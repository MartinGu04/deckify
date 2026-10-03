import { vi } from "vitest";

import { PlaybackService } from "../src/playback/service";
import { PlaylistService, type PlaylistTimingOptions } from "../src/playlists/service";
import { SpotifyApiClient } from "../src/spotify/api/client";
import { SpotifyWebApiTransport } from "../src/spotify/playback/web-api-transport";
import { SpotifyWebApiPlaylists } from "../src/spotify/playlists/web-api-playlists";
import { SpotifyAuthState } from "../src/spotify/state/auth-state";
import { FAKE, fakeFetch, json, recordingLogger, type RecordedRequest } from "./helpers";
import { DEVICE, playerState, trackItem } from "./playback-fixtures";

/** A 22-character base-62 playlist ID derived from a short label (fake, never a real Spotify ID). */
export const pid = (label: string): string => `pl${label}`.padEnd(22, "q").slice(0, 22);

/** A fake track URI. */
export const tid = (label: string): string => `spotify:track:${`tr${label}`.padEnd(22, "q").slice(0, 22)}`;

export const ME = "me-user";

export type FakePlaylist = {
	id: string;
	name: string;
	ownerId: string;
	ownerName: string;
	public: boolean | null;
	collaborative: boolean;
	items: string[];
	snapshot: number;
};

export function playlist(label: string, overrides: Partial<FakePlaylist> = {}): FakePlaylist {
	return { id: pid(label), name: `Playlist ${label}`, ownerId: ME, ownerName: "Me", public: false, collaborative: false, items: [], snapshot: 1, ...overrides };
}

type Override = { match: (req: RecordedRequest) => boolean; respond: (req: RecordedRequest) => Response; once: boolean };

/**
 * An in-memory Spotify Web API for playlists and the player. Every request is recorded; overrides inject failures.
 */
export function fakeSpotifyServer(initial: FakePlaylist[] = []) {
	const server = {
		playlists: initial,
		/** What `GET /me/player` reports; `undefined` means no active device (204). */
		player: playerState({ item: trackItem({ uri: tid("A"), id: "trA" }) }) as Record<string, unknown> | undefined,
		played: [] as unknown[],
		overrides: [] as Override[],
		/** When set, matching requests wait until released. */
		gates: [] as { match: (req: RecordedRequest) => boolean; waiting: (() => void)[] }[],
		respondOnce(match: (req: RecordedRequest) => boolean, respond: (req: RecordedRequest) => Response): void {
			this.overrides.push({ match, respond, once: true });
		},
		respondAlways(match: (req: RecordedRequest) => boolean, respond: (req: RecordedRequest) => Response): void {
			this.overrides.push({ match, respond, once: false });
		},
		gate(match: (req: RecordedRequest) => boolean): { release: () => void; pending: () => number } {
			const gate = { match, waiting: [] as (() => void)[] };
			this.gates.push(gate);
			return { release: () => gate.waiting.shift()?.(), pending: () => gate.waiting.length };
		},
		find(id: string): FakePlaylist | undefined {
			return this.playlists.find((p) => p.id === id);
		},
	};

	const simplified = (p: FakePlaylist): Record<string, unknown> => ({
		id: p.id,
		uri: `spotify:playlist:${p.id}`,
		name: p.name,
		owner: { id: p.ownerId, display_name: p.ownerName, type: "user" },
		public: p.public,
		collaborative: p.collaborative,
		snapshot_id: `snap-${String(p.snapshot)}`,
		items: { href: `https://api.spotify.com/v1/playlists/${p.id}/items`, total: p.items.length },
		external_urls: { spotify: `https://open.spotify.com/playlist/${p.id}` },
		type: "playlist",
	});

	const handle = async (req: RecordedRequest): Promise<Response> => {
		for (const gate of server.gates) {
			if (gate.match(req)) {
				await new Promise<void>((resolve) => gate.waiting.push(resolve));
			}
		}
		const override = server.overrides.find((o) => o.match(req));
		if (override) {
			if (override.once) {
				server.overrides.splice(server.overrides.indexOf(override), 1);
			}
			return override.respond(req);
		}

		const path = req.url.pathname;
		const offset = Number(req.url.searchParams.get("offset") ?? "0");
		const limit = Number(req.url.searchParams.get("limit") ?? "20");
		if (path === "/v1/me/playlists" && req.method === "GET") {
			const page = server.playlists.slice(offset, offset + limit).map(simplified);
			return json(200, { items: page, total: server.playlists.length, limit, offset, next: offset + limit < server.playlists.length ? "x" : null });
		}
		if (path === "/v1/me/player" && req.method === "GET") {
			return server.player === undefined ? new Response(null, { status: 204 }) : json(200, server.player);
		}
		if (path === "/v1/me/player/play" && req.method === "PUT") {
			server.played.push(JSON.parse(req.body || "null"));
			return new Response(null, { status: 204 });
		}
		const items = /^\/v1\/playlists\/([A-Za-z0-9]{22})\/items$/.exec(path);
		const single = /^\/v1\/playlists\/([A-Za-z0-9]{22})$/.exec(path);
		const target = server.find((items ?? single)?.[1] ?? "");
		if ((items || single) && target === undefined) {
			return json(404, { error: { status: 404, message: "Not found." } });
		}
		if (single && target && req.method === "GET") {
			return json(200, simplified(target));
		}
		if (items && target && req.method === "GET") {
			const page = target.items.slice(offset, offset + limit).map((uri) => ({ added_at: "2026-01-01T00:00:00Z", item: { uri } }));
			return json(200, { items: page, total: target.items.length });
		}
		if (items && target && req.method === "POST") {
			const body = JSON.parse(req.body) as { uris: string[] };
			target.items.push(...body.uris);
			target.snapshot++;
			return json(201, { snapshot_id: `snap-${String(target.snapshot)}` });
		}
		return json(500, { error: { status: 500, message: `unexpected ${req.method} ${path}` } });
	};

	const { fetch, requests } = fakeFetch(handle);
	return { server, fetch, requests };
}

/**
 * The real API client, transports, playback service and playlist service on top of the fake server.
 */
export function playlistSetup(
	options: { playlists?: FakePlaylist[]; product?: string; connected?: boolean; timing?: Partial<PlaylistTimingOptions> } = {},
) {
	const { server, fetch, requests } = fakeSpotifyServer(options.playlists);
	const tokens = { getAccessToken: vi.fn(() => Promise.resolve(FAKE.accessToken)), refreshAccessToken: vi.fn(() => Promise.resolve(FAKE.accessToken2)) };
	const api = new SpotifyApiClient(tokens, { fetch });
	const auth = new SpotifyAuthState();
	const connect = (userId = ME, product = options.product ?? "premium"): void => {
		auth.update({ status: "connected", profile: { id: userId, displayName: userId, product }, authorizedAt: 1 });
	};
	if (options.connected !== false) {
		connect();
	}
	const onAuthRejected = vi.fn();
	const logger = recordingLogger();
	const playback = new PlaybackService({ transport: new SpotifyWebApiTransport(api), auth, clock: () => Date.now(), onAuthRejected });
	const playlists = new PlaylistService({
		transport: new SpotifyWebApiPlaylists(api),
		auth,
		playback,
		onAuthRejected,
		clock: () => Date.now(),
		logger,
		timing: options.timing,
	});
	const calls = (method: string, pathPattern: RegExp): RecordedRequest[] => requests.filter((r) => r.method === method && pathPattern.test(r.url.pathname));
	return { server, requests, calls, tokens, auth, connect, playback, playlists, onAuthRejected, logger };
}

export { DEVICE };
