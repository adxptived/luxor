//! Secure secret storage in the OS keychain via `keyring`.
//!
//! Windows: Credential Manager · macOS: Keychain · Linux: Secret Service (D-Bus).
//!
//! SECURITY RULES (project policy — do not change without owner approval):
//! - Secrets are stored ONLY in the OS keychain, never in files, SQLite or logs.
//! - Secrets are sent ONLY to the service the user configured them for
//!   (e.g. a git host). No telemetry, ever.

use keyring::Entry;
use serde::Serialize;

use crate::{Error, Result};

/// Keychain service name. All Luxor secrets live under this service.
const SERVICE: &str = "luxor";

/// Well-known account kinds, kept as plain prefixes for listability.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum SecretKind {
    /// Personal access token for a git host, account = `git:{host}`.
    GitToken,
}

fn validate_name(name: &str) -> Result<()> {
    let ok = !name.is_empty()
        && name.len() <= 128
        && name
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '-' | '_' | ':' | '/'));
    if !ok {
        return Err(Error::InvalidInput(format!(
            "invalid secret account name: {name:?}"
        )));
    }
    Ok(())
}

fn account(kind: SecretKind, name: &str) -> Result<String> {
    validate_name(name)?;
    Ok(match kind {
        SecretKind::GitToken => format!("git:{name}"),
    })
}

fn entry(kind: SecretKind, name: &str) -> Result<Entry> {
    let account = account(kind, name)?;
    Entry::new(SERVICE, &account).map_err(|e| Error::Secrets(e.to_string()))
}

/// Store (or replace) a secret.
pub fn set(kind: SecretKind, name: &str, value: &str) -> Result<()> {
    if value.is_empty() {
        return Err(Error::InvalidInput("secret value cannot be empty".into()));
    }
    entry(kind, name)?
        .set_password(value)
        .map_err(|e| Error::Secrets(e.to_string()))
}

/// Retrieve a secret. Returns `NotFound` if absent.
pub fn get(kind: SecretKind, name: &str) -> Result<String> {
    match entry(kind, name)?.get_password() {
        Ok(value) => Ok(value),
        Err(keyring::Error::NoEntry) => {
            Err(Error::NotFound(format!("secret {:?} for {name}", kind)))
        }
        Err(e) => Err(Error::Secrets(e.to_string())),
    }
}

/// Retrieve a secret if present.
pub fn get_optional(kind: SecretKind, name: &str) -> Result<Option<String>> {
    match get(kind, name) {
        Ok(v) => Ok(Some(v)),
        Err(Error::NotFound(_)) => Ok(None),
        Err(e) => Err(e),
    }
}

/// Delete a secret. Deleting a missing secret is not an error.
pub fn delete(kind: SecretKind, name: &str) -> Result<()> {
    match entry(kind, name)?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(Error::Secrets(e.to_string())),
    }
}

/// Check whether a secret exists without returning its value (safe for UI).
pub fn exists(kind: SecretKind, name: &str) -> Result<bool> {
    Ok(get_optional(kind, name)?.is_some())
}

#[cfg(test)]
mod tests {
    use super::*;

    // Keychain access is environment-dependent (no D-Bus in CI containers),
    // so unit tests focus on the pure validation logic.

    #[test]
    fn account_names_are_namespaced() {
        assert_eq!(
            account(SecretKind::GitToken, "github.com").unwrap(),
            "git:github.com"
        );
    }

    #[test]
    fn bad_names_rejected() {
        assert!(account(SecretKind::GitToken, "").is_err());
        assert!(account(SecretKind::GitToken, "has space").is_err());
        assert!(account(SecretKind::GitToken, "semi;colon").is_err());
        assert!(account(SecretKind::GitToken, &"x".repeat(200)).is_err());
    }

    #[test]
    fn empty_value_rejected() {
        assert_eq!(
            set(SecretKind::GitToken, "github.com", "")
                .unwrap_err()
                .kind(),
            "invalid_input"
        );
    }
}
