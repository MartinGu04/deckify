# Security policy

## Supported versions

Deckify is pre-1.0 and has no public release yet. Until 1.0, only the latest code on `main` (and, once releases exist, the latest
release) receives security fixes. Older builds won't be patched; update to the latest version instead.

## Reporting a vulnerability

Please report security problems **privately**, not in a public issue, discussion or pull request.

- **Preferred:** GitHub's private vulnerability reporting. On the repository's **Security** tab, choose **Report a vulnerability**. The
  maintainer will enable this before the repository is made public.
- **If that option isn't available** (for example while the repository is private): contact the maintainer,
  [@MartinGu04](https://github.com/MartinGu04), privately through GitHub. Ask for a private channel before sending details.

Please include:

- the Deckify version or commit and your Windows and Stream Deck app versions;
- what an attacker could do, and the steps to reproduce it;
- whether it needs local access to your computer, another Windows user, or only network access.

You'll get an acknowledgement as soon as the maintainer can respond. Deckify is a personal project, so there is no guaranteed response
time. Please give a reasonable time to fix the problem before you disclose it publicly.

## Never post secrets

Whether you report privately or ask a general question publicly, **never include**:

- Spotify access tokens, refresh tokens, authorization codes or PKCE verifiers;
- the contents of `%LOCALAPPDATA%\Deckify\spotify-session.json`;
- a Spotify **Client Secret** (Deckify never needs one; if you have shared one anywhere, rotate it in the Spotify Developer Dashboard);
- passwords or browser cookies.

Your Spotify Client ID isn't a secret, but you don't need to share it either. Deckify's logs don't contain tokens, but review a log
before attaching it: it can show your Stream Deck device name and timings of your activity.

If you think a token was exposed, use **Disconnect** in the Spotify Account settings and remove Deckify's access at
<https://www.spotify.com/account/apps/>.

## Scope

- **In scope:** the plugin code, the Property Inspectors, the Deckify Setup page and its local server, the Windows media helper and the
  packaging scripts in this repository.
- **Out of scope** (report those to their owners): Spotify's services and apps, the Stream Deck app, and Windows itself.

## How Deckify limits risk

Deckify has had no formal security audit. Its design limits what can go wrong; [docs/privacy.md](docs/privacy.md) and
[docs/architecture.md](docs/architecture.md) have the details.

- **No Client Secret.** OAuth Authorization Code with PKCE, with a callback listener bound only to `127.0.0.1:43821`.
- **Encrypted session.** Tokens are encrypted locally (AES-256-GCM), with the key protected by Windows DPAPI for the current user.
- **Credentials stay in the plugin process.** The native helper, the Property Inspectors, Deckify Setup and the logs never receive tokens.
- **Local setup server.** Deckify Setup is served only on `127.0.0.1` (dynamic port, never the OAuth callback port) while setup is open. It
  requires a one-time launch code and a per-session token, checks the Host and Origin headers, and runs only a fixed list of account
  actions. See [docs/architecture.md](docs/architecture.md#deckify-setup).
- **Restricted helper.** The media helper accepts six fixed commands. It is started without a shell and only controls Spotify's media
  session.
- **Validated links.** Only links that pass validation are opened: `open.spotify.com` playlist, track and episode links built from
  validated IDs, Spotify's authorization page, the Spotify Developer Dashboard (a fixed address), and Deckify Setup's own `127.0.0.1` URL.
- **Guarded by tests.** Static checks keep these rules from regressing.
