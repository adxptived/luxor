/**
 * Dev Tools panel: .env inspector, log viewer, disk usage, dependencies
 * (update + vulnerability check), process viewer, HTML preview and crash reports.
 */

import {
  AlertTriangle,
  AppWindow,
  Bug,
  Code2,
  Copy,
  Cpu,
  Eye,
  EyeOff,
  ExternalLink,
  FileWarning,
  FolderOpen,
  GitBranch,
  HardDrive,
  Package,
  Play,
  RefreshCw,
  Rocket,
  ScrollText,
  Search,
  TerminalSquare,
  Activity,
  Square,
  Sparkles,
  Layers,
  type LucideIcon,
} from "lucide-react";
import { useCallback, useEffect, useState, useRef } from "react";

import { NoFolderCta } from "@/components/NoFolderCta";
import { useDockStore } from "@/layout/dockStore";
import { t } from "@/lib/i18n";
import { isFileManagerIde, isSystemDefaultIde, mergeIdeActions, resolveDefaultIde } from "@/lib/ideActions";
import * as ipc from "@/lib/ipc";
import { buildRunGroups, exeName, exeProfile, type ProjectProbe, type RunGroup } from "@/lib/runDetect";
import type {
  CrashReport,
  DepManifest,
  DetectedIde,
  DiskUsageReport,
  EnvFile,
  ProcessNode,
  VulnAdvisory,
} from "@/lib/types";
import { errorMessage } from "@/lib/types";
import { useElementWidth } from "@/lib/useElementWidth";
import { useAppStore } from "@/state/appStore";
import { useActiveProject } from "@/state/projectsStore";
import { confirmDestructive } from "@/state/uiStore";
import { startPerfCollection, stopPerfCollection, getPerfSamples, getPerfSummary, clearPerfSamples, subscribePerf, type PerfSample, type PerfSummary } from "@/lib/perfMetrics";
import { subscribeLogs, getLogsFiltered, clearLogs, type LogLine, type LogLevel } from "@/lib/logBuffer";

type Tab = "run" | "html" | "env" | "logs" | "disk" | "deps" | "procs" | "perf" | "crashes";

const TABS: { id: Tab; label: string; icon: LucideIcon }[] = [
  { id: "run", label: "Run", icon: Rocket },
  { id: "html", label: "HTML Preview", icon: AppWindow },
  { id: "env", label: ".env", icon: FileWarning },
  { id: "logs", label: "Logs", icon: ScrollText },
  { id: "disk", label: "Disk", icon: HardDrive },
  { id: "deps", label: "Deps", icon: Package },
  { id: "procs", label: "Processes", icon: Cpu },
  { id: "perf", label: "Perf", icon: Activity },
  { id: "crashes", label: "Crashes", icon: Bug },
];

export function DevToolsPanel() {
  const project = useActiveProject();
  const [tab, setTab] = useState<Tab>("run");
  const root = project?.path || "";
  const needsProject = tab !== "procs" && tab !== "crashes" && tab !== "logs";
  const { ref, width } = useElementWidth<HTMLDivElement>();
  const compact = width > 0 && width < 430;

  return (
    <div ref={ref} className="flex h-full flex-col bg-surface text-sm">
      <div className="flex gap-1 overflow-x-auto border-b border-edge bg-bar/55 px-2 py-2 lx-noscrollbar select-none">
        {TABS.map((tb) => {
          const Icon = tb.icon;
          const active = tab === tb.id;
          return (
            <button
              key={tb.id}
              onClick={() => setTab(tb.id)}
              title={compact ? t(tb.label) : undefined}
              aria-label={t(tb.label)}
              className={`flex shrink-0 items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs transition duration-150 ${
                active
                  ? "border-accent bg-accent/10 text-accent font-semibold shadow-sm"
                  : "border-edge bg-surface text-muted hover:bg-raised hover:text-strong hover:border-muted"
              }`}
            >
              <Icon size={13} className={active ? "text-accent" : ""} />
              {!compact && <span>{t(tb.label)}</span>}
            </button>
          );
        })}
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        {needsProject && (!project || root === "") ? (
          <NoFolderCta hint={t("Attach a folder to use the dev tools.")} />
        ) : (
          <>
            {tab === "run" && <RunTab root={root} compact={compact} />}
            {tab === "html" && <HtmlTab root={root} />}
            {tab === "env" && <EnvTab root={root} />}
            {tab === "logs" && <LogsTab root={root} />}
            {tab === "disk" && <DiskTab root={root} />}
            {tab === "deps" && <DepsTab root={root} />}
            {tab === "procs" && <ProcsTab />}
            {tab === "perf" && <PerfTab />}
            {tab === "crashes" && <CrashesTab />}
          </>
        )}
      </div>
    </div>
  );
}

/**
 * HTML Preview tab. Scans the active project for HTML files and lets you preview
 * them inside Luxor using Tauri asset protocol or iframe. If no HTML files exist,
 * helps you create a demo.html template to get started with a single click.
 */
function HtmlTab({ root }: { root: string }) {
  const toast = useAppStore((s) => s.toast);
  const openFile = useDockStore((s) => s.openFile);
  const [files, setFiles] = useState<string[]>([]);
  const [scanning, setScanning] = useState(false);
  const [creatingDemo, setCreatingDemo] = useState(false);

  const scan = useCallback(async () => {
    setScanning(true);
    try {
      const scanDir = async (dir: string, depth = 0): Promise<string[]> => {
        if (depth > 4) return [];
        try {
          const entries = await ipc.fsListDir(dir);
          const htmls: string[] = [];
          for (const entry of entries) {
            if (entry.is_dir) {
              const lower = entry.name.toLowerCase();
              if (["node_modules", "target", ".git", "src-tauri", ".svelte-kit", ".next", "dist", "build", "tmp", ".nuxt"].includes(lower)) continue;
              htmls.push(...(await scanDir(entry.path, depth + 1)));
            } else if (entry.name.toLowerCase().endsWith(".html") || entry.name.toLowerCase().endsWith(".htm")) {
              htmls.push(entry.path);
            }
          }
          return htmls;
        } catch { return []; }
      };
      setFiles(await scanDir(root));
    } catch (e) {
      toast(errorMessage(e), "error");
    } finally {
      setScanning(false);
    }
  }, [root, toast]);

  useEffect(() => { void scan(); }, [scan]);

  const openPreview = (filePath: string) => {
    openFile(filePath);
  };

  const createDemo = async () => {
    setCreatingDemo(true);
    const demoPath = `${root}/demo.html`;
    const demoHtml = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Luxor HTML Preview Demo</title>
  <style>
    body { font-family: system-ui, sans-serif; background: #0d1117; color: #c9d1d9; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; padding: 20px; box-sizing: border-box; }
    .card { background: #161b22; border: 1px solid #30363d; border-radius: 12px; padding: 32px; max-width: 520px; width: 100%; text-align: center; box-shadow: 0 10px 25px rgba(0,0,0,0.4); }
    h1 { color: #e8b059; margin: 0 0 12px; font-size: 26px; }
    p { color: #8b949e; line-height: 1.6; font-size: 15px; margin: 0 0 20px; }
    .badge { display: inline-block; background: #1f6feb; color: #fff; padding: 4px 14px; border-radius: 20px; font-size: 11px; font-weight: 600; margin-bottom: 20px; letter-spacing: 0.04em; }
    .btn { background: #e8b059; color: #0d1117; border: none; padding: 12px 28px; border-radius: 8px; font-weight: 700; font-size: 14px; cursor: pointer; transition: background 0.2s; }
    .btn:hover { background: #ffd173; }
    .footer { margin-top: 24px; font-size: 11px; color: #484f58; }
  </style>
</head>
<body>
  <div class="card">
    <div class="badge">Luxor Live HTML Preview</div>
    <h1>\u26a1 Luxor Live Sandbox \u26a1</h1>
    <p>This page renders in real time. Edit it in the <strong>Source</strong> tab or your editor, then hit the <strong>Refresh</strong> button to see changes instantly.</p>
    <button class="btn" onclick="this.textContent='\u2714 It works!'">Click to test interactivity</button>
    <div class="footer">Created automatically by Luxor DevTools • Auto-refresh available</div>
  </div>
</body>
</html>`;
    try {
      await ipc.fsWriteText(demoPath, demoHtml);
      toast("demo.html created!", "success");
      await scan();
      openPreview(demoPath);
    } catch (e) {
      toast(`Failed to create demo: ${errorMessage(e)}`, "error");
    } finally {
      setCreatingDemo(false);
    }
  };

  const getRelPath = (abs: string) => abs.replace(root, "").replace(/^[\\/]/, "");

  return (
    <div className="flex h-full flex-col">
      <Header onRefresh={scan} busy={scanning}>
        <AppWindow size={13} className="text-accent" />
        <span className="font-semibold text-strong">HTML Preview Engine</span>
        {scanning && <span className="text-xs text-muted animate-pulse ml-1">{t("Scanning…")}</span>}
        <span className="text-xs text-muted ml-1">({files.length} found)</span>
      </Header>

      {files.length === 0 && !scanning ? (
        <div className="m-3 flex flex-col items-center justify-center rounded-lg border border-dashed border-edge bg-bar/25 px-6 py-10 text-center">
          <AppWindow size={40} className="text-muted mb-3 opacity-35" />
          <div className="text-strong font-semibold mb-1">{t("No HTML pages found")}</div>
          <p className="text-muted text-xs max-w-sm mb-5 leading-relaxed">
            {t("No .html or .htm files were found in this project. Generate a demo template to try live preview, or create an HTML file manually in the Files panel.")}
          </p>
          <button
            onClick={() => void createDemo()}
            disabled={creatingDemo}
            className="flex items-center gap-1.5 rounded-lg border border-accent/35 bg-accent/10 px-4 py-2 text-xs font-semibold text-accent hover:bg-accent/15 transition disabled:opacity-40"
          >
            <Sparkles size={13} /> {creatingDemo ? t("Creating…") : t("Generate demo.html")}
          </button>
        </div>
      ) : (
        <div className="p-2 space-y-1.5">
          <div className="px-1 pb-1 text-[10px] uppercase tracking-widest font-bold text-muted">
            Click a page to open it as a preview tab with Source ↔ View toggle and auto-refresh
          </div>
          {files.map((f) => (
            <button
              key={f}
              onClick={() => openPreview(f)}
              className="group flex w-full items-center gap-3 px-3 py-2.5 rounded-lg border border-edge bg-surface text-left hover:border-accent/40 hover:bg-raised transition duration-150 shadow-sm"
            >
              <AppWindow size={14} className="text-accent shrink-0 group-hover:scale-110 transition-transform" />
              <div className="flex-1 min-w-0">
                <div className="font-mono text-xs font-semibold text-strong truncate">{getRelPath(f).split(/[/\\]/).pop()}</div>
                <div className="font-mono text-[10px] text-muted truncate mt-0.5">{getRelPath(f)}</div>
              </div>
              <div className="shrink-0 flex items-center gap-1 text-[10px] text-muted">
                <Eye size={11} className="text-accent opacity-50 group-hover:opacity-100 group-focus-within:opacity-100 transition" />
                <span className="hidden group-hover:block group-focus-within:block text-accent font-medium">Open preview →</span>
              </div>
            </button>
          ))}
          <button
            onClick={() => void createDemo()}
            disabled={creatingDemo}
            className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-edge px-3 py-2 text-xs text-muted hover:border-accent hover:text-accent transition disabled:opacity-40 mt-2"
          >
            <Sparkles size={12} /> {creatingDemo ? t("Creating…") : t("Add demo.html template")}
          </button>
        </div>
      )}
    </div>
  );
}

function RunTab({ root, compact }: { root: string; compact: boolean }) {
  const toast = useAppStore((s) => s.toast);
  const config = useAppStore((s) => s.config);
  const addTerminal = useDockStore((s) => s.addTerminal);
  const openPanel = useDockStore((s) => s.openPanel);
  const [ides, setIdes] = useState<DetectedIde[]>([]);
  const [groups, setGroups] = useState<RunGroup[]>([]);
  const [exes, setExes] = useState<string[]>([]);
  const [exeQuery, setExeQuery] = useState("");
  const [probing, setProbing] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [lastCommand, setLastCommand] = useState<string | null>(null);

  const probe = useCallback(async () => {
    setProbing(true);
    try {
      const entries = await ipc.fsListDir(root).catch(() => []);
      const present = entries.filter((e) => !e.is_dir).map((e) => e.name.toLowerCase());
      const readIf = async (name: string): Promise<string | null> =>
        present.includes(name.toLowerCase()) ? await ipc.fsReadText(`${root}/${name}`, 65536).then((f) => f.content).catch(() => null) : null;
      const p: ProjectProbe = {
        cargoToml: await readIf("Cargo.toml"),
        packageJson: await readIf("package.json"),
        makefile: (await readIf("Makefile")) ?? (await readIf("makefile")),
        pyproject: await readIf("pyproject.toml"),
        goMod: present.includes("go.mod"),
        requirementsTxt: present.includes("requirements.txt"),
        mainPy: present.includes("main.py"),
        present,
      };
      setGroups(buildRunGroups(p));
    } finally {
      setProbing(false);
    }
  }, [root]);

  const scan = useCallback(async () => {
    setScanning(true);
    try {
      setExes(await ipc.launcherFindExecutables(root, 120));
    } catch {
      setExes([]);
    } finally {
      setScanning(false);
    }
  }, [root]);

  useEffect(() => {
    void ipc.launcherDetectIdes().then(setIdes, () => setIdes([]));
  }, []);

  useEffect(() => {
    setExes([]);
    setExeQuery("");
    void probe();
    void scan();
  }, [probe, scan]);

  const refreshAll = () => {
    void probe();
    void scan();
  };

  const runInTerminal = (cmd: string) => {
    setLastCommand(cmd);
    addTerminal({ cwd: root, autorun: [cmd] });
  };

  const openExternalTerminal = () =>
    ipc.launcherOpenTerminal(root).catch((e: unknown) => toast(`${t("Terminal")} failed: ${errorMessage(e)}`, "error"));

  const openIde = (ide?: string) => {
    const target = ide ?? defaultIde?.command;
    const label = defaultIde && target === defaultIde.command ? t(defaultIde.label) : t(ideActions.find((i) => i.command === target)?.label ?? "IDE");
    const action = isSystemDefaultIde(target)
      ? ipc.launcherOpenDefaultApp(root)
      : isFileManagerIde(target)
        ? ipc.launcherOpenFileManager(root)
        : ipc.launcherOpenIde(root, target);
    void action.then(
      () => toast(`${t("Opening in")} ${label}`, "success"),
      (e: unknown) => toast(`${t("Open IDE")} failed: ${errorMessage(e)}`, "error"),
    );
  };

  const runExe = (exe: string) => {
    setLastCommand(exe);
    ipc.launcherRunExecutable(root, exe).catch((e: unknown) => toast(`${t("Run")} failed: ${errorMessage(e)}`, "error"));
  };

  const openExe = (exe: string) =>
    ipc.launcherOpenDefaultApp(exe).catch((e: unknown) => toast(`${t("Open")} failed: ${errorMessage(e)}`, "error"));

  const openFolder = (exe: string) => {
    const dir = exe.replace(/\\/g, "/").replace(/\/[^/]+$/, "");
    void ipc.launcherOpenFileManager(dir).catch((e: unknown) => toast(errorMessage(e), "error"));
  };

  const copyPath = async (exe: string) => {
    try {
      await navigator.clipboard.writeText(exe);
      toast(t("Path copied"), "success");
    } catch (e) {
      toast(errorMessage(e), "error");
    }
  };

  const matchesExeQuery = (exe: string) => {
    const q = exeQuery.trim().toLowerCase();
    if (!q) return true;
    const hay = `${exeName(exe)} ${relativeExePath(root, exe)} ${exe}`.toLowerCase();
    return q.split(/\s+/).every((part) => hay.includes(part));
  };

  const filteredExes = exes.filter(matchesExeQuery);
  const ideActions: DetectedIde[] = mergeIdeActions(config?.custom_ides, ides, false);
  const defaultIde = resolveDefaultIde(mergeIdeActions(config?.custom_ides, ides, true), config?.default_ide ?? null);
  const defaultIdeLabel = defaultIde ? t(defaultIde.label) : t("IDE");
  const visibleIdeActions = ideActions.filter((ide) => ide.command !== defaultIde?.command);

  return (
    <div className="p-2 space-y-3">
      <Header onRefresh={refreshAll} busy={probing || scanning}>
        <Rocket size={13} className="text-accent animate-pulse" /> {groups.length === 0 && !probing ? t("No known toolchain detected") : t("Run, build & EXE launcher")}
      </Header>

      {lastCommand && (
        <div className="rounded-lg border border-accent/25 bg-accent/5 p-2 flex items-center justify-between text-xs transition duration-150">
          <div className="flex items-center gap-2 min-w-0">
            <span className="font-semibold text-accent shrink-0">{t("Last command:")}</span>
            <code className="font-mono bg-bar/30 px-1.5 py-0.5 rounded text-strong truncate max-w-sm md:max-w-md">{lastCommand}</code>
          </div>
          <button
            onClick={() => runInTerminal(lastCommand)}
            className="flex items-center gap-1 text-accent hover:text-strong hover:bg-accent/15 px-2 py-1 rounded transition font-semibold"
          >
            <Play size={11} /> {t("Re-run")}
          </button>
        </div>
      )}

      <div className="rounded-lg border border-edge bg-bar/35 p-2.5 shadow-sm">
        <div className="mb-2 flex flex-wrap items-start gap-2">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted">
              <Code2 size={13} className="text-accent" /> {t("IDE workspace actions")}
            </div>
            <div className="mt-1 text-xs leading-5 text-muted">
              {t("Open the project in a real IDE flow: files, search, git, terminal, explorer or a detected external editor from one place.")}
            </div>
          </div>
        </div>
        <div className="flex flex-wrap gap-1.5">
          <button
            onClick={() => openIde()}
            disabled={!defaultIde}
            title={`${t("Open project in")} ${defaultIdeLabel}`}
            className="flex items-center gap-1 rounded-lg border border-accent/30 bg-accent/10 px-2.5 py-1.5 text-xs font-medium text-accent hover:bg-accent/15 disabled:opacity-40"
          >
            <AppWindow size={13} /> {t("Open in")} {defaultIdeLabel}
          </button>
          <button onClick={() => openPanel("files")} className="flex items-center gap-1 rounded-lg border border-edge bg-surface px-2.5 py-1.5 text-xs hover:border-accent hover:text-accent">
            <FolderOpen size={13} /> {t("Files")}
          </button>
          <button onClick={() => openPanel("search")} className="flex items-center gap-1 rounded-lg border border-edge bg-surface px-2.5 py-1.5 text-xs hover:border-accent hover:text-accent">
            <Search size={13} /> {t("Search")}
          </button>
          <button onClick={() => openPanel("git")} className="flex items-center gap-1 rounded-lg border border-edge bg-surface px-2.5 py-1.5 text-xs hover:border-accent hover:text-accent">
            <GitBranch size={13} /> {t("Git")}
          </button>
          <button onClick={() => addTerminal({ cwd: root })} className="flex items-center gap-1 rounded-lg border border-edge bg-surface px-2.5 py-1.5 text-xs hover:border-accent hover:text-accent">
            <TerminalSquare size={13} /> {t("Terminal tab")}
          </button>
          <button onClick={openExternalTerminal} className="flex items-center gap-1 rounded-lg border border-edge bg-surface px-2.5 py-1.5 text-xs hover:border-accent hover:text-accent">
            <ExternalLink size={13} /> {t("External terminal")}
          </button>
          <button onClick={() => void ipc.launcherOpenFileManager(root).catch((e: unknown) => toast(errorMessage(e), "error"))} className="flex items-center gap-1 rounded-lg border border-edge bg-surface px-2.5 py-1.5 text-xs hover:border-accent hover:text-accent">
            <FolderOpen size={13} /> {t("Explorer")}
          </button>
          {visibleIdeActions.slice(0, compact ? 2 : 5).map((ide) => (
            <button key={ide.command} onClick={() => openIde(ide.command)} title={ide.command} className="flex items-center gap-1 rounded-lg border border-accent/25 bg-accent/10 px-2.5 py-1.5 text-xs text-accent hover:bg-accent/15">
              <Code2 size={13} /> {ide.label}
            </button>
          ))}
          {ideActions.length === 0 && !defaultIde && (
            <button onClick={() => openIde()} className="flex items-center gap-1 rounded-lg border border-edge bg-surface px-2.5 py-1.5 text-xs hover:border-accent hover:text-accent">
              <Code2 size={13} /> {t("Open IDE")}
            </button>
          )}
        </div>
      </div>

      <div className="rounded-lg border border-edge bg-bar/35 p-2.5 shadow-sm">
        <div className="flex flex-wrap items-start gap-2">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted">
              <Search size={13} className="text-accent" /> {t("Find executable")}
            </div>
            <div className="mt-1 text-xs leading-5 text-muted">
              {t("Luxor scans build folders and nested project outputs for .exe / runnable files, then lets you run, open, reveal or copy them immediately.")}
            </div>
          </div>
          <button
            onClick={() => void scan()}
            disabled={scanning}
            className="shrink-0 rounded-lg border border-edge bg-surface px-2.5 py-1.5 text-xs hover:border-accent hover:text-accent disabled:opacity-40 transition"
          >
            {scanning ? t("Scanning…") : t("Rescan EXE")}
          </button>
        </div>
        <div className="mt-2 flex min-w-0 items-center gap-2 rounded-lg border border-edge bg-surface px-2 py-1.5 focus-within:border-transparent">
          <Search size={13} className="shrink-0 text-muted" />
          <input
            value={exeQuery}
            onChange={(e) => setExeQuery(e.target.value)}
            placeholder={t("Filter by name or path…")}
            className="min-w-0 flex-1 bg-transparent font-mono text-xs text-strong outline-none placeholder:text-muted"
            spellCheck={false}
          />
          <span className="shrink-0 rounded-lg bg-raised px-2 py-0.5 text-[11px] text-muted">
            {filteredExes.length}/{exes.length}
          </span>
        </div>
      </div>

      {exes.length > 0 && (
        <div className="flex flex-col gap-1">
          {filteredExes.map((exe) => {
            const profile = exeProfile(exe);
            const rel = relativeExePath(root, exe);
            return (
              <div key={exe} className="group flex items-center gap-2 rounded-lg border border-edge bg-surface px-2.5 py-2 hover:border-accent/40 hover:bg-raised/80 transition duration-150">
                <Play size={12} className="shrink-0 text-accent animate-pulse" />
                <div className="min-w-0 flex-1">
                  <div className="flex min-w-0 items-center gap-1.5">
                    <span className="truncate font-mono text-xs font-medium text-strong" title={exe}>
                      {exeName(exe)}
                    </span>
                    {profile && (
                      <span className={`shrink-0 rounded px-1 text-[10px] ${profile === "release" ? "bg-raised text-strong font-semibold" : "bg-raised text-muted"}`}>
                        {profile}
                      </span>
                    )}
                    {/\.(exe|cmd|bat|com)$/i.test(exe) && (
                      <span className="shrink-0 rounded bg-success-soft px-1.5 text-[10px] text-success">Windows</span>
                    )}
                  </div>
                  {!compact && <div className="truncate font-mono text-[11px] text-muted" title={rel}>{rel}</div>}
                </div>
                <div className="flex items-center gap-0.5">
                  <button onClick={() => void runExe(exe)} title={t("Run detached")} className="shrink-0 rounded-lg p-1 text-muted hover:bg-surface hover:text-accent transition">
                    <Play size={14} />
                  </button>
                  <button onClick={() => void openExe(exe)} title={t("Open with default app")} className="shrink-0 rounded-lg p-1 text-muted hover:bg-surface hover:text-accent transition">
                    <ExternalLink size={14} />
                  </button>
                  {!compact && (
                    <button onClick={() => runInTerminal(quotePath(exe))} title={t("Run in a new terminal tab")} className="shrink-0 rounded-lg p-1 text-muted hover:bg-surface hover:text-strong transition">
                      <TerminalSquare size={14} />
                    </button>
                  )}
                  <button onClick={() => openFolder(exe)} title={t("Open containing folder")} className="shrink-0 rounded-lg p-1 text-muted hover:bg-surface hover:text-strong transition">
                    <FolderOpen size={14} />
                  </button>
                  {!compact && (
                    <button onClick={() => void copyPath(exe)} title={t("Copy full path")} className="shrink-0 rounded-lg p-1 text-muted opacity-60 hover:bg-surface hover:text-strong group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100 transition">
                      <Copy size={14} />
                    </button>
                  )}
                </div>
              </div>
            );
          })}
          {filteredExes.length === 0 && !scanning && (
            <EmptyToolState icon={Search} title={t("No executable matches this filter")} text={t("Clear the filter or rescan after building the project.")} />
          )}
        </div>
      )}

      {exes.length === 0 && !scanning && (
        <EmptyToolState icon={ExternalLink} title={t("No built executables found")} text={t("Build the project, then rescan. Luxor checks target/debug, target/release, src-tauri/target, bin, dist and nested output folders.")} />
      )}

      {groups.map((g) => (
        <div key={g.tool} className="rounded-lg border border-edge bg-bar/15 p-2.5">
          <div className="mb-2 px-1 text-xs font-semibold uppercase tracking-wide text-muted flex items-center gap-1.5">
            <Layers size={12} className="text-accent" />
            {g.tool}
          </div>
          <div className="flex flex-wrap gap-1.5">
            {g.commands.map((c) => (
              <button
                key={c.cmd}
                onClick={() => runInTerminal(c.cmd)}
                title={`${c.hint ? c.hint + " · " : ""}${c.cmd}`}
                className="flex items-center gap-1.5 rounded-lg border border-edge bg-surface px-2.5 py-1.5 font-mono text-xs hover:border-accent hover:bg-raised transition duration-150 text-strong"
              >
                <Play size={11} className="text-accent" />
                {c.label}
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function relativeExePath(root: string, exe: string): string {
  const normalize = (v: string) => v.replace(/\\/g, "/").replace(/\/+$/, "");
  const r = normalize(root);
  const e = normalize(exe);
  return e.startsWith(`${r}/`) ? e.slice(r.length + 1) : e;
}

function quotePath(path: string): string {
  return `"${path.replace(/"/g, '\\"')}"`;
}

function fmtBytes(n: number): string {
  if (n >= 1024 ** 3) return `${(n / 1024 ** 3).toFixed(1)} GB`;
  if (n >= 1024 ** 2) return `${(n / 1024 ** 2).toFixed(1)} MB`;
  if (n >= 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${n} B`;
}

function Header({
  children,
  onRefresh,
  busy = false,
}: {
  children: React.ReactNode;
  onRefresh?: () => void;
  /** Spins the refresh icon and blocks re-triggering while a load runs (PN-05). */
  busy?: boolean;
}) {
  return (
    <div className="m-2 flex flex-wrap items-center gap-2 rounded-lg border border-edge bg-bar/45 px-3 py-2 text-xs text-muted">
      <div className="flex items-center gap-2 flex-1 min-w-0">
        {children}
      </div>
      {onRefresh && (
        <button
          onClick={onRefresh}
          disabled={busy}
          className="shrink-0 rounded-lg border border-edge bg-surface p-1.5 hover:bg-raised hover:text-strong transition disabled:opacity-50"
          title={busy ? t("Refreshing…") : t("Refresh")}
          aria-busy={busy}
        >
          <RefreshCw size={13} className={busy ? "lx-anim-spin" : undefined} />
        </button>
      )}
    </div>
  );
}

function EmptyToolState({ icon: Icon, title, text }: { icon: LucideIcon; title: string; text?: string }) {
  return (
    <div className="m-2 rounded-lg border border-dashed border-edge bg-bar/30 px-5 py-8 text-center text-xs text-muted">
      <div className="lx-empty-icon mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-lg border border-edge bg-raised text-accent">
        <Icon size={22} />
      </div>
      <div className="font-medium text-strong">{title}</div>
      {text && <div className="mx-auto mt-1 max-w-md leading-5">{text}</div>}
    </div>
  );
}

function EnvTab({ root }: { root: string }) {
  const [files, setFiles] = useState<EnvFile[]>([]);
  const [reveal, setReveal] = useState(false);
  const load = useCallback(() => void ipc.envFiles(root).then(setFiles).catch(() => setFiles([])), [root]);
  useEffect(load, [load]);

  return (
    <div className="space-y-3">
      <Header onRefresh={load}>
        <FileWarning size={13} className="text-warning" /> 
        <span className="font-semibold text-strong">{files.length} env file(s) found</span>
        <button onClick={() => setReveal((v) => !v)} className="ml-3 flex items-center gap-1 hover:text-strong hover:bg-raised px-2 py-1 rounded transition text-xs">
          {reveal ? <EyeOff size={12} /> : <Eye size={12} />} {reveal ? "Hide values" : "Show values"}
        </button>
      </Header>
      {files.length === 0 && <EmptyToolState icon={FileWarning} title={t("No .env files at project root")} text={t("Create .env or .env.example to review variables and missing keys here.")} />}
      {files.map((f) => (
        <div key={f.path} className="mx-2 p-3 rounded-lg border border-edge bg-bar/15 shadow-sm">
          <div className="font-semibold text-strong border-b border-edge pb-1.5 mb-2">{f.path}</div>
          {f.missing_keys.length > 0 && (
            <div className="mb-2.5 flex items-center gap-1.5 text-xs text-warning bg-warning-soft border border-warning-soft-strong px-2 py-1 rounded">
              <AlertTriangle size={12} /> 
              <span>missing vs .env.example: <strong>{f.missing_keys.join(", ")}</strong></span>
            </div>
          )}
          <div className="space-y-1.5 font-mono text-xs">
            {f.vars.map((v) => (
              <div key={v.key} className="flex gap-2 items-center hover:bg-raised/40 px-1 py-0.5 rounded transition">
                <span className="text-accent font-semibold">{v.key}</span>
                <span className="text-muted shrink-0">=</span>
                <span className="truncate text-strong font-medium">
                  {reveal ? v.value : "•".repeat(Math.min(v.value.length, 12)) || <span className="italic text-muted/50">(empty)</span>}
                </span>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function LogsTab({ root: _root }: { root: string }) {
  const [logs, setLogs] = useState<LogLine[]>([]);
  const [filterText, setFilterText] = useState("");
  const [minLvl, setMinLvl] = useState<LogLevel>("DEBUG");
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const updateLogs = () => {
      setLogs(getLogsFiltered(minLvl));
    };
    updateLogs();
    const unsub = subscribeLogs(updateLogs);
    return unsub;
  }, [minLvl]);

  useEffect(() => {
    if (bottomRef.current) {
      bottomRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [logs]);

  const filteredLogs = logs.filter((l) => {
    if (!filterText) return true;
    return l.text.toLowerCase().includes(filterText.toLowerCase());
  });

  const getLevelColor = (level: LogLevel) => {
    switch (level) {
      case "ERROR": return "text-danger font-semibold";
      case "WARN": return "text-warning font-semibold";
      case "INFO": return "text-success";
      case "DEBUG": return "text-info";
      default: return "text-muted";
    }
  };

  const getCategoryBadge = (category: string) => {
    return (
      <span className="px-1 py-0.5 rounded bg-raised text-[9px] text-muted border border-edge font-mono tracking-wide">
        {category}
      </span>
    );
  };

  return (
    <div className="flex h-full flex-col">
      <Header onRefresh={() => setLogs(getLogsFiltered(minLvl))}>
        <ScrollText size={13} className="text-accent" />
        <span className="font-semibold text-strong">System & Agent Live Console</span>
        <button
          onClick={() => { clearLogs(); setLogs([]); }}
          className="ml-auto rounded border border-edge px-2 py-0.5 hover:text-strong transition text-[11px]"
        >
          {t("Clear console")}
        </button>
      </Header>

      {/* Toolbar */}
      <div className="px-2 pb-2 flex flex-wrap gap-2 border-b border-edge bg-bar/10">
        <div className="flex min-w-0 flex-1 items-center gap-2 rounded-lg border border-edge bg-surface px-2 py-1 focus-within:border-transparent">
          <Search size={12} className="shrink-0 text-muted" />
          <input
            value={filterText}
            onChange={(e) => setFilterText(e.target.value)}
            placeholder={t("Search live logs…")}
            className="min-w-0 flex-1 bg-transparent font-mono text-[11px] text-strong outline-none placeholder:text-muted"
          />
        </div>
        <select
          value={minLvl}
          onChange={(e) => setMinLvl(e.target.value as LogLevel)}
          className="rounded-lg border border-edge bg-surface px-2 py-1 text-xs text-strong outline-none focus:border-accent"
        >
          <option value="DEBUG">DEBUG & Above</option>
          <option value="INFO">INFO & Above</option>
          <option value="WARN">WARN & Above</option>
          <option value="ERROR">ERROR Only</option>
        </select>
      </div>

      {/* Log Feed */}
      <div className="flex-1 overflow-auto bg-surface p-3 font-mono text-[11px] space-y-1.5 select-text lx-noscrollbar leading-relaxed">
        {filteredLogs.length === 0 ? (
          <div className="text-center text-muted py-8 italic">No logs recorded matching filters.</div>
        ) : (
          filteredLogs.map((l) => (
            <div key={l.id} className="flex gap-2 items-start hover:bg-raised px-1 py-0.5 rounded transition">
              <span className="text-muted shrink-0 text-[10px] select-none">{new Date(l.ts).toLocaleTimeString()}</span>
              <span className={`shrink-0 w-12 text-[10px] select-none ${getLevelColor(l.level)}`}>[{l.level}]</span>
              {getCategoryBadge(l.category)}
              <span className="text-strong whitespace-pre-wrap break-all flex-1">{l.text}</span>
            </div>
          ))
        )}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}

function DiskTab({ root }: { root: string }) {
  const [report, setReport] = useState<DiskUsageReport | null>(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => {
    setBusy(true);
    void ipc.diskUsage(root).then(setReport).catch(() => setReport(null)).finally(() => setBusy(false));
  }, [root]);
  useEffect(load, [load]);

  const max = Math.max(1, ...(report?.dirs.map((d) => d.bytes) ?? [1]));
  return (
    <div>
      <Header onRefresh={load} busy={busy}>
        <HardDrive size={13} className="text-accent" /> 
        <span className="font-semibold text-strong">Disk Usage Analyzer</span>
        {report && <span className="text-xs text-muted ml-1.5">({fmtBytes(report.total_bytes)} total)</span>}
        {busy && <span className="text-xs text-muted ml-auto animate-pulse">{t("Scanning…")}</span>}
      </Header>
      {!busy && report && report.dirs.length === 0 && <EmptyToolState icon={HardDrive} title={t("No disk usage entries")} text={t("Try refreshing after the project folder is fully loaded.")} />}
      {!busy && !report && <EmptyToolState icon={HardDrive} title={t("Disk scan unavailable")} text={t("Refresh to try scanning project folders again.")} />}

      <div className="p-2 space-y-2">
        {report?.dirs.map((d) => (
          <div key={d.path} className="p-2 rounded-lg border border-edge bg-bar/15 flex flex-col md:flex-row md:items-center gap-2 text-xs shadow-sm hover:border-accent/40 transition">
            <span className="w-full md:w-48 truncate font-medium text-strong" title={d.path}>{d.path}</span>
            <div className="h-2 flex-1 overflow-hidden rounded-full bg-raised">
              <div className={`h-full rounded-full transition-[width] duration-500 ${d.cleanable ? "bg-warning" : "bg-accent"}`} style={{ width: `${(d.bytes / max) * 100}%` }} />
            </div>
            <div className="flex items-center justify-between md:justify-end gap-3 w-full md:w-auto">
              <span className="font-semibold text-strong font-mono min-w-[70px] text-right">{fmtBytes(d.bytes)}</span>
              {d.cleanable && <span className="rounded-full bg-warning-soft border border-warning-soft-strong px-2 py-0.5 text-[9px] text-warning font-semibold uppercase tracking-wider shrink-0">cleanable</span>}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function DepsTab({ root }: { root: string }) {
  const toast = useAppStore((s) => s.toast);
  const [manifests, setManifests] = useState<DepManifest[]>([]);
  const [latest, setLatest] = useState<Record<string, Record<string, string>>>({});
  const [vulns, setVulns] = useState<VulnAdvisory[] | null>(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => void ipc.depManifests(root).then(setManifests).catch(() => setManifests([])), [root]);
  useEffect(load, [load]);

  const checkUpdates = async () => {
    setBusy(true);
    try {
      const next: Record<string, Record<string, string>> = {};
      for (const kind of ["npm", "cargo", "pip"] as const) {
        const names = [...new Set(manifests.filter((m) => m.kind === kind).flatMap((m) => m.deps.map((d) => d.name)))];
        if (names.length) next[kind] = await ipc.latestVersions(kind, names.slice(0, 60));
      }
      setLatest(next);
      toast("Latest versions fetched", "success");
    } catch (e) {
      toast(errorMessage(e), "error");
    } finally {
      setBusy(false);
    }
  };

  const checkVulns = async () => {
    setBusy(true);
    try {
      const found: VulnAdvisory[] = [];
      for (const kind of ["npm", "cargo", "pip"] as const) {
        const pkgs: [string, string][] = manifests
          .filter((m) => m.kind === kind)
          .flatMap((m) => m.deps.map((d) => [d.name, d.req.replace(/^[\^~>=<]+/, "").trim()] as [string, string]))
          .filter(([, v]) => /^\d/.test(v));
        if (pkgs.length) found.push(...(await ipc.osvCheck(kind, pkgs.slice(0, 100))));
      }
      setVulns(found);
      toast(found.length ? `${found.length} known vulnerabilities` : "No known vulnerabilities (OSV)", found.length ? "error" : "success");
    } catch (e) {
      toast(errorMessage(e), "error");
    } finally {
      setBusy(false);
    }
  };

  const outdated = (kind: string, name: string, req: string): string | null => {
    const latestVersion = latest[kind]?.[name];
    if (!latestVersion) return null;
    const current = req.replace(/^[\^~>=<]+/, "").trim();
    return current && latestVersion !== current && !latestVersion.startsWith(current) ? latestVersion : null;
  };

  const totalDepsCount = manifests.reduce((acc, curr) => acc + curr.deps.length, 0);

  return (
    <div className="space-y-3">
      <Header onRefresh={load}>
        <Package size={13} className="text-accent" /> 
        <span className="font-semibold text-strong">Dependencies & Vulnerability Dashboard</span>
      </Header>

      <div className="px-2 flex flex-wrap gap-1.5">
        <button onClick={() => void checkUpdates()} disabled={busy} className="flex-1 min-w-[120px] rounded-lg border border-edge bg-surface px-3 py-1.5 text-xs font-semibold text-strong hover:border-accent hover:text-accent disabled:opacity-40 transition">
          🔍 Check updates
        </button>
        <button onClick={() => void checkVulns()} disabled={busy} className="flex-1 min-w-[120px] rounded-lg border border-edge bg-surface px-3 py-1.5 text-xs font-semibold text-strong hover:border-danger hover:text-danger disabled:opacity-40 transition">
          🛡️ Check vulnerability index (OSV)
        </button>
      </div>

      {/* Dashboard Metrics */}
      <div className="grid grid-cols-3 gap-2 px-2">
        <div className="rounded-lg border border-edge bg-bar/25 px-2.5 py-2 text-center">
          <div className="text-[9px] uppercase tracking-wider text-muted mb-0.5">Manifests</div>
          <div className="text-base font-bold text-strong">{manifests.length}</div>
        </div>
        <div className="rounded-lg border border-edge bg-bar/25 px-2.5 py-2 text-center">
          <div className="text-[9px] uppercase tracking-wider text-muted mb-0.5">Total Deps</div>
          <div className="text-base font-bold text-strong">{totalDepsCount}</div>
        </div>
        <div className="rounded-lg border border-edge bg-bar/25 px-2.5 py-2 text-center">
          <div className="text-[9px] uppercase tracking-wider text-muted mb-0.5">Vulnerable</div>
          <div className={`text-base font-bold ${vulns && vulns.length > 0 ? "text-danger animate-pulse" : "text-success"}`}>
            {vulns ? vulns.length : "—"}
          </div>
        </div>
      </div>

      {manifests.length === 0 && <EmptyToolState icon={Package} title={t("No dependency manifests found")} text={t("package.json, Cargo.toml, requirements.txt and pyproject.toml will be summarized here.")} />}

      {vulns && vulns.length > 0 && (
        <div className="mx-2 mb-2 rounded-lg border border-danger-soft-strong bg-danger-soft p-3">
          <div className="text-xs font-semibold text-danger mb-1.5 flex items-center gap-1.5 uppercase tracking-wide">
            <AlertTriangle size={13} />
            {vulns.length} SECURITY VULNERABILITIES FOUND
          </div>
          <div className="space-y-1.5">
            {vulns.map((v) => (
              <div key={`${v.package}-${v.id}`} className="text-[11px] leading- relaxed border-b border-danger-soft pb-1.5 last:border-0 font-mono">
                <span className="font-bold text-danger bg-danger-soft border border-danger-soft-strong px-1.5 py-0.5 rounded mr-1.5">{v.id}</span>
                <span className="text-strong font-semibold">{v.package}</span>
                {v.summary && <span className="text-muted font-normal ml-1.5">— {v.summary}</span>}
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="space-y-2 p-2">
        {manifests.map((m) => (
          <div key={m.path} className="p-3 rounded-lg border border-edge bg-bar/15 shadow-sm">
            <div className="font-semibold text-strong flex items-center justify-between border-b border-edge pb-1.5 mb-2">
              <span className="truncate">{m.path}</span>
              <span className="rounded-full bg-raised px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-muted border border-edge">
                {m.kind} ({m.deps.length})
              </span>
            </div>
            <div className="space-y-1 font-mono text-xs max-h-56 overflow-y-auto pr-1">
              {m.deps.map((d) => {
                const newer = outdated(m.kind, d.name, d.req);
                return (
                  <div key={`${d.name}-${d.dev}`} className="flex gap-2 items-center hover:bg-raised/40 px-1 py-0.5 rounded transition">
                    <span className="text-strong font-medium flex-1 truncate">{d.name}</span>
                    <span className="text-muted font-normal shrink-0">{d.req}</span>
                    {d.dev && <span className="text-muted/60 text-[10px] bg-raised px-1 rounded">dev</span>}
                    {newer && (
                      <span className="text-warning flex items-center gap-1 shrink-0 bg-warning-soft border border-warning-soft-strong px-1 rounded text-[10px]">
                        ➔ {newer}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function ProcsTab() {
  const toast = useAppStore((s) => s.toast);
  const [nodes, setNodes] = useState<ProcessNode[]>([]);
  const load = useCallback(() => void ipc.processTree(0).then(setNodes).catch((e: unknown) => toast(errorMessage(e), "error")), [toast]);
  useEffect(load, [load]);

  const kill = async (node: ProcessNode) => {
    const ok = await confirmDestructive({ title: t("Kill process"), message: `${t("Kill process:")} ${node.name} (pid ${node.pid})?`, confirmLabel: t("Kill") });
    if (!ok) return;
    try {
      await ipc.processKill(node.pid, false);
      toast(`Killed ${node.name}`, "success");
      load();
    } catch (e) {
      toast(errorMessage(e), "error");
    }
  };

  return (
    <div>
      <Header onRefresh={load}>
        <Cpu size={13} className="text-accent animate-spin-slow" /> 
        <span className="font-semibold text-strong">Runtime Process Explorer</span>
      </Header>
      {nodes.length === 0 && <EmptyToolState icon={Cpu} title={t("No processes reported")} text={t("Refresh to read the current process tree again.")} />}

      <div className="p-2 space-y-1 max-h-[500px] overflow-y-auto select-none">
        {nodes.map((n) => (
          <div key={n.pid} className="group flex items-center gap-2 px-2.5 py-1.5 rounded-md text-xs hover:bg-raised transition duration-150" style={{ paddingLeft: 10 + n.depth * 14 }}>
            <span className="w-12 text-right font-mono text-muted select-text">PID {n.pid}</span>
            <span className="flex-1 truncate text-strong select-text font-medium" title={n.cmd}>{n.name}</span>
            <span className="w-14 text-right font-mono text-muted">{n.cpu_percent.toFixed(1)}%</span>
            <span className="w-18 text-right font-mono text-muted">{fmtBytes(n.memory_bytes)}</span>
            <button onClick={() => void kill(n)} className="text-muted hover:text-danger bg-surface border border-edge rounded px-1.5 py-0.5 text-[10px] font-semibold opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100 transition shadow-sm hover:border-danger-soft-strong hover:bg-danger-soft">KILL</button>
          </div>
        ))}
      </div>
    </div>
  );
}

/** Performance metrics dashboard. */
function PerfTab() {
  const [collecting, setCollecting] = useState(false);
  const [summary, setSummary] = useState<PerfSummary | null>(null);
  const [samples, setSamples] = useState<PerfSample[]>([]);

  useEffect(() => {
    const unsub = subscribePerf(() => {
      setSamples(getPerfSamples());
      setSummary(getPerfSummary());
    });
    return unsub;
  }, []);

  const toggleCollection = () => {
    if (collecting) {
      stopPerfCollection();
      setCollecting(false);
    } else {
      startPerfCollection();
      setCollecting(true);
    }
  };

  return (
    <div>
      <Header onRefresh={() => { setSamples(getPerfSamples()); setSummary(getPerfSummary()); }}>
        <Activity size={13} className="text-accent" /> 
        <span className="font-semibold text-strong">Live Performance Engine</span>
      </Header>
      <div className="mb-3 flex items-center gap-2 px-3">
        <button
          onClick={toggleCollection}
          className={`flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-semibold transition ${
            collecting 
              ? "border-danger-soft-strong bg-danger-soft text-danger hover:bg-danger-soft-strong animate-pulse" 
              : "border-accent/40 bg-accent/10 text-accent hover:bg-accent/15"
          }`}
        >
          {collecting ? <Square size={12} /> : <Play size={12} />}
          {collecting ? t("devtools.perf.stop", "Stop") : t("devtools.perf.start", "Start Collection")}
        </button>
        <button
          onClick={() => { clearPerfSamples(); setSamples([]); setSummary(null); }}
          className="flex items-center gap-1 rounded-lg border border-edge bg-surface px-3 py-1.5 text-xs text-strong hover:text-accent hover:border-accent transition font-semibold"
        >
          <RefreshCw size={12} /> {t("Clear")}
        </button>
        {collecting && <span className="text-xs text-muted font-medium ml-1 bg-raised px-2 py-0.5 rounded-full">{samples.length} samples</span>}
      </div>

      {summary && summary.sampleCount > 0 ? (
        <div className="space-y-3 p-2">
          <div className="grid grid-cols-2 gap-2 md:grid-cols-3">
            <MetricCard label="Avg heap" value={`${summary.avgHeapMB.toFixed(1)} MB`} />
            <MetricCard label="Peak heap" value={`${summary.peakHeapMB.toFixed(1)} MB`} />
            <MetricCard label="Avg frame" value={`${summary.avgFrameMs.toFixed(1)} ms`} />
            <MetricCard label="Worst frame" value={`${summary.worstFrameMs.toFixed(1)} ms`} />
            <MetricCard label="Event loop lag" value={`${summary.avgEventLoopLagMs.toFixed(1)} ms`} />
            <MetricCard label="Duration" value={`${summary.durationSecs.toFixed(0)}s`} />
          </div>
          {/* Simple sparkline for heap usage */}
          {samples.length > 2 && (
            <div className="p-3 rounded-lg border border-edge bg-bar/15 shadow-sm">
              <div className="mb-2 text-[10px] uppercase tracking-wider text-muted font-bold">Heap usage timeline (MB)</div>
              <svg width="100%" height={80} className="overflow-visible">
                {(() => {
                  const max = Math.max(...samples.map((s) => s.heapUsedMB), 1);
                  const w = 100 / (samples.length - 1);
                  const points = samples.map((s, i) => `${i * w},${80 - (s.heapUsedMB / max) * 70}`).join(" ");
                  return <polyline points={points} fill="none" stroke="var(--lx-accent, #e8b059)" strokeWidth={1.75} />;
                })()}
              </svg>
            </div>
          )}
        </div>
      ) : (
        <EmptyToolState
          icon={Activity}
          title={t("devtools.perf.empty", "No performance metrics yet")}
          text={t("devtools.perf.empty_desc", "Click Start to collect runtime performance metrics (memory, frame times, event loop lag).")}
        />
      )}
    </div>
  );
}

function MetricCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-edge bg-bar/15 px-3 py-2 text-center shadow-sm">
      <div className="text-[9px] uppercase tracking-wider text-muted font-bold mb-0.5">{label}</div>
      <div className="font-mono text-sm text-strong font-bold">{value}</div>
    </div>
  );
}

function CrashesTab() {
  const [reports, setReports] = useState<CrashReport[]>([]);
  const [active, setActive] = useState<CrashReport | null>(null);
  const [content, setContent] = useState("");
  const load = useCallback(() => void ipc.crashList().then(setReports).catch(() => setReports([])), []);
  useEffect(load, [load]);

  const open = async (r: CrashReport) => {
    setActive(r);
    setContent(await ipc.crashRead(r.name).catch((e: unknown) => errorMessage(e)));
  };

  if (active) {
    return (
      <div className="flex h-full flex-col">
        <Header>
          <button onClick={() => setActive(null)} className="rounded border border-edge px-2.5 py-0.5 hover:text-strong transition">← Back</button>
          <span className="font-semibold text-strong text-[11px] font-mono truncate max-w-sm">{active.name}</span>
          <button onClick={() => void navigator.clipboard.writeText(content)} className="ml-auto hover:text-strong transition text-xs">Copy</button>
        </Header>
        <pre className="min-h-0 flex-1 overflow-auto whitespace-pre-wrap break-all px-3 py-2 font-mono text-xs text-strong bg-surface select-text leading-relaxed">{content}</pre>
      </div>
    );
  }

  return (
    <div>
      <Header onRefresh={load}>
        <Bug size={13} className="text-danger" /> 
        <span className="font-semibold text-strong">Crash Diagnostic Logger</span>
        <span className="text-xs text-muted">({reports.length} files)</span>
      </Header>
      {reports.length === 0 && <EmptyToolState icon={Bug} title={t("No crashes recorded 🎉")} text={t("Crash reports will appear here when the desktop runtime writes one.")} />}

      <div className="p-2 space-y-1">
        {reports.map((r) => (
          <button
            key={r.name}
            onClick={() => void open(r)}
            className="flex w-full items-center gap-3 px-3 py-2.5 rounded-lg border border-edge bg-surface text-left hover:border-accent hover:bg-raised transition duration-150"
          >
            <AlertTriangle size={14} className="text-danger shrink-0" />
            <span className="flex-1 truncate font-mono text-xs text-strong">{r.name}</span>
            <span className="text-xs text-muted font-mono">{new Date(r.modified * 1000).toLocaleString()}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
