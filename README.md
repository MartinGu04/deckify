# Deckify

**A dynamic Spotify control center for Elgato Stream Deck.**

Deckify is a native Stream Deck plugin that turns the deck into a responsive Spotify control surface rather than a collection of static media buttons.

## Product vision

Deckify should feel like a Spotify Control Center built specifically for Stream Deck:

- Dynamic key states and artwork
- Fast local playback controls
- Spotify Web API features where they add value
- Playlists, queue, library and device control
- A polished property inspector for setup and configuration
- A first-class 5×3 experience for Stream Deck MK.2
- Architecture that can later expand to Stream Deck+, XL, Neo and other supported devices

## Architecture direction

Deckify is intended to use a hybrid model:

1. **Local media layer** for low-latency core playback control and local state where practical.
2. **Spotify Web API layer** for Spotify-specific capabilities such as playlists, library, queue, devices and richer metadata.
3. **Shared state manager** that normalizes playback state for all actions.
4. **Stream Deck SDK layer** that renders and updates actions dynamically.

Authentication should be designed around OAuth Authorization Code with PKCE where supported for this desktop/plugin model. Do not embed a Spotify Client Secret in distributable plugin code.

## Initial target

- Windows
- Elgato Stream Deck MK.2 (15 keys, 5×3)
- Stream Deck 7.1+
- Current Elgato Stream Deck SDK / CLI
- TypeScript + Node.js

## Phase 1 — Foundation

The first milestone is intentionally small:

- Scaffold with the official Stream Deck CLI
- Install and run as a native Stream Deck plugin
- Use a stable Deckify plugin UUID
- Add Deckify branding and placeholder icons
- Implement one proof-of-life action
- Add basic logging and error handling
- Confirm the action appears in the Stream Deck app and works on the physical MK.2

Spotify authentication and playback integration come after the native plugin foundation is verified on hardware.

## Phase 2 — Spotify account

Phase 2 connects a Spotify account with the **Authorization Code flow with PKCE**:

- New **Spotify Account** key (`com.marting.deckify.spotify.account`). Every instance shows the same shared state: Not Configured, Disconnected, Connecting, Connected or Error.
- Its Property Inspector holds the Spotify **Client ID** (stored in Deckify's global settings), the connection status, the connected account name, and Connect / Disconnect buttons.
- Fixed redirect URI `http://127.0.0.1:43821/callback`. A one-shot local listener binds only to `127.0.0.1:43821` and accepts only `/callback`.
- Tokens are stored encrypted with Windows DPAPI (current user). They are refreshed automatically, and the session is restored on startup without opening a browser.

## Phase 3 — Playback core

Phase 3 adds Spotify playback control through the Spotify Web API, targeting your **currently active Spotify device**:

| Action | UUID (permanent) | What it does |
| --- | --- | --- |
| Play / Pause | `com.marting.deckify.spotify.play-pause` | Shows Play while paused and Pause while playing; a press toggles. |
| Next Track | `com.marting.deckify.spotify.next` | Skips to the next item. |
| Previous Track | `com.marting.deckify.spotify.previous` | Goes back to the previous item. |
| Now Playing | `com.marting.deckify.spotify.now-playing` | Shows the title, artist (or show) and progress; a press refreshes. |

- **Scopes:** Deckify now requests `user-read-private`, `user-read-playback-state` and `user-modify-playback-state`.
- **Reconnect after upgrading:** a session authorized before Phase 3 lacks the playback scopes. The Spotify Account key then shows **Reconnect**, and its Property Inspector shows **Reconnect Spotify**. Press it once to authorize again. Your Client ID is kept, and the new session replaces the old one. Deckify never uses the old session for playback, and scopes can't be added through a token refresh.
- **Spotify Premium** is required for play, pause and skip; this is Spotify's rule. With another account, Deckify stays connected and Now Playing still works, but the control keys show **Premium**.
- **No active device:** if Spotify isn't playing on any device, the keys show **No Device** and a press shows an alert. Open Spotify and start playing on a device first. Device selection comes in a later phase.
- **Quota-aware polling:** Spotify Development Mode apps have request quotas as well as rate limits, so one shared poller serves every key. It runs only while Spotify is connected and a playback key is visible, about every 3 s while playing, 8 s while paused and 15 s when nothing is playing. After a press, Deckify re-reads the state shortly afterwards. Requests never overlap. On a rate limit (HTTP 429), Deckify waits for `Retry-After` and keeps showing the last state. If the quota is exhausted, it pauses updates (keys show **Limited**) and resumes on its own once the quota window has passed.
- **OAuth stays explicit:** playback keys never open the browser. If Spotify isn't connected, they show **Connect** or **Reconnect** and alert on press.

## Phase 4 — Windows media bridge

Phase 4 makes Play / Pause, Next Track and Previous Track feel instant on Windows. Each command first goes to the **Spotify desktop app** through Windows' own media controls (*Global System Media Transport Controls*, GSMTC), the same mechanism as the keyboard media keys. The Spotify Web API remains the state source (Now Playing, play/pause state) and the fallback command path.

- **Spotify only.** Deckify picks the Windows media session whose app is Spotify (desktop `Spotify.exe` or the Microsoft Store app `SpotifyAB.SpotifyMusic_…!Spotify`). It never controls a browser, YouTube or any other media app. If Spotify isn't running, the local path reports *unavailable* and nothing local is sent.
- **Exact routing per press:**
  1. Account checks (connected, Premium) as before.
  2. Local Spotify session via GSMTC: Play / Pause uses `TryTogglePlayPauseAsync`, Next `TrySkipNextAsync`, Previous `TrySkipPreviousAsync`. No Web API read happens first.
  3. Only if the local path reports **unavailable** (no Spotify session, helper missing, Windows refused the command) is the same command sent through the Spotify Web API (Phase 3 behavior).
  4. If the local outcome is **unknown** (the helper timed out or crashed mid-command), nothing is retried, so a press can never skip twice.
- **After a press:** Play / Pause flips optimistically; Next / Previous keep the old metadata until Spotify reports the new item. A Web API read then reconciles the keys.
- **Rate limits:** local commands keep working while the Web API is rate-limited or its quota is exhausted; reconciliation waits until the back-off ends. Without a local Spotify session, Phase 3 back-off applies unchanged.
- **The helper** is a small bundled Rust program (`bin/native/deckify-media-bridge.exe`), started once, hidden (no console window), and spoken to over stdin/stdout with one JSON message per line. It accepts only `toggle`, `play`, `pause`, `next`, `previous` and `ping`, and never receives tokens, the Client ID or any Spotify data. If it is missing or keeps failing, Deckify logs that once and works exactly as in Phase 3. End users need nothing extra installed.

## Spotify Developer setup

Deckify only needs a **Client ID**. It never needs, accepts or stores a Client Secret.

1. Open the [Spotify Developer Dashboard](https://developer.spotify.com/dashboard) and create an app named **Deckify**.
2. Under *Which API/SDKs are you planning to use?*, select **Web API**.
3. Add this Redirect URI exactly (no trailing slash, `127.0.0.1` rather than `localhost`) and save:

   ```text
   http://127.0.0.1:43821/callback
   ```

4. Open the app's settings and copy the **Client ID**.
5. Do **not** copy or enter the Client Secret anywhere. Deckify uses PKCE, which doesn't need one.
6. In the Stream Deck app, place **Deckify → Spotify Account** on a key, paste the Client ID into its Property Inspector and press **Save**.
7. Press **Connect Spotify** (or the key). Your browser opens Spotify's consent page. After you approve, the page shows *Deckify is connected to Spotify* and the key changes to **Connected**.

**Development Mode.** New Spotify apps start in Development Mode. Only the app owner and accounts added under the app's *User Management* (a short allowlist) can connect. Any other account gets an error such as HTTP 403, which Deckify shows on the key and in the Property Inspector. Check the dashboard for the current user limit and requirements.

**Session lifetime.** Access tokens last about an hour and are refreshed automatically. Spotify user refresh tokens expire about **six months after you first authorize**, and refreshing does not extend that. When Spotify rejects the refresh token (`invalid_grant`), Deckify deletes the stored session and shows **Connect** again. To revoke Deckify's access yourself, use **Disconnect** and remove Deckify at <https://www.spotify.com/account/apps/>. Spotify has no API for Deckify to revoke tokens.

**Port 43821 in use.** If something else is using port 43821, connecting fails with *"Deckify could not start its local Spotify callback listener because port 43821 … is already in use"*. Deckify never falls back to another port, because Spotify only accepts the registered redirect URI. To find the other program, run `Get-NetTCPConnection -LocalPort 43821 | Select-Object OwningProcess` in PowerShell. If Windows itself has reserved the port (for example Hyper-V), it appears in `netsh interface ipv4 show excludedportrange protocol=tcp`.

## Development

### Prerequisites

- Windows 10 or later with the Stream Deck app **7.1+**
- Node.js **24+** (only for building; Stream Deck runs the plugin on its own bundled Node.js 24 runtime)
- Git
- Rust via [rustup](https://rustup.rs) with the MSVC toolchain (Visual Studio Build Tools, "Desktop development with C++"), only to build the Windows media bridge. `native/media-bridge/rust-toolchain.toml` pins the Rust version; rustup installs it on first use.

Plugin UUID `com.marting.deckify` and every action UUID (`com.marting.deckify.status`, `com.marting.deckify.spotify.account`, `.spotify.play-pause`, `.spotify.next`, `.spotify.previous`, `.spotify.now-playing`) are permanent. Never rename them, because existing keys in users' profiles depend on them.

### Install and build

```powershell
npm ci             # install exact dependency versions from package-lock.json
npm run build      # bundle src/ into com.marting.deckify.sdPlugin/bin/plugin.js
npm run check      # typecheck + lint + tests + build + manifest validation + smoke test
```

Individual steps: `npm run typecheck`, `npm run lint`, `npm test`, `npm run validate` and `npm run smoke`.

- `npm test` runs the Vitest suite. Every Spotify HTTP request is mocked, so tests never contact Spotify and use only obviously fake credentials.
- The smoke test runs the built plugin against a simulated Stream Deck connection, presses the Deckify Status key, and checks that a Spotify Account key renders *Not Configured* and a Play / Pause key renders *Connect*. It needs no hardware.

CI (`.github/workflows/ci.yml`) runs on every pull request to `main` and every push to `main`:

- **Ubuntu:** `npm ci` and `npm run check` on Node.js 24.
- **Windows:** builds the release media bridge, runs its Rust tests, `cargo fmt --check` and `cargo clippy`, runs `npm run pack` (which verifies the helper is inside the package), runs `npm run check` (including a test that drives the real helper), and uploads the `.streamDeckPlugin` as a build artifact.

### Windows media bridge (native helper)

```powershell
npm run native:test    # cargo test: protocol parsing/serialization, Spotify-only session selection, command dispatch
npm run native:build   # cargo build --release, then copy the exe to com.marting.deckify.sdPlugin/bin/native/
```

- Source: `native/media-bridge/` (Rust, `windows` crate). The Rust tests use fakes and never touch real media sessions.
- `npm run native:build` is a no-op with a message on non-Windows machines; the plugin then runs without the local path.
- For a linked development plugin, run `npm run native:build` once (and after changing the Rust code), then `npm run restart`.
- `test/media-bridge-binary.test.ts` drives the real helper through the TypeScript bridge when a build exists (or `DECKIFY_MEDIA_BRIDGE_PATH` points to one) and is skipped otherwise.

### Develop against the Stream Deck app (link workflow)

```powershell
npx streamdeck dev    # enable Stream Deck developer mode (once per machine)
npm run build
npm run link          # symlink com.marting.deckify.sdPlugin into the Stream Deck plugins folder
npm run restart       # (re)start the plugin inside Stream Deck
npm run watch         # optional: rebuild and restart automatically on every change
```

To undo: `npx streamdeck unlink com.marting.deckify`.

The manifest enables Node.js debugging (`Nodejs.Debug`). Use the **Attach to Plugin** VS Code launch configuration to attach a debugger.

### Package

```powershell
npm run pack          # builds the native helper (Windows), bundles, packs and verifies dist/com.marting.deckify.streamDeckPlugin
```

On Windows, `npm run pack` builds the release helper, stages it at `com.marting.deckify.sdPlugin/bin/native/deckify-media-bridge.exe`, runs the Stream Deck CLI pack (which validates the manifest), and then checks that the package contains `bin/plugin.js`, the manifest and the helper; it fails otherwise. On other systems it packs without the helper (Phase 3 behavior only). Double-clicking the `.streamDeckPlugin` file installs it into Stream Deck. Unlink a development copy first, because both use the same UUID.

### Logs

| Log | Location |
| --- | --- |
| Deckify plugin | `com.marting.deckify.sdPlugin\logs\com.marting.deckify.0.log` (when linked, this is inside the repository). For an installed package, look in `%APPDATA%\Elgato\StreamDeck\Plugins\com.marting.deckify.sdPlugin\logs\` |
| Stream Deck app | `%APPDATA%\Elgato\StreamDeck\logs\` |

**Local vs Web API routing.** Each playback press logs which path it took (at `debug` level, which is on for the development manifest):

| Log line | Meaning |
| --- | --- |
| `Playback next sent via windows-gsmtc in 4 ms.` | sent to the Spotify desktop app through Windows media controls; no Web API command |
| `Playback next not available via windows-gsmtc (spotify-session-unavailable); using the Spotify Web API.` | no local Spotify session; the Web API sent it |
| `Playback next via windows-gsmtc has an unknown outcome (timeout); not retrying it.` | the helper didn't answer; nothing was retried |
| `Windows media bridge ready (local Spotify session: found).` | logged once after start |
| `Windows media bridge unavailable (helper not found); using Spotify Web API fallback.` | the helper is missing; Phase 3 behavior |

To see the fallback, quit the Spotify desktop app and play on another Spotify device (phone, web player): presses then log *not available via windows-gsmtc* and go through the Web API.

The plugin logs at `debug` level while `Nodejs.Debug` is enabled and at `info` otherwise. Raise it with `streamDeck.logger.setLevel("trace")` in `src/plugin.ts` to record every message exchanged with Stream Deck.

### Spotify token storage

| What | Where | Protection |
| --- | --- | --- |
| Client ID | Stream Deck global settings | none needed (public identifier) |
| Access and refresh tokens | `%LOCALAPPDATA%\Deckify\spotify-session.json` | AES-256-GCM with a random data key; the data key is protected with Windows DPAPI (CurrentUser) |
| Expiry time, authorization time, scopes | same file, outside the ciphertext | not secret |

- Tokens are encrypted inside the plugin process. Only the 32-byte data key is passed to `ProtectedData` through built-in Windows PowerShell, over stdin and never as a command-line argument. Token plaintext never leaves the process.
- Only the same Windows user can decrypt the file.
- Tokens are never written to Stream Deck settings, the Property Inspector, browser storage, logs or git.
- **Disconnect** deletes the file. On non-Windows development machines, the session is kept in memory only.

### Development-only refresh test

You can trigger a real token refresh on Windows without waiting about an hour for the access token to expire:

```powershell
npm run dev:expire-spotify-token   # marks the stored access token as expired (rewrites only accessTokenExpiresAt)
npm run restart                    # Deckify restores the session and must refresh it
```

The plugin log should then show `Spotify access token refreshed (refresh token rotated: yes|no)`, and the key returns to **Connected**. The script is a development helper in `scripts/` and is not part of the plugin bundle. It never decrypts or prints tokens, and it only works for the Windows user who owns the session.

### Project layout

```text
src/
  plugin.ts                 entry point: logging, error handlers, shared services, action registration, startup restore
  identifiers.ts            permanent plugin / action UUIDs
  actions/
    status.ts               "Deckify Status" proof-of-life key action
    spotify-account.ts      "Spotify Account" key + Property Inspector messaging
    play-pause.ts, skip-track.ts, now-playing.ts
                            playback keys (shared base: playback-key-action.ts; views and Now Playing SVG renderer)
  playback/                 transport-independent playback: model, PlaybackTransport interface, shared state, PlaybackService (polling, commands, local-first routing)
    local-commands.ts       LocalPlaybackCommandTransport contract (handled / unavailable / uncertain)
  windows/                  Windows media bridge client: spawns the bundled helper, JSON-lines IPC, timeouts, restarts
  settings/                 Stream Deck global settings (Client ID only)
  shared/                   logger contract, SDK type helpers
  spotify/
    config.ts               fixed redirect URI, endpoints, timeouts
    errors.ts               typed, user-facing errors (never contain tokens)
    http.ts                 fetch with timeout, error-payload parsing, 401/403/429 mapping
    auth/                   scopes, PKCE, authorization URL, callback listener, token exchange/refresh, auth service
    api/                    authenticated Web API client (GET/PUT/POST, refresh + one retry on 401), current-user profile
    playback/               Spotify Web API playback transport and response parsing
    storage/                TokenStore interface, encrypted file store, Windows DPAPI key protector
    state/                  shared Spotify account state + subscriptions
com.marting.deckify.sdPlugin/
  manifest.json             plugin + action definitions
  imgs/                     Stream Deck images (plugin icon, category icon, action/key images)
  ui/spotify-account/       Spotify Account Property Inspector (no remote scripts, no browser storage)
  bin/, logs/               build output (bin/plugin.js, bin/native/deckify-media-bridge.exe) and runtime logs (git-ignored)
native/media-bridge/        Rust helper: GSMTC Spotify session selection and commands (protocol.rs, selection.rs, dispatch.rs, gsmtc.rs)
assets/brand/               original Deckify brand files (see assets/brand/README.md)
scripts/                    brand-asset export, smoke test, dev-only token expiry helper, native build, pack + package verification
test/                       Vitest suite (Spotify HTTP fully mocked)
```

## Brand

**Deckify**

Brand direction: dark interface, Spotify-inspired green accent, custom Deckify “D” mark.

> Deckify is an independent project and is not affiliated with or endorsed by Spotify or Elgato.
