// Volume Up / Volume Down Property Inspector.
//
// Stores one per-key setting, `volumeStep` (a whole number from 1 to 50), through Stream Deck's Property Inspector WebSocket. Invalid input is
// never saved; the plugin validates the stored value again. It deliberately uses no browser storage.
"use strict";

(() => {
	const DEFAULT_STEP = 10;
	const MIN_STEP = 1;
	const MAX_STEP = 50;

	const input = document.getElementById("volume-step");
	const error = document.getElementById("volume-step-error");

	let socket;
	let context;
	let saved = DEFAULT_STEP;

	/**
	 * Validates a step.
	 * @param {unknown} value Raw value (setting or field text).
	 * @returns {number | undefined} The step; otherwise `undefined` when invalid.
	 */
	function parseStep(value) {
		const text = typeof value === "number" ? String(value) : typeof value === "string" ? value.trim() : "";
		if (!/^\d{1,2}$/.test(text)) {
			return undefined;
		}
		const step = Number.parseInt(text, 10);
		return step >= MIN_STEP && step <= MAX_STEP ? step : undefined;
	}

	/**
	 * Shows a stored step.
	 * @param {object | undefined} settings Per-key settings.
	 */
	function showSettings(settings) {
		saved = parseStep(settings && settings.volumeStep) ?? DEFAULT_STEP;
		input.value = String(saved);
		error.hidden = true;
	}

	/**
	 * Entry point called by Stream Deck when the Property Inspector loads.
	 * @param {string} port WebSocket port.
	 * @param {string} uuid Property Inspector context.
	 * @param {string} registerEvent Registration event name.
	 * @param {string} _info Application info (JSON).
	 * @param {string} actionInfo Action info (JSON), including the key's settings.
	 */
	window.connectElgatoStreamDeckSocket = (port, uuid, registerEvent, _info, actionInfo) => {
		context = uuid;
		const info = JSON.parse(actionInfo);
		showSettings(info.payload && info.payload.settings);
		socket = new WebSocket(`ws://127.0.0.1:${port}`);
		socket.addEventListener("open", () => {
			socket.send(JSON.stringify({ event: registerEvent, uuid }));
		});
		socket.addEventListener("message", (message) => {
			const data = JSON.parse(message.data);
			if (data.event === "didReceiveSettings" && data.payload) {
				showSettings(data.payload.settings);
			}
		});
	};

	/**
	 * Saves the field when it holds a valid step; otherwise shows the error and keeps the stored step.
	 */
	function save() {
		const step = parseStep(input.value);
		error.hidden = step !== undefined;
		if (step === undefined || step === saved) {
			return;
		}
		saved = step;
		if (socket && socket.readyState === WebSocket.OPEN) {
			socket.send(JSON.stringify({ event: "setSettings", context, payload: { volumeStep: step } }));
		}
	}

	input.addEventListener("input", save);
	input.addEventListener("blur", () => {
		if (parseStep(input.value) === undefined) {
			input.value = String(saved);
			error.hidden = true;
		}
	});
})();
