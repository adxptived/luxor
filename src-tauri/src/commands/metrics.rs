//! Metric provider wiring (plan part 13.1): exposes the extensible
//! [`MetricRegistry`] over live app data. Built-in providers wrap current
//! snapshots (audit issues, today's telemetry) and route them through the
//! trait so new metric sources can be added without touching callers.

use luxor_core::metricprovider::{MetricProvider, MetricRegistry, MetricSample};
use luxor_core::Error;
use tauri::State;

use crate::state::AppState;

/// Open (actionable) audit issues across all audited projects.
struct AuditProvider {
    open_issues: i64,
}
impl MetricProvider for AuditProvider {
    fn id(&self) -> &str {
        "audit"
    }
    fn name(&self) -> &str {
        "Audit"
    }
    fn collect(&self) -> Vec<MetricSample> {
        vec![MetricSample::new("open_issues", self.open_issues as f64).with_unit("count")]
    }
}

/// Today's productive / AI time, in seconds.
struct TelemetryProvider {
    total: i64,
    ai: i64,
}
impl MetricProvider for TelemetryProvider {
    fn id(&self) -> &str {
        "telemetry"
    }
    fn name(&self) -> &str {
        "Telemetry"
    }
    fn collect(&self) -> Vec<MetricSample> {
        vec![
            MetricSample::new("today_seconds", self.total as f64).with_unit("seconds"),
            MetricSample::new("ai_seconds", self.ai as f64).with_unit("seconds"),
        ]
    }
}

/// Collect all metrics from the registry's enabled providers (plan 13.1).
#[tauri::command(async)]
pub fn metrics_collect(state: State<'_, AppState>) -> Result<Vec<MetricSample>, Error> {
    let open_issues: i64 = {
        let last = state
            .audit_last
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        last.values().copied().sum()
    };
    let today = {
        let store = state
            .telemetry
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        store.today_summary().unwrap_or_default()
    };

    let mut registry = MetricRegistry::new();
    registry.register(Box::new(AuditProvider { open_issues }));
    registry.register(Box::new(TelemetryProvider {
        total: today.total_seconds,
        ai: today.ai_seconds,
    }));
    Ok(registry.collect_all())
}
