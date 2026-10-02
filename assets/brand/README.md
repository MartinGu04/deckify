# Deckify brand assets

Original, unmodified Deckify brand files live here. They are the single source for every Stream Deck image derived from them and must never be edited by tooling.

| File | Contents |
| --- | --- |
| `deckify-icon.png` | Deckify app / plugin icon (the "D" mark). Transparent background, square, ideally 1024 px or larger. |
| `deckify-logo.png` | Full Deckify logo (mark + wordmark). |

After adding or updating `deckify-icon.png`, regenerate the Stream Deck exports and commit them:

```powershell
npm run assets
```

This writes, without altering the artwork beyond resizing:

- `com.marting.deckify.sdPlugin/imgs/plugin/marketplace.png` (256×256) and `marketplace@2x.png` (512×512): plugin icon
- `com.marting.deckify.sdPlugin/imgs/actions/status/deckify.png` (72×72) and `deckify@2x.png` (144×144): "Deckify" key state, icon on the dark key background

The action-list icon (`imgs/actions/status/icon.svg`) and category icon (`imgs/plugin/category-icon.svg`) are still placeholders. Elgato's guidelines require those to be monochrome white glyphs on a transparent background, so they need a dedicated monochrome version of the mark rather than a conversion of the full-colour icon.

The "Ready" key state (`imgs/actions/status/ready.svg`) is a generic status visual, not brand artwork.
