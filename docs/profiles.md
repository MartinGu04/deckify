# Deckify experiences (bundled Stream Deck profiles)

Deckify includes three ready-made, editable starting layouts for the standard 15-key **Stream Deck** and **Stream Deck MK.2**. They are
not different products: they use the same plugin and the same permanent actions, and only differ in which keys go where. The user picks
one in Deckify Setup right after connecting Spotify (**Install → Connect → Choose → Play**).

Each experience is a Stream Deck profile bundled with the plugin through Elgato's official profile support: the profile file ships in the
plugin folder, it is registered in the manifest's `Profiles` array, and the plugin switches to it with the SDK's `switchToProfile`.

## The layouts

The layouts below are the single source of truth in [`ui/setup/experiences.js`](../com.marting.deckify.sdPlugin/ui/setup/experiences.js).
Deckify Setup draws its previews from that file, and `npm run profiles:check` (also run by `npm run pack` and the tests) compares every
bundled profile with it key by key. `npm run profiles:layouts` prints them. Positions are `column,row`, starting at `0,0` top left; empty
keys are deliberate.

### SIMPLE: "The essentials. Clean and focused."

Nine keys in a centred 3 × 3 block; the outer columns stay empty.

|   | 0 | 1 | 2 | 3 | 4 |
| --- | --- | --- | --- | --- | --- |
| **0** | · | Previous Track | Play / Pause | Next Track | · |
| **1** | · | Like / Unlike | **Now Playing** | Spotify Account | · |
| **2** | · | Volume Down | Mute / Unmute | Volume Up | · |

### DECKIFY: "The complete Deckify experience." (Recommended, preselected)

Every Deckify action once. Now Playing anchors the centre. Playback runs across the top and volume across the bottom. The middle row is
the song and your library: Like and Add to Playlist sit on either side of Now Playing because both act on the song it shows, with the
account key on the far left and Play Playlist on the far right. The four corners are empty on purpose.

|   | 0 | 1 | 2 | 3 | 4 |
| --- | --- | --- | --- | --- | --- |
| **0** | · | Previous Track | Play / Pause | Next Track | · |
| **1** | Spotify Account | Like / Unlike | **Now Playing** | Add to Playlist | Play Playlist |
| **2** | · | Volume Down | Mute / Unmute | Volume Up | · |

### POWER: "Everything within reach."

One dense page, no folders and no extra pages. The left three columns are the SIMPLE controls (same arrangement); the right two columns
are a playlist bank of four **Play Playlist** keys and two **Add to Playlist** keys. Each playlist key holds its own playlist, so the bank
is several one-press playlists, not duplicate keys. Deckify's current actions don't justify more pages, so POWER is a denser layout. It
adds no functionality the other experiences lack.

|   | 0 | 1 | 2 | 3 | 4 |
| --- | --- | --- | --- | --- | --- |
| **0** | Previous Track | Play / Pause | Next Track | Play Playlist | Play Playlist |
| **1** | Like / Unlike | **Now Playing** | Spotify Account | Play Playlist | Play Playlist |
| **2** | Volume Down | Mute / Unmute | Volume Up | Add to Playlist | Add to Playlist |

## Manifest

```json
"Profiles": [
	{ "Name": "profiles/Deckify Simple", "DeviceType": 0, "Readonly": false, "AutoInstall": false, "DontAutoSwitchWhenInstalled": false },
	{ "Name": "profiles/Deckify",        "DeviceType": 0, "Readonly": false, "AutoInstall": false, "DontAutoSwitchWhenInstalled": false },
	{ "Name": "profiles/Deckify Power",  "DeviceType": 0, "Readonly": false, "AutoInstall": false, "DontAutoSwitchWhenInstalled": false }
]
```

- **`Name`** is the path of the file in the plugin folder without `.streamDeckProfile`. The files are
  `com.marting.deckify.sdPlugin/profiles/Deckify Simple.streamDeckProfile`, `…/Deckify.streamDeckProfile` and
  `…/Deckify Power.streamDeckProfile`. The same strings are what Deckify passes to `switchToProfile`.
- **`DeviceType: 0`:** Stream Deck / Stream Deck MK.2 (15 keys, 5 × 3). Other devices are out of scope for now.
- **`Readonly: false`:** users can move, remove and add keys and change playlist selections. The profiles are starting points.
- **`AutoInstall: false`:** installing Deckify doesn't add three profiles. Stream Deck installs a profile the first time Deckify switches
  to it, after asking the user.
- **`DontAutoSwitchWhenInstalled: false`:** after installing, Stream Deck shows the chosen profile.
- **Minimum version:** `AutoInstall` needs Stream Deck 6.6. Deckify already requires 7.1, so the minimum version is unchanged.

## How the switch works

1. The user opens Deckify Setup from the Spotify Account key's settings. The plugin records the device of that key from the SDK event
   (`ev.action.device.id`), never from the Property Inspector's message, and keeps it in the setup session in memory. The device ID is
   never sent to the page and never logged.
2. When the session starts, the page only learns whether that device can use the experiences: `supported`, `unsupported-device` (not a
   15-key Stream Deck) or `device-unavailable`.
3. **Use this experience** sends `{ "type": "choose-experience", "experience": "simple" | "deckify" | "power" }`. The server rejects any
   other value and any extra field, so a profile name, path, device ID or page can't get through.
4. The plugin's `ExperienceSwitcher` maps the ID to its fixed profile name, checks that the originating device is a connected
   `DeviceType 0`, and calls `streamDeck.profiles.switchToProfile(deviceId, name)`. Stream Deck only accepts profiles bundled with the
   plugin, so Deckify can't reach or switch user-made profiles.
5. Requests in flight are shared, and a repeat within four seconds isn't sent again, so a double-click never asks Stream Deck twice.
   **Choose a different experience** is a new, explicit request.
6. The SDK doesn't report back whether the profile was installed. The page says so honestly: **Finish in Stream Deck**, "Stream Deck may
   ask you to install the Deckify profile once. Approve it to continue." Then **Deckify is ready.**

Deckify doesn't store which experience was chosen: Stream Deck owns the installed profile, and Deckify has no reliable way to know whether
the user changed or removed it.

## Personal data and playlist keys

Bundled profiles must contain no personal data. `npm run profiles:check` rejects an export that:

- contains a Spotify URI or `open.spotify.com` link, a playlist selection (`playlistId`, `playlistUri`, `playlistName`), anything
  Client ID-shaped (32 hex characters) or token-shaped, an email address or a user folder path;
- has a **Play Playlist** or **Add to Playlist** key with any settings: playlist keys start unconfigured, and the existing picker lets the
  user choose their own playlist;
- has settings on any other key, except a valid **Volume Up / Down** step;
- contains images (Deckify keys draw their own), actions that aren't Deckify's, more than one page, keys outside 5 × 3, or a layout that
  differs from the preview;
- is named differently from how Deckify presents it.

## Making the profiles (manual export from Stream Deck)

Elgato's documented workflow is to build a profile in the Stream Deck app and export it as `.streamDeckProfile`. Deckify doesn't write
or reverse-engineer that format, so the three files must be exported by hand once, on Windows with the physical MK.2 connected:

1. Build and link the plugin from this branch (`npm run build`, `npm run link`, `npm run restart`). Pause Spotify, so nothing is playing
   while you build and export.
2. In the Stream Deck app, open the profile list for the MK.2 and create a new profile named exactly **Deckify Simple**.
3. Drag the Deckify actions onto the keys exactly as in [SIMPLE](#simple-the-essentials-clean-and-focused). Use fresh keys from the actions
   list. Don't change titles, images or settings, and don't pick a playlist on playlist keys.
4. Repeat for **Deckify** ([DECKIFY](#deckify-the-complete-deckify-experience-recommended-preselected)) and **Deckify Power**
   ([POWER](#power-everything-within-reach)). POWER's playlist keys stay empty too.
5. Export each profile from the Stream Deck app's profile settings (**Export…**) to any folder.
6. Import each export into the plugin. This checks it, then copies it to the path the manifest declares:

   ```powershell
   npm run profiles:import -- simple  "C:\path\to\Deckify Simple.streamDeckProfile"
   npm run profiles:import -- deckify "C:\path\to\Deckify.streamDeckProfile"
   npm run profiles:import -- power   "C:\path\to\Deckify Power.streamDeckProfile"
   npm run profiles:check
   ```

7. Delete the three hand-made profiles from the Stream Deck app, so the bundled ones are what you test next.

## Validating the profiles in Stream Deck

Automated checks can't prove that Stream Deck accepts a profile. Before merging, each bundled profile is installed and switched to in the
real Stream Deck app:

1. `npm run build` and `npm run restart` (or `npm run pack` and install the `.streamDeckPlugin`).
2. Open Deckify Setup from the Spotify Account key, choose an experience and press **Use this experience**.
3. Approve Stream Deck's install prompt. Check that the profile appears on the MK.2 that opened setup, matches the preview key for key,
   can be edited, and that its keys work. Check that playlist keys are empty and can be configured.
4. Repeat for the other two experiences, then run the full [MK.2 checklist](experiences-review/README.md#physical-mk2-checklist).

## Changing a bundled profile later

A user's installed copy belongs to them. Deckify never writes, clones or synchronises profiles, and a plugin update is not permission to
replace the user's changes. Once a profile has been released, don't edit it in place: change the layout in `experiences.js`, export it
under a new profile name, and register that name instead.
