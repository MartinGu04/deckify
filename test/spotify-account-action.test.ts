import { beforeEach, describe, expect, it, vi } from "vitest";

import type { SpotifyAuthService } from "../src/spotify/auth/auth-service";
import { SpotifyAuthState } from "../src/spotify/state/auth-state";
import { MemoryTokenStore } from "../src/spotify/storage/token-store";
import { FAKE, fakeFetch, findSecrets, profileResponse, storedSession } from "./helpers";

// Minimal stand-in for the Stream Deck SDK: the decorator is a no-op, `actions` lists fake keys, and the UI controller records messages.
const sdk = vi.hoisted(() => ({
	ui: {
		action: undefined as { manifestId: string } | undefined,
		sendToPropertyInspector: vi.fn((_payload: unknown) => Promise.resolve()),
	},
	keys: [] as unknown[],
}));

vi.mock("@elgato/streamdeck", () => ({
	default: { ui: sdk.ui },
	action: () => (target: unknown) => target,
	SingletonAction: class {
		get actions(): unknown[] {
			return sdk.keys;
		}
	},
}));

const { SpotifyAccountAction } = await import("../src/actions/spotify-account");
const { SpotifyAuthService: RealAuthService } = await import("../src/spotify/auth/auth-service");

function fakeKey(id: string) {
	return {
		id,
		isKey: () => true,
		setImage: vi.fn((_image: string) => Promise.resolve()),
		setTitle: vi.fn((_title: string) => Promise.resolve()),
		showAlert: vi.fn(() => Promise.resolve()),
		showOk: vi.fn(() => Promise.resolve()),
	};
}

function fakeAuth(state: SpotifyAuthState) {
	return {
		hasSession: false,
		connect: vi.fn(() => {
			state.update({ status: "connected", profile: { id: "u", displayName: "Test Listener", product: undefined }, authorizedAt: 1 });
			return Promise.resolve();
		}),
		disconnect: vi.fn(() => Promise.resolve()),
		verify: vi.fn(() => Promise.resolve()),
		setClientId: vi.fn((_clientId: string | undefined) => Promise.resolve()),
	};
}

function setup() {
	const state = new SpotifyAuthState();
	const auth = fakeAuth(state);
	const saveClientId = vi.fn((_clientId: string | undefined) => Promise.resolve());
	const action = new SpotifyAccountAction({ auth: auth as unknown as SpotifyAuthService, state, saveClientId });
	return { state, auth, saveClientId, action };
}

/** Lets fire-and-forget renders settle. */
const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

type Event = Parameters<InstanceType<typeof SpotifyAccountAction>["onSendToPlugin"]>[0];

beforeEach(() => {
	sdk.keys = [];
	sdk.ui.action = { manifestId: "com.marting.deckify.spotify.account" };
	sdk.ui.sendToPropertyInspector.mockClear();
});

describe("SpotifyAccountAction", () => {
	it("re-renders every instance when the shared state changes", async () => {
		const { state } = setup();
		const keys = [fakeKey("a"), fakeKey("b"), fakeKey("c")];
		sdk.keys = keys;

		state.update({ status: "connecting" });
		await flush();
		state.update({ status: "connected", profile: { id: "u", displayName: "Test Listener", product: undefined }, authorizedAt: 1 });
		await flush();

		for (const key of keys) {
			expect(key.setImage.mock.calls.map(([image]) => image)).toEqual([
				"imgs/actions/spotify-account/connecting.svg",
				"imgs/actions/spotify-account/connected.svg",
			]);
			expect(key.setTitle.mock.calls.map(([title]) => title)).toEqual(["Connecting", "Connected"]);
		}
	});

	it("renders the current shared state when a key appears", async () => {
		const { state, action } = setup();
		state.update({ status: "error", message: "boom" });
		const key = fakeKey("new");

		await action.onWillAppear({ action: key } as never);
		expect(key.setImage).toHaveBeenCalledWith("imgs/actions/spotify-account/error.svg");
		expect(key.setTitle).toHaveBeenCalledWith("Error");
	});

	it("alerts instead of connecting when no Client ID is configured", async () => {
		const { auth, action } = setup();
		const key = fakeKey("k");
		await action.onKeyDown({ action: key } as never);

		expect(auth.connect).not.toHaveBeenCalled();
		expect(key.showAlert).toHaveBeenCalled();
	});

	it("connects on press when disconnected and confirms success", async () => {
		const { state, auth, action } = setup();
		state.update({ status: "disconnected", clientId: FAKE.clientId });
		const key = fakeKey("k");
		await action.onKeyDown({ action: key } as never);

		expect(auth.connect).toHaveBeenCalledTimes(1);
		expect(key.showOk).toHaveBeenCalled();
	});

	it("verifies instead of reconnecting when a session exists", async () => {
		const { state, auth, action } = setup();
		auth.hasSession = true;
		state.update({ status: "connected", clientId: FAKE.clientId, profile: { id: "u", displayName: "x", product: undefined }, authorizedAt: 1 });
		await action.onKeyDown({ action: fakeKey("k") } as never);

		expect(auth.verify).toHaveBeenCalledTimes(1);
		expect(auth.connect).not.toHaveBeenCalled();
	});

	it("validates the Client ID from the Property Inspector before saving it", async () => {
		const { auth, saveClientId, action } = setup();
		await action.onSendToPlugin({ payload: { type: "deckify:spotify:save-client-id", clientId: "not valid" } } as unknown as Event);

		expect(saveClientId).not.toHaveBeenCalled();
		expect(auth.setClientId).not.toHaveBeenCalled();
		expect(sdk.ui.sendToPropertyInspector).toHaveBeenLastCalledWith(
			expect.objectContaining({ clientIdError: expect.stringMatching(/does not look like a Spotify Client ID/) as unknown }),
		);
	});

	it("saves a valid Client ID to global settings and applies it", async () => {
		const { auth, saveClientId, action } = setup();
		await action.onSendToPlugin({ payload: { type: "deckify:spotify:save-client-id", clientId: ` ${FAKE.clientId} ` } } as unknown as Event);

		expect(saveClientId).toHaveBeenCalledWith(FAKE.clientId);
		expect(auth.setClientId).toHaveBeenCalledWith(FAKE.clientId);
	});

	it("routes Connect and Disconnect", async () => {
		const { auth, action } = setup();
		await action.onSendToPlugin({ payload: { type: "deckify:spotify:connect" } } as unknown as Event);
		await action.onSendToPlugin({ payload: { type: "deckify:spotify:disconnect" } } as unknown as Event);
		expect(auth.connect).toHaveBeenCalledTimes(1);
		expect(auth.disconnect).toHaveBeenCalledTimes(1);
	});

	it("ignores malformed Property Inspector messages", async () => {
		const { auth, saveClientId, action } = setup();
		for (const payload of [null, "connect", {}, { type: "deckify:spotify:save-client-id" }, { type: "unknown" }]) {
			await action.onSendToPlugin({ payload } as unknown as Event);
		}
		expect(auth.connect).not.toHaveBeenCalled();
		expect(saveClientId).not.toHaveBeenCalled();
	});

	it("does not message another action's Property Inspector", async () => {
		const { state } = setup();
		sdk.ui.action = { manifestId: "com.marting.deckify.status" };
		state.update({ status: "disconnected" });
		await flush();
		expect(sdk.ui.sendToPropertyInspector).not.toHaveBeenCalled();
	});
});

describe("shared state propagation (real auth service)", () => {
	it("updates every key and the Property Inspector from startup restoration, without exposing tokens", async () => {
		const state = new SpotifyAuthState();
		const { fetch } = fakeFetch(() => profileResponse("Test Listener"));
		const auth = new RealAuthService({
			state,
			tokenStore: new MemoryTokenStore(storedSession({ accessTokenExpiresAt: Date.now() + 3_600_000 })),
			openUrl: () => Promise.reject(new Error("must not open a browser")),
			http: { fetch },
		});
		new SpotifyAccountAction({ auth, state, saveClientId: () => Promise.resolve() });
		const keys = [fakeKey("a"), fakeKey("b")];
		sdk.keys = keys;

		await auth.initialize(FAKE.clientId);
		await flush();

		for (const key of keys) {
			expect(key.setTitle).toHaveBeenLastCalledWith("Connected");
		}
		const payload = sdk.ui.sendToPropertyInspector.mock.calls.at(-1)?.[0] as { state: Record<string, unknown> };
		expect(payload.state).toMatchObject({ status: "connected", displayName: "Test Listener", clientId: FAKE.clientId });
		expect(Object.keys(payload.state).sort()).toEqual(["authorizedAt", "clientId", "displayName", "message", "product", "redirectUri", "status"]);
		expect(findSecrets(JSON.stringify(sdk.ui.sendToPropertyInspector.mock.calls))).toEqual([]);

		await auth.disconnect();
		await flush();
		for (const key of keys) {
			expect(key.setTitle).toHaveBeenLastCalledWith("Connect");
		}
	});
});
