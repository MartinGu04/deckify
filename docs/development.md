# Developing Deckify

This page is for building Deckify from source. **End users don't need any of it**: the packaged `.streamDeckPlugin` contains everything
(see the [README](../README.md#getting-started)).

## Prerequisites

- **Windows 10 or later** with the Stream Deck app **7.1+**.
- **Node.js 24+.** Only for building; Stream Deck runs the plugin on its own bundled Node.js 24 runtime.
- **Git.**
- **Rust,** only to build the Windows media bridge:
  - install it via [rustup](https://rustup.rs) with the MSVC toolchain (Visual Studio Build Tools, "Desktop development with C++");
  - `native/media-bridge/rust-toolchain.toml` pins the Rust version, and rustup installs it on first use.
- **A Spotify app with your own Client ID,** set up as in the [README](../README.md#2-create-your-spotify-client-id).

The plugin UUID `com.marting.deckify` and every action UUID in `src/identifiers.ts` are **permanent**. Never rename them: keys in users'
profiles depend on them, and a test fails if they change.

## Install, build and check

```powershell
npm ci             # install exact dependency versions from package-lock.json
npm run build      # bundle src/ into com.marting.deckify.sdPlugin/bin/plugin.js
npm run check      # typecheck + lint + tests + build + manifest validation + smoke test
```

Individual steps: `npm run typecheck`, `npm run lint`, `npm test`, `npm run validate` and `npm run smoke`.

- **`npm test`** runs the Vitest suite. Every Spotify HTTP request is mocked, so tests never contact Spotify and use only obviously fake
  credentials.
- **The smoke test** runs the built plugin against a simulated Stream Deck connection. It needs no hardware. It checks that:
  - the hidden Deckify Status key still works;
  - a Spotify Account key renders *Not Configured*;
  - Play / Pause, Volume Up, Mute / Unmute, Like / Unlike, Add to Playlist and Play Playlist keys render *Connect*.
- **`npm run assets`** regenerates image exports:
  - the development plugin icon PNGs from `assets/brand/`;
  - the volume / Like / playlist key images (`scripts/export-key-icons.mjs`);
  - the README overview illustration (`scripts/export-deck-overview.mjs`).

  Tests fail if a committed generated file differs from its generator.

## Windows media bridge (native helper)

```powershell
npm run native:test    # cargo test: protocol parsing/serialization, Spotify-only session selection, command dispatch
npm run native:build   # cargo build --release, then copy the exe to com.marting.deckify.sdPlugin/bin/native/
```

- **Source:** `native/media-bridge/` (Rust, `windows` crate). The Rust tests use fakes and never touch real media sessions.
- **Other systems:** `npm run native:build` does nothing (with a message) on non-Windows machines; the plugin then runs without the local
  path.
- **Linked development plugin:** run `npm run native:build` once (and after changing the Rust code), then `npm run restart`.
- **Real-helper test:** `test/media-bridge-binary.test.ts` drives the real helper through the TypeScript bridge when a build exists (or
  `DECKIFY_MEDIA_BRIDGE_PATH` points to one), and is skipped otherwise.

## Run inside the Stream Deck app (link workflow)

```powershell
npx streamdeck dev    # enable Stream Deck developer mode (once per machine)
npm run build
npm run link          # symlink com.marting.deckify.sdPlugin into the Stream Deck plugins folder
npm run restart       # (re)start the plugin inside Stream Deck
npm run watch         # optional: rebuild and restart automatically on every change
```

- **To undo the link:** `npx streamdeck unlink com.marting.deckify`.
- **Debugging:** the manifest enables Node.js debugging (`Nodejs.Debug`). Use the **Attach to Plugin** VS Code launch configuration to
  attach a debugger.

## Package

```powershell
npm run pack          # builds the native helper (Windows), bundles, packs and verifies dist/com.marting.deckify.streamDeckPlugin
```

1. **On Windows,** `npm run pack` builds the release helper and stages it at
   `com.marting.deckify.sdPlugin/bin/native/deckify-media-bridge.exe`.
2. It runs the Stream Deck CLI pack, which validates the manifest.
3. It checks that the package contains:
   - `bin/plugin.js` and the manifest;
   - every file the manifest references;
   - every generated key image;
   - the Spotify attribution images;
   - the Property Inspector scripts and styles;
   - on Windows, the helper.

   It fails if anything is missing.
4. **On other systems** it packs without the helper (Web API only).

- **Not in the package:** only `com.marting.deckify.sdPlugin/` is packed, so `docs/` (including the brand-review concepts and media) and
  `assets/` never end up in the plugin.
- **Installing a package:** double-clicking the `.streamDeckPlugin` file installs it into Stream Deck. Unlink a development copy first,
  because both use the same UUID.

## Continuous integration

`.github/workflows/ci.yml` runs on every pull request to `main` and every push to `main`. Actions are pinned by commit SHA.

- **Ubuntu:** `npm ci` and `npm run check` on Node.js 24.
- **Windows:**
  1. builds the release media bridge;
  2. runs its Rust tests, `cargo fmt --check` and `cargo clippy -D warnings`;
  3. runs `npm run pack` (package verification included);
  4. runs `npm run check`, including the test that drives the real helper;
  5. uploads the `.streamDeckPlugin` as a build artifact.

## Logs

| Log | Location |
| --- | --- |
| Deckify plugin | `com.marting.deckify.sdPlugin\logs\com.marting.deckify.0.log` (inside the repository when linked). For an installed package: `%APPDATA%\Elgato\StreamDeck\Plugins\com.marting.deckify.sdPlugin\logs\` |
| Stream Deck app | `%APPDATA%\Elgato\StreamDeck\logs\` |

**Local vs Web API routing.** Each playback press logs which path it took, at `info` level. The lines contain no track, artist or device
names:

| Log line | Meaning |
| --- | --- |
| `Playback next sent via windows-gsmtc in 4 ms.` | Sent to the Spotify desktop app through Windows media controls; no Web API command. |
| `Playback next not available via windows-gsmtc (spotify-session-unavailable); using the Spotify Web API.` | No local Spotify session; the Web API sent it. |
| `Playback next via windows-gsmtc has an unknown outcome (timeout); not retrying it.` | The helper didn't answer; nothing was retried. |
| `Windows media bridge ready (local Spotify session: found).` | Logged once after start. |
| `Windows media bridge unavailable (helper not found); using Spotify Web API fallback.` | The helper is missing; Web API only. |

To see the fallback, quit the Spotify desktop app and play on another Spotify device (phone, web player). Presses then log *not available
via windows-gsmtc* and go through the Web API.

- **Volume and Like / Unlike** always use the Web API. They log only failures (for example `Volume change failed: ...`) and, for Like /
  Unlike, `Library item saved.` / `Library item removed.` without any track details.
- **Playlist keys** log `Playlist list refreshed.`, `Playlist item added.`, `Playlist item already present.` and
  `Playlist playback started.`, and failures only as error codes. They never log playlist names, IDs or track URIs.
- **Log level:** the plugin logs at `debug` while `Nodejs.Debug` is enabled and at `info` otherwise. To record every message exchanged
  with Stream Deck, raise it with `streamDeck.logger.setLevel("trace")` in `src/plugin.ts`, locally only.

## Development-only token refresh test

You can trigger a real token refresh on Windows without waiting about an hour for the access token to expire:

```powershell
npm run dev:expire-spotify-token   # marks the stored access token as expired (rewrites only accessTokenExpiresAt)
npm run restart                    # Deckify restores the session and must refresh it
```

- **Expected result:** the log shows `Spotify access token refreshed (refresh token rotated: yes|no)`, and the key returns to
  **Connected**.
- **Safety:** the script is a development helper in `scripts/` and is not part of the plugin bundle. It never decrypts or prints tokens,
  and it only works for the Windows user who owns the session.

## Troubleshooting

**Port 43821 in use.** If another program uses port 43821, connecting fails with *"Deckify could not start its local Spotify callback
listener because port 43821 … is already in use"*.

- **No fallback port:** Spotify only accepts the registered redirect URI, so Deckify never tries another port.
- **Find the other program:** run `Get-NetTCPConnection -LocalPort 43821 | Select-Object OwningProcess` in PowerShell.
- **Reserved by Windows** (for example by Hyper-V): the port then appears in `netsh interface ipv4 show excludedportrange protocol=tcp`.

## Project layout

```text
src/
  plugin.ts                 entry point: logging, error handlers, shared services, action registration, startup restore
  identifiers.ts            permanent plugin / action UUIDs
  actions/                  one class per action, key views, Now Playing renderer, Spotify attribution, Property Inspector protocols
  playback/                 PlaybackService: model, shared state, polling, local-first routing, volume controller, mute memory
  library/                  LibraryService: the current song's Liked Songs state (checks, like / unlike, race guards)
  playlists/                PlaylistService: shared cache, writable filter, duplicate cache by snapshot, add, play; model and validation
  windows/                  Windows media bridge client: spawns the bundled helper, JSON-lines IPC, timeouts, restarts
  settings/                 Stream Deck global settings (Client ID only)
  shared/                   logger contract, SDK type helpers
  spotify/
    config.ts               fixed redirect URI, endpoints, timeouts
    errors.ts, http.ts      typed user-facing errors (never contain tokens); fetch with timeout and 401/403/429 mapping
    links.ts                open.spotify.com links for the item playing
    auth/                   scopes, PKCE, authorization URL, callback listener, token exchange/refresh, auth service
    api/                    authenticated Web API client (refresh + one retry on 401), current-user profile
    playback/, library/, playlists/
                            Spotify Web API transports and response parsing
    storage/                TokenStore interface, encrypted file store, Windows DPAPI key protector
    state/                  shared Spotify account state + subscriptions
com.marting.deckify.sdPlugin/
  manifest.json             plugin + action definitions
  imgs/                     plugin icon, category icon, action/key images, Spotify attribution icon
  ui/                       Property Inspectors: spotify-account/, volume/, playlist/ (shared picker), shared/ stylesheet
  bin/, logs/               build output (plugin.js, native/deckify-media-bridge.exe) and runtime logs (git-ignored)
native/media-bridge/        Rust helper: GSMTC Spotify session selection and commands
assets/brand/               development-era Deckify brand files (see its README)
docs/                       architecture, privacy, history, launch audits, brand review, media capture guide
scripts/                    asset generators, smoke test, dev-only token expiry helper, native build, pack + package verification
test/                       Vitest suite (Spotify HTTP fully mocked)
```
