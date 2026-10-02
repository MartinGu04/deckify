/**
 * Local (on-this-PC) playback command path, tried before the Spotify Web API for lower latency.
 *
 * This is transport-independent: the Windows media-session bridge implements it today; actions never see it.
 */

/** Commands a local transport may perform. `toggle` lets the local player decide between play and pause without a state read. */
export type LocalPlaybackCommand = "toggle" | "play" | "pause" | "next" | "previous";

/**
 * Result of a local command.
 *
 * - `handled`: the local Spotify app performed the command; the Web API must not be used for it.
 * - `unavailable`: the command was definitely NOT performed (no Spotify session, helper not running, command rejected...). Falling back to
 *   the Web API is safe and cannot duplicate the command.
 * - `uncertain`: the command may or may not have been performed (e.g. the helper timed out or exited mid-request). Never fall back: a
 *   fallback could skip two tracks. The state is reconciled instead.
 */
export type LocalCommandResult =
	| { readonly status: "handled" }
	| { readonly status: "unavailable"; readonly reason: string }
	| { readonly status: "uncertain"; readonly reason: string };

/**
 * A local playback command transport.
 *
 * Contract: `execute` reports uncertainty through its result. A thrown error means nothing was sent, so callers may fall back.
 */
export interface LocalPlaybackCommandTransport {
	/** Short identifier for logs, e.g. `"windows-gsmtc"`. */
	readonly id: string;

	/** Performs a command on the local Spotify app. */
	execute(command: LocalPlaybackCommand): Promise<LocalCommandResult>;

	/** Whether a controllable local Spotify session currently exists. Side-effect free; `false` on any problem. */
	isAvailable(): Promise<boolean>;

	/** Stops any helper process. */
	dispose(): void;
}
