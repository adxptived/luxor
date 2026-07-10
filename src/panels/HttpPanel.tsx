/** REST scratch pad: fire HTTP requests without leaving the cockpit. */

import { ChevronDown, ChevronRight, Copy, History, Loader2, Plus, Send, Trash2 } from "lucide-react";
import { useState } from "react";

import * as ipc from "@/lib/ipc";
import { t } from "@/lib/i18n";
import type { HttpResponseInfo } from "@/lib/types";
import { errorMessage } from "@/lib/types";
import { useAppStore } from "@/state/appStore";

const METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"];

type AuthType = "none" | "bearer" | "basic";

/** Build the Authorization header for the selected auth mode, if any. */
function authHeader(auth: AuthType, token: string, user: string, pass: string): [string, string] | null {
  if (auth === "bearer" && token.trim()) return ["Authorization", `Bearer ${token.trim()}`];
  if (auth === "basic" && (user || pass)) return ["Authorization", `Basic ${btoa(`${user}:${pass}`)}`];
  return null;
}

interface HistoryEntry {
  method: string;
  url: string;
  status: number;
  ts: number;
}

function loadHistory(): HistoryEntry[] {
  try { return JSON.parse(localStorage.getItem("luxor.httpHistory") || "[]"); } catch { return []; }
}
function saveHistory(h: HistoryEntry[]) {
  try { localStorage.setItem("luxor.httpHistory", JSON.stringify(h.slice(0, 50))); } catch { /* ignore */ }
}

export function HttpPanel() {
  const toast = useAppStore((s) => s.toast);
  const [method, setMethod] = useState("GET");
  const [url, setUrl] = useState("");
  const [headers, setHeaders] = useState<[string, string][]>([["", ""]]);
  const [body, setBody] = useState("");
  const [response, setResponse] = useState<HttpResponseInfo | null>(null);
  const [busy, setBusy] = useState(false);
  const [showHeaders, setShowHeaders] = useState(false);
  const [history, setHistory] = useState<HistoryEntry[]>(loadHistory);
  const [showHistory, setShowHistory] = useState(false);
  const [auth, setAuth] = useState<AuthType>("none");
  const [authToken, setAuthToken] = useState("");
  const [authUser, setAuthUser] = useState("");
  const [authPass, setAuthPass] = useState("");
  // SSRF guard (audit 2.7): ON by default; users hitting local dev servers
  // can switch it off explicitly, and the choice is remembered.
  const [blockPrivate, setBlockPrivate] = useState<boolean>(
    () => localStorage.getItem("luxor.httpBlockPrivate") !== "0",
  );
  const toggleBlockPrivate = () => {
    setBlockPrivate((v) => {
      try { localStorage.setItem("luxor.httpBlockPrivate", v ? "0" : "1"); } catch { /* ignore */ }
      return !v;
    });
  };

  const send = async () => {
    if (!url.trim()) return;
    setBusy(true);
    setResponse(null);
    try {
      const extra = authHeader(auth, authToken, authUser, authPass);
      const finalHeaders = headers.filter(([k]) => k.trim() !== "");
      // Explicit Authorization header wins over the auth helper.
      if (extra && !finalHeaders.some(([k]) => k.toLowerCase() === "authorization")) finalHeaders.push(extra);
      const result = await ipc.httpRequest({
        method,
        url: url.trim(),
        headers: finalHeaders,
        body,
        block_private: blockPrivate,
      });
      setResponse(result);
      // Record in history
      const entry: HistoryEntry = { method, url: url.trim(), status: result.status, ts: Date.now() };
      const next = [entry, ...history.filter((h) => !(h.method === entry.method && h.url === entry.url))].slice(0, 50);
      setHistory(next);
      saveHistory(next);
    } catch (e) {
      toast(errorMessage(e), "error");
    } finally {
      setBusy(false);
    }
  };

  const prettyBody = (() => {
    if (!response) return "";
    try {
      return JSON.stringify(JSON.parse(response.body), null, 2);
    } catch {
      return response.body;
    }
  })();

  const statusColor =
    response == null
      ? ""
      : response.status < 300
        ? "text-success"
        : response.status < 400
          ? "text-warning"
          : "text-danger";
  const nonEmptyHeaders = headers.filter(([k]) => k.trim()).length;
  const canHaveBody = method !== "GET" && method !== "HEAD";

  return (
    <div className="@container flex h-full flex-col bg-surface text-sm lx-fade-in">
      <div className="border-b border-edge bg-bar/55 p-3">
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <div className="min-w-0 flex-1">
            <div className="text-sm font-semibold text-strong">{t("HTTP scratchpad")}</div>
            <div className="truncate text-xs text-muted">{t("Build quick API requests without leaving the workspace.")}</div>
          </div>
          <button
            onClick={toggleBlockPrivate}
            title={t(
              "http.guard_hint",
              "SSRF guard: blocks requests to localhost/private networks. Turn off only to hit local dev servers.",
            )}
            aria-pressed={blockPrivate}
            className={`rounded-full border px-2 py-1 text-[10px] transition-colors ${
              blockPrivate
                ? "border-edge bg-surface text-muted"
                : "border-warning/60 bg-warning/10 text-warning"
            }`}
          >
            {blockPrivate
              ? t("http.guard_on", "Guard: private hosts blocked")
              : t("http.guard_off", "Guard OFF — local/private requests allowed")}
          </button>
          <span className="rounded-full border border-edge bg-surface px-2 py-1 text-[10px] text-muted">
            {nonEmptyHeaders} headers{canHaveBody && body.trim() ? " · body" : ""}
          </span>
        </div>

        <div className="grid gap-2 @sm:grid-cols-[7.5rem_1fr_auto]">
          <select
            value={method}
            onChange={(e) => setMethod(e.target.value)}
            className="rounded-lg border border-edge bg-raised px-2 py-2 font-mono text-xs font-semibold text-strong outline-none focus:border-accent/70"
          >
            {METHODS.map((m) => (
              <option key={m}>{m}</option>
            ))}
          </select>
          <input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && void send()}
            placeholder="https://api.example.com/v1/…"
            className="min-w-0 rounded-lg border border-edge bg-raised px-3 py-2 font-mono text-xs text-strong outline-none placeholder:text-muted focus:border-accent/70"
          />
          <button
            onClick={() => void send()}
            disabled={busy || !url.trim()}
            className="flex items-center justify-center gap-1.5 rounded-lg bg-accent px-4 py-2 text-xs font-semibold text-on-accent shadow-sm disabled:opacity-40"
          >
            {busy ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />} {busy ? t("Sending…") : t("Send")}
          </button>
        </div>

        <button
          onClick={() => setShowHeaders((v) => !v)}
          className="mt-2 flex items-center gap-1 rounded-lg px-1.5 py-1 text-xs text-muted hover:bg-raised hover:text-strong"
        >
          {showHeaders ? <ChevronDown size={13} /> : <ChevronRight size={13} />} Headers and body
        </button>
        <button
          onClick={() => setShowHistory((v) => !v)}
          className="mt-2 ml-2 flex items-center gap-1 rounded-lg px-1.5 py-1 text-xs text-muted hover:bg-raised hover:text-strong"
        >
          {showHistory ? <ChevronDown size={13} /> : <ChevronRight size={13} />} <History size={12} /> History ({history.length})
        </button>
        {showHistory && (
          <div className="mt-2 rounded-lg border border-edge bg-surface/55 p-2">
            {history.length === 0 && <div className="px-2 py-2 text-xs text-muted">{t("No requests yet.")}</div>}
            {history.map((h, i) => (
              <button
                key={i}
                onClick={() => { setMethod(h.method); setUrl(h.url); setShowHistory(false); }}
                className="flex w-full items-center gap-2 rounded-lg px-2 py-1 text-left text-xs hover:bg-raised"
              >
                <span className={`font-mono font-bold ${h.status < 300 ? "text-success" : h.status < 400 ? "text-warning" : "text-danger"}`}>{h.method}</span>
                <span className="min-w-0 flex-1 truncate font-mono text-muted">{h.url}</span>
                <span className="shrink-0 text-muted">{h.status}</span>
              </button>
            ))}
            {history.length > 0 && (
              <button
                onClick={() => { setHistory([]); saveHistory([]); }}
                className="mt-2 flex items-center gap-1 rounded-lg px-2 py-1 text-xs text-danger hover:bg-danger-soft"
              >
                <Trash2 size={11} /> {t("Clear history")}
              </button>
            )}
          </div>
        )}
        {showHeaders && (
          <div className="mt-2 rounded-lg border border-edge bg-surface/55 p-2">
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <span className="text-xs text-muted">{t("Auth")}:</span>
              <select
                value={auth}
                onChange={(e) => setAuth(e.target.value as AuthType)}
                className="rounded-lg border border-edge bg-raised px-2 py-1 text-xs text-strong outline-none focus:border-accent/70"
              >
                <option value="none">{t("None")}</option>
                <option value="bearer">Bearer</option>
                <option value="basic">Basic</option>
              </select>
              {auth === "bearer" && (
                <input
                  value={authToken}
                  onChange={(e) => setAuthToken(e.target.value)}
                  placeholder={t("Token")}
                  type="password"
                  className="min-w-0 flex-1 rounded-lg border border-edge bg-raised px-2 py-1 font-mono text-xs text-strong outline-none focus:border-accent/70"
                />
              )}
              {auth === "basic" && (
                <>
                  <input
                    value={authUser}
                    onChange={(e) => setAuthUser(e.target.value)}
                    placeholder={t("Username")}
                    className="w-32 rounded-lg border border-edge bg-raised px-2 py-1 font-mono text-xs text-strong outline-none focus:border-accent/70"
                  />
                  <input
                    value={authPass}
                    onChange={(e) => setAuthPass(e.target.value)}
                    placeholder={t("Password")}
                    type="password"
                    className="w-32 rounded-lg border border-edge bg-raised px-2 py-1 font-mono text-xs text-strong outline-none focus:border-accent/70"
                  />
                </>
              )}
            </div>
            <div className="space-y-1.5">
              {headers.map(([k, v], i) => (
                <div key={i} className="grid gap-1.5 @sm:grid-cols-[minmax(7rem,0.45fr)_1fr_auto]">
                  <input
                    value={k}
                    onChange={(e) => setHeaders((h) => h.map((p, j) => (j === i ? [e.target.value, p[1]] : p)))}
                    placeholder={t("Header")}
                    className="min-w-0 rounded-lg border border-edge bg-raised px-2 py-1.5 font-mono text-xs text-strong outline-none focus:border-accent/70"
                  />
                  <input
                    value={v}
                    onChange={(e) => setHeaders((h) => h.map((p, j) => (j === i ? [p[0], e.target.value] : p)))}
                    placeholder={t("Value")}
                    className="min-w-0 rounded-lg border border-edge bg-raised px-2 py-1.5 font-mono text-xs text-strong outline-none focus:border-accent/70"
                  />
                  <button
                    onClick={() => setHeaders((h) => h.filter((_, j) => j !== i))}
                    className="rounded-lg px-2 text-muted hover:bg-danger-soft hover:text-danger"
                    title={t("Delete")}
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              ))}
            </div>
            <button
              onClick={() => setHeaders((h) => [...h, ["", ""]])}
              className="mt-2 flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-xs text-muted hover:bg-raised hover:text-strong"
            >
              <Plus size={12} /> Add header
            </button>
            {canHaveBody && (
              <textarea
                value={body}
                onChange={(e) => setBody(e.target.value)}
                placeholder={t("Request body (JSON, text…)")}
                rows={5}
                className="mt-2 w-full resize-y rounded-lg border border-edge bg-raised p-3 font-mono text-xs text-strong outline-none focus:border-accent/70"
              />
            )}
            {!canHaveBody && <div className="mt-2 rounded-lg border border-dashed border-edge px-3 py-2 text-xs text-muted">{method} requests usually do not send a body.</div>}
          </div>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-auto p-3">
        {!response && !busy && (
          <div className="flex h-full min-h-48 items-center justify-center rounded-lg border border-dashed border-edge bg-bar/30 p-6 text-center text-muted">
            <div>
              <div className="lx-empty-icon mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-lg border border-edge bg-raised text-accent">
                <Send size={20} />
              </div>
              <div className="font-medium text-strong">{t("Send a request to see the response here")}</div>
              <div className="mt-1 max-w-xs text-xs leading-5">Headers, status, timing and body preview will appear in this panel.</div>
            </div>
          </div>
        )}
        {busy && (
          <div className="flex h-full min-h-48 items-center justify-center rounded-lg border border-edge bg-bar/30 p-6 text-center text-muted">
            <div>
              <Loader2 size={24} className="mx-auto mb-3 animate-spin text-accent" />
              <div className="font-medium text-strong">Sending request…</div>
              <div className="mt-1 text-xs">Waiting for the server response.</div>
            </div>
          </div>
        )}
        {response && (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2 rounded-lg border border-edge bg-bar/40 p-3 text-xs">
              <span className={`rounded-lg bg-raised px-2 py-1 font-mono font-bold ${statusColor}`}>
                {response.status} {response.status_text}
              </span>
              <span className="rounded-lg bg-raised px-2 py-1 text-muted">{response.elapsed_ms} ms</span>
              <span className="rounded-lg bg-raised px-2 py-1 text-muted">
                {response.body.length.toLocaleString()} bytes{response.truncated && " (truncated)"}
              </span>
              <button
                className="ml-auto flex items-center gap-1 rounded-lg px-2 py-1 text-muted hover:bg-raised hover:text-strong"
                onClick={() => {
                  void navigator.clipboard.writeText(prettyBody);
                  toast(t("Copied"), "success");
                }}
              >
                <Copy size={12} /> Copy body
              </button>
            </div>
            <details className="rounded-lg border border-edge bg-bar/30 p-3 text-xs">
              <summary className="cursor-pointer text-muted hover:text-strong">
                Response headers ({response.headers.length})
              </summary>
              <div className="mt-2 space-y-1 font-mono">
                {response.headers.map(([k, v], i) => (
                  <div key={i} className="break-all rounded-lg bg-surface/60 px-2 py-1">
                    <span className="text-accent">{k}</span>: <span className="text-muted">{v}</span>
                  </div>
                ))}
              </div>
            </details>
            <pre className="whitespace-pre-wrap break-all rounded-lg border border-edge bg-raised p-3 font-mono text-xs leading-5 text-strong">
              {prettyBody}
            </pre>
          </div>
        )}
      </div>
    </div>
  );
}
