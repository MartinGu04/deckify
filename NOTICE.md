# Licensing notice

| What | Terms |
| --- | --- |
| Deckify's original source code | [MIT License](LICENSE) |
| Deckify's original documentation | [MIT License](LICENSE) |
| The Deckify name, logo, symbol and brand identity | All rights reserved, except where explicitly permitted below |
| Spotify's trademarks, logos, icons and brand assets | Spotify's terms and brand guidelines |
| Elgato / Stream Deck names, trademarks and brand assets | Their respective owners' terms |
| Third-party software (npm and Rust dependencies) | Each package's own licence |

## Scope of the MIT License

The [MIT License](LICENSE) (Copyright (c) 2026 Martin Gusin) applies to Deckify's original source code and documentation. It is a
copyright licence for that material only. It grants no trademark rights, and it does not relicense any third-party name, trademark or
asset in this repository.

## The Deckify brand

The Deckify name and DECKIFY wordmark, the Deckify logo and symbol, and Deckify's original brand identity are **not** licensed under the
MIT License. All rights are reserved except where explicitly permitted. This covers the files in [`assets/brand/`](assets/brand/README.md),
the plugin images exported from them ([list](assets/brand/README.md#exports-in-the-plugin)), and the logo and symbol artwork wherever
else it appears in the repository.

- **Permitted:** using the name "Deckify" to refer to this project accurately, for example in an article, a review or a link to it.
- **Not permitted without written permission:** using the Deckify name, logo or symbol as the name or branding of another product, a
  fork or a redistributed build, or in a way that suggests the Deckify project made or endorses it.
- **Forks:** the code may be forked and modified under the MIT License. A distributed fork needs its own name and brand, without the
  Deckify logo or symbol.

The MIT License covers the code that generates the brand files (`scripts/brand.mjs`). It doesn't grant the right to use the name, logo or
symbol that code draws as branding.

## Third-party names, trademarks and assets

The Deckify MIT License grants no rights in any third-party trademark.

- **Spotify:** Spotify's trademarks, logos, icons and official brand assets remain subject to Spotify's terms and brand guidelines. The
  Spotify files Deckify ships unmodified for attribution are not covered by the MIT License:
  - `com.marting.deckify.sdPlugin/imgs/attribution/` (Spotify's icon and Like + icon);
  - `com.marting.deckify.sdPlugin/ui/playlist/Spotify_Full_Logo_RGB_White.png` (Spotify's logo);
  - `assets/spotify-like-icon/` (Spotify's Like icons);
  - the copies of Spotify's Like icons embedded in `com.marting.deckify.sdPlugin/imgs/actions/library/like-add.svg` and
    `like-added.svg`.
- **Elgato / Stream Deck:** the Elgato and Stream Deck names, trademarks and third-party brand assets remain subject to their respective
  owners' terms. Deckify uses the names only to say what it works with.
- **Dependencies:** third-party software Deckify uses or bundles, such as the Stream Deck SDK (`@elgato/streamdeck`), stays under its own
  licence.

Deckify is an independent project, not affiliated with, endorsed by or sponsored by Spotify or Elgato.
