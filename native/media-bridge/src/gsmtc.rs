//! Windows implementation of [`MediaSessions`] using GSMTC
//! (`Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager`).

use windows::Media::Control::{
    GlobalSystemMediaTransportControlsSession as Session, GlobalSystemMediaTransportControlsSessionManager as Manager,
};

use crate::dispatch::{MediaSessions, SessionError};
use crate::protocol::Command;

/// GSMTC session access. The session manager is requested lazily and kept for the life of the process.
#[derive(Default)]
pub struct GsmtcSessions {
    manager: Option<Manager>,
}

impl GsmtcSessions {
    fn manager(&mut self) -> Result<&Manager, SessionError> {
        if self.manager.is_none() {
            let manager = Manager::RequestAsync()
                .and_then(|operation| operation.join())
                .map_err(|_| SessionError::Unavailable)?;
            self.manager = Some(manager);
        }
        self.manager.as_ref().ok_or(SessionError::Unavailable)
    }
}

impl MediaSessions for GsmtcSessions {
    type Session = Session;

    fn sessions(&mut self) -> Result<Vec<(String, Session)>, SessionError> {
        let list = match self.manager()?.GetSessions() {
            Ok(list) => list,
            Err(_) => {
                // Request a fresh manager next time.
                self.manager = None;
                return Err(SessionError::Unavailable);
            }
        };
        Ok(list
            .into_iter()
            .filter_map(|session| {
                let app_id = session.SourceAppUserModelId().ok()?.to_string_lossy();
                Some((app_id, session))
            })
            .collect())
    }

    fn send(&mut self, session: &Session, command: Command) -> Result<bool, SessionError> {
        let operation = match command {
            Command::Toggle => session.TryTogglePlayPauseAsync(),
            Command::Play => session.TryPlayAsync(),
            Command::Pause => session.TryPauseAsync(),
            Command::Next => session.TrySkipNextAsync(),
            Command::Previous => session.TrySkipPreviousAsync(),
        };
        operation
            .and_then(|operation| operation.join())
            .map_err(|_| SessionError::CommandFailed)
    }
}
