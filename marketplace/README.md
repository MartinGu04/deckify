# Deckify Marketplace media (gallery v2)

The Elgato Marketplace thumbnail and four gallery images for Deckify v1.0, rebuilt after Marketplace review asked for gallery media with
no overlapping elements and no supporting files. Every image is 1920×960 PNG, composed from real Deckify UI, and rendered by a script
that measures the result and refuses to write an image that fails its checks.

## Folders

| Folder | What it holds | Upload it? |
| --- | --- | --- |
| [`upload-ready/`](upload-ready/) | The five images, and nothing else. | **Yes**: these are the Marketplace files. |
| [`review/`](review/) | Internal review only: `contact-sheet.png` (every image at 960, 640 and 480 px wide) and `qa-report.md`. | No |
| `out/` | Intermediate files: bundles, the raw Setup captures, `data.json`, reduced-size previews. Git-ignored. | No |
| `src/`, `scripts/` | The pipeline. | No |

| Upload as | File |
| --- | --- |
| Thumbnail | `upload-ready/deckify-thumbnail-1920x960.png` |
| Gallery 1: Deckify overview | `upload-ready/deckify-gallery-1-overview-1920x960.png` |
| Gallery 2: Easy setup | `upload-ready/deckify-gallery-2-easy-setup-1920x960.png` |
| Gallery 3: Two experiences | `upload-ready/deckify-gallery-3-two-experiences-1920x960.png` |
| Gallery 4: Everyday controls | `upload-ready/deckify-gallery-4-everyday-controls-1920x960.png` |

The 288×288 app icon is unchanged: [`assets/brand/marketplace/deckify-app-icon-288.png`](../assets/brand/marketplace/deckify-app-icon-288.png).

## Render

```sh
cd marketplace
npm install
npm run render     # captures, composes, checks; writes upload-ready/ and review/ only if every image passes
```

It uses the pre-installed Chromium in `/opt/pw-browsers`, or `CHROMIUM_PATH`. Copy lives in `src/compose/content.js`; layout in
`src/compose/compose.css` and `compose.js`.

## Where every pixel comes from

Nothing in these images is an invented interface. Two kinds of source, both Deckify's own:

| On screen | Source |
| --- | --- |
| Key images and key titles | **The plugin's own view code**, run on demo playback states: `playPauseView`, `skipView`, `volumeView`, `muteView`, `likeView`, `addToPlaylistView`, `playPlaylistView`, `getSpotifyAccountKeyView` and `renderNowPlayingSvg` from `src/actions/` (bundled by `src/key-states.ts`). The image each returns is the shipped file in `imgs/actions/`; Now Playing is the SVG the plugin renders at runtime, with Spotify's icon where the plugin draws it. |
| Key layouts | `ui/setup/experiences.js`, the layout data the bundled DECKIFY and SIMPLE profiles are checked against (`npm run profiles:check`). |
| Key names under the keys (gallery 4) | The action names from the same catalog, which match the manifest. |
| Deckify Setup screens (galleries 2 and 3) | **Captures of the real Deckify Setup page**, served by the plugin's real `DeckifySetupServer` (its routes, session token and Content Security Policy) with the real account commands, account state and `ExperienceSwitcher` (`src/setup-stage.ts`). Only Spotify sign-in and the Stream Deck device are stand-ins. The script clicks through the real flow (Connect Spotify → You're connected → Choose my Deckify experience) at 2× pixel density, and crops on element boundaries. |
| Logo | `assets/brand/deckify-logo-on-dark.svg`, unchanged. |
| Type | Inter, the typeface of the DECKIFY wordmark. |

Demo data is fictional and matches the promo film: the song *Low Orbit* by *Halcyon Rooms*, the playlist *Night Drive*, the account
*Deckify Demo*. No Spotify account is involved. The Client ID is a placeholder that never appears on screen: the render fails if it shows
up in a capture. No token exists anywhere in the pipeline.

**Presentation-only differences from a Windows PC:**

- Text renders in Inter. Segoe UI isn't available on the render machine; the system resolves the page's own `Segoe UI` font stack to it.
- Key titles are drawn the way Stream Deck draws a plugin's title on a key (bottom-aligned, white with a dark edge), since the titles
  come from Stream Deck itself, not the key image. The size and face approximate Stream Deck's default title style.
- The keys sit on a plain 5 × 3 panel, not a picture of the hardware. The overview caption says it is the layout on a 15-key Stream Deck.

## Why v1 had overlaps (root causes)

The v1 images Marketplace reviewed aren't in this repository (no branch, pull request or commit ever held a thumbnail or gallery image),
so this analysis is based on the existing media pipeline (the promo film in [`film/`](../film/README.md)) and Deckify's real key states,
reproduced while building v2:

1. **Two-line key titles land on the playlist icons.** The idle titles of the playlist keys are two lines (`Add to / Playlist`,
   `Play / Playlist`). The icons reach down to y ≈ 95 of the 144-unit key, and a bottom-aligned two-line title at a normal title size
   starts above that, so the title sits on the artwork. The pixel check measured 133 and 197 px of icon under those titles. It most likely
   looks the same on hardware (confirm on the MK.2), so any image of a full Deckify deck in its idle state shows text over UI. v2 shows
   those keys in their genuine single-line states (**Added**, **Started**), and the pixel check rejects any key title that touches its
   icon. A change to the key art or titles is a product decision and is out of scope here.
2. **Type and product were positioned independently.** The film places headlines and the deck in separate, absolutely positioned layers
   with hand-picked coordinates and a moving camera; nothing checks one against the other, so stills taken from it can put type over the
   product.
3. **Text fitted by estimate, not measurement.** Line breaks in the film are chosen from an estimated text width (`textWidth`), so a
   longer word or a font fallback can push a line into the product.
4. **16:9 sources in a 2:1 frame.** Stills from a 16:9 film lose about 60 px top and bottom at 1920×960, enough to clip a headline,
   button or window edge.
5. **Media at natural size can grow its container.** Seen while building v2: a 2× capture placed at its natural size grows the grid row
   and pushes its caption out of the frame. A layout that only shrinks fonts to cope never notices this.

## Layout system (how v2 prevents collisions)

- **One safe frame.** Content lives only inside a 104 px / 88 px inset frame. Nothing is absolutely positioned, translated or given a
  negative margin for layout. The only exception is a key title on its own key face, which is what Stream Deck does.
- **Two cells, one gutter.** The frame is a CSS grid with a copy cell and a media cell, separated by a fixed 96 px gutter, in a single row
  exactly the frame's height (`grid-template-rows: minmax(0, 1fr)`). Text can't reach the media cell.
- **Media fits its cell; type never shrinks.** `compose.js` measures the media cell and scales only the product media into it: keys up to
  a maximum size, captures never above their own pixels. Type sizes are fixed tokens (headline 76 px, body 32 px, nothing below 26 px; 40 px
  on the thumbnail). Copy that doesn't fit is a failed check and gets rewritten.
- **Measured QA on the rendered page, every render.** The script fails without writing `upload-ready/` if any image:
  - isn't exactly 1920×960;
  - has an element or any line of text outside the safe frame or its own column;
  - has text within 32 px of any media block, or a caption touching its media;
  - has text blocks or key labels overlapping each other or a key;
  - has text wider than its box;
  - has copy below 26 px (gallery) or 40 px (thumbnail);
  - has capture text below 18 px (body) or 13 px (smallest badge) once scaled;
  - has a key title outside its key, or over its key's artwork (pixel check);
  - has an image that failed to load, or a capture shown above its own resolution;
  - has a capture whose crop cuts through a line of text;
  - shows forbidden text: a file name or development path, a link, "Official", a Client ID- or token-shaped value, placeholder copy.
- **Reduced-size review.** Every image is also rendered at 960, 640 and 480 px wide (the browser's own downscaling) for the contact sheet.

## Still needs real product captures

These images use real Deckify UI, but no camera or Stream Deck app capture. Before or after this submission, consider:

1. **A photo or capture of a Stream Deck MK.2 running Deckify**, to replace the plain key panel on the thumbnail and gallery 1 (see
   [docs/media](../docs/media/README.md)). Elgato's Media Room has official device images if a device render is preferred.
2. **The Stream Deck app** (actions list, and the playlist picker Property Inspector with search, paging and Spotify attribution). The
   picker isn't in the gallery because it only exists inside the Stream Deck app window.
3. **Key title style on hardware.** The title size and face are an approximation of Stream Deck's default. Compare against an MK.2 and
   adjust `.key .title` in `compose.css` if needed.
4. **The functional demo video** Marketplace asked for is separate from these images. The promo film in [`film/`](../film/README.md)
   predates parts of v1.0 and needs updating before it can serve as a demo:
   - it loads Like images that no longer exist (`library/heart-*.svg`; v1.0 uses Spotify's Like icons);
   - its server maps the Setup tour's Like icon to a missing file;
   - it shows playlist names on keys, which v1.0 never does.

   A real screen and hardware recording is the more convincing demo.
