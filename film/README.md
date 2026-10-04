# Deckify promo film

A 24-second product film for Deckify, built from Deckify's own assets and its real UI. It renders to two masters from one timeline:

| Master | Size | Composition |
| --- | --- | --- |
| Desktop 16:9 | 3840×2160 (1920×1080 layout at 2×) | Type left, product right; title-safe 128 px / 96 px margins. |
| Social 9:16 | 1080×1920 | Its own layout: type on top, product below, the Setup card in its narrow layout, a stacked INSTALL / CONNECT / CHOOSE / PLAY. Type and UI stay between y 230 and y 1520 (clear of social apps' top and bottom UI) with 72 px side margins. |

The film is a deterministic HTML page: `seek(t)` draws the frame for any time `t`, and `scripts/render.mjs` captures it frame by frame in
headless Chromium and encodes it with ffmpeg. Nothing is keyframed by hand in a video tool, so changing a word, a timing or a layout and
rendering again is all it takes.

## Render

```sh
cd film
npm install
npm run soundtrack          # out/soundtrack.wav (−14 LUFS, −1 dBTP)
npm run render:desktop      # out/deckify-film-16x9-3840x2160.mp4
npm run render:mobile       # out/deckify-film-9x16-1080x1920.mp4
npm run render:draft        # a fast 960×540 check
npm run preview             # http://127.0.0.1:4321/?format=desktop (or mobile): play and scrub in a browser
```

`render.mjs` also takes `--fps 60`, `--from` / `--to` (seconds) and `--stills 3.5,14.8` (PNG stills for review). It uses the pre-installed
Chromium in `/opt/pw-browsers`, or `CHROMIUM_PATH`. Renders go to `out/` (git-ignored).

## Real product first

| On screen | Source |
| --- | --- |
| Logo, symbol, wordmark | `assets/brand/deckify-symbol.svg` and `deckify-logo-on-dark.svg`, inlined unchanged. Only clip masks and transforms animate them; the last frame is the official lockup. |
| Every key image | `com.marting.deckify.sdPlugin/imgs/actions/`, as shipped. Key titles follow the plugin's views: `70%`, `Added`, `Started`, `Choose Playlist`, `Connect`, two-line playlist names. |
| Now Playing key | `src/now-playing.js`, a port of `src/actions/now-playing-render.ts` (layout, text budget, progress bar, Spotify's icon with its clear space). |
| Key states | `film.js` derives each key from a small playback model the same way the plugin does: signed out → disabled images and **Connect**; no playlist chosen → **Choose Playlist**; and so on. |
| Actions list | The 11 public actions, with their own action-list icons and names from the manifest. |
| Deckify Setup | **The real page** (`ui/setup/`), served unchanged with a bridge (`src/setup-bridge.js`) that stands in for the plugin's local API and puts the page's timers on film time. The typed Client ID, "Client ID saved.", the waiting screen, the "Spotify sign-in didn't finish" guidance, **Copied**, and "You're connected 🎉" are all rendered by Deckify's own code. |
| Spotify | Only where Deckify shows it: the official icon on Now Playing, and Spotify named in the copy and the setup flow. |

Presentation-only changes, kept to a minimum: Inter replaces Segoe UI (not available on the render machine), the Setup page's background is
transparent so the card floats on the stage, and focus rings left by scripted clicks are hidden (`src/setup-film.css`).

Demo data is fictional: tracks (*Low Orbit*, *Velvet Static*, *Northbound*), artists, playlists, the account name *Deckify Demo* and a fake
Client ID. No personal data, no real Client ID, no album artwork (Deckify never shows any).

## Structure

| File | What it is |
| --- | --- |
| `src/timeline.js` | The edit decision list: scenes, copy, key presses, Setup events and sound cues. Picture and sound both read it. |
| `src/film.js` | The film: camera, deck, actions list, Setup driver, type, end card, both layouts. |
| `src/film.css` | Stage styles, using Deckify's tokens (violet `#7C5CFF`, charcoal `#15171C`, key background `#121212`). |
| `src/now-playing.js` | The Now Playing key renderer (port). |
| `src/setup-bridge.js`, `src/setup-film.css` | Injected into the real Deckify Setup page by the server. |
| `scripts/serve.mjs` | Serves the film and the repository's real assets (nothing is copied). |
| `scripts/render.mjs` | Frame capture and encoding. |
| `scripts/soundtrack.mjs` | Music and UI sounds, synthesised from the timeline. |

## The film, shot by shot

| Time | Scene | Picture | Copy |
| --- | --- | --- | --- |
| 0:00–0:03 | **Hook** | Near black. The deck's screens wake in a wave from the Play key: the first violet. Macro shots with shallow depth of field and whip pans: Play → Pause, Next (Now Playing changes track), Volume Up (60% → 70%), Like (the heart fills). A brief symbol reveal: the D draws on, its four keys pop in like presses. | YOUR SPOTIFY. / AT YOUR FINGERTIPS. |
| 0:03–0:06 | **Control** | The symbol pushes through into the full deck. Play, Next, Volume Up twice (80%), Volume Down, Mute (0%), Unmute: every key and the Now Playing key update live. | CONTROL EVERYTHING. |
| 0:06–0:09 | **Music actions** | Tight on the right-hand keys. Like (outline → filled). Add to Playlist: *Keepers* → **Adding…** → **Added**. Play Playlist *Night Drive* → **Started**, and Now Playing switches to the playlist's track. Each word clears before the next rises into its place, so two are never on screen together. | LIKE IT. · SAVE IT. · PLAY IT. |
| 0:09–0:13 | **Personalization** | The deck empties. The Deckify actions list slides in; each action lifts from its row and lands on a key, in order, until the deck is full, playlists named. A press on *Sunday Slow* starts it. | YOUR DECK. YOUR WAY. |
| 0:13–0:17 | **Smart setup** | The real Deckify Setup: the Client ID is typed, Save & Continue, Connect Spotify, waiting. The sign-in fails: Deckify explains it in plain words, with the exact Redirect URI and the fix; the camera pushes in (on 9:16, tight on the guidance card, with the page above it faded out under the type); Copy → **Copied**; Try again; **You're connected 🎉**. | NO CRYPTIC ERRORS. JUST ANSWERS. |
| 0:17–0:21 | **Complete experience** | The deck at a three-quarter hero angle, dark. Each word lights as the deck does it: **INSTALL** (screens wake, keys say *Connect*), **CONNECT** (Spotify Account → Connecting → Connected, every key comes alive), **CHOOSE** (*Choose Playlist* becomes playlist names), **PLAY** (Night Drive starts, Now Playing runs, Like, volume up). Slow orbit. | INSTALL → CONNECT → CHOOSE → PLAY |
| 0:21–0:24 | **End card** | Fade to dark. The symbol draws on, keys pop in. It slides into the full DECKIFY lockup. Tagline, support line. One cue: the four keys light once, in order, like presses. The finished card holds for about 0.7 s, then a hard cut to black at 23.9 s. | Spotify control. Done right. · For Stream Deck on Windows · Spotify Premium required |

## Sound

`scripts/soundtrack.mjs` writes a restrained 120 BPM electronic bed: detuned-saw pads (vi–IV–I–V in D), a sidechained sub, a soft kit,
plucked arpeggios into a ping-pong delay, and a reverb. The cuts sit on the beat grid. The mix follows the story: a drop under the symbol
flash, half time and a filtered pad under the error recovery, the full groove for the finale, a final Dmaj9 under the lockup, silence at
the cut. UI sounds come from the same timeline: a damped key press on every press, a short sweep on Next, volume blips, chimes for
Like / Added / Started / Connected, ticks for typing and clicks, a soft two-note notice (never an alarm) when sign-in fails.

It is a finished, synced temp score. To use licensed music instead, keep the cue sheet (`soundCues()` in `timeline.js`) for the UI sounds
and replace the music section of the script, or mix the new music under `out/soundtrack.wav`.

## Where the film follows the repository instead of the brief

The brief asked for some things the product doesn't have. The repository is the source of truth, and the film must not show features that
don't exist, so:

| Brief | Film | Why |
| --- | --- | --- |
| "DECKIFY green" accent | Deckify violet `#7C5CFF` | The approved B1 brand is violet (`assets/brand/README.md`). Green appears only in Spotify's own icon on Now Playing. |
| Windows + macOS | "For Stream Deck on Windows" | The manifest and README are Windows-only ("macOS isn't supported"). |
| Simple / Deckify ⭐ Recommended / Power modes, and the deck populating itself | The deck filled from the real actions list | Deckify has no experience modes or preset layouts yet. When they ship, the **Personalization** scene (9–13 s) is the slot for them: drive the real mode picker the way the Setup scene drives Deckify Setup, and keep the fill-up animation as the payoff. |
| "Almost there · The Redirect URI in your Spotify app doesn't match Deckify" | Deckify's real guidance: "Spotify sign-in didn't finish", with the three checks, the Redirect URI, **Copy Redirect URI**, **Try again**, **Open Spotify Dashboard** | Deckify can't confirm a Redirect URI mismatch (Spotify reports it on its own page), so its real copy says what happened and lists the fix without claiming a cause it doesn't know. |
| Album artwork changing | Now Playing changes title, artist and progress | Deckify never fetches or shows artwork (`now-playing-render.ts`; `docs/media/README.md`). |
| "Saved to Liked Songs" confirmation | The Like key fills | Deckify confirms a like on the key itself. There is no toast. |
| A monitor running the Spotify app beside the deck | The deck as the hero, with the Setup page | Recreating Spotify's app would make it look like a Spotify ad and would be a mock screenshot. Every on-screen surface here is Deckify's own. |

The Stream Deck is drawn as a plain, unbranded 15-key device: no Elgato logo, no claim of an official product shot.
