import { describe, expect, it } from "vitest";

import { normalizeClientId } from "../src/spotify/client-id";
import { SpotifyClientIdError } from "../src/spotify/errors";
import { FAKE } from "./helpers";

describe("normalizeClientId", () => {
	it("accepts and trims a 32-character hexadecimal Client ID", () => {
		expect(normalizeClientId(`  ${FAKE.clientId}\n`)).toBe(FAKE.clientId);
	});

	it("treats empty input as removing the Client ID", () => {
		expect(normalizeClientId("")).toBeUndefined();
		expect(normalizeClientId("   ")).toBeUndefined();
		expect(normalizeClientId(undefined)).toBeUndefined();
	});

	it("rejects malformed values", () => {
		expect(() => normalizeClientId("not-a-client-id")).toThrow(SpotifyClientIdError);
		expect(() => normalizeClientId(`${FAKE.clientId}0`)).toThrow(SpotifyClientIdError);
		expect(() => normalizeClientId(42)).toThrow(SpotifyClientIdError);
	});
});
