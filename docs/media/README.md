# Deckify media

Images and captures for the README, releases and (later) the Marketplace listing.

**Rules for every file here:**

- **Real media only.** Never a mock screenshot, an invented hardware photo or a render made to look like an official Elgato product.
- **Clean data.** No personal data: no notifications, account names, emails, private playlist names, Client IDs or tokens.
- **Artwork.** No album artwork or Spotify logo used as decoration. Spotify's icon appears only where Deckify really shows it (Now
  Playing) or in the playlist picker's attribution.
- **No placeholders.** The README links a file only once it exists, so it never has broken images.
- **Brand.** The development-era Deckify mark must not appear in public media (see [brand review](../brand-review/README.md)).

## What exists

| File | What it is |
| --- | --- |
| `deck-layout-overview.svg` | An **illustration** (not a photo) of an example 5×3 layout, built by `scripts/export-deck-overview.mjs` from the key images Deckify ships. It contains no Spotify artwork and no track data, and it is regenerated when the key artwork changes (`npm run assets`). |

## Still to capture

### 1. Physical MK.2 hero GIF (required before a public release)

A short, real capture of a Stream Deck MK.2 running Deckify.

- **Length and loop:** 5–8 seconds, looping cleanly (end on the same frame it starts on).
- **Setting:**
  - steady camera, even lighting, no glare on the keys;
  - the deck square to the camera;
  - the Elgato logo on the hardware may show, but don't crop or stage it to look like an official product shot.
- **Content, in order:**
  1. Play / Pause changing from play to pause;
  2. a track change (Next) with Now Playing updating;
  3. a Volume key changing the percentage;
  4. Like changing state, or Add to Playlist showing **Added**.
- **Track choice:** something whose title and artist are fine to publish. Now Playing shows Spotify's icon next to it, as Spotify's
  guidelines require.
- **Privacy:** no notifications or personal information on screen.
- **Output:** `docs/media/deckify-mk2.gif` (or an MP4 with a GIF fallback), at most about 1280 px wide and compressed under about 5 MB
  for GitHub.

### 2. Stream Deck app: action list

A screenshot of the Stream Deck app's actions list with the **Deckify** category expanded.

- It shows the eleven public actions (not Deckify Status).
- Crop to the app window, without personal profiles or other plugins' names if possible.
- Output: `docs/media/stream-deck-actions.png`.

### 3. Playlist picker

A screenshot of an Add to Playlist or Play Playlist Property Inspector showing:

- a selected playlist and **Open in Spotify**;
- search in use;
- paging ("1–20 of N") with Previous / Next;
- the Spotify logo and *Playlist information provided by Spotify*;
- only neutral playlist names (create demo playlists if needed), with no private names or other people's names.

Output: `docs/media/playlist-picker.png`.

### 4. Remote Spotify Connect (optional)

A short clip of Deckify controlling Spotify on a phone or speaker (Play Playlist, volume) with the desktop app closed. Hide the phone's
notifications. Output: `docs/media/remote-connect.gif` or `.mp4`.

## Adding media to the README

When a capture exists, add it under the README hero or in the matching section with descriptive alt text, for example
`![Deckify on a Stream Deck MK.2: play, skip, volume and like](docs/media/deckify-mk2.gif)`. The documentation tests check that every
local image the README references exists.
