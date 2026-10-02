import { describe, expect, it } from "vitest";

import { createCodeChallenge, createPkceAttempt, generateCodeVerifier, generateState, isValidState } from "../src/spotify/auth/pkce";

describe("PKCE", () => {
	it("generates verifiers of valid length using only unreserved characters", () => {
		for (let i = 0; i < 50; i++) {
			const verifier = generateCodeVerifier();
			expect(verifier.length).toBeGreaterThanOrEqual(43);
			expect(verifier.length).toBeLessThanOrEqual(128);
			expect(verifier).toMatch(/^[A-Za-z0-9\-._~]+$/);
		}
	});

	it("generates a different verifier every time", () => {
		const verifiers = new Set(Array.from({ length: 100 }, generateCodeVerifier));
		expect(verifiers.size).toBe(100);
	});

	it("derives the S256 challenge (RFC 7636 appendix B test vector)", () => {
		expect(createCodeChallenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk")).toBe("E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
	});

	it("produces base64url challenges without padding", () => {
		expect(createCodeChallenge(generateCodeVerifier())).toMatch(/^[A-Za-z0-9\-_]{43}$/);
	});

	it("creates attempts whose challenge matches the verifier", () => {
		const attempt = createPkceAttempt();
		expect(attempt.codeChallenge).toBe(createCodeChallenge(attempt.codeVerifier));
		expect(attempt.state).not.toBe(attempt.codeVerifier);
	});
});

describe("OAuth state", () => {
	it("generates unpredictable 256-bit state values", () => {
		const states = new Set(Array.from({ length: 100 }, generateState));
		expect(states.size).toBe(100);
		for (const state of states) {
			expect(state).toMatch(/^[A-Za-z0-9\-_]{43}$/);
		}
	});

	it("accepts only an exact match", () => {
		const state = generateState();
		expect(isValidState(state, state)).toBe(true);
		expect(isValidState(state, `${state}x`)).toBe(false);
		expect(isValidState(state, state.slice(1))).toBe(false);
		expect(isValidState(state, generateState())).toBe(false);
		expect(isValidState(state, null)).toBe(false);
		expect(isValidState(state, undefined)).toBe(false);
		expect(isValidState(state, "")).toBe(false);
		expect(isValidState("", "")).toBe(false);
	});
});
