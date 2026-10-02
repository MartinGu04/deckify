import streamDeck from "@elgato/streamdeck";

import { StatusAction } from "./actions/status";

// Log files are written to "<plugin>.sdPlugin/logs". The SDK defaults to "debug" when the manifest enables Node.js debugging and "info" otherwise;
// raise to "trace" locally to record every message exchanged with Stream Deck.
const logger = streamDeck.logger;

// Errors must never fail silently: a rejected promise that escapes an event handler would otherwise terminate the plugin process.
// (Uncaught exceptions are already logged by the SDK.)
process.on("unhandledRejection", (reason) => logger.error("Unhandled promise rejection.", reason));

streamDeck.actions.registerAction(new StatusAction());

streamDeck
	.connect()
	.then(() => logger.info(`Deckify ${streamDeck.info.plugin.version} connected to Stream Deck ${streamDeck.info.application.version}.`))
	.catch((err: unknown) => logger.error("Failed to connect to Stream Deck.", err));
