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

## Development

### Prerequisites

- Windows 10 or later with the Stream Deck app **7.1+**
- Node.js **24+** (only for building; Stream Deck runs the plugin on its own bundled Node.js 24 runtime)
- Git

Plugin UUID `com.marting.deckify` and action UUID `com.marting.deckify.status` are permanent. Never rename them, because existing keys in users' profiles depend on them.

### Install and build

```powershell
npm ci             # install exact dependency versions from package-lock.json
npm run build      # bundle src/ into com.marting.deckify.sdPlugin/bin/plugin.js
npm run check      # typecheck + lint + build + manifest validation + smoke test
```

Individual steps: `npm run typecheck`, `npm run lint`, `npm run validate` and `npm run smoke`. The smoke test runs the built plugin against a simulated Stream Deck connection and presses the Deckify Status key, so it needs no hardware.

CI (`.github/workflows/ci.yml`) runs `npm ci` and `npm run check` on Node.js 24 for every pull request to `main` and every push to `main`.

### Develop against the Stream Deck app (link workflow)

```powershell
npx streamdeck dev    # enable Stream Deck developer mode (once per machine)
npm run build
npm run link          # symlink com.marting.deckify.sdPlugin into the Stream Deck plugins folder
npm run restart       # (re)start the plugin inside Stream Deck
npm run watch         # optional: rebuild and restart automatically on every change
```

To undo: `npx streamdeck unlink com.marting.deckify`.

The manifest enables Node.js debugging (`Nodejs.Debug`). Use the **Attach to Plugin** VS Code launch configuration to attach a debugger.

### Package

```powershell
npm run pack          # builds, validates and writes dist/com.marting.deckify.streamDeckPlugin
```

Double-clicking the `.streamDeckPlugin` file installs it into Stream Deck. Unlink a development copy first, because both use the same UUID.

### Logs

| Log | Location |
| --- | --- |
| Deckify plugin | `com.marting.deckify.sdPlugin\logs\com.marting.deckify.0.log` (when linked, this is inside the repository). For an installed package, look in `%APPDATA%\Elgato\StreamDeck\Plugins\com.marting.deckify.sdPlugin\logs\` |
| Stream Deck app | `%APPDATA%\Elgato\StreamDeck\logs\` |

The plugin logs at `debug` level while `Nodejs.Debug` is enabled and at `info` otherwise. Raise it with `streamDeck.logger.setLevel("trace")` in `src/plugin.ts` to record every message exchanged with Stream Deck.

### Project layout

```text
src/
  plugin.ts             entry point: logging, error handlers, action registration, connect
  identifiers.ts        permanent plugin / action UUIDs
  actions/status.ts     "Deckify Status" proof-of-life key action
com.marting.deckify.sdPlugin/
  manifest.json         plugin + action definitions
  imgs/                 Stream Deck images (plugin icon, category icon, action/key images)
  bin/, logs/           build output and runtime logs (git-ignored)
assets/brand/           original Deckify brand files (see assets/brand/README.md)
assets/placeholder/     source of temporary placeholder artwork
scripts/                brand-asset export and hardware-free smoke test
```

Later phases add `src/services/` (Spotify Web API, local Windows media layer), `src/state/` (shared playback state manager), `src/types/` and a `ui/` property inspector when there is something to put in them.

## Brand

**Deckify**

Brand direction: dark interface, Spotify-inspired green accent, custom Deckify “D” mark.

> Deckify is an independent project and is not affiliated with or endorsed by Spotify or Elgato.
