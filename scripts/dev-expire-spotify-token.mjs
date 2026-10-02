/**
 * DEVELOPMENT ONLY: marks the stored Spotify access token as expired so the next Deckify start exercises the real refresh flow.
 *
 * Usage (Windows, as the same user that runs Stream Deck):
 *   npm run dev:expire-spotify-token
 *   npm run restart
 *
 * It rewrites only the non-secret `accessTokenExpiresAt` field of `%LOCALAPPDATA%\Deckify\spotify-session.json`. It never decrypts,
 * reads or prints tokens, and it is not part of the plugin bundle, so it adds nothing to the shipped plugin.
 * `--file <path>` targets another session file (used by the automated tests).
 */
import { readFile, rename, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { parseArgs } from "node:util";

const { values } = parseArgs({ options: { file: { type: "string" } } });
const file = values.file ?? path.join(process.env.LOCALAPPDATA ?? path.join(os.homedir(), "AppData", "Local"), "Deckify", "spotify-session.json");

let session;
try {
	session = JSON.parse(await readFile(file, "utf8"));
} catch (err) {
	console.error(err?.code === "ENOENT" ? `No stored Spotify session at ${file}. Connect Spotify first.` : `Could not read ${file}: ${err?.message}`);
	process.exit(1);
}

if (session?.format !== "deckify.spotify-session" || session.version !== 1 || typeof session.accessTokenExpiresAt !== "number") {
	console.error(`${file} is not a Deckify Spotify session file (format v1).`);
	process.exit(1);
}

session.accessTokenExpiresAt = 0;
const temp = `${file}.dev-expire.tmp`;
await writeFile(temp, `${JSON.stringify(session, null, "\t")}\n`, "utf8");
await rename(temp, file);

console.log(`Marked the stored Spotify access token as expired (${file}).`);
console.log("Restart Deckify (npm run restart) and check the log for: Spotify access token refreshed (refresh token rotated: ...).");
