//! Spotify-only media session selection.
//!
//! Deckify must never control another app's media session (browsers, YouTube, VLC, other players), even when Windows considers that
//! session "current". Sessions are matched by their `SourceAppUserModelId` with a deliberately conservative rule.

/// Ranks a session's AppUserModelId: `Some(rank)` for Spotify (lower is preferred), `None` for anything else.
///
/// - Desktop Spotify reports its executable name, `Spotify.exe` (a full path is accepted too).
/// - Microsoft Store Spotify reports its package family, `SpotifyAB.SpotifyMusic_<publisher id>!<app>`.
///
/// Matching is case-insensitive. Substring matches (e.g. a browser tab or web app that merely mentions Spotify) are never accepted.
pub fn spotify_rank(app_user_model_id: &str) -> Option<u8> {
    let id = app_user_model_id.trim().to_ascii_lowercase();
    let file_name = id.rsplit(['\\', '/']).next().unwrap_or_default();
    if file_name == "spotify.exe" {
        return Some(0);
    }
    if id.starts_with("spotifyab.spotifymusic_") && id.contains('!') {
        return Some(1);
    }
    None
}

/// Selects the Spotify session among the current sessions, deterministically: the best rank wins, then the earliest in enumeration order.
///
/// Returns `None` when no Spotify session exists. There is intentionally no fallback to any other session.
pub fn select_spotify_session<S: AsRef<str>>(app_user_model_ids: &[S]) -> Option<usize> {
    app_user_model_ids
        .iter()
        .enumerate()
        .filter_map(|(index, id)| spotify_rank(id.as_ref()).map(|rank| (rank, index)))
        .min()
        .map(|(_, index)| index)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn recognizes_desktop_and_store_spotify() {
        for id in [
            "Spotify.exe",
            "spotify.exe",
            "SPOTIFY.EXE",
            " Spotify.exe ",
            r"C:\Users\Test\AppData\Roaming\Spotify\Spotify.exe",
            "SpotifyAB.SpotifyMusic_zpdnekdrzrea0!Spotify",
            "spotifyab.spotifymusic_zpdnekdrzrea0!spotify",
        ] {
            assert!(spotify_rank(id).is_some(), "{id}");
        }
    }

    #[test]
    fn rejects_everything_else() {
        for id in [
            "",
            "chrome.exe",
            "Chrome",
            "msedge.exe",
            "MSEdge",
            "308046B0AF4A39CB",
            "firefox.exe",
            "vlc.exe",
            "Microsoft.ZuneMusic_8wekyb3d8bbwe!Microsoft.ZuneMusic",
            "MSEdge._crx_spotifywebapp",
            "Chrome._crx_open.spotify.com",
            "Spotify",
            "notspotify.exe",
            "spotify.exe.bak",
            "SpotifyHelper.exe",
            "SpotifyAB.SpotifyMusic",
            "open.spotify.com",
        ] {
            assert_eq!(spotify_rank(id), None, "{id}");
        }
    }

    #[test]
    fn prefers_spotify_over_a_current_browser_session() {
        assert_eq!(select_spotify_session(&["chrome.exe", "Spotify.exe"]), Some(1));
        assert_eq!(
            select_spotify_session(&["msedge.exe", "vlc.exe", "SpotifyAB.SpotifyMusic_zpdnekdrzrea0!Spotify"]),
            Some(2)
        );
    }

    #[test]
    fn never_selects_a_non_spotify_session() {
        assert_eq!(select_spotify_session(&["chrome.exe"]), None);
        assert_eq!(
            select_spotify_session(&["chrome.exe", "msedge.exe", "vlc.exe", "308046B0AF4A39CB"]),
            None
        );
        assert_eq!(select_spotify_session::<&str>(&[]), None);
    }

    #[test]
    fn selects_deterministically_among_multiple_spotify_sessions() {
        // Desktop beats Store regardless of order; ties go to the first enumerated.
        assert_eq!(
            select_spotify_session(&["SpotifyAB.SpotifyMusic_zpdnekdrzrea0!Spotify", "Spotify.exe"]),
            Some(1)
        );
        assert_eq!(select_spotify_session(&["chrome.exe", "Spotify.exe", "spotify.exe"]), Some(1));
    }
}
