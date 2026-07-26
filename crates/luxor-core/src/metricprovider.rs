//! Plugin / extensibility layer (plan part 13.1): a trait-based metric
//! provider system so new data sources can be added without touching the
//! telemetry core. Built-in collectors (git, processes, audit) and future
//! plugins implement [`MetricProvider`]; the [`MetricRegistry`] fans out.

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

/// A single named metric value emitted by a provider.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct MetricSample {
    /// Stable metric key, e.g. "git.lines_added" or "audit.issues_open".
    pub key: String,
    pub value: f64,
    /// Optional unit hint ("seconds", "count", "percent").
    pub unit: Option<String>,
}

impl MetricSample {
    pub fn new(key: impl Into<String>, value: f64) -> Self {
        Self {
            key: key.into(),
            value,
            unit: None,
        }
    }
    pub fn with_unit(mut self, unit: impl Into<String>) -> Self {
        self.unit = Some(unit.into());
        self
    }
}

/// Implement to contribute metrics to dashboards and Discord presence.
///
/// Providers must be cheap and non-blocking — they run on the telemetry
/// cadence (zero-overhead budget, plan part 10).
pub trait MetricProvider: Send + Sync {
    /// Stable provider id (used for enable/disable + namespacing).
    fn id(&self) -> &str;
    /// Human-readable name for settings UI.
    fn name(&self) -> &str {
        self.id()
    }
    /// Collect the current samples. Return an empty vec when nothing changed.
    fn collect(&self) -> Vec<MetricSample>;
}

/// Holds registered providers and aggregates their samples.
#[derive(Default)]
pub struct MetricRegistry {
    providers: Vec<Box<dyn MetricProvider>>,
    disabled: BTreeMap<String, bool>,
}

impl MetricRegistry {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn register(&mut self, provider: Box<dyn MetricProvider>) {
        self.providers.push(provider);
    }

    pub fn set_enabled(&mut self, id: &str, enabled: bool) {
        self.disabled.insert(id.to_string(), !enabled);
    }

    fn is_enabled(&self, id: &str) -> bool {
        !self.disabled.get(id).copied().unwrap_or(false)
    }

    pub fn provider_ids(&self) -> Vec<String> {
        self.providers.iter().map(|p| p.id().to_string()).collect()
    }

    /// Collect from every enabled provider, namespacing keys by provider id.
    pub fn collect_all(&self) -> Vec<MetricSample> {
        let mut out = Vec::new();
        for p in &self.providers {
            if !self.is_enabled(p.id()) {
                continue;
            }
            for mut s in p.collect() {
                if !s.key.starts_with(&format!("{}.", p.id())) {
                    s.key = format!("{}.{}", p.id(), s.key);
                }
                out.push(s);
            }
        }
        out
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    struct GitMock;
    impl MetricProvider for GitMock {
        fn id(&self) -> &str {
            "git"
        }
        fn collect(&self) -> Vec<MetricSample> {
            vec![MetricSample::new("lines_added", 450.0).with_unit("count")]
        }
    }

    #[test]
    fn registry_namespaces_and_respects_disable() {
        let mut reg = MetricRegistry::new();
        reg.register(Box::new(GitMock));
        let samples = reg.collect_all();
        assert_eq!(samples.len(), 1);
        assert_eq!(samples[0].key, "git.lines_added");
        assert_eq!(samples[0].unit.as_deref(), Some("count"));

        reg.set_enabled("git", false);
        assert!(reg.collect_all().is_empty());
        assert_eq!(reg.provider_ids(), vec!["git".to_string()]);
    }
}
