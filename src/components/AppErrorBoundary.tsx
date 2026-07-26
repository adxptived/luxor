import { Component, type ErrorInfo, type ReactNode } from "react";

import { t } from "@/lib/i18n";
import { pushStructured } from "@/lib/logBuffer";
import { announce } from "@/lib/useAriaLive";
import { WindowControls } from "./WindowChrome";

/**
 * Top-level error boundary for the entire Luxor app.
 *
 * The per-panel `PanelBoundary` in DockLayout catches crashes inside
 * individual dock panels, but anything thrown *outside* the dock (TopBar,
 * NavRail, StatusBar, RightPanel, overlays, lazy Suspense fallbacks) would
 * propagate to the root and blank the entire window with no recovery UI.
 *
 * This boundary wraps the whole tree so that even a fatal render error
 * shows a recoverable "something went wrong" screen with a Reload button
 * instead of a white void.
 *
 * Phase 11 — Reliability: now includes error count tracking, a "Reload app"
 * option, clipboard-copy of the error for bug reports, and ARIA live
 * announcements for screen readers.
 */
interface Props {
  children: ReactNode;
}
interface State {
  error: Error | null;
  errorCount: number;
}

export class AppErrorBoundary extends Component<Props, State> {
  state: State = { error: null, errorCount: 0 };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    pushStructured("ERROR", "ui", "app crash", {
      message: String(error),
      stack: error.stack?.slice(0, 1000),
      componentStack: info.componentStack?.slice(0, 1000),
    });
    void import("@/lib/ipc").then(({ frontendLog }) =>
      frontendLog(`APP_CRASH ${String(error)} ${info.componentStack ?? ""}`.slice(0, 1000)),
    );
    this.setState((s) => ({ errorCount: s.errorCount + 1 }));
    announce(t("app.crashed.title", "Something went wrong"));
  }

  handleReload = () => {
    // WebviewWindow has no reload() method, so reload the document directly.
    // This works in both the Tauri webview and a plain browser.
    window.location.reload();
  };

  private errorReport(): string {
    const error = this.state.error;
    if (!error) return "";
    return [
      "Luxor crash report",
      `Time: ${new Date().toISOString()}`,
      `Error: ${String(error)}`,
      "",
      "Stack:",
      error.stack ?? "(no stack)",
    ].join("\n");
  }

  handleCopyError = () => {
    const text = this.errorReport();
    if (!text) return;
    navigator.clipboard?.writeText(text).catch(() => {});
  };

  render() {
    if (this.state.error) {
      const repeatedCrash = this.state.errorCount > 2;
      const report = this.errorReport();
      return (
        <div className="flex h-screen w-screen flex-col bg-surface text-center" role="alert" aria-live="assertive">
          <div className="lx-titlebar shrink-0" data-testid="crash-window-chrome">
            <div className="lx-drag flex min-w-0 flex-1 items-center px-3 text-left text-xs font-medium text-muted" data-tauri-drag-region>
              Luxor · {t("app.crashed.title", "Something went wrong")}
            </div>
            <WindowControls />
          </div>
          <div className="flex flex-1 flex-col items-center justify-center gap-4 p-8">
          <div className="text-lg font-semibold text-strong">
            {t("app.crashed.title", "Something went wrong")}
          </div>
          <div className="max-w-lg text-sm text-muted">
            {repeatedCrash
              ? t("app.crashed.repeated", "This keeps happening. Try reloading the app — your work is safe.")
              : t("app.crashed.description", "An unexpected error occurred. Your work is safe — try reloading the app.")}
          </div>
          <div className="max-h-72 w-full max-w-3xl overflow-auto rounded-lg border border-edge bg-raised px-3 py-2 text-left font-mono text-xs leading-5 text-muted">
            <pre className="whitespace-pre-wrap break-words">{report}</pre>
          </div>
          <div className="flex items-center gap-2">
            <button
              className="rounded-lg border border-edge bg-raised px-4 py-2 text-sm text-strong transition-colors hover:bg-accent hover:text-on-accent"
              onClick={() => this.setState({ error: null })}
            >
              {t("app.crashed.retry", "Try again")}
            </button>
            <button
              className="rounded-lg border border-edge bg-raised px-4 py-2 text-sm text-strong transition-colors hover:bg-raised"
              onClick={this.handleReload}
            >
              {t("app.crashed.reload", "Reload app")}
            </button>
            <button
              className="rounded-lg border border-edge bg-raised px-4 py-2 text-sm text-muted transition-colors hover:text-strong"
              onClick={this.handleCopyError}
              title={t("app.crashed.copy", "Copy error for bug report")}
             aria-label={t("app.crashed.copy", "Copy error for bug report")}>
              {t("app.crashed.copy", "Copy error")}
            </button>
          </div>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}