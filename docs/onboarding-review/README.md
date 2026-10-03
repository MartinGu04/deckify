# Deckify Setup and Spotify Account: review renders

Renders of Phase 8 for review before the hardware check:

- **Deckify Setup:** the guided setup in the browser, rendered at 1280 px wide (some screens also at 600 px).
- **Spotify Account Property Inspector:** the compact entry point, rendered at 360 px wide.

Phase 9 changed the **You're connected**, end-of-tour and **Deckify is ready** screens (the experience chooser now comes first); see
[experiences-review](../experiences-review/README.md) for the current versions.

They come from the real `ui/setup/` and `ui/spotify-account/` pages in headless Chromium. The plugin's messages are simulated with a fake
Client ID and display name; no Spotify account is involved. These files are review material, not product media, and are not shipped with
the plugin.

## Deckify Setup

| Screen | File |
| --- | --- |
| Welcome | [setup-01-welcome.png](setup-01-welcome.png) · narrow window: [setup-01-welcome-narrow.png](setup-01-welcome-narrow.png) |
| Step 1: Spotify Dashboard | [setup-02-dashboard.png](setup-02-dashboard.png) |
| Step 2: Spotify app and Redirect URI (Development Mode help open, Copy pressed) | [setup-03-spotify-app.png](setup-03-spotify-app.png) · narrow: [setup-03-spotify-app-narrow.png](setup-03-spotify-app-narrow.png) |
| Step 3: Client ID | [setup-04-client-id.png](setup-04-client-id.png) · invalid: [setup-05-client-id-invalid.png](setup-05-client-id-invalid.png) |
| Step 4: Connect, right after Save & Continue | [setup-06-connect-saved.png](setup-06-connect-saved.png) |
| Waiting, taking longer | [setup-07-waiting-slow.png](setup-07-waiting-slow.png) |
| Access refused (403) | [setup-08-refused.png](setup-08-refused.png) |
| You're connected | [setup-09-success.png](setup-09-success.png) |
| Tour | [setup-10-tour.png](setup-10-tour.png) · narrow: [setup-10-tour-narrow.png](setup-10-tour-narrow.png) |
| Deckify is ready | [setup-11-ready.png](setup-11-ready.png) |
| Reopened while connected | [setup-12-account.png](setup-12-account.png) |
| Reconnect (new permissions) | [setup-13-reconnect.png](setup-13-reconnect.png) |
| Link used or expired | [setup-14-expired.png](setup-14-expired.png) |

## Spotify Account Property Inspector

| Screen | File |
| --- | --- |
| Not connected | [pi-01-disconnected.png](pi-01-disconnected.png) · with a problem: [pi-02-disconnected-issue.png](pi-02-disconnected-issue.png) |
| Connected (help open) | [pi-03-connected.png](pi-03-connected.png) |
| Reconnect required | [pi-04-reconnect.png](pi-04-reconnect.png) |
| Waiting for Spotify | [pi-05-waiting.png](pi-05-waiting.png) |
