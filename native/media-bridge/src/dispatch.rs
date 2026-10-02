//! Request handling, independent of the Windows API so it can be tested anywhere.

use crate::protocol::{Command, ErrorCode, NotHandledReason, Request, Response, parse_request};
use crate::selection::select_spotify_session;

/// Failure while talking to the Windows media session APIs.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SessionError {
    /// The session manager or session list could not be obtained; nothing was sent.
    Unavailable,
    /// The command call failed after it was issued; the outcome is unknown.
    #[cfg_attr(not(windows), allow(dead_code, reason = "only the Windows GSMTC implementation issues commands"))]
    CommandFailed,
}

/// Access to the system's media sessions.
pub trait MediaSessions {
    /// A handle to one session.
    type Session;

    /// Lists the current sessions with their `SourceAppUserModelId`, in enumeration order.
    fn sessions(&mut self) -> Result<Vec<(String, Self::Session)>, SessionError>;

    /// Sends a command to a session; `Ok(false)` means Windows reports the session did not accept it.
    fn send(&mut self, session: &Self::Session, command: Command) -> Result<bool, SessionError>;
}

/// Handles one request line and returns the response.
pub fn handle_line<M: MediaSessions>(line: &str, media: &mut M) -> Response {
    match parse_request(line) {
        Ok(request) => handle_request(request, media),
        Err(id) => Response::Error {
            id,
            code: ErrorCode::InvalidRequest,
        },
    }
}

/// Handles a validated request. Only a Spotify session is ever controlled.
pub fn handle_request<M: MediaSessions>(request: Request, media: &mut M) -> Response {
    match request {
        Request::Ping { id } => {
            let spotify_session = media
                .sessions()
                .map(|sessions| select_session(&sessions).is_some())
                .unwrap_or(false);
            Response::Pong { id, spotify_session }
        }
        Request::Command { id, command } => {
            let sessions = match media.sessions() {
                Ok(sessions) => sessions,
                Err(_) => {
                    return Response::NotHandled {
                        id,
                        reason: NotHandledReason::MediaManagerUnavailable,
                    };
                }
            };
            let Some(index) = select_session(&sessions) else {
                return Response::NotHandled {
                    id,
                    reason: NotHandledReason::SpotifySessionUnavailable,
                };
            };
            match media.send(&sessions[index].1, command) {
                Ok(true) => Response::Handled { id },
                Ok(false) => Response::NotHandled {
                    id,
                    reason: NotHandledReason::CommandRejected,
                },
                Err(SessionError::Unavailable) => Response::NotHandled {
                    id,
                    reason: NotHandledReason::MediaManagerUnavailable,
                },
                Err(SessionError::CommandFailed) => Response::Error {
                    id: Some(id),
                    code: ErrorCode::CommandFailed,
                },
            }
        }
    }
}

fn select_session<S>(sessions: &[(String, S)]) -> Option<usize> {
    let ids: Vec<&str> = sessions.iter().map(|(id, _)| id.as_str()).collect();
    select_spotify_session(&ids)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Fake session list: records every command sent and to which app.
    struct Fake {
        apps: Vec<&'static str>,
        list_error: Option<SessionError>,
        result: Result<bool, SessionError>,
        sent: Vec<(&'static str, Command)>,
    }

    impl Fake {
        fn new(apps: &[&'static str]) -> Self {
            Self {
                apps: apps.to_vec(),
                list_error: None,
                result: Ok(true),
                sent: Vec::new(),
            }
        }
    }

    impl MediaSessions for Fake {
        type Session = &'static str;

        fn sessions(&mut self) -> Result<Vec<(String, Self::Session)>, SessionError> {
            match self.list_error {
                Some(error) => Err(error),
                None => Ok(self.apps.iter().map(|app| ((*app).to_owned(), *app)).collect()),
            }
        }

        fn send(&mut self, session: &Self::Session, command: Command) -> Result<bool, SessionError> {
            self.sent.push((session, command));
            self.result
        }
    }

    fn command(name: &str) -> String {
        format!(r#"{{"id":"1","type":"command","command":"{name}"}}"#)
    }

    #[test]
    fn sends_commands_to_spotify_even_when_a_browser_session_comes_first() {
        let mut media = Fake::new(&["chrome.exe", "Spotify.exe", "msedge.exe"]);
        for (name, expected) in [
            ("toggle", Command::Toggle),
            ("next", Command::Next),
            ("previous", Command::Previous),
            ("play", Command::Play),
            ("pause", Command::Pause),
        ] {
            assert_eq!(handle_line(&command(name), &mut media), Response::Handled { id: "1".into() });
            assert_eq!(media.sent.last(), Some(&("Spotify.exe", expected)));
        }
        assert!(media.sent.iter().all(|(app, _)| *app == "Spotify.exe"));
    }

    #[test]
    fn never_controls_a_browser_when_spotify_is_absent() {
        let mut media = Fake::new(&["chrome.exe", "msedge.exe"]);
        assert_eq!(
            handle_line(&command("toggle"), &mut media),
            Response::NotHandled {
                id: "1".into(),
                reason: NotHandledReason::SpotifySessionUnavailable
            }
        );
        assert!(media.sent.is_empty());
    }

    #[test]
    fn reports_no_session_when_nothing_is_playing() {
        let mut media = Fake::new(&[]);
        assert_eq!(
            handle_line(&command("next"), &mut media),
            Response::NotHandled {
                id: "1".into(),
                reason: NotHandledReason::SpotifySessionUnavailable
            }
        );
    }

    #[test]
    fn reports_a_rejected_command_as_not_handled() {
        let mut media = Fake::new(&["Spotify.exe"]);
        media.result = Ok(false);
        assert_eq!(
            handle_line(&command("next"), &mut media),
            Response::NotHandled {
                id: "1".into(),
                reason: NotHandledReason::CommandRejected
            }
        );
        assert_eq!(media.sent.len(), 1);
    }

    #[test]
    fn reports_a_failed_command_as_an_unknown_outcome() {
        let mut media = Fake::new(&["Spotify.exe"]);
        media.result = Err(SessionError::CommandFailed);
        assert_eq!(
            handle_line(&command("next"), &mut media),
            Response::Error {
                id: Some("1".into()),
                code: ErrorCode::CommandFailed
            }
        );
    }

    #[test]
    fn reports_an_unavailable_session_manager() {
        let mut media = Fake::new(&["Spotify.exe"]);
        media.list_error = Some(SessionError::Unavailable);
        assert_eq!(
            handle_line(&command("toggle"), &mut media),
            Response::NotHandled {
                id: "1".into(),
                reason: NotHandledReason::MediaManagerUnavailable
            }
        );
        assert!(media.sent.is_empty());
    }

    #[test]
    fn ping_reports_whether_a_spotify_session_exists_without_sending_anything() {
        let mut media = Fake::new(&["chrome.exe", "Spotify.exe"]);
        assert_eq!(
            handle_line(r#"{"id":"9","type":"ping"}"#, &mut media),
            Response::Pong {
                id: "9".into(),
                spotify_session: true
            }
        );
        let mut media = Fake::new(&["chrome.exe"]);
        assert_eq!(
            handle_line(r#"{"id":"9","type":"ping"}"#, &mut media),
            Response::Pong {
                id: "9".into(),
                spotify_session: false
            }
        );
        let mut media = Fake::new(&["Spotify.exe"]);
        media.list_error = Some(SessionError::Unavailable);
        assert_eq!(
            handle_line(r#"{"id":"9","type":"ping"}"#, &mut media),
            Response::Pong {
                id: "9".into(),
                spotify_session: false
            }
        );
        assert!(media.sent.is_empty());
    }

    #[test]
    fn rejects_invalid_requests_without_touching_sessions() {
        let mut media = Fake::new(&["Spotify.exe"]);
        assert_eq!(
            handle_line("garbage", &mut media),
            Response::Error {
                id: None,
                code: ErrorCode::InvalidRequest
            }
        );
        assert_eq!(
            handle_line(r#"{"id":"3","type":"command","command":"rm -rf"}"#, &mut media),
            Response::Error {
                id: Some("3".into()),
                code: ErrorCode::InvalidRequest
            }
        );
        assert!(media.sent.is_empty());
    }
}
