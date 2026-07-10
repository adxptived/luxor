import { Component, type ErrorInfo, type ReactNode } from "react";

import { t } from "@/lib/i18n";
import { pushStructured } from "@/lib/logBuffer";

/**
 * Per-panel error boundary: catches render errors inside a single dock panel
 * so one crashing panel doesn't blank the entire dock or the app.
 *
 * Shows a compact "this panel crashed" card with a Retry button that resets
 * the boundary (re-mounting the panel). The error is logged to the structured
 * log buffer and the Tauri frontend log for diagnostics.
 */
interface Props {
  children: ReactNode;
  panelName?: string;
}
interface State {
  error: Error | null;
}

export class PanelErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  private errorReport(): string {
    const error = this.state.error;
    if (!error) return "";
    return [
      "Luxor panel crash report",
      `Panel: ${this.props.panelName ?? "unknown"}`,
      `Time: ${new Date().toISOString()}`,
      `Error: ${String(error)}`,
      "",
      "Stack:",
      error.stack ?? "(no stack)",
    ].join("\n");
  }

  private copyError = () => {
    const report = this.errorReport();
    if (!report) return;
    navigator.clipboard?.writeText(report).catch(() => {});
  };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    pushStructured("ERROR", "ui", "panel crash", {
      panel: this.props.panelName ?? "unknown",
      message: String(error),
      stack: error.stack?.slice(0, 800),
      componentStack: info.componentStack?.slice(0, 800),
    });
    void import("@/lib/ipc").then(({ frontendLog }) =>
      frontendLog(
        `PANEL_CRASH [${this.props.panelName ?? "unknown"}] ${String(error)} ${info.componentStack ?? ""}`.slice(0, 800),
      ),
    );
  }

  render() {
    if (this.state.error) {
      const report = this.errorReport();
      return (
        <div
          data-testid="panel-crashed"
          className="flex h-full w-full flex-col items-center justify-center gap-3 bg-surface p-6 text-center"
        >
          <div className="flex h-12 w-12 items-center justify-center rounded-lg border border-danger-soft-strong bg-danger-soft text-danger">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
              <line x1="12" y1="9" x2="12" y2="13" />
              <line x1="12" y1="17" x2="12.01" y2="17" />
            </svg>
          </div>
          <div className="text-sm font-semibold text-strong">
            {this.props.panelName
              ? `${this.props.panelName} — ${t("panel.crashed", "panel crashed")}`
              : t("panel.crashed", "This panel crashed")}
          </div>
          <div className="max-h-44 w-full max-w-2xl overflow-auto rounded-lg border border-edge bg-raised px-3 py-2 text-left font-mono text-xs leading-5 text-muted">
            <pre className="whitespace-pre-wrap break-words">{report}</pre>
          </div>
          <div className="flex items-center gap-2">
            <button
              className="rounded-lg border border-edge bg-raised px-4 py-2 text-sm text-strong transition-colors hover:bg-accent hover:text-on-accent"
              onClick={() => this.setState({ error: null })}
            >
              {t("panel.retry", "Retry")}
            </button>
            <button
              className="rounded-lg border border-edge bg-raised px-4 py-2 text-sm text-muted transition-colors hover:text-strong"
              onClick={this.copyError}
            >
              {t("app.crashed.copy", "Copy error")}
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
