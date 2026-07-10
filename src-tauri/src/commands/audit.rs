//! Static project audit command (plan part 1.3 "killer feature").
//!
//! Runs [`luxor_core::audit::run_audit`] over a project and is the concrete
//! *producer* for the audit telemetry counters (`audits_run`, `issues_fixed`
//! → `purity_keeper` achievement) and the Critical Discord status (Priority 1,
//! plan 4.2). The filesystem walk runs without holding any lock; the short
//! state updates happen afterwards.

use luxor_core::audit::{self, AuditReport};
use luxor_core::Error;
use tauri::State;

use crate::state::AppState;

/// Run a static audit of `project_path`, update audit counters, and raise a
/// critical Discord status when critical issues are present.
#[tauri::command(async)]
pub fn audit_run(state: State<'_, AppState>, project_path: String) -> Result<AuditReport, Error> {
    // 1) Scan the tree (no locks held during IO).
    let report = audit::run_audit(std::path::Path::new(&project_path))?;
    let actionable = report.critical + report.high;

    // 2) Credit fixed issues vs the previous run for this project (plan 1.3).
    let fixed = {
        let mut last = state
            .audit_last
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        let prev = last.get(&project_path).copied();
        last.insert(project_path.clone(), actionable);
        match prev {
            Some(p) => (p - actionable).max(0),
            None => 0, // first run — nothing to compare against yet
        }
    };

    // 3) Bump today's audit counters.
    {
        let store = state
            .telemetry
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        store.bump_audit(1, fixed)?;
    }

    // 4) A critical finding interrupts the Discord carousel immediately.
    if report.critical > 0 {
        let mut engine = state
            .discord
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        engine.push_critical(
            format!("🛡️ Аудит: {} критических", report.critical),
            Some(format!("🐞 {} проблем", actionable)),
        );
    }

    Ok(report)
}
