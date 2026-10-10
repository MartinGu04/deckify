# Deckify review film: timestamped breakdown

Internal review material, generated from `src/timeline.js` and `src/clips.js` by `scripts/review.mjs`. Not for upload.

**Film:** `deckify-review-film-1920x1080.mp4`, 1920×1080, 30 fps, H.264, 74.13 s.

**Original footage:**

- **Desktop:** Deckify-desktop-compressed.mp4 (Windows screen recording, 1920×1080, 60 fps). No audio track.
- **Phone:** WhatsApp Video 2026-10-09 at 01.08.32.mp4 (iPhone, Stream Deck MK.2, 576×1024, 30 fps). Its own sound isn't used.
- They are separate takes: the desktop clock reads 01:05–01:06 and the phone's 01:07. The film never shows them side by side.

**How to read this:**

- *Film* times are in the rendered film; *source* times are seconds in the original file.
- Clips play at recorded speed. A *hold* freezes the clip's last real frame after the action has finished.
- Shots crossfade over 12 frames (0.40 s); the outgoing shot holds its last frame under the incoming one.
- Boxes are `[x, y, width, height]` in the original's pixels.

## Shot list

| Film | Shot | Caption | Source footage |
| --- | --- | --- | --- |
| 0:00.00–0:05.00 | Intro: Deckify logo, tagline | – | none (title card) |
| 0:05.00–0:06.60 | Chapter card: 01 Connect Spotify | – | none (title card) |
| 0:06.60–0:11.90 | single, hold 0.3 s | Before you connect, every Deckify key says Connect. | desktop 0:08.60–0:13.60 (`signed-out`) |
| 0:11.90–0:14.13 | split, hold 0.6 s | Deckify Setup: one click on Connect Spotify. | desktop 0:18.50–0:20.12 (`setup-keys`)<br>desktop 0:18.50–0:20.12 (`setup-page`) |
| 0:14.13–0:15.93 | split, hold 0.4 s | You approve on Spotify's own page. | desktop 0:21.00–0:22.40 (`approve-keys`)<br>desktop 0:21.00–0:22.40 (`approve-page`) |
| 0:15.93–0:22.13 | split, hold 0.8 s | Connected. Every key updates on its own. | desktop 0:24.00–0:29.40 (`connected-keys`)<br>desktop 0:24.00–0:29.40 (`connected-page`) |
| 0:22.13–0:23.73 | Chapter card: 02 Your keys, live | – | none (title card) |
| 0:23.73–0:26.80 | single, hold 0.8 s | Choose a playlist for a playlist key. | desktop 0:50.00–0:52.25 (`picker`) |
| 0:26.80–0:32.80 | stack, hold 0.8 s | Music starts in Spotify, and the keys light up. | desktop 0:54.00–0:59.20 (`live-bar`)<br>desktop 0:54.00–0:59.20 (`live-keys`) |
| 0:32.80–0:36.00 | stack, hold 0.6 s | Volume changes in Spotify show on the keys. | desktop 0:59.20–1:01.80 (`volume-bar`)<br>desktop 0:59.20–1:01.80 (`volume-keys`) |
| 0:36.00–0:40.80 | single, hold 0.8 s | Now Playing shows the song, the artist and the progress. | desktop 1:03.40–1:07.40 (`now-playing`) |
| 0:40.80–0:42.40 | Chapter card: 03 On the Stream Deck | – | none (title card) |
| 0:42.40–0:46.60 | portrait | Volume Up and Volume Down. | phone 0:01.40–0:05.60 (`press-volume`) |
| 0:46.60–0:50.47 | portrait, hold 0.6 s | Spotify's volume, in steps of 10: 84% → 74% → 64%. | phone 0:06.60–0:09.85 (`press-volume-app`) |
| 0:50.47–0:52.97 | portrait, hold 0.8 s | Pause. The key turns to Play. | phone 0:11.50–0:13.20 (`press-play-pause`) |
| 0:52.97–0:56.63 | portrait, hold 0.8 s | The song playing now is added: Adding…, then Added. | phone 0:17.90–0:20.75 (`press-add`) |
| 0:56.63–0:59.93 | portrait, hold 0.3 s | The chosen playlist starts, and Now Playing follows. | phone 0:24.20–0:27.20 (`press-play-playlist`) |
| 0:59.93–1:01.73 | portrait, hold 0.6 s | Spotify plays it: The Viral 100. | phone 0:28.40–0:29.60 (`spotify-playing`) |
| 1:01.73–1:05.43 | portrait, hold 0.8 s | Like saves the song to your Liked Songs. | phone 0:31.00–0:33.90 (`press-like`) |
| 1:05.43–1:07.63 | portrait, hold 0.6 s | The Like key shows it's saved. | phone 0:36.90–0:38.50 (`press-like-app`) |
| 1:07.63–1:14.13 | End card: logo, tagline, requirements, disclaimer | – | none (title card) |

## Every functional claim, traced to the footage

### 0:06.60 · Connect Spotify: "Before you connect, every Deckify key says Connect."

- **`signed-out`**: desktop, source 0:08.60–0:13.60, crop `[376, 127, 998, 771]`.
  - **Shows:** The Stream Deck app with Deckify's actions list. Every Deckify key shows Connect; the Spotify Account inspector shows Not connected and Set up Deckify. The pointer opens account setup.

### 0:11.90 · Connect Spotify: "Deckify Setup: one click on Connect Spotify."

- **`setup-keys`**: desktop, source 0:18.50–0:20.12, crop `[120, 300, 520, 650]`.
  - **Shows:** Keys show Connect; the Spotify Account key turns to Connecting at 20.0 s, the moment Connect Spotify is clicked.
- **`setup-page`**: desktop, source 0:18.50–0:20.12, crop `[870, 135, 840, 560]`.
  - **Shows:** Deckify Setup, step 4 of 4: Connect Spotify is clicked at 20.0 s (the browser's address bar is cropped out). The clip ends before the browser leaves for Spotify.

### 0:14.13 · Connect Spotify: "You approve on Spotify's own page."

- **`approve-keys`**: desktop, source 0:21.00–0:22.40, crop `[120, 300, 520, 650]`.
  - **Shows:** The Spotify Account key and inspector wait for Spotify (Connecting, Waiting for Spotify…).
- **`approve-page`**: desktop, source 0:21.00–0:22.40, crop `[960, 120, 640, 860]`.
  - **Shows:** Spotify's own authorization page for the user's Deckify app (in Hebrew; the address bar with the Client ID is cropped out).
  - **Blurred:** `[1035, 393, 522, 72]`: Spotify account name and picture on the consent page.

### 0:15.93 · Connect Spotify: "Connected. Every key updates on its own."

The caption appears at film 0:20.13, when what it describes happens.

- **`connected-keys`**: desktop, source 0:24.00–0:29.40, crop `[120, 300, 520, 650]`.
  - **Shows:** After Spotify's approval (25.3 s), every key updates at 28.2 s: Spotify Account → Connected; playback and volume keys → No Device (nothing playing yet); playlist keys → Choose Playlist.
  - **Blurred:** `[325, 846, 170, 30]` from source 0:27.90: Spotify display name in the Spotify Account inspector.
- **`connected-page`**: desktop, source 0:24.00–0:29.40, crop `[960, 150, 640, 830]`.
  - **Shows:** The approve button is clicked at 25.3 s; Deckify's local page answers "Deckify is connected to Spotify" at 25.5 s (the address bar with the authorization code is cropped out).
  - **Blurred:** `[1028, 164, 536, 82]` until source 0:25.50: Spotify account name and picture on the consent page.

### 0:23.73 · Your keys, live: "Choose a playlist for a playlist key."

- **`picker`**: desktop, source 0:50.00–0:52.25, crop `[120, 300, 520, 656]`.
  - **Shows:** The Play Playlist key's inspector loads the user's playlists; The Viral 100 (by uDiscover Playlists, a public playlist) is chosen at 51.6 s, and the key's title changes from Choose Playlist to No Device.
  - **Blurred:** `[345, 864, 264, 92]`: the user's own playlist names, some with people's names.

### 0:26.80 · Your keys, live: "Music starts in Spotify, and the keys light up."

- **`live-bar`**: desktop, source 0:54.00–0:59.20, crop `[1085, 902, 715, 86]`.
  - **Shows:** Spotify's player bar (Spotify in Firefox): playback starts, then Happier by Bastille, Marshmello plays.
  - **Blurred:** `[1730, 906, 72, 76]`: album artwork (not ours to publish).
- **`live-keys`**: desktop, source 0:54.00–0:59.20, crop `[140, 305, 480, 290]`.
  - **Shows:** Playback is started in Spotify with the mouse (about 53.9 s, then Happier at 57 s); at 58.3 s every key lights up with live state: pause icon, volume 100%, playlist and Like keys ready.

### 0:32.80 · Your keys, live: "Volume changes in Spotify show on the keys."

- **`volume-bar`**: desktop, source 0:59.20–1:01.80, crop `[790, 902, 1010, 86]`.
  - **Shows:** Spotify's volume slider is dragged with the mouse (the pointer is visible on it).
  - **Blurred:** `[1730, 906, 72, 76]`: album artwork (not ours to publish).
- **`volume-keys`**: desktop, source 0:59.20–1:01.80, crop `[140, 305, 480, 290]`.
  - **Shows:** The volume keys change from 100% to 54% (61.0–61.5 s) as Spotify's volume changes. The clip ends before the Stream Deck window, being resized, slides over Spotify's player bar.

### 0:36.00 · Your keys, live: "Now Playing shows the song, the artist and the progress."

- **`now-playing`**: desktop, source 1:03.40–1:07.40, crop `[140, 305, 480, 290]`.
  - **Shows:** The Now Playing action is dropped on a key and immediately shows the current song (Happier · Marshmello…), Spotify's icon and the progress bar.

### 0:42.40 · Volume: "Volume Up and Volume Down."

- **`press-volume`**: phone, source 0:01.40–0:05.60, crop `[0, 0, 576, 1024]`, stabilised.
  - **Shows:** Volume keys are pressed on the MK.2 (the percentages are too small to read in this shot).

### 0:46.60 · Volume: "Spotify's volume, in steps of 10: 84% → 74% → 64%."

- **`press-volume-app`**: phone, source 0:06.60–0:09.85, crop `[0, 0, 576, 1024]`, stabilised.
  - **Shows:** The same take, on the monitor: the Volume Up / Down keys in the Stream Deck app step 84% → 74% → 84% → 74% → 64% (the presses are off camera).

### 0:50.47 · Play / Pause: "Pause. The key turns to Play."

Key-press sound at film 0:51.27, where the footage shows the press.

- **`press-play-pause`**: phone, source 0:11.50–0:13.20, crop `[0, 0, 576, 1024]`, reframed `[24, 86, 528, 938]` after stabilisation, stabilised.
  - **Shows:** Play / Pause is pressed at about 12.3 s; by 13.0 s the key shows Play and the Now Playing key's corner shows Paused.

### 0:52.97 · Add to Playlist: "The song playing now is added: Adding…, then Added."

Key-press sound at film 0:53.47, where the footage shows the press.

- **`press-add`**: phone, source 0:17.90–0:20.75, crop `[0, 0, 576, 1024]`, stabilised.
  - **Shows:** Add to Playlist is pressed at 18.3–18.8 s; the key shows Adding… (19.0 s), then Stream Deck's check mark and Added (20.05 s), which Deckify only shows once Spotify has added the song.

### 0:56.63 · Play Playlist: "The chosen playlist starts, and Now Playing follows."

Key-press sound at film 0:57.03, where the footage shows the press.

- **`press-play-playlist`**: phone, source 0:24.20–0:27.20, crop `[0, 0, 576, 1024]`, stabilised.
  - **Shows:** Play Playlist is pressed at 24.5–25.5 s; the check mark and Started appear at 25.75 s, and Now Playing changes from Happier to a Noah Kahan song (Draw You Out – From The…) at 26.5 s.

### 0:59.93 · Play Playlist: "Spotify plays it: The Viral 100."

- **`spotify-playing`**: phone, source 0:28.40–0:29.60, crop `[0, 0, 576, 1024]`.
  - **Shows:** The same take, on the monitor: Spotify marks The Viral 100 as playing (green, speaker icon) and the player shows a track from The Hunger Games album by Noah Kahan. Playlist rows above it are blurred.
  - **Blurred:** everything above Spotify's playing row, tracked frame by frame (`scripts/blur_above_playing_row.py`): other people's names as playlist owners.

### 1:01.73 · Like: "Like saves the song to your Liked Songs."

Key-press sound at film 1:03.13, where the footage shows the press.

- **`press-like`**: phone, source 0:31.00–0:33.90, crop `[0, 0, 576, 1024]`, stabilised.
  - **Shows:** Like / Unlike is pressed at 32.3–32.8 s; at 33.0 s the key shows Spotify's liked icon and Added, which Deckify only shows once Spotify has saved the song.

### 1:05.43 · Like: "The Like key shows it's saved."

- **`press-like-app`**: phone, source 0:36.90–0:38.50, crop `[0, 0, 576, 1024]`, stabilised.
  - **Shows:** The same take, on the monitor: the Like key in the Stream Deck app shows the liked state.

## Privacy

- **Never on screen:** the browser's address bar (it holds the Client ID during sign-in and the authorization code afterwards), the Windows taskbar, desktop icons and notifications. Every desktop crop stays inside the app windows.
- **Blurred:** the Spotify account name and picture on Spotify's consent page; the display name in the Spotify Account inspector; the user's own playlist names in the picker; other people's names in the Spotify library (phone); album artwork in Spotify's player bar.
- **Left visible, as evidence:** the chosen public playlist (*The Viral 100*, by uDiscover Playlists), track titles and artists of commercially released songs (*Happier* by Bastille and Marshmello; a Noah Kahan track from *The Hunger Games* album), Spotify's own consent text, and Deckify's own UI.

## Not shown (no sufficient real footage)

- **Next / Previous Track** and **Mute / Unmute:** the keys appear in the layout, but no recording shows a press and its result.
- **The SIMPLE / DECKIFY experience chooser:** the recording connects from the Spotify Account inspector, not through the chooser.
- **A volume press with a readable result on the hardware:** the MK.2 shot can't resolve the percentages. The film pairs it with the same take's monitor shot, where they read 84% → 74% → 64%; the presses themselves are off camera there.
- **Desktop and hardware at the same moment:** the two recordings are separate takes, so no split screen pairs them.
