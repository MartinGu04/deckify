# Deckify brand review

> **Status: review concepts only. No direction is approved yet.** Nothing here is used by the plugin, the package or the README hero.
> Production artwork changes only after one direction is chosen (or revised) and approved.

## Why a new mark

The development-era Deckify mark (`assets/brand/deckify-icon.png`, `deckify-logo.png`) is a green "D" with three curved sound lines. That
leans on Spotify's own brand elements: Spotify Green and the three "waves" of the Spotify icon. Spotify's Design & Branding Guidelines don't
allow a third-party app's logo to include or look similar to Spotify brand elements, so that mark can't be Deckify's public identity.

The new identity has to say **Deckify = Stream Deck + control surface**, not "a Spotify clone".

## Shared rules for every concept

- A recognizable **D**, built from Stream Deck ideas: physical keys, key grids, a control surface.
- **No** waves or sound arcs, **no** circular badge, **no** green, **no** Spotify typography, and never combined with Spotify branding.
- Dark charcoal base (`#15171C`), white, and **one Deckify-owned accent** that is clearly not Spotify Green.
- Works on a transparent background, in one colour, and at every size Deckify needs: a 20×20 action-list / category glyph, a 72×72 key,
  the 288×288 Marketplace icon and a large GitHub hero.
- Plain geometry (rectangles, straight lines, one D-shaped curve). Each sheet shows the hero lockup, Marketplace tile, key (2× and actual
  size), the monochrome 40/20 px glyphs on dark and light, and the one-colour mark.

The `DECKIFY` wordmark on the sheets uses a generic geometric sans (Inter / Segoe UI) as a placeholder; the final wordmark should be set in
a licensed typeface and outlined.

## Concept A · Keycap D

![Concept A: a violet keycap with a white D](concept-a.svg)

- **What it is:** a raised violet keycap with a white **D** pressed into its face. The darker lip under the face makes it read as a
  physical key you press.
- **Why it's Deckify:** "D" plus "Stream Deck key".
- **Why it isn't Spotify:** a rounded square, not a circle; violet (`#7C5CFF`), not green; no lines or waves.
- **How it scales:**
  - The 20 px glyph drops the lip and keeps the D knocked out of a rounded square. It stays crisp because it is just two shapes.
  - On a key, the keycap sits inside the key like a key on a key, which is the most "Stream Deck" of the three.

## Concept B · Key-grid D

![Concept B: a blue chamfered D outline around a 2×2 grid of keys](concept-b.svg)

- **What it is:** a **D** outline with chamfered (angled) corners instead of a curve, framing a 2×2 grid of keys, with one key "lit".
- **Why it's Deckify:** it reads as a deck of keys inside a D, the clearest "control surface" message.
- **Why it isn't Spotify:** electric blue (`#2F6BFF`); all straight lines and angles, no round shapes at all.
- **How it scales:** the 20 px glyph keeps the outline and merges the grid into one key, because four keys would blur at that size.
- **Risk:** at a glance the angled outline can read as a tag or an arrow; it needs the key grid to read as a D.

## Concept C · Key-column D

![Concept C: three orange keys stacked as the stem of a D](concept-c.svg)

- **What it is:** the stem of the **D** is a column of three keys, and the bowl is one solid shape.
- **Why it's Deckify:** a D built out of keys, literally a "deck".
- **Why it isn't Spotify:** signal orange (`#FF6B2C`) is far from Spotify Green, and the keys are rounded squares, not lines or arcs.
- **How it scales:** it is the boldest silhouette at 20 px and on a key.
- **Risk:** the separated stem can read as "ID" or "iD" at small sizes. Slightly wider keys or a smaller gap would help if this direction
  is chosen.

## Comparison

| | A · Keycap D | B · Key-grid D | C · Key-column D |
| --- | --- | --- | --- |
| Accent | Violet `#7C5CFF` | Electric blue `#2F6BFF` | Signal orange `#FF6B2C` |
| Main idea | one physical key | a grid of keys (control surface) | a D built from keys |
| 20 px glyph | very clear | clear (simplified) | very clear |
| Main risk | the most conventional "app icon" | can read as a tag / arrow | can read as "ID" |

The accent colours are suggestions; any concept can take another accent as long as it stays clearly away from Spotify Green.

## After a direction is approved

1. Final vector master of the mark and wordmark (outlined type) in `assets/brand/`. The development-era files stay there, labelled.
2. Production exports:
   - plugin icon 256×256 / 512×512;
   - Marketplace icon 288×288;
   - category icon 28×28 / 56×56 and the Deckify Status action icon 20×20 / 40×40 (monochrome white, transparent);
   - the Status key image.
3. The key-image accent (today `#22D46E`, close to Spotify Green) changes to the approved accent in `scripts/export-key-icons.mjs` and the
   playback / account key SVGs. The tests that keep generated images in sync cover that step.
4. A README hero and Marketplace gallery images built from the approved mark. Spotify's logo is never part of them.
