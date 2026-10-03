# Deckify experiences: review renders

Renders of Phase 9 (**Choose → Play**) for review before the hardware check. They come from the real `ui/setup/` page in headless
Chromium at 1280 px wide (one at 600 px). The plugin's answers are simulated, with a fake display name and no Spotify account involved.
The key previews are Deckify's own schematic drawings, built from the same layout data the bundled profiles are checked against. They
are not screenshots of the Stream Deck app. These files are review material, not product media, and are not shipped with the plugin.

| Screen | File |
| --- | --- |
| You're connected: **Choose my Deckify experience** first, tour optional | [experiences-01-connected.png](experiences-01-connected.png) |
| Choose your Deckify experience: two cards, DECKIFY preselected and Recommended | [experiences-02-chooser.png](experiences-02-chooser.png) |
| SIMPLE selected | [experiences-03-chooser-simple.png](experiences-03-chooser-simple.png) |
| Narrow window | [experiences-04-chooser-narrow.png](experiences-04-chooser-narrow.png) |
| Finish in Stream Deck (after **Use this experience**) | [experiences-05-finish.png](experiences-05-finish.png) |
| Deckify is ready: DECKIFY · Recommended | [experiences-06-ready.png](experiences-06-ready.png) |
| Deckify is ready: SIMPLE | [experiences-07-ready-simple.png](experiences-07-ready-simple.png) |
| Opened from a device the layouts don't fit | [experiences-08-unsupported.png](experiences-08-unsupported.png) |
| Stream Deck couldn't be reached | [experiences-09-unreachable.png](experiences-09-unreachable.png) |
| End of the tour: **Choose my experience** | [experiences-10-tour-end.png](experiences-10-tour-end.png) |
| Reopened while connected: **Choose a Deckify experience** | [experiences-11-account-reopened.png](experiences-11-account-reopened.png) |

## Physical MK.2 checklist

To pass before merge, with the bundled exports SIMPLE and DECKIFY ⭐ Recommended ([docs/profiles.md](../profiles.md)):

1. A fresh Deckify Setup reaches **Choose your Deckify experience** after the Spotify connection.
2. The chooser shows exactly two cards: DECKIFY (visibly marked Recommended and preselected) and SIMPLE.
3. The DECKIFY preview matches the installed **DECKIFY ⭐ Recommended** profile.
4. The SIMPLE preview matches the installed **SIMPLE** profile.
5. Choosing an experience triggers only the selected bundled profile.
6. The first-time Stream Deck install prompt is understandable.
7. The selected profile switches onto the originating MK.2.
8. The profiles are editable.
9. DECKIFY controls work.
10. SIMPLE controls work.
11. Playlist actions contain no developer or user playlist configuration and can be configured normally.
12. The ready screen shows `DECKIFY · Recommended` or `SIMPLE`, and **Choose a different experience** returns to the chooser.
13. The Account key still opens the compact Account Property Inspector.
14. The Account Property Inspector still opens Deckify Setup.
15. The existing Spotify session survives.
16. Existing actions keep their settings and behaviour.
17. No CMD or PowerShell windows appear.
18. The package installs normally.
19. Phase 8 Setup App security hasn't regressed.
