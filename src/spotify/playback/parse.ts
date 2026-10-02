import { INACTIVE_OBSERVATION, type PlaybackDevice, type PlaybackItem, type PlaybackObservation } from "../../playback/model";
import { SpotifyInvalidResponseError } from "../errors";
import { isRecord } from "../http";

/**
 * Normalizes a `GET /v1/me/player` response (Get Playback State).
 *
 * - `204 No Content` (no body) means there is no active playback → inactive observation.
 * - A body without a device is treated as inactive too.
 * - Tracks and episodes are fully supported; ads and unknown future item types are represented without failing.
 * @param status HTTP status of the successful response.
 * @param body Parsed body.
 * @returns The observation.
 */
export function parsePlaybackState(status: number, body: unknown): PlaybackObservation {
	if (status === 204 || body === undefined) {
		return INACTIVE_OBSERVATION;
	}
	if (!isRecord(body)) {
		throw new SpotifyInvalidResponseError("playback state was not a JSON object");
	}

	const device = parseDevice(body.device);
	if (device === undefined) {
		return INACTIVE_OBSERVATION;
	}

	const currentlyPlayingType = typeof body.currently_playing_type === "string" ? body.currently_playing_type : undefined;
	return {
		active: true,
		isPlaying: body.is_playing === true,
		device,
		item: parseItem(body.item, currentlyPlayingType),
		progressMs: toNonNegativeNumber(body.progress_ms),
	};
}

/**
 * Parses the device object.
 * @param value Raw device.
 * @returns The device; otherwise `undefined` when missing or invalid.
 */
function parseDevice(value: unknown): PlaybackDevice | undefined {
	if (!isRecord(value)) {
		return undefined;
	}
	return {
		id: typeof value.id === "string" && value.id.length > 0 ? value.id : undefined,
		name: typeof value.name === "string" ? truncate(value.name, 100) : "Unknown device",
		type: typeof value.type === "string" ? truncate(value.type, 40) : "Unknown",
		isRestricted: value.is_restricted === true,
		volumePercent: parseVolumePercent(value.volume_percent),
		supportsVolume: value.supports_volume === true,
	};
}

/**
 * Validates a device volume.
 * @param value Raw `volume_percent` (Spotify sends an integer 0–100, or `null` when unknown).
 * @returns The volume rounded to a whole percent; otherwise `undefined` when missing, not a finite number, or outside 0–100.
 */
export function parseVolumePercent(value: unknown): number | undefined {
	if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 100) {
		return undefined;
	}
	return Math.round(value);
}

/**
 * Parses the current item (track, episode, or anything else).
 * @param value Raw item.
 * @param currentlyPlayingType Spotify's `currently_playing_type` (`track`, `episode`, `ad`, `unknown`).
 * @returns The item; otherwise `undefined` when nothing is loaded.
 */
function parseItem(value: unknown, currentlyPlayingType: string | undefined): PlaybackItem | undefined {
	if (!isRecord(value)) {
		// Ads are reported without an item.
		return currentlyPlayingType === "ad"
			? { type: "ad", id: undefined, uri: undefined, title: "Advertisement", subtitle: "", durationMs: undefined }
			: undefined;
	}

	const base = {
		id: typeof value.id === "string" && value.id.length > 0 ? value.id : undefined,
		uri: typeof value.uri === "string" && value.uri.length > 0 ? value.uri : undefined,
		title: typeof value.name === "string" ? truncate(value.name.trim(), 200) : "",
		durationMs: toNonNegativeNumber(value.duration_ms),
	};

	switch (value.type) {
		case "track":
			return { ...base, type: "track", subtitle: joinArtists(value.artists) };
		case "episode": {
			const show = isRecord(value.show) ? value.show : undefined;
			const subtitle = typeof show?.name === "string" ? show.name : typeof show?.publisher === "string" ? show.publisher : "";
			return { ...base, type: "episode", subtitle: truncate(subtitle.trim(), 200) };
		}
		default:
			return { ...base, type: "unknown", subtitle: "" };
	}
}

/**
 * Joins artist names.
 * @param value Raw artists array.
 * @returns Comma-separated names.
 */
function joinArtists(value: unknown): string {
	if (!Array.isArray(value)) {
		return "";
	}
	const names = value.flatMap((artist) => (isRecord(artist) && typeof artist.name === "string" && artist.name.trim().length > 0 ? [artist.name.trim()] : []));
	return truncate(names.join(", "), 200);
}

function toNonNegativeNumber(value: unknown): number | undefined {
	return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;
}

function truncate(value: string, max: number): string {
	return value.length > max ? value.slice(0, max) : value;
}
