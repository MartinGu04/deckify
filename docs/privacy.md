# Deckify privacy

Deckify runs entirely on your computer. It has **no Deckify server, no account with Deckify, no analytics and no telemetry**: the plugin's
only network connections are to Spotify (`accounts.spotify.com` and `api.spotify.com`). This page lists exactly what Deckify stores, sends
and logs. It describes the current code; if something here is wrong, please report it (see [SECURITY.md](../SECURITY.md)).

## What Deckify stores, and where

| What | Where | Protection |
| --- | --- | --- |
| Your Spotify **Client ID** | Stream Deck's global settings for Deckify | None needed: a Client ID is a public app identifier, not a secret. |
| Spotify **access and refresh tokens** | `%LOCALAPPDATA%\Deckify\spotify-session.json` | Encrypted (see below). |
| Session metadata (the Client ID it belongs to, when the access token expires, when you authorized, the granted scopes) | The same file, outside the encrypted part | Not secret. |
| Per-key settings: the Volume step; the chosen playlist's ID, URI and name (the name is only a display cache; the key is identified by ID and URI) | Stream Deck's settings for that key | Stored by Stream Deck like any key setting. |
| Logs | The plugin's `logs` folder (see [Logs](#logs)) | Plain text, without secrets. |

- **How the tokens are encrypted:**
  - The tokens are encrypted inside the plugin process with AES-256-GCM, using a random data key.
  - Only that data key is protected with Windows **DPAPI** (CurrentUser scope). It goes through the built-in Windows PowerShell, over stdin,
    never as a command-line argument.
  - The tokens themselves never leave the plugin process unencrypted, and only the same Windows user can decrypt the file.
- **Never stored:** Deckify doesn't store your Spotify password (you sign in on Spotify's own page) or a Client Secret (it never uses
  one). Tokens never go into Stream Deck settings, Property Inspector pages, browser storage, logs or the repository.
- **In memory only:** the current track, playlists and the last non-zero volume are never written to disk by Deckify.
- **Other systems:** on non-Windows development machines, the session is kept in memory only.

## What is sent to Spotify

Deckify talks to Spotify over HTTPS only, and only while Spotify is connected and you use Deckify keys.

| When | Sent to Spotify |
| --- | --- |
| Connecting | In your browser: your Client ID, the redirect URI, the requested scopes and a PKCE challenge. From the plugin: the authorization code and the PKCE verifier, to get tokens. |
| Staying connected | The refresh token, to get a new access token about every hour. |
| While a playback key is visible | Requests for your current playback state (polled about every 3 to 15 s, never in parallel). |
| On key presses | The command (play, pause, skip, volume, play a playlist); for Like / Unlike, the current song's URI; for Add to Playlist, the playlist's ID and the current song's URI. |
| Playlist keys and pickers | Requests for your playlist list, a playlist's details and its item URIs (to avoid duplicates). |

Spotify processes these requests under its own privacy policy and the terms of your Spotify developer app.

## What is sent to the Windows media helper

The bundled helper (`deckify-media-bridge.exe`) receives only one of these commands: `toggle`, `play`, `pause`, `next`, `previous` or
`ping`, each with a request number.

- **It never receives:** tokens, the Client ID, track or playlist data.
- **What it reads:** the list of Windows media sessions, only to find Spotify's.
- **What it sends back:** whether the command was handled.

## What the Property Inspectors see

The settings pages in the Stream Deck app talk only to the plugin.

- **What they show:**
  - Spotify Account: the setup guide, the connection status, your Spotify display name and plan, your Client ID and the Redirect URI;
  - Volume: the step;
  - the playlist picker: your playlists' names, owners and sizes.
- **What the Spotify Account page receives:** only that public account state and a short problem code (for example
  `authorization-denied`), which it turns into guidance. The guided setup's step and tour page live only in the open page and are
  forgotten when it closes.
- **What they never receive:** tokens or API URLs.
- **What they never do:** call Spotify, open links themselves, store anything in browser storage, or load remote scripts. **Open Spotify
  Dashboard** asks the plugin, which opens only `https://developer.spotify.com/dashboard`.

## Logs

The plugin log is `logs\com.marting.deckify.0.log` inside the plugin folder (for an installed plugin,
`%APPDATA%\Elgato\StreamDeck\Plugins\com.marting.deckify.sdPlugin\logs\`).

- **What it contains:** start-up and connection events, which path each playback press took (local or Web API) with its timing, error
  types, and messages such as `Playlist item added.`
- **What it never contains:**
  - tokens, authorization codes, PKCE verifiers or the Client ID;
  - track, artist, album or playlist names;
  - track, playlist or user IDs and URIs.

  Tests guard these rules.
- **One exception, for the legacy Status key:** pressing a Deckify Status key logs your Stream Deck's device name (for example "Stream Deck")
  and the key position.
- **Retention:** the Stream Deck SDK keeps up to 10 rotated log files of up to 50 MB each.

## Disconnect and removal

- **Disconnect** (in the Spotify Account Property Inspector):
  - **What it deletes:** the encrypted session file, so Deckify forgets your tokens.
  - **What it keeps:** your Client ID, so you can reconnect.
  - **Revoking access at Spotify:** Spotify has no API for Deckify to revoke them. Remove Deckify's access at
    <https://www.spotify.com/account/apps/>.
- **A rejected refresh token** (`invalid_grant`): Deckify deletes the stored session and shows **Connect**.
- **Uninstalling the plugin** in the Stream Deck app removes the plugin folder and its logs. The session file in
  `%LOCALAPPDATA%\Deckify\` stays until you disconnect first or delete that folder.
