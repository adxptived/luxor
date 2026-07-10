/** Docker panel: containers, images, logs and lifecycle actions via the docker CLI. */

import { Box, Container, FileText, Loader2, Play, RefreshCw, RotateCw, Search, Square, TerminalSquare, Trash2, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";

import * as ipc from "@/lib/ipc";
import { t } from "@/lib/i18n";
import type { DockerContainer, DockerImage } from "@/lib/types";
import { errorMessage } from "@/lib/types";
import { useAppStore } from "@/state/appStore";
import { confirmDestructive } from "@/state/uiStore";

type Tab = "containers" | "images";

export function DockerPanel() {
  const toast = useAppStore((s) => s.toast);
  const [version, setVersion] = useState<string | null | undefined>(undefined);
  const [tab, setTab] = useState<Tab>("containers");
  const [containers, setContainers] = useState<DockerContainer[]>([]);
  const [images, setImages] = useState<DockerImage[]>([]);
  const [showAll, setShowAll] = useState(true);
  const [query, setQuery] = useState("");
  const [logsFor, setLogsFor] = useState<DockerContainer | null>(null);
  const [logs, setLogs] = useState("");
  const [busy, setBusy] = useState(false);
  const [execOpen, setExecOpen] = useState<DockerContainer | null>(null);
  const [execCmd, setExecCmd] = useState("");
  const [execOutput, setExecOutput] = useState("");
  const [execBusy, setExecBusy] = useState(false);

  const refresh = useCallback(async () => {
    setBusy(true);
    try {
      const v = await ipc.dockerVersion();
      setVersion(v);
      if (v) {
        const [cs, is] = await Promise.all([ipc.dockerContainers(showAll), ipc.dockerImages()]);
        setContainers(cs);
        setImages(is);
      }
    } catch (e) {
      toast(errorMessage(e), "error");
    } finally {
      setBusy(false);
    }
  }, [showAll, toast]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const filteredContainers = useMemo(() => {
    const q = query.toLowerCase().trim();
    if (!q) return containers;
    return containers.filter((c) => `${c.name} ${c.image} ${c.status} ${c.ports}`.toLowerCase().includes(q));
  }, [containers, query]);

  const filteredImages = useMemo(() => {
    const q = query.toLowerCase().trim();
    if (!q) return images;
    return images.filter((img) => `${img.repository} ${img.tag} ${img.id} ${img.created} ${img.size}`.toLowerCase().includes(q));
  }, [images, query]);

  const action = async (id: string, act: string, label: string) => {
    try {
      await ipc.dockerAction(id, act);
      toast(label, "success");
      await refresh();
    } catch (e) {
      toast(errorMessage(e), "error");
    }
  };

  const openLogs = async (c: DockerContainer) => {
    setLogsFor(c);
    setLogs(t("Loading…"));
    try {
      setLogs(await ipc.dockerLogs(c.id));
    } catch (e) {
      setLogs(errorMessage(e));
    }
  };

  const runExec = async () => {
    if (!execOpen || !execCmd.trim()) return;
    setExecBusy(true);
    setExecOutput("");
    try {
      const result = await ipc.dockerExec(execOpen.id, execCmd.trim());
      setExecOutput(result);
    } catch (e) {
      setExecOutput(errorMessage(e));
    } finally {
      setExecBusy(false);
    }
  };

  if (version === undefined) {
    return (
      <div className="flex h-full items-center justify-center bg-surface text-muted">
        <div className="rounded-lg border border-edge bg-bar/45 px-5 py-4 text-center shadow-sm">
          <Loader2 size={22} className="mx-auto mb-2 animate-spin text-accent" />
          <div className="font-medium text-strong">{t("Checking Docker…")}</div>
          <div className="mt-1 text-xs">Looking for the docker CLI.</div>
        </div>
      </div>
    );
  }

  if (version === null) {
    return (
      <div className="flex h-full flex-col items-center justify-center bg-surface p-6 text-center text-muted">
        <div className="max-w-md rounded-lg border border-edge bg-bar/40 p-5 shadow-sm">
          <div className="lx-empty-icon mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-lg border border-edge bg-raised text-accent">
            <Container size={28} />
          </div>
          <div className="text-sm font-medium text-strong">{t("Docker CLI not found")}</div>
          <div className="mt-1 text-xs leading-5">{t("Install Docker Desktop / Podman and make `docker` available in PATH")}</div>
          <button onClick={() => void refresh()} className="mt-3 inline-flex items-center gap-1.5 rounded-lg border border-edge px-3 py-1.5 text-xs hover:bg-raised hover:text-strong">
            <RefreshCw size={13} /> {t("Try again")}
          </button>
        </div>
      </div>
    );
  }

  if (logsFor) {
    return (
      <div className="flex h-full flex-col bg-surface text-sm">
        <div className="flex flex-wrap items-center gap-2 border-b border-edge bg-bar/55 p-3">
          <button onClick={() => setLogsFor(null)} className="rounded-lg border border-edge px-2 py-1 text-xs text-muted hover:bg-raised hover:text-strong">
            ← Back
          </button>
          <div className="min-w-0 flex-1">
            <div className="truncate font-medium text-strong">{logsFor.name}</div>
            <div className="truncate text-xs text-muted">{logsFor.image} · {logsFor.status}</div>
          </div>
          <button onClick={() => void openLogs(logsFor)} className="rounded-lg border border-edge px-2 py-1 text-muted hover:bg-raised hover:text-strong" title={t("Refresh logs")} aria-label={t("Refresh logs")}>
            <RefreshCw size={13} />
          </button>
        </div>
        <pre className="min-h-0 flex-1 overflow-auto whitespace-pre-wrap break-all bg-surface p-3 font-mono text-xs leading-5 text-strong">
          {logs || "(no output)"}
        </pre>
      </div>
    );
  }

  if (execOpen) {
    return (
      <div className="flex h-full flex-col bg-surface text-sm">
        <div className="flex flex-wrap items-center gap-2 border-b border-edge bg-bar/55 p-3">
          <button onClick={() => setExecOpen(null)} className="rounded-lg border border-edge px-2 py-1 text-xs text-muted hover:bg-raised hover:text-strong">
            ← Back
          </button>
          <div className="min-w-0 flex-1">
            <div className="truncate font-medium text-strong">{t("docker.exec_in", "Exec in")} {execOpen.name}</div>
            <div className="truncate text-xs text-muted">{execOpen.image}</div>
          </div>
        </div>
        <div className="flex items-center gap-2 border-b border-edge bg-bar/30 p-2">
          <span className="font-mono text-xs text-muted">$</span>
          <input
            autoFocus
            value={execCmd}
            onChange={(e) => setExecCmd(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") void runExec(); }}
            placeholder={t("docker.exec_placeholder", "e.g. sh -c 'ls -la'")}
            disabled={execBusy}
            className="flex-1 rounded-lg border border-edge bg-surface px-2 py-1.5 font-mono text-xs text-strong outline-none focus:border-accent disabled:opacity-50"
          />
          <button
            onClick={() => void runExec()}
            disabled={execBusy || !execCmd.trim()}
            className="rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-on-accent hover:opacity-90 disabled:opacity-40"
          >
            {execBusy ? <Loader2 size={13} className="animate-spin" /> : t("Run")}
          </button>
        </div>
        <pre className="min-h-0 flex-1 overflow-auto whitespace-pre-wrap break-all bg-surface p-3 font-mono text-xs leading-5 text-strong">
          {execOutput || t("docker.exec_empty", "Enter a command and press Run to execute inside the container.")}
        </pre>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col bg-surface text-sm">
      <div className="border-b border-edge bg-bar/55 p-3">
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <div className="flex min-w-0 flex-1 items-center gap-2">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-edge bg-raised text-accent">
              <Container size={17} />
            </span>
            <div className="min-w-0">
              <div className="font-semibold text-strong">Docker</div>
              <div className="truncate text-xs text-muted">docker {version}</div>
            </div>
          </div>
          <label className="flex cursor-pointer items-center gap-1.5 rounded-lg border border-edge bg-surface px-2 py-1.5 text-xs text-muted hover:text-strong">
            <input type="checkbox" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} className="accent-accent" />
            all containers
          </label>
          <button onClick={() => void refresh()} className="flex items-center gap-1.5 rounded-lg border border-edge px-2 py-1.5 text-xs text-muted hover:bg-raised hover:text-strong" disabled={busy}>
            <RefreshCw size={13} className={busy ? "animate-spin" : ""} /> Refresh
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="flex rounded-lg border border-edge bg-surface/70 p-1">
            {(["containers", "images"] as Tab[]).map((tId) => (
              <button
                key={tId}
                onClick={() => setTab(tId)}
                className={`rounded-lg px-3 py-1.5 text-xs capitalize ${tab === tId ? "bg-raised text-strong shadow-sm" : "text-muted hover:text-strong"}`}
              >
                {tId} <span className="opacity-70">{tId === "containers" ? containers.length : images.length}</span>
              </button>
            ))}
          </div>
          <span className="relative min-w-44 flex-1">
            <Search size={13} className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-muted" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={tab === "containers" ? t("Search containers…") : t("Search images…")}
              className="w-full rounded-lg border border-edge bg-surface py-1.5 pl-7 pr-7 text-xs text-strong outline-none placeholder:text-muted focus:border-accent/70"
            />
            {query && (
              <button className="absolute right-2 top-1/2 -translate-y-1/2 text-muted hover:text-strong" onClick={() => setQuery("")} aria-label={t("Clear search")} title={t("Clear search")}>
                <X size={13} />
              </button>
            )}
          </span>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-auto p-2">
        {tab === "containers" && (
          <div className="grid gap-2">
            {filteredContainers.map((c) => (
              <div key={c.id} className="flex min-w-0 flex-wrap items-center gap-2 rounded-lg border border-edge bg-bar/30 px-3 py-2 hover:border-accent/40 hover:bg-raised/30">
                <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${c.state === "running" ? "bg-success shadow-[0_0_10px_var(--lx-success-soft-strong)]" : "bg-muted"}`} />
                <div className="min-w-44 flex-1">
                  <div className="truncate font-medium text-strong">{c.name}</div>
                  <div className="truncate text-xs text-muted">
                    {c.image} · {c.status} {c.ports && `· ${c.ports}`}
                  </div>
                </div>
                <div className="ml-auto flex shrink-0 items-center gap-1">
                  <IconBtn title={t("Logs")} onClick={() => void openLogs(c)}>
                    <FileText size={13} />
                  </IconBtn>
                  {c.state === "running" && (
                    <IconBtn title={t("docker.exec", "Exec")} onClick={() => { setExecOpen(c); setExecCmd(""); setExecOutput(""); }}>
                      <TerminalSquare size={13} />
                    </IconBtn>
                  )}
                  {c.state === "running" ? (
                    <>
                      <IconBtn title={t("Restart")} onClick={() => void action(c.id, "restart", `${t("Restarted")} ${c.name}`)}>
                        <RotateCw size={13} />
                      </IconBtn>
                      <IconBtn title={t("Stop")} onClick={() => void action(c.id, "stop", `${t("Stopped")} ${c.name}`)}>
                        <Square size={13} />
                      </IconBtn>
                    </>
                  ) : (
                    <>
                      <IconBtn title={t("Start")} onClick={() => void action(c.id, "start", `${t("Started")} ${c.name}`)}>
                        <Play size={13} />
                      </IconBtn>
                      <IconBtn
                        title={t("Remove")}
                        danger
                        onClick={() =>
                          void confirmDestructive({ title: t("Remove container"), message: `${t("Remove container")} ${c.name}?` }).then(
                            (ok) => { if (ok) void action(c.id, "rm", `${t("Removed")} ${c.name}`); },
                          )
                        }
                      >
                        <Trash2 size={13} />
                      </IconBtn>
                    </>
                  )}
                </div>
              </div>
            ))}
            {containers.length === 0 && <Empty icon={<Container size={24} />} title={t("No containers")} text={t("Run or create containers and they will appear here.")} />}
            {containers.length > 0 && filteredContainers.length === 0 && <Empty icon={<Search size={24} />} title={t("No matching containers")} text={t("Clear search or try another name, image, status or port.")} />}
          </div>
        )}

        {tab === "images" && (
          <div className="grid gap-2">
            {filteredImages.map((img) => (
              <div key={`${img.id}-${img.tag}`} className="flex min-w-0 items-center gap-2 rounded-lg border border-edge bg-bar/30 px-3 py-2 hover:border-accent/40 hover:bg-raised/30">
                <Box size={15} className="shrink-0 text-accent" />
                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium text-strong">
                    {img.repository}
                    <span className="text-muted">:{img.tag}</span>
                  </div>
                  <div className="text-xs text-muted">
                    {img.size} · {img.created}
                  </div>
                </div>
                <IconBtn
                  title={t("Remove image")}
                  danger
                  onClick={() =>
                    void confirmDestructive({ title: t("Remove image"), message: `${t("Remove image")} ${img.repository}:${img.tag}?` }).then(
                      (ok) => { if (ok) void action(img.id, "rmi", t("Image removed")); },
                    )
                  }
                >
                  <Trash2 size={13} />
                </IconBtn>
              </div>
            ))}
            {images.length === 0 && <Empty icon={<Box size={24} />} title={t("No images")} text={t("Pulled or built images will appear here.")} />}
            {images.length > 0 && filteredImages.length === 0 && <Empty icon={<Search size={24} />} title={t("No matching images")} text={t("Clear search or try another repository/tag.")} />}
          </div>
        )}
      </div>
    </div>
  );
}

function IconBtn({
  title,
  onClick,
  danger,
  children,
}: {
  title: string;
  onClick: () => void;
  danger?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      title={title}
      aria-label={title}
      onClick={onClick}
      className={`shrink-0 rounded-lg p-1.5 text-muted transition-colors hover:bg-raised ${danger ? "hover:text-danger" : "hover:text-strong"}`}
    >
      {children}
    </button>
  );
}

function Empty({ icon, title, text }: { icon: ReactNode; title: string; text: string }) {
  return (
    <div className="rounded-lg border border-dashed border-edge bg-bar/30 px-5 py-10 text-center text-muted">
      <div className="lx-empty-icon mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-lg border border-edge bg-raised text-accent">{icon}</div>
      <div className="font-medium text-strong">{title}</div>
      <div className="mx-auto mt-1 max-w-xs text-xs leading-5">{text}</div>
    </div>
  );
}
