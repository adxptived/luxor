use serde::Serialize;

/// Unified error type for all core modules.
///
/// Serializes to a `{ kind, message }` object so the frontend can match on
/// `kind` and show a human-friendly `message`.
#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[error("io error: {0}")]
    Io(#[from] std::io::Error),

    #[error("git error: {0}")]
    Git(#[from] git2::Error),

    #[error("database error: {0}")]
    Db(#[from] rusqlite::Error),

    #[error("config error: {0}")]
    Config(String),

    #[error("terminal error: {0}")]
    Pty(String),

    #[error("launcher error: {0}")]
    Launcher(String),

    #[error("secret storage error: {0}")]
    Secrets(String),

    #[error("AI gateway error: {0}")]
    Ai(String),

    #[error("http error: {0}")]
    Http(#[from] reqwest::Error),

    #[error("serialization error: {0}")]
    Serde(#[from] serde_json::Error),

    #[error("process error: {0}")]
    Process(String),

    #[error("not found: {0}")]
    NotFound(String),

    #[error("invalid input: {0}")]
    InvalidInput(String),

    /// The on-disk state changed since the caller last read it (optimistic
    /// concurrency failure). The frontend matches on `kind == "conflict"` to
    /// show a "file changed on disk" dialog instead of a generic error toast.
    #[error("conflict: {0}")]
    Conflict(String),
}

pub type Result<T> = std::result::Result<T, Error>;

impl Error {
    /// Stable machine-readable discriminant for the frontend.
    pub fn kind(&self) -> &'static str {
        match self {
            Error::Io(_) => "io",
            Error::Git(_) => "git",
            Error::Db(_) => "db",
            Error::Config(_) => "config",
            Error::Pty(_) => "pty",
            Error::Launcher(_) => "launcher",
            Error::Secrets(_) => "secrets",
            Error::Ai(_) => "ai",
            Error::Http(_) => "http",
            Error::Serde(_) => "serde",
            Error::Process(_) => "process",
            Error::NotFound(_) => "not_found",
            Error::InvalidInput(_) => "invalid_input",
            Error::Conflict(_) => "conflict",
        }
    }
}

impl Serialize for Error {
    fn serialize<S: serde::Serializer>(
        &self,
        serializer: S,
    ) -> std::result::Result<S::Ok, S::Error> {
        use serde::ser::SerializeStruct;
        let mut s = serializer.serialize_struct("Error", 2)?;
        s.serialize_field("kind", self.kind())?;
        s.serialize_field("message", &self.to_string())?;
        s.end()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn error_serializes_with_kind_and_message() {
        let err = Error::Pty("boom".into());
        let json = serde_json::to_value(&err).unwrap();
        assert_eq!(json["kind"], "pty");
        assert_eq!(json["message"], "terminal error: boom");
    }
}
