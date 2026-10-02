# Deckify

**A dynamic Spotify control center for Elgato Stream Deck.**

Deckify is a native Stream Deck plugin that turns the deck into a responsive Spotify control surface rather than a collection of static media buttons.

## Product vision

Deckify should feel like a Spotify Control Center built specifically for Stream Deck:

- Dynamic key states and artwork
- Fast local playback controls
- Spotify Web API features where they add value
- Playlists, queue, library and device control
- A polished property inspector for setup and configuration
- A first-class 5×3 experience for Stream Deck MK.2
- Architecture that can later expand to Stream Deck+, XL, Neo and other supported devices

## Architecture direction

Deckify is intended to use a hybrid model:

1. **Local media layer** for low-latency core playback control and local state where practical.
2. **Spotify Web API layer** for Spotify-specific capabilities such as playlists, library, queue, devices and richer metadata.
3. **Shared state manager** that normalizes playback state for all actions.
4. **Stream Deck SDK layer** that renders and updates actions dynamically.

Authentication should be designed around OAuth Authorization Code with PKCE where supported for this desktop/plugin model. Do not embed a Spotify Client Secret in distributable plugin code.

## Initial target

- Windows
- Elgato Stream Deck MK.2 (15 keys, 5×3)
- Stream Deck 7.1+
- Current Elgato Stream Deck SDK / CLI
- TypeScript + Node.js

## Phase 1 — Foundation

The first milestone is intentionally small:

- Scaffold with the official Stream Deck CLI
- Install and run as a native Stream Deck plugin
- Use a stable Deckify plugin UUID
- Add Deckify branding and placeholder icons
- Implement one proof-of-life action
- Add basic logging and error handling
- Confirm the action appears in the Stream Deck app and works on the physical MK.2

Spotify authentication and playback integration come after the native plugin foundation is verified on hardware.

## Brand

**Deckify**

Brand direction: dark interface, Spotify-inspired green accent, custom Deckify “D” mark.

> Deckify is an independent project and is not affiliated with or endorsed by Spotify or Elgato.
