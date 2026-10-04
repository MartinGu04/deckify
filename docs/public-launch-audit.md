# Public-launch audit

An audit of Deckify against Spotify's Design & Branding Guidelines and Elgato's Stream Deck plugin guidelines, first written in Phase 7
and updated for the **v1.0 release cleanup** (version `1.0.0.0`, author `MARTIN.G`). It says what is compliant, what is
[resolved](#resolved-for-v10), what still [blocks the release](#still-open-before-v10), what waits for
[Marketplace media](#marketplace-media-pending) and what is [after v1.0](#post-v10-roadmap). Marketplace listing details are in
[marketplace-readiness.md](marketplace-readiness.md).

## Sources and limits

- **Spotify:** [Design & Branding Guidelines](https://developer.spotify.com/documentation/design).
- **Elgato:**
  - [plugin guidelines](https://docs.elgato.com/guidelines/stream-deck/plugins/);
  - [plugin metadata](https://docs.elgato.com/guidelines/streamdeck/plugins/metadata/);
  - [Marketplace thumbnails and app icons](https://docs.elgato.com/en/general/creating-a-product/thumbnails-and-app-icons).
- **How the rules were read:** Phase 7 and the v1.0 cleanup were prepared in an environment that can't open `developer.spotify.com`,
  `docs.elgato.com` or `newsroom.spotify.com`. The rules below come from search-engine excerpts of those pages, plus the project brief.
- **Verify before launch:** read both guideline pages in full once more, as they change. Items marked **verify** depend on wording that
  could not be read in full.
- **Spotify assets:** the two Spotify image files Deckify ships come byte-for-byte from Spotify's brand-asset storage
  (`storage.googleapis.com/pr-newsroom-wp/…`). Tests pin their SHA-256. If the developer site offers different files, replace them and
  update the hashes.

Status key: ✅ compliant · 🟡 open question or minor follow-up · ⛔ blocks a public launch.

## Spotify: Deckify's own brand

| Item | Status | Notes |
| --- | --- | --- |
| Product name | ✅ | "Deckify" doesn't contain or imitate "Spotify". |
| Deckify logo / plugin icon | ✅ (Phase 7) | **B1 · Frame D** (violet `#7C5CFF`) is the approved brand ([final geometry](brand-review/README.md#final-b1-geometry)). The masters are in [`assets/brand/`](../assets/brand/README.md), and the plugin icon, category icon, Status key and README hero use it. The development-era mark (a green D with sound lines that resembled Spotify Green and the Spotify waves) is archived in `assets/brand/archive/development-era/`, used nowhere, and tests keep it that way. |
| Key-image accent colour | ✅ (Phase 7) | Deckify's key images, Now Playing accents, Property Inspector controls and the sign-in result page use Deckify violet instead of the former `#22D46E`, which was close to Spotify Green. A test keeps the old green out of Deckify-owned files. Spotify's own attribution assets are exempt and unchanged. |
| README hero | ✅ | The B1 logo, with light and dark variants. No Spotify logo and no co-branding. The overview illustration uses Deckify's own key images only. |
| Endorsement wording | ✅ | README, manifest and docs describe compatibility ("Spotify Premium required", "for Stream Deck"), never endorsement. The README footer states Deckify isn't affiliated with or endorsed by Spotify or Elgato. |
| Manifest description | 🟡 | "A dynamic Spotify control center for Elgato Stream Deck." describes function. Revisit with the final Marketplace copy. |
| "Spotify" in action names | 🟡 | "Spotify Account" names what the key connects to. It is descriptive, not branding. **Verify** against Spotify's naming rules for the final listing. |

## Spotify: metadata shown by Deckify

Spotify requires its metadata (artist, album, track and playlist names, artwork, previews) to be shown with Spotify branding and to link
back to the content on Spotify.

| Surface | Spotify metadata shown | Attribution | Link back | Status |
| --- | --- | --- | --- | --- |
| **Now Playing key** | Track title and artists, or episode and show name | **Added in Phase 7:** Spotify's official icon (green, unmodified), top-left, 21 px on a 72-pixel key, clear space of half its height | **Added in Phase 7:** a press opens the song or episode on `open.spotify.com` (built only from a valid item URI) | ✅ hardware review pending |
| **Playlist picker** (Property Inspector) | Playlist names, owner names, item counts | Spotify's official full logo, 90 px wide, with *Playlist information provided by Spotify* | **Open in Spotify** for the selected playlist and, **since v1.0, on every playlist row**. The plugin opens only a validated `open.spotify.com/playlist/<id>` for the selected playlist or a playlist the picker offers | ✅ (v1.0) |
| **Add to Playlist / Play Playlist keys** | **None since v1.0.** The keys show Deckify's own labels, *Add to Playlist* and *Play Playlist* | n/a | n/a (the picker has Open in Spotify) | ✅ (v1.0) |
| **Spotify Account** (key and Property Inspector) | The user's own Spotify display name, in the Property Inspector only | The page is about connecting Spotify and names it in text; no logo | n/a | 🟡 low risk |
| Like / Unlike, Volume, Mute, Play / Pause, Next, Previous keys | No content metadata (state and percentages only) | n/a | n/a | ✅ |
| Logs, README, docs, overview illustration | No Spotify metadata | n/a | n/a | ✅ |

**Decisions (v1.0):**

1. **Playlist names on playlist keys: removed.** The conservative reading is that a playlist name on a key is displayed Spotify metadata
   without attribution or a link back, which a 72-pixel key can't carry. The keys now show Deckify-owned labels (*Add to Playlist*,
   *Play Playlist*), plus Deckify's own status and feedback titles. The selection itself is unchanged: stored per key by playlist ID and
   URI, with the display-only name cache kept in step with Spotify, and shown only in the Property Inspector, next to Spotify's logo and
   with Open in Spotify. Tests check that no playlist name, owner or ID reaches a key title.
2. **Row-level links in the picker: added.** Every row that has a validated Spotify link offers **Open in Spotify**. The picker sends
   only the playlist ID; the plugin checks it (format, present in the current list, and for Add to Playlist writable) and opens
   `https://open.spotify.com/playlist/<id>`. The picker still never receives or opens links itself, and opening a row never changes the
   key's playlist.
3. **Now Playing at 21 px.**
   - **Size:** Spotify's minimum icon size (21 px digital) is met in key pixels on the MK.2. The full logo (70 px minimum) doesn't fit a
     72-pixel key, and Spotify allows the icon alone when there isn't room for the full logo.
   - **Clear space:** the clear space is kept, which leaves the title and artist the lower half of the key.
   - **Before launch:** confirm on the physical MK.2 that it is legible, and that Stream Deck draws the embedded PNG in the key's SVG.

## Spotify: Like / Unlike

| Item | Status | Notes |
| --- | --- | --- |
| Behaviour | ✅ | Likes or unlikes on Spotify (nothing is stored by Deckify), songs only, with race handling and no polling. Unchanged. Permanent UUID `com.marting.deckify.spotify.like` unchanged. |
| States | ✅ | Explicit: `add` (not in Liked Songs, inactive), `added` (active state), `checking`, `unavailable`, with a test listing every case (`test/like-states.test.ts`). The artwork is one table, `LIKE_KEY_IMAGES` in `src/actions/like-view.ts`. |
| Icon | ✅ (v1.0) | Spotify's official Like icon files, downloaded by the owner from Spotify's Design & Branding Guidelines (`like-icon-svg.zip` and `like-icon-png.zip`, files dated 2024-09-20), are kept unmodified in `assets/spotify-like-icon/` with their SHA-256 pinned (`test/spotify-like-icon.test.ts`). **Inactive** (`add`): the white **+ icon**. **Active** (`added`): Spotify's green active state. Both are embedded byte-for-byte (the 135×135 PNGs, as data URIs) in Deckify's dark 72×72 key at 72/144 size, centred in the upper part, at their original proportions, with nothing drawn over them and no filter, recolouring or cropping (the way Now Playing embeds Spotify's icon). **Checking** and **unavailable** use Deckify's own grey glyphs (three dots; a dash), so Spotify's icon is never altered to show them; the title says why (Connect, No Device, Track Only, …). The **action-list icon** is Spotify's official `like-icon-like.svg` itself, unmodified (`imgs/attribution/`). The heart artwork is deleted, and a test keeps it out. |
| Messages | ✅ (v1.0) | Following Spotify's "Added to Liked Songs" / "Removed from Liked Songs", a successful press shows **Added** or **Removed** as the key title for 1.5 s, on the pressed key only, while the image already shows the new state. A failed or ignored press shows no message (an alert instead, as before). The message is a timer only: no extra request, no polling. |
| README illustration | ✅ | The README stays free of Spotify artwork: its overview illustration shows the Like key in Deckify's neutral (unavailable) state. |

**Before launch:** on the physical MK.2, confirm that Stream Deck draws the embedded PNGs in the Like key images (the same technique as
Now Playing's icon), that both states are legible, and how the 135×135 official SVG looks as the action-list icon in the Stream Deck app.

## Elgato: plugin and action list

| Item | Status | Notes |
| --- | --- | --- |
| Plugin UUID | ✅ | `com.marting.deckify`: reverse-DNS, includes the author and the product. Permanent. |
| Action UUIDs | ✅ | All prefixed with the plugin UUID. Permanent (a manifest test fails if they change). |
| Plugin name and category | ✅ | Both "Deckify". |
| Action names | ✅ | 11 public actions, all well under 30 characters, describing what the key does. |
| Tooltips | ✅ | Every action has one. |
| Legacy Deckify Status | ✅ (Phase 7) | Hidden with `VisibleInActionsList: false`, still registered for existing profiles. Covered by a test and the smoke test. |
| Action-list icons | ✅ | SVG, 20×20, monochrome white `#FFFFFF`, transparent background (checked by a test). |
| Category icon | ✅ (Phase 7) | The B1 28×28 pixel-grid glyph: SVG, monochrome white, transparent. |
| Key images | ✅ | SVG at 72×72 with a 144×144 drawing; the Status key PNGs are 72×72 and 144×144. Dark key backgrounds are intended (key images, not action-list icons). |
| Plugin icon | ✅ (Phase 7) | `imgs/plugin/marketplace.png` 256×256 and `@2x` 512×512 PNG: the B1 symbol on the charcoal tile. |
| Author | ✅ (v1.0) | `MARTIN.G`, the public author name, in the manifest and `package.json` (checked by a test). |
| Node.js debugging | ✅ (v1.0) | The committed manifest keeps `Nodejs.Debug: "enabled"` for development. `npm run pack` packs a staged copy whose manifest has **no `Debug` option** (`"Nodejs": { "Version": "24" }`), so Stream Deck never starts the released plugin with an inspector. The pack reads the manifest back from the finished `.streamDeckPlugin` and fails if it enables debugging; `test/release-package.test.ts` packs with the real Stream Deck CLI and checks the same. |
| Version | ✅ (v1.0) | `1.0.0.0` in the manifest; `1.0.0` in `package.json` and `package-lock.json` (checked by tests). |
| Devices | 🟡 | Keypad actions only. Designed and hardware-tested on the MK.2; other models with keys should work but are untested. No dial (Stream Deck +) support. |

## Repository

| Item | Status | Notes |
| --- | --- | --- |
| Licence | ✅ (v1.0) | **MIT License**, chosen by the owner: [`LICENSE`](../LICENSE), Copyright (c) 2026 Martin Gusin, standard MIT terms. It covers Deckify's original source code and documentation only. [`NOTICE.md`](../NOTICE.md) excludes the Deckify name, logo, symbol and brand identity (all rights reserved except where explicitly permitted), Spotify's trademarks, logos, icons and official brand assets (Spotify's terms and brand guidelines), and Elgato / Stream Deck names, trademarks and brand assets (their owners' terms); it grants no third-party trademark rights. `package.json` and the Windows helper's `Cargo.toml` declare `MIT` (checked by a test). |
| Security policy | ✅ (Phase 7) | `SECURITY.md`. Enable GitHub private vulnerability reporting when the repository becomes public. |
| Privacy | ✅ (Phase 7) | `docs/privacy.md`, checked against the code: no telemetry, Spotify is the only network destination. |
| Media | 🟡 | No real screenshots or hardware captures yet. The capture plan is in [`media/README.md`](media/README.md). The README has no image placeholders or broken links. |
| Documentation | ✅ | A product-first README; engineering detail moved to `docs/`; tests keep links and key facts in sync. |

## Phase 7 verification (completed)

On the production B1 build (`a13b8e9`), the owner checked Deckify on a physical Stream Deck MK.2 under Windows, and reviewed the README:

- **Stream Deck app:** the B1 plugin and category artwork looks good and is legible.
- **Physical MK.2:** the violet key artwork reads well on the device.
- **Actions list:** Deckify Status is hidden, as intended.
- **Regression:** functional testing passed, and the existing controls remain operational.
- **README:** the review passed in GitHub's rendered view (light and dark), covering copy, links and media structure.

## Resolved for v1.0

- **Version and author:** `1.0.0.0` and `MARTIN.G`, synchronized in the manifest, `package.json`, `package-lock.json` and the smoke test.
  Plugin UUID, category, product name and all twelve action UUIDs are unchanged (a test lists them literally).
- **Release Node.js configuration:** packages ship without `Nodejs.Debug`, verified on the actual package.
- **Playlist metadata:** no playlist names on keys; Open in Spotify on the selected playlist and every picker row.
- **Like / Unlike:** Spotify's official + icon and active state, unmodified and hash-pinned, for the inactive and active states; Spotify's
  + icon as the action-list icon; Deckify's own glyphs for checking and unavailable; no heart anywhere; brief **Added** / **Removed** after a
  successful press.
- **Elgato metadata:** Windows 10+ only, Stream Deck 7.1+, Node.js 24, keypad actions only (unchanged).
- **Phase 7:** brand, attribution assets, hidden legacy action, security policy and privacy documentation (see above).
- **Licence:** the owner chose the MIT License for Deckify's original source code and documentation (`LICENSE`). The Deckify brand
  (name, logo, symbol, `assets/brand/`) is excluded and all rights reserved except where explicitly permitted; Spotify and
  Elgato / Stream Deck trademarks and brand assets stay under their owners' terms, and no third-party trademark rights are granted
  ([`NOTICE.md`](../NOTICE.md)).

## Still open before v1.0

**Before publishing a release:**

1. The **physical MK.2 review** of the v1.0 release package (listed in the v1.0 pull request), including the Like key with Spotify's
   icons.

**Before making the repository public:** enabling GitHub private vulnerability reporting. (The licence is decided: MIT, see
[Resolved for v1.0](#resolved-for-v10).)

**Before submitting to the Marketplace:** everything above, the [Marketplace media](#marketplace-media-pending), and re-checking Spotify's
developer terms for distributing an app that each user connects with their own Client ID.

## Marketplace media pending

Real product media is handled separately from the code; nothing fake is added in the meantime.

- The Marketplace thumbnail and gallery (1920×960) from real captures; see [marketplace-readiness.md](marketplace-readiness.md). The
  288×288 app icon is done.
- A real hardware capture for the README ([capture plan](media/README.md)).
- The playlist picker screenshot (now with Open in Spotify on each row) and the Like key with Spotify's icons.

## Post-v1.0 roadmap

Not v1.0 blockers:

- **v1.1:** Phase 10 (dynamic key visuals) and Stream Deck + support (dials and touch strip).
- **macOS:** not supported in v1.0 (Deckify's local controls use Windows' media controls); the listing says Windows only.
- Other ideas in the README's roadmap (device choice, queue controls, layouts for other models).
