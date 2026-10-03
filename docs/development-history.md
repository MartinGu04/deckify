# Deckify development history

How Deckify was built, phase by phase, with the decisions and details that still apply. Everything described here is in the current code
(Phase 6). For the current design as a whole, see [architecture.md](architecture.md).

## Phase 1: Foundation

- **The plugin:** a native plugin scaffolded with the official Stream Deck CLI, with the permanent plugin UUID `com.marting.deckify`.
- **Proof of life:** the **Deckify Status** action (`com.marting.deckify.status`) toggles between *Deckify* and *Ready* on each press. It
  confirmed the plugin, logging and error handling on a physical MK.2.
- **Today (Phase 7):** it is hidden from the actions list (`VisibleInActionsList: false`) but still registered, so existing keys keep
  working.

## Phase 2: Spotify account

- **Spotify Account key** (`com.marting.deckify.spotify.account`). Every instance shows the same shared state: Not Configured,
  Disconnected, Connecting, Connected or Error.
- **Its Property Inspector** holds the Spotify **Client ID** (stored in Deckify's global settings), the connection status, the connected
  account name, and Connect / Disconnect buttons.
- **Authorization Code flow with PKCE** with a fixed redirect URI, `http://127.0.0.1:43821/callback`. A one-shot local listener binds only
  to `127.0.0.1:43821` and accepts only `/callback`. No Client Secret is needed, accepted or stored.
- **Session storage:** tokens are encrypted with a random AES-256-GCM data key, and the data key is protected with Windows DPAPI (current
  user). Tokens are refreshed automatically, and the session is restored on startup without opening a browser.
- **Session lifetime:**
  - access tokens last about an hour and are refreshed automatically;
  - when Spotify rejects the refresh token (`invalid_grant`), Deckify deletes the stored session and shows **Connect** again;
  - Spotify has no API for Deckify to revoke tokens. To revoke Deckify's access, use **Disconnect** and remove Deckify at
    <https://www.spotify.com/account/apps/>.

## Phase 3: Playback core

| Action | UUID (permanent) | What it does |
| --- | --- | --- |
| Play / Pause | `com.marting.deckify.spotify.play-pause` | Shows Play while paused and Pause while playing; a press toggles. |
| Next Track | `com.marting.deckify.spotify.next` | Skips to the next item. |
| Previous Track | `com.marting.deckify.spotify.previous` | Goes back to the previous item. |
| Now Playing | `com.marting.deckify.spotify.now-playing` | Shows the title, artist (or show) and progress. A press refreshed the state; since Phase 7 it opens the item on Spotify, then refreshes. |

- **Scopes:** `user-read-private`, `user-read-playback-state`, `user-modify-playback-state`.
- **Reconnect after an upgrade.** A session authorized before a phase that added scopes lacks those scopes.
  - The Spotify Account key then shows **Reconnect**, and its Property Inspector shows **Reconnect Spotify**. Press it once to authorize
    again.
  - The Client ID is kept, and the new session replaces the old one.
  - The old session is never used for the new features, and scopes are never added through a token refresh.
- **Spotify Premium** is required for playback control (Spotify's rule). With another account, Deckify stays connected and Now Playing
  still works, but control keys show **Premium**.
- **No active device:** the keys show **No Device** and a press alerts. Deckify has no device picker.
- **Quota-aware polling.** Spotify Development Mode apps have request quotas as well as rate limits, so one shared poller serves every key.
  - It runs only while Spotify is connected and a playback key is visible: about every 3 s while playing, 8 s while paused and 15 s when
    nothing is playing.
  - After a press, Deckify re-reads the state shortly afterwards. Requests never overlap.
  - On HTTP 429 it waits for `Retry-After` and keeps the last state. When the quota is exhausted it pauses updates (keys show **Limited**)
    and resumes on its own.
- **OAuth stays explicit:** playback keys never open the browser. When Spotify isn't connected, they show **Connect** or **Reconnect**
  and alert on press.

## Phase 4: Windows media bridge

Play / Pause, Next Track and Previous Track became instant on Windows. Each command first goes to the **Spotify desktop app** through
Windows' media controls (*Global System Media Transport Controls*, GSMTC), the same mechanism as keyboard media keys. The Web API remains the
state source and the fallback.

- **Spotify only.**
  - Deckify picks the media session whose app is Spotify: the desktop `Spotify.exe`, or the Microsoft Store app
    `SpotifyAB.SpotifyMusic_…!Spotify`.
  - It never controls a browser, YouTube or any other media app. If Spotify isn't running, the local path reports *unavailable*.
- **Exact routing per press:**
  1. Account checks: connected, Premium.
  2. The local Spotify session via GSMTC: `TryTogglePlayPauseAsync`, `TrySkipNextAsync` or `TrySkipPreviousAsync`. No Web API read happens
     first.
  3. The Web API, only if the local path reports **unavailable**: no Spotify session, helper missing, or Windows refused the command.
  4. If the local outcome is **unknown** (the helper timed out or crashed mid-command), nothing is retried, so a press never skips twice.
- **After a press:** Play / Pause flips optimistically. Next / Previous keep the old metadata until Spotify reports the new item. A Web API
  read then reconciles the keys.
- **Rate limits:** local commands keep working while the Web API is rate-limited; reconciliation waits until the back-off ends.
- **The helper:**
  - a small bundled Rust program (`bin/native/deckify-media-bridge.exe`), started once, hidden, with no shell and no console window;
  - one JSON message per line over stdin/stdout, accepting only `toggle`, `play`, `pause`, `next`, `previous` and `ping`;
  - it never receives tokens, the Client ID or any Spotify data;
  - if it is missing or keeps failing, Deckify logs that once and uses the Web API.

## Phase 5: Essential controls

| Action | UUID (permanent) | What it does |
| --- | --- | --- |
| Volume Down | `com.marting.deckify.spotify.volume-down` | Lowers the active device's Spotify volume by the key's step; shows the volume. |
| Volume Up | `com.marting.deckify.spotify.volume-up` | Raises the active device's Spotify volume by the key's step; shows the volume. |
| Mute / Unmute | `com.marting.deckify.spotify.mute` | Sets the volume to 0, or restores the previous volume. |
| Like / Unlike | `com.marting.deckify.spotify.like` | Adds the current song to Liked Songs, or removes it. |

- **Scopes:** `user-library-read` and `user-library-modify`. Older sessions show **Reconnect** once.
- **Volume is Spotify's own device volume.**
  - It is the volume the Spotify apps show, set through `PUT /v1/me/player/volume` for the desktop app and remote Spotify Connect devices
    alike, whenever Spotify reports the device supports it.
  - Deckify deliberately does **not** use the Windows volume mixer (Core Audio). That is a second, independent level that would disagree
    with Spotify.
- **Volume step:** set per key in the Property Inspector, 1–50%, default 10%. Invalid values fall back to 10%. Volume stays within 0–100%.
- **Rapid presses all count.** Each press moves the target volume immediately, and requests are sent one at a time with the newest target.
  Four quick presses of +10 from 40% end at 80%.
- **No guessing:**
  - an unknown or stale volume is read first;
  - with no active device the keys show **No Device**;
  - a device Spotify reports as not supporting volume shows **Unsupported**.
- **Mute / Unmute** uses Spotify's volume, because Spotify has no separate mute.
  - "Muted" means the real device volume is 0, whoever set it.
  - The last non-zero volume is remembered **in memory only**. After Stream Deck restarts, Unmute from 0% restores 50% until Deckify has
    seen a non-zero volume again.
  - It is deliberately not persisted, because storing it in Stream Deck's global settings could race with saving the Client ID there.
- **Like / Unlike**
  - **Songs only.** It uses Spotify's library API (`GET /v1/me/library/contains`, `PUT` and `DELETE /v1/me/library` with the track URI);
    the older `/me/tracks` endpoints are not used.
  - **When it checks.** The state is checked once per song while a Like key is visible, never polled.
  - **Race safety.** A press applies to the song that was playing when pressed, and a second press during the first is ignored.
- **Spotify Premium** stays required for all controls.

## Phase 6: Playlists

| Action | UUID (permanent) | What it does |
| --- | --- | --- |
| Add to Playlist | `com.marting.deckify.spotify.add-to-playlist` | Adds the current Spotify song to the key's playlist, unless it is already there. |
| Play Playlist | `com.marting.deckify.spotify.play-playlist` | Starts the key's playlist on the active Spotify device. |

- **Scopes:** `playlist-read-private`, `playlist-read-collaborative`, `playlist-modify-public`, `playlist-modify-private`.
- **Spotify's February 2026 playlist API:**
  - `GET /v1/me/playlists` (50 per page, every page);
  - `GET /v1/playlists/{id}` (the current snapshot and owner, before adding);
  - `GET /v1/playlists/{id}/items` (item URIs only);
  - `POST /v1/playlists/{id}/items`.

  The deprecated `/playlists/{id}/tracks` endpoints are not used. Play Playlist uses `PUT /v1/me/player/play` with `context_uri` on the
  active device, never the Windows media session.
- **The picker**
  - **Loading:** playlists load when the Property Inspector opens and are cached for five minutes; **Refresh** reloads them.
  - **Browsing:** search is local, and the list shows at most 20 at a time with Previous / Next.
  - **Telling playlists apart:** same-named playlists are distinguished by owner, Private / Collaborative, item count and, if still
    identical, the end of their ID.
  - **Selection:** a key stores the playlist's **ID and URI**, never its name. A renamed playlist stays selected, and a deleted one shows
    **Unavailable**.
- **Add to Playlist**
  - **Which playlists:** only ones you own or collaborate on.
  - **What it adds:** songs only, and always the song that was playing at the moment of the press.
- **No duplicates.** Before adding, Deckify checks the playlist's items, cached per `snapshot_id`; an existing song shows **Already
  Added**. A quick double press is ignored.
- **Spotify attribution:**
  - the picker shows Spotify's official full logo with *Playlist information provided by Spotify*;
  - **Open in Spotify** opens only `https://open.spotify.com/playlist/<id>` links for the selected playlist.
- **Privacy:** the picker never sees tokens or the Client ID and never calls Spotify itself. Logs never contain playlist names, IDs or
  track URIs.

## Phase 7: Public showcase

- **Documentation:** a product-first README, this history, architecture and privacy docs, and a security policy.
- **Legacy action:** **Deckify Status** is hidden from the actions list.
- **Now Playing:** shows Spotify's official icon next to Spotify metadata. A press opens the current song or episode on Spotify, then
  refreshes.
- **Like / Unlike:** its states are named explicitly (add, added, checking, unavailable). The Phase 5 artwork stays until official Spotify
  Like icons are supplied.
- **Launch audits:** the [public-launch audit](public-launch-audit.md) and [Marketplace readiness](marketplace-readiness.md).
- **Brand:** the development-era mark, which looked too much like Spotify's, was replaced by the approved **B1 · Frame D**
  ([brand review](brand-review/README.md)).
  - **Where it is used:** the B1 masters live in `assets/brand/`; the plugin icon, category and Status icons, the Status key, the README
    hero and the 288×288 Marketplace icon use it.
  - **Key colour:** Deckify's key accent changed from green to violet `#7C5CFF`.
- **Verification:**
  - **README:** reviewed in GitHub's rendered view.
  - **Physical MK.2:** the production B1 build passed on Windows. The B1 plugin and category artwork looks good in the Stream Deck app, and
    the violet key artwork reads well on the device.
  - **Actions list:** Deckify Status is hidden.
  - **Regression:** functional testing passed, and the existing controls still work.

## Phase 8: Guided Spotify setup

- **Goal:** Spotify setup became a guided first-run experience instead of a technical form. The action UUID, OAuth (Authorization Code
  with PKCE) and plugin-side tokens are unchanged.
- **Deckify Setup:**
  - **Why the browser:** the narrow Property Inspector was reviewed in the real Stream Deck app, and the full wizard then moved into
    Deckify Setup, a local page in the default browser served by the plugin.
  - **Hosting:** on `127.0.0.1` only, on a dynamic port (never 43821), and only while setup is open.
  - **Access:** a one-time launch code in the URL fragment, a session token kept in page memory, and a fixed list of account commands.
  - **The Property Inspector** is now a compact entry point: status, account summary, **Set up Deckify** / **Open Deckify Setup**,
    Reconnect and Disconnect.
- **Flow:** Welcome → Open Spotify Dashboard → create the app (Web API, exact Redirect URI with a Copy button) → Client ID
  (**Save & Continue**) → Connect → **You're connected** → optional four-card tour (Now Playing, Like, Playlists, Volume) →
  **Deckify is ready.** Reopening Deckify Setup while connected shows the account. Reconnect (new permissions) and expired sessions get a
  compact screen, not the wizard.
- **Structured problems:** the plugin publishes an `issue` code with every problem (for example `authorization-denied`,
  `authorization-timeout`, `spotify-access-refused`, `session-expired`), so neither page parses English. Every code has guidance with a
  next step. A 403 is presented as a possible Users Management fix, never as a confirmed diagnosis.
- **Sign-in controls:** after 45 seconds of waiting, Deckify Setup offers troubleshooting (exact Redirect URI, Open Dashboard, Retry
  Connect) without declaring a failure. Retry cancels the waiting attempt and opens Spotify's page again; Cancel stops it.
- **Spotify's Development Mode rules** (owner Premium, one Client ID per new developer, five authorized users) are explained as Spotify's
  rules in a collapsed help section.
- **Verification:** automated tests cover the setup's behaviour, the setup server's security over real HTTP, and one end-to-end run.
  Hardware review on the MK.2 is pending.

## Phase 9: Ready-made experiences

- **Goal:** Deckify should feel ready-made, not like a box of separate actions. The product flow became **Install → Connect → Choose →
  Play**; Phase 8 had covered Install → Connect.
- **Experiences:** three editable starting layouts for the 15-key Stream Deck / MK.2, built from the existing actions only
  ([profiles.md](profiles.md)):
  - **SIMPLE:** a centred 3 × 3 block of the essentials.
  - **DECKIFY** (recommended): every action once, with Now Playing in the centre.
  - **POWER:** the SIMPLE controls plus a playlist bank, on one page. More pages weren't justified by today's actions.
- **Official profile support:** the layouts are Stream Deck profiles bundled in `profiles/` and registered in the manifest's `Profiles`
  (`DeviceType 0`, editable, installed only when chosen, shown once installed). The plugin switches to them with the SDK's
  `switchToProfile`, and only to those.
- **Deckify Setup:** after connecting, **Choose my Deckify experience** comes first and **Show me around first** is optional; the tour
  ends at the chooser. Three cards with schematic 5 × 3 previews drawn from the same data the profiles are checked against. Nothing is
  installed until **Use this experience**. Then **Finish in Stream Deck** (Stream Deck may ask to install the profile once) and
  **Deckify is ready.**, which names the experience.
- **Security:** one new command, `choose-experience`, accepting only `simple`, `deckify` or `power` and no other field. The target device
  is the one whose Spotify Account key opened setup, from the SDK event, and it is never exposed to the page. Unsupported devices get a
  message instead of a switch. Requests are collapsed, so a double-click can't trigger two switches.
- **Profiles are real exports:** Deckify doesn't write the `.streamDeckProfile` format. The exports are made in the Stream Deck app and
  imported with `npm run profiles:import`, which checks the layout and rejects personal data, configured playlist keys and images.
  `npm run pack` refuses to build without them.
- **Verification:** automated tests cover the switcher, the server command, the page, the layouts, the checker and packaging. The real
  profile exports and the physical MK.2 review are pending.
