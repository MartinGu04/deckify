/**
 * Minimal logger contract used by Deckify services.
 *
 * Services receive a logger instead of importing the Stream Deck SDK directly, which keeps them testable without a Stream Deck connection.
 * Never pass tokens, authorization codes or PKCE verifiers to a logger.
 */
export interface Logger {
	debug(...data: unknown[]): unknown;
	info(...data: unknown[]): unknown;
	warn(...data: unknown[]): unknown;
	error(...data: unknown[]): unknown;
}

/**
 * Logger that discards everything; the default for services constructed without one (e.g. in tests).
 */
export const silentLogger: Logger = {
	debug: () => undefined,
	info: () => undefined,
	warn: () => undefined,
	error: () => undefined,
};
