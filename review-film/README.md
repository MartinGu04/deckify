# Deckify review film

A 75-second functional demo of Deckify for Elgato Marketplace review, edited from two real recordings: a Windows screen recording and
iPhone footage of a Stream Deck MK.2. It answers Marketplace's request for a short functional demonstration. It is not the promo film in
[`film/`](../film/README.md): that one is a rendered motion piece, this one is real footage, framed and captioned.

**Beautiful presentation, real functionality, nothing fabricated.** Every functional claim is shown by recorded footage in the same shot;
[`review/breakdown.md`](review/breakdown.md) traces each one to the exact seconds of the original file.

## Output

| File | What it is |
| --- | --- |
| `out/deckify-review-film-1920x1080.mp4` | The film: 1920×1080, 30 fps, H.264 High, AAC, about 75.6 s. Git-ignored; render it, or use the copy delivered for review. |
| `review/breakdown.md` | Internal: the timestamped breakdown (film time → source file and seconds → what it shows → what is blurred). |
| `review/contact-sheet.jpg` | Internal: two frames of every shot, from the rendered film. |

## Render

```sh
cd review-film
npm install
node scripts/prepare.mjs --desktop <Deckify-desktop-compressed.mp4> --phone <WhatsApp Video ….mp4>   # → out/clips
node scripts/soundtrack.mjs        # → out/soundtrack.wav
node scripts/render.mjs --check    # every frame's layout check, in seconds
node scripts/render.mjs            # → out/deckify-review-film-1920x1080.mp4 (about 9 minutes)
node scripts/review.mjs            # → review/breakdown.md, review/contact-sheet.jpg
```

The original recordings are never committed or modified: the desktop one shows the Client ID and an authorization code in the browser's
address bar, which no clip includes. Needs ffmpeg (with vid.stab) and Python 3 with NumPy and Pillow; Chromium comes from
`/opt/pw-browsers` or `CHROMIUM_PATH`.

## The film

| Film | Chapter | What the footage shows |
| --- | --- | --- |
| 0:00 | Intro | The DECKIFY lockup. "Spotify control for your Stream Deck. A functional demo, from real recordings." |
| 0:05 | **01 Connect Spotify** | Every key says **Connect** → Deckify Setup, **Connect Spotify** clicked, the Account key turns **Connecting** → approval on Spotify's own page → every key updates (**Connected**, **No Device**, **Choose Playlist**). |
| 0:22 | **02 Your keys, live** | A playlist chosen in the key's inspector → music starts in Spotify and the deck lights up → the volume keys follow Spotify's volume (100% → 54%) → **Now Playing** shows the song. |
| 0:42 | **03 On the Stream Deck** | The MK.2: Volume (84% → 74% → 64%, read on the monitor in the same take), **Play / Pause**, **Add to Playlist** (Adding… → Added), **Play Playlist** (Started, Now Playing changes, Spotify plays it), **Like** (Added). |
| 1:09 | End card | "Spotify control. Done right." For Stream Deck on Windows · Spotify Premium required · not affiliated with Spotify or Elgato. |

## Editing rules

- **Real timing.** Clips play at recorded speed; nothing is sped up, slowed down or reordered within a clip. A hold freezes the last real
  frame after the action has finished.
- **Honest pairing.** Split screens only pair crops of the same moment of the same recording (the Stream Deck app beside the browser, the
  keys under Spotify's player bar). The desktop and phone recordings are separate takes and never share a frame. Physical presses are
  only matched to responses visible in the same shot.
- **Captions wait for their evidence.** A caption that describes a result appears when the result does (`captionAt`).
- **Product-focused framing.** Every desktop crop stays inside an app window: no taskbar, desktop icons, address bar or unrelated apps.
  Phone footage is stabilised (vid.stab), lightly denoised and brightened, never retouched.
- **Privacy.** Account names, the user's playlist names, other people's names and album art are pixelated and blurred. One shot needs a
  moving boundary: `scripts/blur_above_playing_row.py` finds Spotify's green playing row in each frame and blurs everything above it,
  failing rather than leaving a frame unblurred.
- **Layout that can't collide.** Footage and captions live in separate zones (`src/film.css`). `film.check()` measures every frame (text
  over footage or within 24 px of it, anything off the frame or out of its zone, clipped text) and the render refuses to write a film
  with any failing frame.
- **Sound.** A restrained synthesised bed (`scripts/soundtrack.mjs`) and a soft key tick only where the footage shows a physical press.
  No voiceover, no recorded sound, −16 LUFS target.

## Not in the film

There isn't enough real footage for these, so the film leaves them out rather than simulate them:

- **Next / Previous Track and Mute / Unmute:** never pressed on camera.
- **The DECKIFY / SIMPLE experience chooser:** not in the recording.
- **Hardware and desktop in one frame:** separate takes.

A second, steadier and brighter MK.2 take would let a future cut show these and the volume percentages on the hardware itself.
