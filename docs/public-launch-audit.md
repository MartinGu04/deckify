# Public-launch audit

An audit of Deckify against Spotify's Design & Branding Guidelines and Elgato's Stream Deck plugin guidelines, as of Phase 7. It says what
is compliant, what Phase 7 changed, and what still blocks making the repository public, publishing a release, or submitting to the
Marketplace. Marketplace listing details are in [marketplace-readiness.md](marketplace-readiness.md).

## Sources and limits

- **Spotify:** [Design & Branding Guidelines](https://developer.spotify.com/documentation/design).
- **Elgato:**
  - [plugin guidelines](https://docs.elgato.com/guidelines/stream-deck/plugins/);
  - [plugin metadata](https://docs.elgato.com/guidelines/streamdeck/plugins/metadata/);
  - [Marketplace thumbnails and app icons](https://docs.elgato.com/en/general/creating-a-product/thumbnails-and-app-icons).
- **How the rules were read:** Phase 7 was prepared in an environment that can't open `developer.spotify.com`, `docs.elgato.com` or
  `newsroom.spotify.com`. The rules below come from search-engine excerpts of those pages, plus the project brief.
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
| **Playlist picker** (Property Inspector) | Playlist names, owner names, item counts | Spotify's official full logo, 90 px wide, with *Playlist information provided by Spotify* | **Open in Spotify** for the selected playlist (validated `open.spotify.com/playlist/<id>`) | ✅ (row-level links: 🟡) |
| **Add to Playlist / Play Playlist keys** | The chosen playlist's name as the key title | None on the key | None from the key; the picker has Open in Spotify | 🟡 open question |
| **Spotify Account** (key and Property Inspector) | The user's own Spotify display name, in the Property Inspector only | The page is about connecting Spotify and names it in text; no logo | n/a | 🟡 low risk |
| Like / Unlike, Volume, Mute, Play / Pause, Next, Previous keys | No content metadata (state and percentages only) | n/a | n/a | ✅ |
| Logs, README, docs, overview illustration | No Spotify metadata | n/a | n/a | ✅ |

**Open questions** (documented rather than guessed):

1. **Playlist names on playlist keys.** The key title is a playlist name the user picked.
   - **Possible readings:** it may count as displayed Spotify metadata, or as the user's own configuration label.
   - **If attribution is required,** the options are:
     - a small official Spotify icon on those keys, with clear space (it would compete with the Deckify glyph on a 72-pixel key);
     - showing a Deckify label instead of the name by default;
     - relying on the picker's attribution and link.
   - **Today:** unchanged, pending a decision.
2. **Row-level links in the picker.** Each playlist row shows Spotify metadata, but only the selected playlist has an Open in Spotify link.
   Adding a link per row would change the picker's request protocol.
3. **Now Playing at 21 px.**
   - **Size:** Spotify's minimum icon size (21 px digital) is met in key pixels on the MK.2. The full logo (70 px minimum) doesn't fit a
     72-pixel key, and Spotify allows the icon alone when there isn't room for the full logo.
   - **Clear space:** the clear space is kept, which leaves the title and artist the lower half of the key.
   - **Before launch:** confirm on the physical MK.2 that it is legible, and that Stream Deck draws the embedded PNG in the key's SVG.

## Spotify: Like / Unlike

| Item | Status | Notes |
| --- | --- | --- |
| Behaviour | ✅ | Likes or unlikes on Spotify (nothing is stored by Deckify), songs only, with race handling and no polling. Unchanged. |
| States | ✅ | Explicit: `add` (not in Liked Songs), `added` (active state), `checking`, `unavailable`, with a test listing every case (`test/like-states.test.ts`). |
| Icon | ⛔ blocker for public launch | Spotify's guidelines represent Like with a **+ icon** and an active state, and provide the icons to download, in all states (SVG and PNG). That download is on `developer.spotify.com`, which couldn't be reached. Deckify must not redraw Spotify's icon, so the **Phase 5 heart artwork is unchanged** until the official files are supplied. |
| Messages | 🟡 | Spotify's guidance pairs the + icon with "Added to Liked Songs" / "Removed from Liked Songs" messages. On a key that would be a brief **Added** / **Removed** title after a press. Not implemented yet, so the Like visuals stay unchanged for hardware review. Do it together with the icon swap. |

**To finish Like / Unlike:**

1. Download the official Like icon set from Spotify's Design & Branding page.
2. Add the needed state files, unmodified, under `imgs/actions/library/`.
3. Point `LIKE_KEY_IMAGES` in `src/actions/like-view.ts` at them (white on the dark key, or the official coloured active state). Keep the
   `checking` / `unavailable` states distinguishable, for example with Deckify's dimmed treatment if Spotify provides no disabled state.
4. Add the files to the package check, and pin their hashes in a test like `test/spotify-attribution.test.ts`.
5. Decide on the action-list icon. It is Deckify's own glyph; a heart today.
6. Review on the MK.2.

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
| Author | 🟡 | `MARTIN.G`. It is shown on the Marketplace and in Stream Deck; confirm the public author name before release. |
| `Nodejs.Debug: "enabled"` | 🟡 **verify** | The manifest asks Stream Deck to run the plugin with the Node.js inspector in debug mode (`--inspect=127.0.0.1:{port}`). Confirm whether that applies to installed packages outside Stream Deck's developer mode. Either way, release packages should not request it; have `npm run pack` write `"disabled"` into the packaged manifest. |
| Version | 🟡 | `0.1.0.0`. Choose the first public version when a release is planned. |
| Devices | 🟡 | Keypad actions only. Designed and hardware-tested on the MK.2; other models with keys should work but are untested. No dial (Stream Deck +) support. |

## Repository

| Item | Status | Notes |
| --- | --- | --- |
| Licence | ⛔ | No licence file. Without one, nobody may reuse the code. Choosing one needs the owner's explicit decision; Phase 7 adds none. |
| Security policy | ✅ (Phase 7) | `SECURITY.md`. Enable GitHub private vulnerability reporting when the repository becomes public. |
| Privacy | ✅ (Phase 7) | `docs/privacy.md`, checked against the code: no telemetry, Spotify is the only network destination. |
| Media | 🟡 | No real screenshots or hardware captures yet. The capture plan is in [`media/README.md`](media/README.md). The README has no image placeholders or broken links. |
| Documentation | ✅ | A product-first README; engineering detail moved to `docs/`; tests keep links and key facts in sync. |

## Blockers before going public

**Before making the repository public:**

1. Choose a licence, or deliberately decide to publish without one.
2. Review the rendered README (now with the B1 logo).
3. Enable private vulnerability reporting.

**Before publishing a release:**

1. Everything above.
2. Review the violet key artwork, the B1 plugin icon and the Status key on the physical MK.2.
3. Official Spotify Like icons, or a decision recorded with Spotify's guidance in hand.
4. Settle the open metadata questions above.
5. `Nodejs.Debug` handled for release packages.
6. Public author name and version.
7. A real hardware capture for the README.

**Before submitting to the Marketplace:**

1. Everything above.
2. The Marketplace thumbnail and gallery (1920×960) from real product media; see [marketplace-readiness.md](marketplace-readiness.md). The 288×288 app icon is done.
3. Re-check Spotify's developer terms for distributing an app that each user connects with their own Client ID.
