import { silentLogger, type Logger } from "../shared/logger";
import { issueForError, type SpotifyAccountIssue } from "./account-issues";
import type { SpotifyAuthService } from "./auth/auth-service";
import { normalizeClientId } from "./client-id";
import { SPOTIFY_REDIRECT_URI } from "./config";
import { describeError } from "./errors";
import { SPOTIFY_DEVELOPER_DASHBOARD_URL } from "./links";
import type { SpotifyAuthActivity, SpotifyAuthSnapshot, SpotifyAuthState, SpotifyAuthStatus } from "./state/auth-state";

/**
 * The fixed set of account operations the Spotify Account Property Inspector and the Deckify Setup App may request. None of them carries a
 * URL: Open Dashboard always opens {@link SPOTIFY_DEVELOPER_DASHBOARD_URL}.
 */
export type SpotifyAccountCommand =
	| { readonly type: "save-client-id"; readonly clientId: string }
	| { readonly type: "connect" }
	| { readonly type: "retry-connect" }
	| { readonly type: "cancel-connect" }
	| { readonly type: "disconnect" }
	| { readonly type: "open-dashboard" };

/** Every command name, for validation. */
export const SPOTIFY_ACCOUNT_COMMANDS: readonly SpotifyAccountCommand["type"][] = [
	"save-client-id",
	"connect",
	"retry-connect",
	"cancel-connect",
	"disconnect",
	"open-dashboard",
];

/** A problem with a Client ID the user entered, or with the request itself, shown next to the Client ID field. */
export type ClientIdProblem = { readonly message: string; readonly issue: SpotifyAccountIssue };

/**
 * The public account state shown by the Property Inspector and the Setup App. Never contains tokens, codes, verifiers or keys; a test pins
 * the exact keys.
 */
export type PublicSpotifyAccountState = {
	readonly status: SpotifyAuthStatus;
	readonly clientId: string;
	readonly redirectUri: string;
	readonly displayName: string | null;
	readonly product: string | null;
	readonly authorizedAt: number | null;
	readonly message: string | null;
	readonly issue: SpotifyAccountIssue | null;
	readonly activity: SpotifyAuthActivity | null;
};

/**
 * Public account state plus the outcome of the last Client ID request.
 */
export type PublicSpotifyAccountPayload = {
	readonly state: PublicSpotifyAccountState;
	readonly clientIdError: string | null;
	readonly clientIdIssue: SpotifyAccountIssue | null;
};

/**
 * Projects the shared snapshot onto the public payload.
 * @param snapshot Shared state.
 * @param clientIdProblem Problem with the Client ID request, if any.
 * @returns The payload.
 */
export function toPublicAccountPayload(snapshot: SpotifyAuthSnapshot, clientIdProblem?: ClientIdProblem): PublicSpotifyAccountPayload {
	return {
		state: {
			status: snapshot.status,
			clientId: snapshot.clientId ?? "",
			redirectUri: SPOTIFY_REDIRECT_URI,
			displayName: snapshot.profile?.displayName ?? null,
			product: snapshot.profile?.product ?? null,
			authorizedAt: snapshot.authorizedAt ?? null,
			message: snapshot.message ?? null,
			issue: snapshot.issue ?? null,
			activity: snapshot.activity ?? null,
		},
		clientIdError: clientIdProblem?.message ?? null,
		clientIdIssue: clientIdProblem?.issue ?? null,
	};
}

/**
 * Validates a command. Unknown types, missing fields and wrong types are rejected; extra fields (e.g. a URL) are ignored.
 * @param payload Raw message.
 * @param prefix Prefix of the `type` (e.g. `deckify:spotify:` for the Property Inspector).
 * @returns The command; otherwise `undefined`.
 */
export function parseSpotifyAccountCommand(payload: unknown, prefix = ""): SpotifyAccountCommand | undefined {
	if (typeof payload !== "object" || payload === null || !("type" in payload) || typeof payload.type !== "string") {
		return undefined;
	}
	if (!payload.type.startsWith(prefix)) {
		return undefined;
	}
	const type = payload.type.slice(prefix.length);
	switch (type) {
		case "connect":
		case "retry-connect":
		case "cancel-connect":
		case "disconnect":
		case "open-dashboard":
			return { type };
		case "save-client-id":
			return "clientId" in payload && typeof payload.clientId === "string" && payload.clientId.length <= 256 ? { type, clientId: payload.clientId } : undefined;
		default:
			return undefined;
	}
}

/**
 * Dependencies of {@link SpotifyAccountCommands}.
 */
export type SpotifyAccountCommandsOptions = {
	readonly auth: SpotifyAuthService;
	readonly state: SpotifyAuthState;

	/** Persists the Client ID in Deckify's global settings. */
	readonly saveClientId: (clientId: string | undefined) => Promise<void>;

	/** Opens a URL in the default browser; only ever called with {@link SPOTIFY_DEVELOPER_DASHBOARD_URL}. */
	readonly openUrl: (url: string) => Promise<void>;
	readonly logger?: Logger;
};

/**
 * Runs the account commands shared by the Property Inspector and the Setup App. All OAuth and token handling stays in
 * {@link SpotifyAuthService}; this only validates input and forwards it.
 */
export class SpotifyAccountCommands {
	readonly #auth: SpotifyAuthService;
	readonly #state: SpotifyAuthState;
	readonly #saveClientId: (clientId: string | undefined) => Promise<void>;
	readonly #openUrl: (url: string) => Promise<void>;
	readonly #logger: Logger;

	/**
	 * Initializes a new instance of the {@link SpotifyAccountCommands} class.
	 * @param options Dependencies.
	 */
	constructor(options: SpotifyAccountCommandsOptions) {
		this.#auth = options.auth;
		this.#state = options.state;
		this.#saveClientId = options.saveClientId;
		this.#openUrl = options.openUrl;
		this.#logger = options.logger ?? silentLogger;
	}

	/**
	 * The current public payload.
	 * @param clientIdProblem Problem with the last Client ID request, if any.
	 * @returns The payload.
	 */
	payload(clientIdProblem?: ClientIdProblem): PublicSpotifyAccountPayload {
		return toPublicAccountPayload(this.#state.snapshot, clientIdProblem);
	}

	/**
	 * Runs a command. Never throws.
	 * @param command Validated command.
	 * @returns A problem to show next to the Client ID field; otherwise `undefined`.
	 */
	async run(command: SpotifyAccountCommand): Promise<ClientIdProblem | undefined> {
		try {
			switch (command.type) {
				case "save-client-id":
					return await this.#saveClientIdFrom(command.clientId);
				case "connect":
					await this.#auth.connect();
					return undefined;
				case "retry-connect":
					await this.#auth.retryConnect();
					return undefined;
				case "cancel-connect":
					this.#auth.cancelConnect();
					return undefined;
				case "disconnect":
					await this.#auth.disconnect();
					return undefined;
				case "open-dashboard":
					this.#logger.info("Opening the Spotify Developer Dashboard.");
					await this.#openUrl(SPOTIFY_DEVELOPER_DASHBOARD_URL);
					return undefined;
			}
		} catch (err) {
			this.#logger.error("Spotify account request failed.", err);
			return { message: describeError(err), issue: issueForError(err) };
		}
	}

	/**
	 * Validates (with the existing Client ID validator), stores and applies a Client ID.
	 * @param input Raw Client ID.
	 * @returns The validation problem; otherwise `undefined`.
	 */
	async #saveClientIdFrom(input: string): Promise<ClientIdProblem | undefined> {
		let clientId: string | undefined;
		try {
			clientId = normalizeClientId(input);
		} catch (err) {
			return { message: describeError(err), issue: issueForError(err) };
		}
		await this.#saveClientId(clientId);
		await this.#auth.setClientId(clientId);
		return undefined;
	}
}
