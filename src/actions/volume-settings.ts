/**
 * Per-key settings of the Volume Up / Volume Down keys, edited in the volume Property Inspector. Never trusted as-is: always read through
 * {@link normalizeVolumeStep}.
 */
export type VolumeKeySettings = {
	/** Percentage points per press, 1–50. */
	volumeStep?: number;
};

export const DEFAULT_VOLUME_STEP = 10;
export const MIN_VOLUME_STEP = 1;
export const MAX_VOLUME_STEP = 50;

/**
 * Validates a stored volume step.
 * @param value Raw setting from Stream Deck (anything).
 * @returns A whole number from 1 to 50; otherwise the default of 10.
 */
export function normalizeVolumeStep(value: unknown): number {
	let step: number | undefined;
	if (typeof value === "number") {
		step = value;
	} else if (typeof value === "string" && /^\s*\d{1,2}\s*$/.test(value)) {
		step = Number.parseInt(value, 10);
	}
	return step !== undefined && Number.isInteger(step) && step >= MIN_VOLUME_STEP && step <= MAX_VOLUME_STEP ? step : DEFAULT_VOLUME_STEP;
}
