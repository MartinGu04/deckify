import { createServer, type IncomingMessage, type ServerResponse } from "node:http";

import { silentLogger, type Logger } from "../../shared/logger";
import { AUTHORIZATION_TIMEOUT_MS, SPOTIFY_REDIRECT_HOST, SPOTIFY_REDIRECT_PATH, SPOTIFY_REDIRECT_PORT, SPOTIFY_REDIRECT_URI } from "../config";
import {
	AuthorizationCallbackError,
	AuthorizationCancelledError,
	AuthorizationDeniedError,
	AuthorizationStateMismatchError,
	AuthorizationTimeoutError,
	CallbackListenerError,
	CallbackPortInUseError,
} from "../errors";
import { renderCallbackPage } from "./callback-page";
import { isValidState } from "./pkce";

/**
 * Result of a successful authorization callback.
 */
export type AuthorizationCallback = {
	/** Authorization code; single-use and short-lived, but still never logged. */
	readonly code: string;
};

/**
 * A running, single-use callback listener for one authorization attempt.
 */
export interface CallbackListener {
	/** Settles exactly once: with the authorization code, or with an error (denied, state mismatch, timeout, cancelled). */
	readonly result: Promise<AuthorizationCallback>;

	/** Cancels the attempt (if still pending) and closes the listener. Safe to call more than once. */
	close(): void;
}

/**
 * Options for {@link startCallbackListener}.
 */
export type CallbackListenerOptions = {
	/** The `state` sent with the authorization request. */
	readonly expectedState: string;

	/** How long to wait for the callback; defaults to two minutes. */
	readonly timeoutMs?: number;

	readonly logger?: Logger;
};

/** The only Host header a legitimate redirect can carry. Anything else (e.g. DNS rebinding) is rejected. */
const EXPECTED_HOST = `${SPOTIFY_REDIRECT_HOST}:${SPOTIFY_REDIRECT_PORT}`;

/**
 * Starts the local OAuth callback listener on exactly `127.0.0.1:43821`.
 *
 * Resolves once the listener is accepting connections, so the browser is only opened when the redirect can be received. Rejects with
 * {@link CallbackPortInUseError} when the port is taken; there is no fallback port or host.
 * @param options Listener options.
 * @returns The running listener.
 */
export async function startCallbackListener(options: CallbackListenerOptions): Promise<CallbackListener> {
	const { expectedState, timeoutMs = AUTHORIZATION_TIMEOUT_MS, logger = silentLogger } = options;

	let settled = false;
	let resolveResult!: (value: AuthorizationCallback) => void;
	let rejectResult!: (reason: Error) => void;
	const result = new Promise<AuthorizationCallback>((resolve, reject) => {
		resolveResult = resolve;
		rejectResult = reject;
	});
	// The owner awaits `result` later; never let an early rejection surface as an unhandled rejection.
	result.catch(() => undefined);

	const server = createServer((req, res) => {
		handleRequest(req, res);
	});
	server.keepAliveTimeout = 1;

	const shutdown = (): void => {
		server.close();
		server.closeAllConnections();
	};

	const settle = (outcome: AuthorizationCallback | Error, res?: ServerResponse): void => {
		if (settled) {
			return;
		}
		settled = true;
		clearTimeout(timer);

		// Let the browser receive the result page before the connection is torn down.
		if (res && !res.writableFinished) {
			server.close();
			res.once("close", shutdown);
		} else {
			shutdown();
		}

		if (outcome instanceof Error) {
			logger.info(`Spotify authorization attempt ended: ${outcome.name}.`);
			rejectResult(outcome);
		} else {
			logger.info("Spotify authorization callback received.");
			resolveResult(outcome);
		}
	};

	const handleRequest = (req: IncomingMessage, res: ServerResponse): void => {
		if (settled) {
			send(res, 410, renderCallbackPage("error", "This Deckify sign-in attempt has already finished. Close this window."));
			return;
		}
		if (req.method !== "GET") {
			send(res, 405, renderCallbackPage("error", "Method not allowed."));
			return;
		}
		if (req.headers.host !== EXPECTED_HOST) {
			send(res, 400, renderCallbackPage("error", "Unexpected host."));
			return;
		}

		let url: URL;
		try {
			url = new URL(req.url ?? "/", SPOTIFY_REDIRECT_URI);
		} catch {
			send(res, 400, renderCallbackPage("error", "Malformed request."));
			return;
		}
		if (url.pathname !== SPOTIFY_REDIRECT_PATH) {
			send(res, 404, renderCallbackPage("error", "Not found."));
			return;
		}

		const params = url.searchParams;
		if (!isValidState(expectedState, params.get("state"))) {
			const error = new AuthorizationStateMismatchError();
			send(res, 400, renderCallbackPage("error", error.message));
			settle(error, res);
			return;
		}

		const oauthError = params.get("error");
		if (oauthError !== null) {
			const error = oauthError === "access_denied" ? new AuthorizationDeniedError() : new AuthorizationCallbackError(oauthError);
			send(res, 200, renderCallbackPage("denied", error.message));
			settle(error, res);
			return;
		}

		const code = params.get("code");
		if (code === null || code.length === 0) {
			const error = new AuthorizationCallbackError("missing_code", "Spotify did not return an authorization code. Please try again.");
			send(res, 400, renderCallbackPage("error", error.message));
			settle(error, res);
			return;
		}

		send(res, 200, renderCallbackPage("success", "Deckify is connected to Spotify. You can close this window."));
		settle({ code }, res);
	};

	const timer = setTimeout(() => {
		settle(new AuthorizationTimeoutError());
	}, timeoutMs);

	await new Promise<void>((resolve, reject) => {
		const onError = (err: NodeJS.ErrnoException): void => {
			settled = true;
			clearTimeout(timer);
			reject(toListenError(err));
		};
		server.once("error", onError);
		server.listen({ host: SPOTIFY_REDIRECT_HOST, port: SPOTIFY_REDIRECT_PORT, exclusive: true }, () => {
			server.off("error", onError);
			resolve();
		});
	});

	server.on("error", (err) => {
		settle(new CallbackListenerError(err.message, { cause: err }));
	});

	logger.info(`Spotify callback listener started on ${SPOTIFY_REDIRECT_URI}.`);

	return {
		result,
		close: () => {
			settle(new AuthorizationCancelledError());
		},
	};
}

/**
 * Maps a `listen` failure to a Deckify error.
 * @param err The error raised by the server.
 * @returns The mapped error.
 */
function toListenError(err: NodeJS.ErrnoException): Error {
	switch (err.code) {
		case "EADDRINUSE":
			return new CallbackPortInUseError({ cause: err });
		case "EACCES":
			return new CallbackListenerError(`access to port ${SPOTIFY_REDIRECT_PORT} was denied; it may be reserved by Windows`, { cause: err });
		default:
			return new CallbackListenerError(err.code ?? err.message, { cause: err });
	}
}

/**
 * Sends a local HTML page. The page never references external resources and must not be cached; `no-referrer` keeps the callback URL
 * (which contains the authorization code) from leaking.
 * @param res Response.
 * @param status HTTP status.
 * @param html Page.
 */
function send(res: ServerResponse, status: number, html: string): void {
	res.writeHead(status, {
		"Content-Type": "text/html; charset=utf-8",
		"Cache-Control": "no-store",
		"Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
		"Referrer-Policy": "no-referrer",
		"X-Content-Type-Options": "nosniff",
		Connection: "close",
	});
	res.end(html);
}
