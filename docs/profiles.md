# Deckify experiences (bundled Stream Deck profiles)

Deckify includes two ready-made, editable starting layouts for the standard 15-key **Stream Deck** and **Stream Deck MK.2**:

- **DECKIFY ⭐ Recommended:** the complete Deckify experience.
- **SIMPLE:** the essentials.

They aren't different products. Both use the same plugin and the same permanent actions; only the keys and their positions differ. The
user picks one in Deckify Setup right after connecting Spotify (**Install → Connect → Choose → Play**).

Each experience is a real Stream Deck profile, exported from the Stream Deck app. It is bundled with the plugin through Elgato's official
profile support: the file ships in the plugin folder, it's registered in the manifest's `Profiles` array, and the plugin switches to it
with the SDK's `switchToProfile`.

## The layouts

The layouts are kept in [`ui/setup/experiences.js`](../com.marting.deckify.sdPlugin/ui/setup/experiences.js), which Deckify Setup draws
its previews from. The tests, `npm run profiles:check` and `npm run pack` all compare both bundled exports with it, key by key.
`npm run profiles:layouts` prints the layouts. Positions are `column,row`, starting at `0,0` top left; empty keys (`·`) are left empty on
purpose.

### DECKIFY: "The complete Deckify experience." (Recommended, preselected)

Every Deckify action, once each, with Now Playing in the centre:

- **Top row:** playback.
- **Bottom row:** volume.
- **Middle row:** the song and your library. Like and Add to Playlist sit on either side of Now Playing, because both act on the song it
  shows. The account key is on the far left and Play Playlist on the far right.
- **Corners:** empty.

|   | 0 | 1 | 2 | 3 | 4 |
| --- | --- | --- | --- | --- | --- |
| **0** | · | Previous Track | Play / Pause | Next Track | · |
| **1** | Spotify Account | Like / Unlike | **Now Playing** | Add to Playlist | Play Playlist |
| **2** | · | Volume Down | Mute / Unmute | Volume Up | · |

### SIMPLE: "The essentials. Clean and focused."

Nine keys in a centred 3 × 3 block. The outer columns stay empty.

|   | 0 | 1 | 2 | 3 | 4 |
| --- | --- | --- | --- | --- | --- |
| **0** | · | Previous Track | Play / Pause | Next Track | · |
| **1** | · | Like / Unlike | **Now Playing** | Spotify Account | · |
| **2** | · | Volume Down | Mute / Unmute | Volume Up | · |

## Manifest

```json
"Profiles": [
	{ "Name": "profiles/DECKIFY ⭐ Recommended", "DeviceType": 0, "Readonly": false, "AutoInstall": false, "DontAutoSwitchWhenInstalled": false },
	{ "Name": "profiles/SIMPLE",                 "DeviceType": 0, "Readonly": false, "AutoInstall": false, "DontAutoSwitchWhenInstalled": false }
]
```

- **`Name`** is the path of the export inside the plugin folder, without `.streamDeckProfile`. The files are
  `com.marting.deckify.sdPlugin/profiles/DECKIFY ⭐ Recommended.streamDeckProfile` and `…/profiles/SIMPLE.streamDeckProfile`.
  - Each file is named after the profile name inside the export, which is what Stream Deck shows.
  - Deckify passes the same strings to `switchToProfile`.
- **`DeviceType: 0`:** Stream Deck / Stream Deck MK.2 (15 keys, 5 × 3). Other devices are out of scope for now.
- **`Readonly: false`:** users can move, remove and add keys, and change playlist selections. The profiles are starting points.
- **`AutoInstall: false`:** installing Deckify doesn't add any profiles. Stream Deck installs a profile the first time Deckify switches to
  it, after asking the user.
- **`DontAutoSwitchWhenInstalled: false`:** once installed, Stream Deck shows the chosen profile.
- **Minimum version:** `AutoInstall` needs Stream Deck 6.6. Deckify already requires 7.1, so the minimum version is unchanged.

## How the switch works

1. **Recording the device.** The user opens Deckify Setup from the Spotify Account key's settings.
   - The plugin records which device that key is on, from the SDK event (`ev.action.device.id`). It never takes the device from the
     Property Inspector's message.
   - It keeps the device in the setup session, in memory only. The device ID is never sent to the page and never logged.
2. **Telling the page.** When the session starts, the page only learns whether that device can use the experiences:
   - `supported`;
   - `unsupported-device` (not a 15-key Stream Deck);
   - `device-unavailable`.
3. **The request.** **Use this experience** sends `{ "type": "choose-experience", "experience": "deckify" | "simple" }`. The server
   rejects any other value and any extra field, so a profile name, path, device ID or page can't get through.
4. **The switch.** The plugin's `ExperienceSwitcher`:
   - maps the ID to its fixed profile name;
   - checks that the originating device is a connected `DeviceType 0`;
   - calls `streamDeck.profiles.switchToProfile(deviceId, name)`.

   Stream Deck only accepts profiles bundled with the plugin, so Deckify can't reach or switch user-made profiles.
5. **No double switches.** A request already in flight is shared, and a repeat within four seconds isn't sent again, so a double-click
   never asks Stream Deck twice. **Choose a different experience** is a new, explicit request.
6. **Honest finish.** The SDK doesn't report back whether the profile was installed, so the page doesn't claim it was. It shows
   **Finish in Stream Deck**: "Stream Deck may ask you to install the Deckify profile once. Approve it to continue." Then
   **Deckify is ready.**

Deckify doesn't store which experience was chosen. Stream Deck owns the installed profile, and Deckify has no reliable way to know whether
the user has changed or removed it.

## What an export contains

Both exports come from Stream Deck 7.6 on Windows with the MK.2 (device model `20GBA9901`). They contain:

```text
package.json                                        app version, device model, RequiredPlugins: ["com.marting.deckify"]
Profiles/<PROFILE>.sdProfile/manifest.json          Name, Device, Pages { Default: <empty page>, Pages: [<page with keys>] }
Profiles/<PROFILE>.sdProfile/Profiles/<PAGE>/manifest.json   Controllers: [{ Type: "Keypad", Actions: { "column,row": action } }]
…/Images/                                           empty folders
```

Every action has `Settings: {}` and default title styling. The profile manifest also records the Stream Deck app's own identifier for the
device the profile was made on (`Device.UUID`). That's a Stream Deck hardware identifier, not Spotify or account data.

## Personal data and playlist keys

Bundled profiles must contain no personal data. `npm run profiles:check` checks the real export structure and rejects an export that:

- requires a plugin other than Deckify, or contains more than one profile, a page the profile doesn't list, or any file other than the
  manifests (images included);
- has more or fewer than one page with keys, keys outside 5 × 3, actions that aren't Deckify's, or a layout that differs from the preview;
- has a **Play Playlist** or **Add to Playlist** key with any settings. Playlist keys start unconfigured, so the existing picker lets the
  user choose their own playlist.
- has settings on any other key (except a valid **Volume Up / Down** step), a custom title or image, or action resources;
- contains, anywhere, any of:
  - a Spotify URI or `open.spotify.com` link;
  - a playlist selection (`playlistId`, `playlistUri`, `playlistName`);
  - anything Client ID-shaped (32 hex characters) or token-shaped;
  - an email address or a user folder path;
- carries a profile name other than **DECKIFY ⭐ Recommended** or **SIMPLE** respectively.

## Making or replacing an export

Elgato's documented workflow is to build a profile in the Stream Deck app and export it as `.streamDeckProfile`. Deckify doesn't write
that format. The bundled files are exports made on Windows with the physical MK.2:

1. Build and link the plugin (`npm run build`, `npm run link`, `npm run restart`). Pause Spotify.
2. In the Stream Deck app, create a profile for the MK.2 named **DECKIFY ⭐ Recommended** (or **SIMPLE**) and drag fresh Deckify actions
   onto the keys exactly as above. Don't change titles, images or settings, and don't pick a playlist.
3. Export it from the profile settings (**Export…**), then import it. Importing checks the file, then copies it to the path the manifest
   declares:

   ```powershell
   npm run profiles:import -- deckify "C:\path\to\DECKIFY ⭐ Recommended.streamDeckProfile"
   npm run profiles:import -- simple  "C:\path\to\SIMPLE.streamDeckProfile"
   npm run profiles:check
   ```

4. Delete the hand-made profile from the Stream Deck app, so the bundled one is what you test next.

## Validating the profiles in Stream Deck

Automated checks can't prove that Stream Deck accepts a profile. Before merging, both bundled profiles are installed and switched to in
the real Stream Deck app:

1. `npm run pack`, then install `dist/com.marting.deckify.streamDeckPlugin` (or `npm run build` and `npm run restart`).
2. Open Deckify Setup from the Spotify Account key, choose an experience and press **Use this experience**.
3. Approve Stream Deck's install prompt, then check that:
   - the profile appears on the MK.2 that opened setup;
   - it matches the preview key for key;
   - it can be edited;
   - its keys work;
   - its playlist keys are empty and can be configured.
4. Repeat for the other experience, then run the full [MK.2 checklist](experiences-review/README.md#physical-mk2-checklist).

## Changing a bundled profile later

A user's installed copy belongs to them. Deckify never writes, clones or synchronises profiles, and a plugin update is not permission to
replace the user's changes. Once a profile has been released, don't edit it in place: change the layout in `experiences.js`, export it
under a new profile name, and register that name instead.
