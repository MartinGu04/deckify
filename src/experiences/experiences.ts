import { silentLogger, type Logger } from "../shared/logger";

/**
 * Deckify experiences: ready-made, editable Stream Deck layouts bundled with the plugin as Stream Deck profiles.
 *
 * The Setup App may only send one of these fixed IDs. The plugin alone maps an ID to its bundled profile (registered in the manifest's
 * `Profiles` array) and to the device that opened Deckify Setup; the browser never sends a profile name, path or device ID.
 */
export const EXPERIENCE_IDS = ["deckify", "simple"] as const;

/** One of the fixed experience IDs. */
export type ExperienceId = (typeof EXPERIENCE_IDS)[number];

/**
 * Bundled profile of each experience: the manifest `Profiles[].Name` (the path of the `.streamDeckProfile` without its extension), which is
 * exactly what Stream Deck's `switchToProfile` expects. The file names are the names of the real Stream Deck exports.
 */
export const EXPERIENCE_PROFILES: Readonly<Record<ExperienceId, string>> = Object.freeze({
	deckify: "profiles/DECKIFY ⭐ Recommended",
	simple: "profiles/SIMPLE",
});

/** Stream Deck device type the bundled profiles are made for: Stream Deck / Stream Deck MK.2 (15 keys, 5 × 3). */
export const EXPERIENCE_DEVICE_TYPE = 0;

/** A request repeated within this window (double-click, retried request) is answered without asking Stream Deck again. */
export const DUPLICATE_REQUEST_WINDOW_MS = 4000;

/**
 * Whether Deckify's experiences can be installed on the device that opened Deckify Setup.
 * - `supported`: a connected Stream Deck / MK.2;
 * - `unsupported-device`: another kind of Stream Deck (Phase 9 profiles are for 15-key devices only);
 * - `device-unavailable`: the device is unknown or disconnected.
 */
export type ExperienceSupport = "supported" | "unsupported-device" | "device-unavailable";

/**
 * Outcome of choosing an experience. `requested` means the switch was sent to Stream Deck, nothing more: Stream Deck may first ask the user
 * to install the profile, and it does not report back.
 */
export type ExperienceOutcome = Exclude<ExperienceSupport, "supported"> | "requested" | "busy" | "failed";

/** What Deckify needs to know about a Stream Deck device. */
export type ExperienceDevice = { readonly type: number; readonly isConnected: boolean };

/**
 * Parses an experience ID from untrusted input.
 * @param value Candidate.
 * @returns The ID; otherwise `undefined`.
 */
export function parseExperienceId(value: unknown): ExperienceId | undefined {
	return typeof value === "string" && (EXPERIENCE_IDS as readonly string[]).includes(value) ? (value as ExperienceId) : undefined;
}

/**
 * Dependencies of {@link ExperienceSwitcher}.
 */
export type ExperienceSwitcherOptions = {
	/** Looks up a device the plugin knows (from the SDK's device store). */
	readonly getDevice: (deviceId: string) => ExperienceDevice | undefined;

	/** Stream Deck's official profile switch; Stream Deck only accepts profiles bundled with the plugin. */
	readonly switchToProfile: (deviceId: string, profile: string) => Promise<void>;
	readonly clock?: () => number;
	readonly logger?: Logger;
};

/**
 * Switches the originating Stream Deck to the bundled profile of a chosen experience, at most once per request.
 *
 * Concurrent requests share the one in flight, and a repeat within {@link DUPLICATE_REQUEST_WINDOW_MS} is not sent again, so a double-click
 * never asks Stream Deck twice. Choosing again later (for example "Choose a different experience") is a new, explicit request.
 */
export class ExperienceSwitcher {
	readonly #getDevice: (deviceId: string) => ExperienceDevice | undefined;
	readonly #switchToProfile: (deviceId: string, profile: string) => Promise<void>;
	readonly #clock: () => number;
	readonly #logger: Logger;

	#inFlight: { readonly key: string; readonly promise: Promise<ExperienceOutcome> } | undefined;
	#last: { readonly key: string; readonly at: number } | undefined;

	/**
	 * Initializes a new instance of the {@link ExperienceSwitcher} class.
	 * @param options Dependencies.
	 */
	constructor(options: ExperienceSwitcherOptions) {
		this.#getDevice = options.getDevice;
		this.#switchToProfile = options.switchToProfile;
		this.#clock = options.clock ?? Date.now;
		this.#logger = options.logger ?? silentLogger;
	}

	/**
	 * Whether experiences can be installed on a device.
	 * @param deviceId The device that opened Deckify Setup; `undefined` when unknown.
	 * @returns The support.
	 */
	support(deviceId: string | undefined): ExperienceSupport {
		const device = deviceId === undefined ? undefined : this.#getDevice(deviceId);
		if (device === undefined || !device.isConnected) {
			return "device-unavailable";
		}
		return device.type === EXPERIENCE_DEVICE_TYPE ? "supported" : "unsupported-device";
	}

	/**
	 * Switches a device to the bundled profile of an experience.
	 * @param id Experience (already validated).
	 * @param deviceId The device that opened Deckify Setup (kept plugin-side, never sent by the browser).
	 * @returns The outcome.
	 */
	choose(id: ExperienceId, deviceId: string | undefined): Promise<ExperienceOutcome> {
		const support = this.support(deviceId);
		if (support !== "supported" || deviceId === undefined) {
			this.#logger.info(`Not switching to the ${id} experience: ${support === "supported" ? "device-unavailable" : support}.`);
			return Promise.resolve(support === "supported" ? "device-unavailable" : support);
		}
		const key = `${deviceId}\n${id}`;
		if (this.#inFlight !== undefined) {
			return this.#inFlight.key === key ? this.#inFlight.promise : Promise.resolve("busy");
		}
		const now = this.#clock();
		if (this.#last?.key === key && now - this.#last.at < DUPLICATE_REQUEST_WINDOW_MS) {
			return Promise.resolve("requested");
		}

		const promise: Promise<ExperienceOutcome> = this.#send(deviceId, EXPERIENCE_PROFILES[id], key).finally(() => {
			if (this.#inFlight?.promise === promise) {
				this.#inFlight = undefined;
			}
		});
		this.#inFlight = { key, promise };
		return promise;
	}

	/**
	 * Asks Stream Deck to switch profiles.
	 * @param deviceId Device.
	 * @param profile Bundled profile (manifest name).
	 * @param key Identifies the request, for duplicates.
	 * @returns The outcome.
	 */
	async #send(deviceId: string, profile: string, key: string): Promise<ExperienceOutcome> {
		try {
			this.#logger.info(`Switching the originating Stream Deck to the bundled "${profile}" profile.`);
			await this.#switchToProfile(deviceId, profile);
			this.#last = { key, at: this.#clock() };
			return "requested";
		} catch (err) {
			this.#logger.error(`Stream Deck did not accept the switch to the bundled "${profile}" profile.`, err);
			return "failed";
		}
	}
}
