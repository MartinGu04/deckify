import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * PKCE (RFC 7636) and OAuth `state` helpers.
 *
 * Verifiers and state values come from the operating system's CSPRNG and are base64url encoded, which only produces characters from the
 * PKCE "unreserved" set (A-Z, a-z, 0-9, "-", "_").
 */

/** Number of random bytes in a code verifier; 64 bytes encode to 86 characters (PKCE allows 43-128). */
const VERIFIER_BYTES = 64;

/** Number of random bytes in an OAuth state value (256 bits). */
const STATE_BYTES = 32;

/**
 * Generates a cryptographically random PKCE code verifier.
 * @returns The code verifier (86 characters).
 */
export function generateCodeVerifier(): string {
	return randomBytes(VERIFIER_BYTES).toString("base64url");
}

/**
 * Derives the S256 code challenge for a verifier: `BASE64URL(SHA256(ASCII(code_verifier)))`.
 * @param verifier Code verifier.
 * @returns The code challenge.
 */
export function createCodeChallenge(verifier: string): string {
	return createHash("sha256").update(verifier, "ascii").digest("base64url");
}

/**
 * Generates a cryptographically random OAuth `state` value.
 * @returns The state value.
 */
export function generateState(): string {
	return randomBytes(STATE_BYTES).toString("base64url");
}

/**
 * Compares a received `state` with the expected value in constant time.
 * @param expected State sent with the authorization request.
 * @param received State returned by the callback.
 * @returns `true` when they match.
 */
export function isValidState(expected: string, received: string | null | undefined): boolean {
	if (typeof received !== "string" || expected.length === 0) {
		return false;
	}
	const a = Buffer.from(expected, "utf8");
	const b = Buffer.from(received, "utf8");
	return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Values that belong to a single authorization attempt.
 */
export type PkceAttempt = {
	readonly codeVerifier: string;
	readonly codeChallenge: string;
	readonly state: string;
};

/**
 * Creates the verifier, challenge and state for a new authorization attempt.
 * @returns The attempt values.
 */
export function createPkceAttempt(): PkceAttempt {
	const codeVerifier = generateCodeVerifier();
	return { codeVerifier, codeChallenge: createCodeChallenge(codeVerifier), state: generateState() };
}
