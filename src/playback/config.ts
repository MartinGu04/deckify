/**
 * Playback polling and reconciliation timings.
 *
 * Spotify Development Mode apps have request quotas as well as rate limits, so polling is shared (one poller for every key), only runs while
 * a playback key is visible and Spotify is connected, and slows down when nothing is changing.
 */
export const PlaybackTiming = {
	/** While something is playing (progress and track changes matter). */
	playingIntervalMs: 3_000,

	/** While paused. */
	pausedIntervalMs: 8_000,

	/** While there is no active device or playback. */
	inactiveIntervalMs: 15_000,

	/** After a failed state request (network, server or 403 errors). */
	errorIntervalMs: 30_000,

	/** Delay before re-reading the state after a successful command, giving Spotify time to apply it. */
	reconcileDelayMs: 700,

	/** Second check after Next/Previous when the first reconciliation still shows the old item. */
	trackChangeRecheckMs: 2_000,

	/** Volume restored by Unmute when Deckify has not seen a non-zero volume since it started. */
	defaultUnmuteVolumePercent: 50,

	/** Back-off when Spotify rate limits without a Retry-After header. */
	defaultRateLimitBackoffMs: 10_000,

	/** Back-off when the Development Mode quota is exhausted without a Retry-After header. */
	defaultQuotaBackoffMs: 30 * 60_000,
} as const;

export type PlaybackTimingOptions = { readonly [K in keyof typeof PlaybackTiming]: number };
