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

## Phase 5 — Essential controls

Phase 5 adds the everyday controls:

| Action | UUID (permanent) | What it does |
| --- | --- | --- |
| Volume Down | `com.marting.deckify.spotify.volume-down` | Lowers the active device's Spotify volume by the key's step; shows the volume. |
| Volume Up | `com.marting.deckify.spotify.volume-up` | Raises the active device's Spotify volume by the key's step; shows the volume. |
| Mute / Unmute | `com.marting.deckify.spotify.mute` | Sets the volume to 0, or restores the previous volume. |
| Like / Unlike | `com.marting.deckify.spotify.like` | Adds the current song to Liked Songs, or removes it; the heart shows which. |

- **Scopes:** Deckify now also requests `user-library-read` and `user-library-modify` (Like / Unlike). A session from Phase 3 or 4 lacks them, so after upgrading the Spotify Account key shows **Reconnect**, exactly like the Phase 3 upgrade: press **Reconnect Spotify** once. The Client ID is kept and the old session is never used; scopes are never added through a token refresh.
- **Volume is Spotify's own device volume**, the one the Spotify apps show, controlled through the Web API (`PUT /v1/me/player/volume`) for the desktop app and remote Spotify Connect devices (phone, speaker) alike, whenever Spotify reports the device supports it. Deckify deliberately does **not** use the Windows volume mixer (Core Audio): that is a second, independent level that would disagree with Spotify. The Phase 4 helper still only handles Play / Pause, Next and Previous.
- **Volume step:** each Volume Up / Volume Down key has a **Volume step** setting in its Property Inspector (1–50%, default 10%). Invalid values fall back to 10%. Volume never goes below 0% or above 100%.
- **Rapid presses all count.** Each press moves the target volume immediately (the key shows it right away); requests are sent one at a time, each carrying the newest target. Four quick presses of +10 from 40% end at 80%, even if Deckify only needs to send 50% and then 80%. Afterwards Deckify re-reads the state to confirm.
- **No guessing:** if the current volume is unknown or stale, Deckify reads it first. With no active device the keys show **No Device**; a device without volume control shows **Unsupported**; restricted devices, rate limits (**Limited**), non-Premium accounts (**Premium**) and signed-out states behave like the playback keys.
- **Mute / Unmute** uses Spotify's volume, because Spotify has no separate mute: Mute remembers the current volume and sets 0; Unmute restores it. Muted simply means the real device volume is 0, whoever set it: Volume Down reaching 0 shows muted, Volume Up from 0 makes it audible (0% + 10% = 10%), and a change in another Spotify app is picked up. Deckify remembers the last non-zero volume it saw or set **in memory only**; after Stream Deck restarts, Unmute from 0% restores 50% until Deckify has seen a non-zero volume again. (Storing it in Stream Deck's global settings could race with saving the Client ID there, so it is deliberately not persisted.)
- **Like / Unlike** works on songs only. It uses Spotify's current library API (`GET /v1/me/library/contains`, `PUT` and `DELETE /v1/me/library`, with the track URI); the older `/me/tracks` endpoints are not used. Episodes, ads, local files and unknown items are never sent; the key shows **Track Only**. The heart is checked once per song while a Like key is visible (also after reconnecting and when a Like key appears), never polled, so a song liked or unliked in another Spotify app updates when the song changes or the Like key reappears. A press always applies to the song that was playing when you pressed, even if the next song starts before Spotify answers, and a second press while the first is still being sent is ignored.
- **Spotify Premium** stays required for all Deckify controls, including volume and Like / Unlike.

## Phase 6 — Playlists

Phase 6 adds two playlist keys, each configured with a real playlist picker in its Property Inspector (you never type IDs, URIs or links):

| Action | UUID (permanent) | What it does |
| --- | --- | --- |
| Add to Playlist | `com.marting.deckify.spotify.add-to-playlist` | Adds the current Spotify song to the key's playlist, unless it is already there. |
| Play Playlist | `com.marting.deckify.spotify.play-playlist` | Starts the key's playlist on the active Spotify device. |

- **Scopes:** Deckify now also requests `playlist-read-private`, `playlist-read-collaborative`, `playlist-modify-public` and `playlist-modify-private`. A Phase 5 session lacks them, so after upgrading the Spotify Account key shows **Reconnect** once (same flow as before; the Client ID and session are kept until you reconnect).
- **Spotify's February 2026 playlist API:** `GET /v1/me/playlists` (50 per page, every page), `GET /v1/playlists/{id}` (the playlist's current snapshot and owner, before adding), `GET /v1/playlists/{id}/items` (item URIs only, 50 per page) and `POST /v1/playlists/{id}/items` with `{"uris": ["spotify:track:…"]}`. The deprecated `/playlists/{id}/tracks` endpoints are not used. Play Playlist uses `PUT /v1/me/player/play` with `{"context_uri": "spotify:playlist:…"}` on the active device (never the Windows media session).
- **The picker** shows your playlists (loaded when the Property Inspector opens, cached for five minutes, **Refresh** to reload) with a local search by name, at most 20 at a time (**Previous** / **Next** page through longer lists and longer search results; paging and search never contact Spotify). Same-named playlists are told apart by owner, Private / Collaborative, item count and, if still identical, the end of their ID. A key stores the playlist's **ID and URI**, never its name, so a renamed playlist stays selected (its new name appears after the next refresh) and a deleted one shows **Unavailable** instead of silently switching.
- **Add to Playlist** offers only playlists you can change: ones you own and collaborative ones. A public playlist someone else owns is never offered. It works on songs only (episodes, ads and local files show **Track Only**) and adds the song that was playing at the moment of the press, even if the next one starts before Spotify answers.
- **No duplicates:** before adding, Deckify checks whether the song is already in the playlist. The playlist's items are read once per playlist version (`snapshot_id`) and remembered, so later presses only cost one small request until the playlist changes. Already there → **Already Added** (no second copy); a quick double press is ignored while the first add runs.
- **Play Playlist** offers every playlist in your library, including followed ones, and behaves like the other playback keys: **No Device**, **Restricted**, **Premium**, **Limited**, **Connect** / **Reconnect**.
- **Spotify attribution:** playlist names are shown exactly as Spotify returns them, the picker shows Spotify's official full logo (the unmodified white version from Spotify's brand assets, at 90 px wide, `ui/playlist/Spotify_Full_Logo_RGB_White.png`) with *Playlist information provided by Spotify*, and **Open in Spotify** opens the selected playlist with the link Spotify provides (only `https://open.spotify.com/playlist/<id>` links are accepted). No artwork is downloaded and the Spotify logo appears only in the picker, never in Deckify's keys or action icons; `npm run pack` fails if the logo is missing from the package.
- **Privacy:** the picker never sees tokens or the Client ID and never calls Spotify itself; logs never contain playlist names, IDs or track URIs.

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
- The smoke test runs the built plugin against a simulated Stream Deck connection, presses the Deckify Status key, and checks that a Spotify Account key renders *Not Configured* and that Play / Pause, Volume Up, Mute / Unmute, Like / Unlike, Add to Playlist and Play Playlist keys render *Connect*. It needs no hardware.
- `npm run assets` regenerates the image exports: the brand PNGs from `assets/brand/` and the volume / Like / playlist key images (`scripts/export-key-icons.mjs`, simple vector geometry). A test fails if the committed key images differ from the generator.

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

**Local vs Web API routing.** Each playback press logs which path it took, at `info` level, so the lines also appear in an installed package's log. They contain no track, artist or device names:

| Log line | Meaning |
| --- | --- |
| `Playback next sent via windows-gsmtc in 4 ms.` | sent to the Spotify desktop app through Windows media controls; no Web API command |
| `Playback next not available via windows-gsmtc (spotify-session-unavailable); using the Spotify Web API.` | no local Spotify session; the Web API sent it |
| `Playback next via windows-gsmtc has an unknown outcome (timeout); not retrying it.` | the helper didn't answer; nothing was retried |
| `Windows media bridge ready (local Spotify session: found).` | logged once after start |
| `Windows media bridge unavailable (helper not found); using Spotify Web API fallback.` | the helper is missing; Phase 3 behavior |

To see the fallback, quit the Spotify desktop app and play on another Spotify device (phone, web player): presses then log *not available via windows-gsmtc* and go through the Web API.

Volume and Like / Unlike always use the Web API; they log only failures (for example `Volume change failed: ...`) and, for Like / Unlike, `Library item saved.` / `Library item removed.` without any track details.

Playlist keys log `Playlist list refreshed.`, `Playlist item added.`, `Playlist item already present.` and `Playlist playback started.`, and failures only as error codes; never playlist names, IDs or track URIs.

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
    volume.ts, like.ts      Volume Up / Volume Down / Mute and Like / Unlike keys (views: playback-views.ts, like-view.ts; volume-settings.ts)
    playlist-*.ts           Add to Playlist / Play Playlist keys, their views, and the picker protocol
  playback/                 transport-independent playback: model, PlaybackTransport interface, shared state, PlaybackService (polling, commands,
                            local-first routing, coalescing volume controller, mute memory)
  library/                  LibraryService: the current track's Liked Songs state (checks, like / unlike, race guards), LibraryTransport interface
  playlists/                PlaylistService (shared cache, writable filter, duplicate cache by snapshot, add, play), playlist model and
                            validation, key settings (ID + URI), PlaylistTransport interface
    local-commands.ts       LocalPlaybackCommandTransport contract (handled / unavailable / uncertain)
  windows/                  Windows media bridge client: spawns the bundled helper, JSON-lines IPC, timeouts, restarts
  settings/                 Stream Deck global settings (Client ID only)
  shared/                   logger contract, SDK type helpers
  spotify/
    config.ts               fixed redirect URI, endpoints, timeouts
    errors.ts               typed, user-facing errors (never contain tokens)
    http.ts                 fetch with timeout, error-payload parsing, 401/403/429 mapping
    auth/                   scopes, PKCE, authorization URL, callback listener, token exchange/refresh, auth service
    api/                    authenticated Web API client (GET/PUT/POST/DELETE, refresh + one retry on 401), current-user profile
    playback/               Spotify Web API playback transport (incl. volume) and response parsing
    library/                Spotify Web API library transport (/me/library)
    playlists/              Spotify Web API playlist transport (/me/playlists, /playlists/{id}, /playlists/{id}/items) and parsing
    storage/                TokenStore interface, encrypted file store, Windows DPAPI key protector
    state/                  shared Spotify account state + subscriptions
com.marting.deckify.sdPlugin/
  manifest.json             plugin + action definitions
  imgs/                     Stream Deck images (plugin icon, category icon, action/key images)
  ui/spotify-account/       Spotify Account Property Inspector (no remote scripts, no browser storage)
  ui/volume/                Volume Up / Volume Down Property Inspector (Volume step)
  ui/playlist/              shared playlist picker for Add to Playlist and Play Playlist
  ui/shared/                Property Inspector stylesheet
  bin/, logs/               build output (bin/plugin.js, bin/native/deckify-media-bridge.exe) and runtime logs (git-ignored)
native/media-bridge/        Rust helper: GSMTC Spotify session selection and commands (protocol.rs, selection.rs, dispatch.rs, gsmtc.rs)
assets/brand/               original Deckify brand files (see assets/brand/README.md)
scripts/                    brand-asset export, key-image generator (volume / Like / playlist icons), smoke test, dev-only token expiry helper,
                            native build, pack + package verification
test/                       Vitest suite (Spotify HTTP fully mocked)
```

## Brand

**Deckify**

Brand direction: dark interface, Spotify-inspired green accent, custom Deckify “D” mark.

> Deckify is an independent project and is not affiliated with or endorsed by Spotify or Elgato.
