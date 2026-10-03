import { describe, expect, it, vi } from "vitest";

import {
	DUPLICATE_REQUEST_WINDOW_MS,
	EXPERIENCE_DEVICE_TYPE,
	EXPERIENCE_IDS,
	EXPERIENCE_PROFILES,
	ExperienceSwitcher,
	parseExperienceId,
	type ExperienceDevice,
} from "../src/experiences/experiences";
import { recordingLogger } from "./helpers";

// The plugin side of Deckify's experiences: the fixed ID → bundled profile mapping, device checks and race safety.
const DEVICES: Readonly<Record<string, ExperienceDevice>> = {
	mk2: { type: 0, isConnected: true },
	"other-mk2": { type: 0, isConnected: true },
	mini: { type: 1, isConnected: true },
	xl: { type: 2, isConnected: true },
	plus: { type: 7, isConnected: true },
	neo: { type: 9, isConnected: true },
	unplugged: { type: 0, isConnected: false },
};

function switcher() {
	let now = 1_000_000;
	const switchToProfile = vi.fn((_deviceId: string, _profile: string) => Promise.resolve());
	const logger = recordingLogger();
	const experiences = new ExperienceSwitcher({ getDevice: (id) => DEVICES[id], switchToProfile, clock: () => now, logger });
	return { experiences, switchToProfile, logger, advance: (ms: number) => (now += ms) };
}

describe("experience IDs", () => {
	it("are exactly deckify and simple, each mapped to its real bundled export", () => {
		expect(EXPERIENCE_IDS).toEqual(["deckify", "simple"]);
		expect(EXPERIENCE_PROFILES).toEqual({ deckify: "profiles/DECKIFY ⭐ Recommended", simple: "profiles/SIMPLE" });
		expect(Object.isFrozen(EXPERIENCE_PROFILES)).toBe(true);
		expect(EXPERIENCE_DEVICE_TYPE).toBe(0);
	});

	it("parse only the fixed IDs", () => {
		for (const id of EXPERIENCE_IDS) {
			expect(parseExperienceId(id)).toBe(id);
		}
		for (const value of [
			"power",
			"POWER",
			"Deckify",
			"DECKIFY",
			"SIMPLE",
			" deckify",
			"DECKIFY ⭐ Recommended",
			"profiles/SIMPLE",
			"profiles/DECKIFY ⭐ Recommended",
			"../deckify",
			"toString",
			"__proto__",
			"constructor",
			"",
			0,
			null,
			undefined,
			["simple"],
			{ id: "simple" },
		]) {
			expect(parseExperienceId(value), JSON.stringify(value)).toBeUndefined();
		}
	});
});

describe("ExperienceSwitcher", () => {
	it("supports only connected Stream Deck / MK.2 devices", () => {
		const { experiences } = switcher();
		expect(experiences.support("mk2")).toBe("supported");
		for (const id of ["mini", "xl", "plus", "neo"]) {
			expect(experiences.support(id), id).toBe("unsupported-device");
		}
		expect(experiences.support("unplugged")).toBe("device-unavailable");
		expect(experiences.support("unknown")).toBe("device-unavailable");
		expect(experiences.support(undefined)).toBe("device-unavailable");
	});

	it("switches the given device to the experience's bundled profile", async () => {
		const { experiences, switchToProfile } = switcher();
		expect(await experiences.choose("simple", "mk2")).toBe("requested");
		expect(await experiences.choose("deckify", "other-mk2")).toBe("requested");
		expect(switchToProfile.mock.calls).toEqual([
			["mk2", "profiles/SIMPLE"],
			["other-mk2", "profiles/DECKIFY ⭐ Recommended"],
		]);
	});

	it("never attempts a switch on an unsupported, unplugged or unknown device", async () => {
		const { experiences, switchToProfile } = switcher();
		expect(await experiences.choose("deckify", "plus")).toBe("unsupported-device");
		expect(await experiences.choose("deckify", "unplugged")).toBe("device-unavailable");
		expect(await experiences.choose("deckify", "unknown")).toBe("device-unavailable");
		expect(await experiences.choose("deckify", undefined)).toBe("device-unavailable");
		expect(switchToProfile).not.toHaveBeenCalled();
	});

	it("shares a request in flight and answers a different one with busy", async () => {
		const { experiences, switchToProfile } = switcher();
		let release = (): void => undefined;
		switchToProfile.mockImplementationOnce(() => new Promise<void>((resolve) => (release = resolve)));
		const first = experiences.choose("deckify", "mk2");
		const second = experiences.choose("deckify", "mk2");
		expect(await experiences.choose("simple", "mk2")).toBe("busy");
		release();
		expect(await Promise.all([first, second])).toEqual(["requested", "requested"]);
		expect(switchToProfile).toHaveBeenCalledTimes(1);
	});

	it("does not resend a repeat within the duplicate window, but does when chosen again later", async () => {
		const { experiences, switchToProfile, advance } = switcher();
		await experiences.choose("deckify", "mk2");
		advance(DUPLICATE_REQUEST_WINDOW_MS - 1);
		expect(await experiences.choose("deckify", "mk2")).toBe("requested");
		expect(switchToProfile).toHaveBeenCalledTimes(1);
		// A different experience is a different request.
		await experiences.choose("simple", "mk2");
		expect(switchToProfile).toHaveBeenCalledTimes(2);
		advance(DUPLICATE_REQUEST_WINDOW_MS);
		await experiences.choose("simple", "mk2");
		expect(switchToProfile).toHaveBeenCalledTimes(3);
	});

	it("reports a refused switch, including one that throws synchronously, and recovers", async () => {
		const { experiences, switchToProfile } = switcher();
		switchToProfile.mockRejectedValueOnce(new Error("refused"));
		expect(await experiences.choose("deckify", "mk2")).toBe("failed");
		switchToProfile.mockImplementationOnce(() => {
			throw new Error("not connected");
		});
		expect(await experiences.choose("deckify", "mk2")).toBe("failed");
		expect(await experiences.choose("deckify", "mk2")).toBe("requested");
		expect(switchToProfile).toHaveBeenCalledTimes(3);
	});

	it("logs the profile, never the device ID", async () => {
		const { experiences, logger } = switcher();
		await experiences.choose("deckify", "mk2");
		await experiences.choose("deckify", "plus");
		const log = logger.lines.join("\n");
		expect(log).toContain("profiles/DECKIFY ⭐ Recommended");
		expect(log).not.toMatch(/\bmk2\b|\bplus\b/);
	});
});
