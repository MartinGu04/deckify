//! Deckify media bridge: a small persistent helper that Deckify starts with piped stdin/stdout.
//!
//! It reads JSON-lines requests from stdin, controls only the local Spotify media session through Windows GSMTC, and answers on stdout.
//! It exits when stdin closes (i.e. when Deckify exits). It never receives Spotify credentials.

// Release builds use the GUI subsystem so no console window can ever appear; stdio still works through the pipes Deckify provides.
#![cfg_attr(all(windows, not(debug_assertions)), windows_subsystem = "windows")]

mod dispatch;
#[cfg(windows)]
mod gsmtc;
mod protocol;
mod selection;

use std::io::{self, BufRead, Write};

use dispatch::handle_line;
use protocol::{ErrorCode, MAX_LINE_BYTES, Response};

fn main() {
    #[cfg(windows)]
    let mut media = gsmtc::GsmtcSessions::default();
    #[cfg(not(windows))]
    let mut media = unsupported::NoSessions;

    if let Err(error) = serve(io::stdin().lock(), io::stdout().lock(), &mut media) {
        // Broken pipe: Deckify went away. Nothing else to do.
        eprintln!("deckify-media-bridge: {error}");
    }
}

/// Serves requests until stdin closes.
fn serve<R: BufRead, W: Write, M: dispatch::MediaSessions>(mut input: R, mut output: W, media: &mut M) -> io::Result<()> {
    let mut buffer = Vec::with_capacity(256);
    loop {
        buffer.clear();
        if input.read_until(b'\n', &mut buffer)? == 0 {
            return Ok(());
        }
        let response = match std::str::from_utf8(&buffer) {
            Ok(text) if buffer.len() <= MAX_LINE_BYTES + 2 => {
                let line = text.trim_end_matches(['\r', '\n']);
                if line.trim().is_empty() {
                    continue;
                }
                handle_line(line, media)
            }
            _ => Response::Error {
                id: None,
                code: ErrorCode::InvalidRequest,
            },
        };
        output.write_all(response.to_json().as_bytes())?;
        output.write_all(b"\n")?;
        output.flush()?;
    }
}

/// Non-Windows stand-in so the protocol can be built and tested on any OS: there are never any sessions.
#[cfg(not(windows))]
mod unsupported {
    use crate::dispatch::{MediaSessions, SessionError};
    use crate::protocol::Command;

    pub struct NoSessions;

    impl MediaSessions for NoSessions {
        type Session = ();

        fn sessions(&mut self) -> Result<Vec<(String, ())>, SessionError> {
            Err(SessionError::Unavailable)
        }

        fn send(&mut self, _session: &(), _command: Command) -> Result<bool, SessionError> {
            Err(SessionError::Unavailable)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::dispatch::{MediaSessions, SessionError};
    use crate::protocol::Command;

    struct SpotifyOnly(Vec<Command>);

    impl MediaSessions for SpotifyOnly {
        type Session = ();
        fn sessions(&mut self) -> Result<Vec<(String, ())>, SessionError> {
            Ok(vec![("Spotify.exe".to_owned(), ())])
        }
        fn send(&mut self, _session: &(), command: Command) -> Result<bool, SessionError> {
            self.0.push(command);
            Ok(true)
        }
    }

    #[test]
    fn serves_json_lines_in_order_and_survives_bad_input() {
        let input = concat!(
            "{\"id\":\"1\",\"type\":\"ping\"}\n",
            "\n",
            "nonsense\n",
            "{\"id\":\"2\",\"type\":\"command\",\"command\":\"toggle\"}\r\n",
            "{\"id\":\"3\",\"type\":\"command\",\"command\":\"next\"}",
        );
        let mut output = Vec::new();
        let mut media = SpotifyOnly(Vec::new());
        serve(input.as_bytes(), &mut output, &mut media).unwrap();

        let lines: Vec<&str> = std::str::from_utf8(&output).unwrap().lines().collect();
        assert_eq!(lines.len(), 4);
        assert!(lines[0].starts_with(r#"{"id":"1","ok":true,"pong":true,"spotifySession":true"#));
        assert_eq!(lines[1], r#"{"id":null,"ok":false,"error":"invalid-request"}"#);
        assert_eq!(lines[2], r#"{"id":"2","ok":true,"handled":true}"#);
        assert_eq!(lines[3], r#"{"id":"3","ok":true,"handled":true}"#);
        assert_eq!(media.0, vec![Command::Toggle, Command::Next]);
    }

    #[test]
    fn rejects_oversized_and_non_utf8_lines() {
        let mut input = vec![b'{'; MAX_LINE_BYTES + 10];
        input.push(b'\n');
        input.extend_from_slice(&[0xff, 0xfe, b'\n']);
        let mut output = Vec::new();
        serve(input.as_slice(), &mut output, &mut SpotifyOnly(Vec::new())).unwrap();
        let text = String::from_utf8(output).unwrap();
        assert_eq!(
            text.lines()
                .filter(|l| *l == r#"{"id":null,"ok":false,"error":"invalid-request"}"#)
                .count(),
            2
        );
    }
}
