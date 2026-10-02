/**
 * Hardware-free smoke test for the built plugin.
 *
 * Starts a minimal stand-in for the Stream Deck application (a local WebSocket server), launches `bin/plugin.js` the way Stream Deck does, then places
 * a Deckify Status key and presses it three times. Passes when the plugin registers and requests the states 1 -> 0 -> 1.
 *
 * This only exercises the plugin <-> Stream Deck protocol; it does not replace testing in the Stream Deck app on real hardware.
 * Run `npm run build` first. Log output is written to `com.marting.deckify.sdPlugin/logs/`.
 */
import { spawn } from "node:child_process";
import path from "node:path";
import { WebSocketServer } from "ws";

const PLUGIN_DIR = path.resolve("com.marting.deckify.sdPlugin");
const ACTION_UUID = "com.marting.deckify.status";
const EXPECTED_STATES = [1, 0, 1];
const TIMEOUT_MS = 10_000;

const context = "smoke-test-key";
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
	const send = (event) =>
		socket.send(
			JSON.stringify({
				action: ACTION_UUID,
				event,
				context,
				device,
				payload: { controller: "Keypad", coordinates: { column: 0, row: 0 }, isInMultiAction: false, settings: {}, state, resources: {} },
			}),
		);
	const press = () => {
		send("keyDown");
		send("keyUp");
	};

	socket.on("message", (data) => {
		const message = JSON.parse(data.toString());
		received.push(message);

		if (message.event === "registerPlugin") {
			send("willAppear");
			press();
		} else if (message.event === "setState" && message.context === context) {
			state = message.payload.state;
			if (states().length < EXPECTED_STATES.length) press();
			else finish();
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
	return received.filter((m) => m.event === "setState").map((m) => m.payload.state);
}

function finish(error) {
	clearTimeout(timeout);
	plugin.removeAllListeners("exit");
	plugin.kill();
	server.close();

	const registered = received.some((m) => m.event === "registerPlugin");
	const passed = !error && registered && JSON.stringify(states()) === JSON.stringify(EXPECTED_STATES);
	console.log(`registered: ${registered}`);
	console.log(`setState sequence: ${JSON.stringify(states())} (expected ${JSON.stringify(EXPECTED_STATES)})`);
	console.log(passed ? "Smoke test passed." : `Smoke test FAILED${error ? `: ${error}` : ""}.`);
	process.exit(passed ? 0 : 1);
}
