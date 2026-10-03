# Elgato Marketplace readiness

What a Marketplace submission of Deckify would need, checked against Elgato's current guidelines. **Nothing has been submitted**, and no
final Marketplace artwork exists yet: it waits for an approved Deckify brand ([brand review](brand-review/README.md)). Spotify-specific
items are in the [public-launch audit](public-launch-audit.md).

Sources: Elgato's [plugin guidelines](https://docs.elgato.com/guidelines/stream-deck/plugins/),
[plugin metadata](https://docs.elgato.com/guidelines/streamdeck/plugins/metadata/) and
[thumbnails and app icons](https://docs.elgato.com/en/general/creating-a-product/thumbnails-and-app-icons). Re-read them before submitting.

Status key: ✅ ready · 🟡 decision or small change needed · ⛔ missing.

## Manifest and actions

| Requirement | Deckify today | Status |
| --- | --- | --- |
| Plugin UUID: reverse-DNS, author + product | `com.marting.deckify` | ✅ |
| Action UUIDs prefixed with the plugin UUID | All 12, e.g. `com.marting.deckify.spotify.play-pause` | ✅ |
| UUIDs never change after publishing | Fixed since each phase shipped; a test guards them | ✅ |
| Action count | 11 public actions; 1 hidden legacy action (Deckify Status) kept for existing profiles | ✅ |
| Action names accurate and concise (about 30 characters or less) | Longest: "Spotify Account" / "Previous Track" / "Add to Playlist" (15) | ✅ |
| Tooltips | One per action, describing the behaviour | ✅ |
| Category: specified, same as or similar to the plugin name, no author name | "Deckify" | ✅ |
| Author: identifies the creator, shown on Marketplace and in Stream Deck | `MARTIN.G` | 🟡 confirm the public name |
| Description | "A dynamic Spotify control center for Elgato Stream Deck." | 🟡 finalize with the listing copy |
| Supported OS and app version | Windows 10+, Stream Deck 7.1+ | ✅ (macOS isn't supported, so the listing must say Windows only) |

## Images inside the plugin

| Requirement | Deckify today | Status |
| --- | --- | --- |
| Plugin icon 256×256 and 512×512 PNG | `imgs/plugin/marketplace.png` / `@2x`: the B1 symbol on the charcoal tile | ✅ |
| Category icon 28×28 (56×56 when raster), monochrome white, transparent | The B1 28×28 pixel-grid glyph, SVG, `#FFFFFF`, transparent | ✅ |
| Action icons 20×20 (40×40 when raster), monochrome white, transparent | 12 SVGs, 20×20, `#FFFFFF`, transparent | ✅ (Like's heart may change with official Spotify Like icons) |
| Key images 72×72 with 144×144 high-DPI | SVG drawn at 144×144, shown at 72×72, in Deckify violet; Status PNGs (B1 symbol) at 72×72 and 144×144 | ✅ |

## Marketplace listing assets

| Requirement | Plan | Status |
| --- | --- | --- |
| App icon 288×288 PNG, product name or logo as the focus, bold readable type, static | `assets/brand/marketplace/deckify-app-icon-288.png`: the B1 symbol on the charcoal tile | ✅ |
| Thumbnail 1920×960 PNG | Must show the product and its functionality. It waits for real media (an MK.2 capture, the Stream Deck app, the playlist picker); a brand-only image won't do. See [media](media/README.md#5-marketplace-thumbnail-and-gallery-1920960). | ⛔ |
| Gallery images 1920×960 PNG | See the shot list below | ⛔ |
| Accurate depiction of the product and its functionality | Real captures only; any illustration labelled as such | 🟡 |
| All text clear, legible and in English | English captions only | 🟡 |
| Accurate Stream Deck device depictions | Show the MK.2 it was tested on, from a real photo or capture. No invented renders or other models. | 🟡 |
| No "Official" claims unless you own the IP | Deckify never claims to be official Spotify or Elgato software | ✅ |
| No copyrighted imagery you don't own | Album artwork must not appear in listing images. Spotify's logo only where Spotify's rules require attribution, never as decoration. | 🟡 |

### Gallery shot list (proposal)

1. **Layout overview:** a real photo or capture of the MK.2 running a Deckify profile, in clean lighting, with no personal notifications.
2. **Playback:** Play / Pause, Next and Now Playing on hardware. The Now Playing key shows its Spotify icon, as the Spotify guidelines
   require; choose a track whose metadata is fine to publish.
3. **Volume and Mute:** the volume percentage on the key.
4. **Playlists:** the playlist picker in the Stream Deck app (search, paging, Spotify attribution), with neutral playlist names.
5. **Setup:** the Spotify Account Property Inspector with the Client ID field. Never show a real Client ID or any token.
6. **Privacy:** a text-only slide with "No Client Secret · encrypted local session · Spotify-only media control".

Each image: 1920×960 PNG, English text, no Spotify logo used as decoration, and no claim of endorsement.

## Before submitting

1. Capture the real product media, then compose the 1920×960 thumbnail and gallery from it with the B1 logo. The brand, plugin icon, category icon, key accent and 288×288 app icon are done.
2. Resolve the Spotify items in the [public-launch audit](public-launch-audit.md): Like icons, playlist-key attribution and the Development
   Mode / Client ID model for public users.
3. Set the release version and author, and handle `Nodejs.Debug` for the package.
4. Build with `npm run pack` on Windows (CI does this) and install the package on a clean machine.
