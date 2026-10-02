//! JSON-lines protocol between Deckify (Node.js) and this helper.
//!
//! Requests (one JSON object per line on stdin):
//!   {"id":"1","type":"command","command":"toggle"}   commands: toggle | play | pause | next | previous
//!   {"id":"2","type":"ping"}
//!
//! Responses (one JSON object per line on stdout, same `id`):
//!   {"id":"1","ok":true,"handled":true}                                   performed by the local Spotify session
//!   {"id":"1","ok":true,"handled":false,"reason":"spotify-session-unavailable"}   NOT performed (safe to fall back)
//!   {"id":"2","ok":true,"pong":true,"spotifySession":true,"version":"0.1.0"}
//!   {"id":"1","ok":false,"error":"invalid-request"}                       NOT performed
//!   {"id":"1","ok":false,"error":"command-failed"}                        Windows call failed after being issued: outcome unknown
//!
//! The protocol carries no Spotify credentials, tokens or metadata.

use serde::Serialize;
use serde_json::Value;

/// Longest accepted request line, in bytes.
pub const MAX_LINE_BYTES: usize = 1024;

/// Longest accepted request ID.
const MAX_ID_LEN: usize = 64;

/// A playback command the helper can send to the Spotify media session.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Command {
    Toggle,
    Play,
    Pause,
    Next,
    Previous,
}

impl Command {
    /// Parses a command name; only the fixed set is accepted.
    pub fn parse(name: &str) -> Option<Self> {
        match name {
            "toggle" => Some(Self::Toggle),
            "play" => Some(Self::Play),
            "pause" => Some(Self::Pause),
            "next" => Some(Self::Next),
            "previous" => Some(Self::Previous),
            _ => None,
        }
    }
}

/// A validated request.
#[derive(Debug, PartialEq, Eq)]
pub enum Request {
    Command { id: String, command: Command },
    Ping { id: String },
}

/// Why a command was not performed. Every variant guarantees nothing was sent to the media session.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum NotHandledReason {
    /// No Spotify media session exists (other apps' sessions are never used).
    SpotifySessionUnavailable,
    /// The Windows media session manager could not be obtained.
    MediaManagerUnavailable,
    /// Windows reported that the Spotify session did not accept the command.
    CommandRejected,
}

impl NotHandledReason {
    fn as_str(self) -> &'static str {
        match self {
            Self::SpotifySessionUnavailable => "spotify-session-unavailable",
            Self::MediaManagerUnavailable => "media-manager-unavailable",
            Self::CommandRejected => "command-rejected",
        }
    }
}

/// Error codes.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ErrorCode {
    /// The request was malformed or not allowed; nothing was performed.
    InvalidRequest,
    /// The Windows call failed after the command was issued; the outcome is unknown.
    CommandFailed,
}

impl ErrorCode {
    fn as_str(self) -> &'static str {
        match self {
            Self::InvalidRequest => "invalid-request",
            Self::CommandFailed => "command-failed",
        }
    }
}

/// A response to one request.
#[derive(Debug, PartialEq, Eq)]
pub enum Response {
    Handled { id: String },
    NotHandled { id: String, reason: NotHandledReason },
    Pong { id: String, spotify_session: bool },
    Error { id: Option<String>, code: ErrorCode },
}

#[derive(Serialize)]
struct Wire<'a> {
    id: Option<&'a str>,
    ok: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    handled: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    reason: Option<&'static str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pong: Option<bool>,
    #[serde(rename = "spotifySession", skip_serializing_if = "Option::is_none")]
    spotify_session: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    version: Option<&'static str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<&'static str>,
}

impl Response {
    /// Serializes the response as a single JSON line (without the trailing newline).
    pub fn to_json(&self) -> String {
        let empty = Wire {
            id: None,
            ok: true,
            handled: None,
            reason: None,
            pong: None,
            spotify_session: None,
            version: None,
            error: None,
        };
        let wire = match self {
            Self::Handled { id } => Wire {
                id: Some(id),
                handled: Some(true),
                ..empty
            },
            Self::NotHandled { id, reason } => Wire {
                id: Some(id),
                handled: Some(false),
                reason: Some(reason.as_str()),
                ..empty
            },
            Self::Pong { id, spotify_session } => Wire {
                id: Some(id),
                pong: Some(true),
                spotify_session: Some(*spotify_session),
                version: Some(env!("CARGO_PKG_VERSION")),
                ..empty
            },
            Self::Error { id, code } => Wire {
                id: id.as_deref(),
                ok: false,
                error: Some(code.as_str()),
                ..empty
            },
        };
        serde_json::to_string(&wire).unwrap_or_else(|_| r#"{"id":null,"ok":false,"error":"invalid-request"}"#.to_owned())
    }
}

/// Parses and validates one request line.
///
/// On failure, returns the request ID when it could be read, so the caller can still correlate the error.
pub fn parse_request(line: &str) -> Result<Request, Option<String>> {
    if line.len() > MAX_LINE_BYTES {
        return Err(None);
    }
    let value: Value = serde_json::from_str(line).map_err(|_| None)?;
    let object = value.as_object().ok_or(None)?;

    let id = object
        .get("id")
        .and_then(Value::as_str)
        .filter(|id| is_valid_id(id))
        .map(str::to_owned)
        .ok_or(None)?;

    // Only the documented fields are allowed.
    if object.keys().any(|key| !matches!(key.as_str(), "id" | "type" | "command")) {
        return Err(Some(id));
    }

    match object.get("type").and_then(Value::as_str) {
        Some("ping") if !object.contains_key("command") => Ok(Request::Ping { id }),
        Some("command") => match object.get("command").and_then(Value::as_str).and_then(Command::parse) {
            Some(command) => Ok(Request::Command { id, command }),
            None => Err(Some(id)),
        },
        _ => Err(Some(id)),
    }
}

fn is_valid_id(id: &str) -> bool {
    !id.is_empty() && id.len() <= MAX_ID_LEN && id.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_every_command() {
        for (name, command) in [
            ("toggle", Command::Toggle),
            ("play", Command::Play),
            ("pause", Command::Pause),
            ("next", Command::Next),
            ("previous", Command::Previous),
        ] {
            let line = format!(r#"{{"id":"7","type":"command","command":"{name}"}}"#);
            assert_eq!(parse_request(&line), Ok(Request::Command { id: "7".into(), command }));
        }
    }

    #[test]
    fn parses_ping() {
        assert_eq!(
            parse_request(r#"{"id":"a-1_B","type":"ping"}"#),
            Ok(Request::Ping { id: "a-1_B".into() })
        );
    }

    #[test]
    fn rejects_unknown_commands_and_types_with_the_id() {
        for line in [
            r#"{"id":"1","type":"command","command":"stop"}"#,
            r#"{"id":"1","type":"command","command":"TOGGLE"}"#,
            r#"{"id":"1","type":"command"}"#,
            r#"{"id":"1","type":"command","command":1}"#,
            r#"{"id":"1","type":"exec","command":"toggle"}"#,
            r#"{"id":"1"}"#,
            r#"{"id":"1","type":"ping","command":"toggle"}"#,
            r#"{"id":"1","type":"command","command":"next","shell":"calc.exe"}"#,
        ] {
            assert_eq!(parse_request(line), Err(Some("1".into())), "{line}");
        }
    }

    #[test]
    fn rejects_malformed_input_without_an_id() {
        for line in [
            "",
            "not json",
            "[]",
            "null",
            r#"{"type":"ping"}"#,
            r#"{"id":1,"type":"ping"}"#,
            r#"{"id":"","type":"ping"}"#,
            r#"{"id":"has space","type":"ping"}"#,
            r#"{"id":"\u0000","type":"ping"}"#,
        ] {
            assert_eq!(parse_request(line), Err(None), "{line}");
        }
        let long_id = format!(r#"{{"id":"{}","type":"ping"}}"#, "x".repeat(65));
        assert_eq!(parse_request(&long_id), Err(None));
        let long_line = format!(r#"{{"id":"1","type":"ping","pad":"{}"}}"#, "x".repeat(MAX_LINE_BYTES));
        assert_eq!(parse_request(&long_line), Err(None));
    }

    #[test]
    fn serializes_responses_exactly() {
        assert_eq!(
            Response::Handled { id: "1".into() }.to_json(),
            r#"{"id":"1","ok":true,"handled":true}"#
        );
        assert_eq!(
            Response::NotHandled {
                id: "2".into(),
                reason: NotHandledReason::SpotifySessionUnavailable
            }
            .to_json(),
            r#"{"id":"2","ok":true,"handled":false,"reason":"spotify-session-unavailable"}"#
        );
        assert_eq!(
            Response::NotHandled {
                id: "3".into(),
                reason: NotHandledReason::CommandRejected
            }
            .to_json(),
            r#"{"id":"3","ok":true,"handled":false,"reason":"command-rejected"}"#
        );
        assert_eq!(
            Response::NotHandled {
                id: "4".into(),
                reason: NotHandledReason::MediaManagerUnavailable
            }
            .to_json(),
            r#"{"id":"4","ok":true,"handled":false,"reason":"media-manager-unavailable"}"#
        );
        assert_eq!(
            Response::Pong {
                id: "5".into(),
                spotify_session: true
            }
            .to_json(),
            format!(
                r#"{{"id":"5","ok":true,"pong":true,"spotifySession":true,"version":"{}"}}"#,
                env!("CARGO_PKG_VERSION")
            )
        );
        assert_eq!(
            Response::Error {
                id: Some("6".into()),
                code: ErrorCode::CommandFailed
            }
            .to_json(),
            r#"{"id":"6","ok":false,"error":"command-failed"}"#
        );
        assert_eq!(
            Response::Error {
                id: None,
                code: ErrorCode::InvalidRequest
            }
            .to_json(),
            r#"{"id":null,"ok":false,"error":"invalid-request"}"#
        );
    }
}
