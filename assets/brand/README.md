# Deckify brand assets

Deckify's approved brand is **B1 · Frame D**: a violet D frame around a 2×2 grid of Stream Deck-style keys, meaning "D + a deck of keys".
The design history and the final geometry are in [docs/brand-review](../../docs/brand-review/README.md#final-b1-geometry).

The Deckify name, logo, symbol and brand identity are not licensed under the MIT License that covers Deckify's code and documentation:
all rights reserved, except where explicitly permitted. See the [licensing notice](../../NOTICE.md#the-deckify-brand).

**Colours:**

- Deckify violet `#7C5CFF`: the mark and Deckify's key accents.
- Charcoal `#15171C`: tiles and dark backgrounds.
- Key background `#121212`.
- White.

## Masters

Every file here is generated from `scripts/brand.mjs` by `npm run assets`. Edit the geometry there, never the files by hand. A test fails
if a committed file differs from the generator.

| File | Use |
| --- | --- |
| `deckify-symbol.svg` | The symbol in violet, transparent background. |
| `deckify-symbol-mono.svg` | One-colour symbol (charcoal; recolour to white for dark backgrounds), transparent. |
| `deckify-logo.svg` | Horizontal lockup, symbol + DECKIFY, for **light** backgrounds (charcoal wordmark), transparent. |
| `deckify-logo-on-dark.svg` | The same lockup for **dark** backgrounds (white wordmark), transparent. |
| `deckify-glyph-20.svg` | 20×20 pixel-grid glyph for action-list icons, white on transparent. |
| `deckify-glyph-28.svg` | 28×28 pixel-grid glyph for the category icon, white on transparent. |
| `marketplace/deckify-app-icon-288.png` | Elgato Marketplace app icon, 288×288: the symbol on the charcoal tile. |

**Wordmark:**

- **Typeface:** Inter ExtraBold, licensed under the SIL Open Font License, which allows use in logos.
- **Lockup:** letter-spacing 6%, cap height half the D's height. It is converted to outlines, so no font is needed to display it.

## Exports in the plugin

| File | Made from |
| --- | --- |
| `imgs/plugin/marketplace.png` (256×256), `marketplace@2x.png` (512×512) | Plugin icon: the symbol on the charcoal tile. |
| `imgs/plugin/category-icon.svg` | `deckify-glyph-28.svg` |
| `imgs/actions/status/icon.svg` | `deckify-glyph-20.svg` |
| `imgs/actions/status/deckify.png` (72×72), `deckify@2x.png` (144×144) | Deckify Status key: the symbol on the dark key. |

Deckify's functional key images (play, volume, playlist, ...) use the same violet. They come from `scripts/export-key-icons.mjs` and the
hand-drawn SVGs in `imgs/actions/`.

The Marketplace thumbnail and gallery images (1920×960) are built from real Deckify UI by the pipeline in
[marketplace/](../../marketplace/README.md); the upload-ready files are in `marketplace/upload-ready/`.

## Not brand assets

- **Spotify attribution:** the Spotify icon on Now Playing (`imgs/attribution/`) and the Spotify logo in the playlist picker are
  Spotify's own files, used unmodified for attribution. They are never recoloured and never combined with the Deckify mark.
- **Archive:** [`archive/development-era/`](archive/development-era/README.md) keeps the pre-public development identity for history
  only.
