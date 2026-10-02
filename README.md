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
- Only the `user-read-private` scope is requested. There is no playback yet.
- Tokens are stored encrypted with Windows DPAPI (current user). They are refreshed automatically, and the session is restored on startup without opening a browser.

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

Plugin UUID `com.marting.deckify` and action UUIDs `com.marting.deckify.status` and `com.marting.deckify.spotify.account` are permanent. Never rename them, because existing keys in users' profiles depend on them.

### Install and build

```powershell
npm ci             # install exact dependency versions from package-lock.json
npm run build      # bundle src/ into com.marting.deckify.sdPlugin/bin/plugin.js
npm run check      # typecheck + lint + tests + build + manifest validation + smoke test
```

Individual steps: `npm run typecheck`, `npm run lint`, `npm test`, `npm run validate` and `npm run smoke`.

- `npm test` runs the Vitest suite. Every Spotify HTTP request is mocked, so tests never contact Spotify and use only obviously fake credentials.
- The smoke test runs the built plugin against a simulated Stream Deck connection, presses the Deckify Status key, and checks that a Spotify Account key renders *Not Configured*. It needs no hardware.

CI (`.github/workflows/ci.yml`) runs `npm ci` and `npm run check` on Node.js 24 for every pull request to `main` and every push to `main`.

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
npm run pack          # builds, validates and writes dist/com.marting.deckify.streamDeckPlugin
```

Double-clicking the `.streamDeckPlugin` file installs it into Stream Deck. Unlink a development copy first, because both use the same UUID.

### Logs

| Log | Location |
| --- | --- |
| Deckify plugin | `com.marting.deckify.sdPlugin\logs\com.marting.deckify.0.log` (when linked, this is inside the repository). For an installed package, look in `%APPDATA%\Elgato\StreamDeck\Plugins\com.marting.deckify.sdPlugin\logs\` |
| Stream Deck app | `%APPDATA%\Elgato\StreamDeck\logs\` |

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
  settings/                 Stream Deck global settings (Client ID only)
  shared/                   logger contract, SDK type helpers
  spotify/
    config.ts               fixed redirect URI, endpoints, timeouts
    errors.ts               typed, user-facing errors (never contain tokens)
    http.ts                 fetch with timeout, error-payload parsing, 401/403/429 mapping
    auth/                   scopes, PKCE, authorization URL, callback listener, token exchange/refresh, auth service
    api/                    authenticated Web API client, current-user profile
    storage/                TokenStore interface, encrypted file store, Windows DPAPI key protector
    state/                  shared Spotify account state + subscriptions
com.marting.deckify.sdPlugin/
  manifest.json             plugin + action definitions
  imgs/                     Stream Deck images (plugin icon, category icon, action/key images)
  ui/spotify-account/       Spotify Account Property Inspector (no remote scripts, no browser storage)
  bin/, logs/               build output and runtime logs (git-ignored)
assets/brand/               original Deckify brand files (see assets/brand/README.md)
scripts/                    brand-asset export, smoke test, dev-only token expiry helper
test/                       Vitest suite (Spotify HTTP fully mocked)
```

Playback phases will add the local Windows media layer and a shared playback state manager next to `src/spotify/`.

## Brand

**Deckify**

Brand direction: dark interface, Spotify-inspired green accent, custom Deckify “D” mark.

> Deckify is an independent project and is not affiliated with or endorsed by Spotify or Elgato.
