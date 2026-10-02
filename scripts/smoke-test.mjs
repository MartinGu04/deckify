/**
 * Hardware-free smoke test for the built plugin.
 *
 * Starts a minimal stand-in for the Stream Deck application (a local WebSocket server) and launches `bin/plugin.js` the way Stream Deck does.
 * It then:
 *   1. places a Deckify Status key and presses it three times, expecting the states 1 -> 0 -> 1;
 *   2. answers the plugin's global-settings request with no Spotify Client ID and places a Spotify Account key, expecting it to render the
 *      "Set Up" (not configured) state;
 *   3. places a Play / Pause key, expecting the unavailable icon with the title "Connect" (playback never contacts Spotify while signed out);
 *   4. places Volume Up, Mute / Unmute and Like / Unlike keys, expecting their unavailable icons with the title "Connect".
 *
 * No Spotify request is made (no Client ID is configured). This only exercises the plugin <-> Stream Deck protocol; it does not replace
 * testing in the Stream Deck app on real hardware. Run `npm run build` first. Log output is written to `com.marting.deckify.sdPlugin/logs/`.
 */
import { spawn } from "node:child_process";
import path from "node:path";
import { WebSocketServer } from "ws";

const PLUGIN_DIR = path.resolve("com.marting.deckify.sdPlugin");
const STATUS_UUID = "com.marting.deckify.status";
const SPOTIFY_ACCOUNT_UUID = "com.marting.deckify.spotify.account";
const PLAY_PAUSE_UUID = "com.marting.deckify.spotify.play-pause";
/** Phase 5 keys: UUID, context and the image each must render while signed out. */
const SIGNED_OUT_KEYS = [
	{ uuid: "com.marting.deckify.spotify.volume-up", context: "smoke-volume-up-key", image: "imgs/actions/volume/volume-up-disabled.svg" },
	{ uuid: "com.marting.deckify.spotify.mute", context: "smoke-mute-key", image: "imgs/actions/volume/speaker-disabled.svg" },
	{ uuid: "com.marting.deckify.spotify.like", context: "smoke-like-key", image: "imgs/actions/library/heart-disabled.svg" },
];
const EXPECTED_STATES = [1, 0, 1];
const TIMEOUT_MS = 10_000;

const statusContext = "smoke-status-key";
const spotifyContext = "smoke-spotify-account-key";
const playPauseContext = "smoke-play-pause-key";
const device = "smoke-test-mk2";
const info = {
	application: { font: "Segoe UI", language: "en", platform: "windows", platformVersion: "10.0", version: "7.1.0" },
	colors: {},
	devicePixelRatio: 2,
	devices: [{ id: device, name: "Stream Deck MK.2 (simulated)", size: { columns: 5, rows: 3 }, type: 7 }],
	plugin: { uuid: "com.marting.deckify", version: "0.1.0.0" },
};

const received = [];
const server = new WebSocketServer({ host: "127.0.0.1", port: 0 });
await new Promise((resolve) => server.once("listening", resolve));

server.on("connection", (socket) => {
	let state = 0;
	const send = (action, context, event, column) =>
		socket.send(
			JSON.stringify({
				action,
				event,
				context,
				device,
				payload: { controller: "Keypad", coordinates: { column, row: 0 }, isInMultiAction: false, settings: {}, state, resources: {} },
			}),
		);
	const press = () => {
		send(STATUS_UUID, statusContext, "keyDown", 0);
		send(STATUS_UUID, statusContext, "keyUp", 0);
	};

	socket.on("message", (data) => {
		const message = JSON.parse(data.toString());
		received.push(message);

		if (message.event === "registerPlugin") {
			send(STATUS_UUID, statusContext, "willAppear", 0);
			send(SPOTIFY_ACCOUNT_UUID, spotifyContext, "willAppear", 1);
			send(PLAY_PAUSE_UUID, playPauseContext, "willAppear", 2);
			SIGNED_OUT_KEYS.forEach((key, i) => send(key.uuid, key.context, "willAppear", 3 + i));
			press();
		} else if (message.event === "getGlobalSettings") {
			socket.send(JSON.stringify({ event: "didReceiveGlobalSettings", id: message.id, payload: { settings: {} } }));
		} else if (message.event === "setState" && message.context === statusContext) {
			state = message.payload.state;
			if (states().length < EXPECTED_STATES.length) press();
		}

		if (states().length >= EXPECTED_STATES.length && spotifyRendered() && playPauseRendered() && signedOutKeysRendered()) {
			finish();
		}
	});
});

const plugin = spawn(
	process.execPath,
	["bin/plugin.js", "-port", String(server.address().port), "-pluginUUID", "smoke-test", "-registerEvent", "registerPlugin", "-info", JSON.stringify(info)],
	{ cwd: PLUGIN_DIR, stdio: "inherit" },
);
plugin.once("exit", (code) => {
	if (code !== null) finish(`plugin exited early with code ${code}`);
});
const timeout = setTimeout(() => finish("timed out"), TIMEOUT_MS);

function states() {
	return received.filter((m) => m.event === "setState" && m.context === statusContext).map((m) => m.payload.state);
}

function spotifyRendered() {
	const forKey = received.filter((m) => m.context === spotifyContext);
	return (
		forKey.some((m) => m.event === "setTitle" && m.payload.title === "Set Up") &&
		forKey.some((m) => m.event === "setImage" && m.payload.image === "imgs/actions/spotify-account/not-configured.svg")
	);
}

function playPauseRendered() {
	const forKey = received.filter((m) => m.context === playPauseContext);
	return (
		forKey.some((m) => m.event === "setTitle" && m.payload.title === "Connect") &&
		forKey.some((m) => m.event === "setImage" && m.payload.image === "imgs/actions/playback/play-disabled.svg")
	);
}

function signedOutKeysRendered() {
	return SIGNED_OUT_KEYS.every((key) => {
		const forKey = received.filter((m) => m.context === key.context);
		return (
			forKey.some((m) => m.event === "setTitle" && m.payload.title === "Connect") &&
			forKey.some((m) => m.event === "setImage" && m.payload.image === key.image)
		);
	});
}

function finish(error) {
	clearTimeout(timeout);
	plugin.removeAllListeners("exit");
	plugin.kill();
	server.close();

	const registered = received.some((m) => m.event === "registerPlugin");
	const statusOk = JSON.stringify(states()) === JSON.stringify(EXPECTED_STATES);
	const spotifyOk = spotifyRendered();
	const playPauseOk = playPauseRendered();
	const phase5Ok = signedOutKeysRendered();
	const passed = !error && registered && statusOk && spotifyOk && playPauseOk && phase5Ok;
	console.log(`registered: ${registered}`);
	console.log(`Deckify Status setState sequence: ${JSON.stringify(states())} (expected ${JSON.stringify(EXPECTED_STATES)})`);
	console.log(`Spotify Account rendered "Set Up" (not configured): ${spotifyOk}`);
	console.log(`Play / Pause rendered "Connect" (signed out): ${playPauseOk}`);
	console.log(`Volume Up, Mute / Unmute and Like / Unlike rendered "Connect" (signed out): ${phase5Ok}`);
	console.log(passed ? "Smoke test passed." : `Smoke test FAILED${error ? `: ${error}` : ""}.`);
	process.exit(passed ? 0 : 1);
}
