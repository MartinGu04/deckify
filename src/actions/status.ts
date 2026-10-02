import streamDeck, { action, type KeyDownEvent, SingletonAction, type State, type WillAppearEvent } from "@elgato/streamdeck";

import { ActionUUID } from "../identifiers";

/**
 * States of the Deckify Status key; the values are the indexes of the `States` defined for this action in `manifest.json`.
 */
export const StatusState = {
	Deckify: 0,
	Ready: 1,
} as const satisfies Record<string, State>;

export type StatusState = (typeof StatusState)[keyof typeof StatusState];

const logger = streamDeck.logger.createScope("Deckify Status");

/**
 * Proof-of-life action that toggles between the "Deckify" and "Ready" states on each key press.
 *
 * Automatic state switching is disabled in the manifest (`DisableAutomaticStates`), so the plugin is the single source of truth for which state is shown.
 */
@action({ UUID: ActionUUID.Status })
export class StatusAction extends SingletonAction {
	/**
	 * Occurs when the key becomes visible, e.g. when Stream Deck starts or the user navigates to the page containing it.
	 * @param ev The event.
	 */
	override onWillAppear(ev: WillAppearEvent): void {
		logger.debug(`Appeared on "${ev.action.device.name}" in state "${describe(toStatusState(ev.payload.state))}".`);
	}

	/**
	 * Occurs when the key is pressed; advances the key to the next state.
	 * @param ev The event.
	 */
	override async onKeyDown(ev: KeyDownEvent): Promise<void> {
		const current = toStatusState(ev.payload.state);
		const next = nextStatusState(current);
		const position = ev.action.coordinates ? ` key (${ev.action.coordinates.column}, ${ev.action.coordinates.row})` : "";

		logger.info(`Pressed on "${ev.action.device.name}"${position}: ${describe(current)} -> ${describe(next)}.`);

		try {
			await ev.action.setState(next);
		} catch (err) {
			logger.error("Failed to update the key state.", err);
			await ev.action.showAlert().catch((alertErr: unknown) => logger.error("Failed to show alert on key.", alertErr));
		}
	}
}

/**
 * Gets the state that follows {@link state}.
 * @param state Current state.
 * @returns The next state.
 */
export function nextStatusState(state: StatusState): StatusState {
	return state === StatusState.Deckify ? StatusState.Ready : StatusState.Deckify;
}

/**
 * Normalizes the state reported by Stream Deck; anything unexpected falls back to {@link StatusState.Deckify}.
 * @param state State reported by Stream Deck.
 * @returns The status state.
 */
function toStatusState(state: State | undefined): StatusState {
	return state === StatusState.Ready ? StatusState.Ready : StatusState.Deckify;
}

/**
 * Gets a readable name for {@link state}, for logging.
 * @param state The state.
 * @returns The name of the state.
 */
function describe(state: StatusState): string {
	return state === StatusState.Ready ? "Ready" : "Deckify";
}
