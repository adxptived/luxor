import type { IDockviewPanelProps } from "dockview";
import {
  Bot,
  ChevronRight,
  CheckCircle2,
  Circle,
  FolderGit2,
  FolderOpen,
  FolderPlus,
  History,
  LayoutGrid,
  Lightbulb,
  Rocket,
  Search,
  Sparkles,
  SquareTerminal,
  TriangleAlert,
} from "lucide-react";
import React, { useEffect, useState } from "react";

import * as ipc from "@/lib/ipc";
import { t } from "@/lib/i18n";
import type { RecentProject } from "@/lib/types";
import { useDockStore } from "@/layout/dockStore";
import { useProjectsStore } from "@/state/projectsStore";
import { useAppStore } from "@/state/appStore";

import pkg from "../../package.json";

const APP_VERSION: string = (pkg as { version: string }).version;

/** Tips rotate by context so the Welcome and Blank screens read differently. */
const WELCOME_TIPS = [
  "Drag a panel tab onto another panel's edge to split the layout.",
  "Use the split buttons in every panel header to split right/down instantly.",
  "Right-click tabs, the sidebar and the status bar for more actions.",
  "Open .sqlite/.db files from the file explorer — there's a built-in DB viewer.",
  "Customize the sidebar buttons: right-click a button or open Settings → Interface.",
];

const BLANK_TIPS = [
  "A blank workspace has no project folder — perfect for quick terminals and notes.",
  "Open a folder below to turn this into a full project with Git and Files.",
  "Add favorite commands from the quick-actions menu to re-run them in one click.",
];

/** Onboarding checklist steps shown for first-time users. */
const ONBOARDING_STEPS = [
  { id: "open_folder", label: "Open a project folder", icon: FolderPlus },
  { id: "open_terminal", label: "Open a terminal", icon: SquareTerminal },
  { id: "open_ai", label: "Explore the AI center", icon: Bot },
  { id: "open_settings", label: "Customize settings", icon: LayoutGrid },
];

/**
 * Welcome / launcher screen.
 *
 * Two variants share one component:
 *  - default: shown on the global Welcome tab — full set of "get started"
 *    actions (open folder, blank workspace, terminal, AI center) + recents.
 *  - `blank`: shown inside a folder-less ("Blank") workspace. It drops the
 *    redundant "New blank workspace" action (you are already in one) and leads
 *    with what actually makes sense here: a terminal and attaching a folder.
 */
function WelcomePanelImpl(props: Partial<IDockviewPanelProps> = {}) {
  const blank = Boolean((props.params as { blank?: boolean } | undefined)?.blank);
  const addProject = useProjectsStore((s) => s.addProject);
  const addBlank = useProjectsStore((s) => s.addBlank);
  const addTerminal = useDockStore((s) => s.addTerminal);
  const openPanel = useDockStore((s) => s.openPanel);
  const setSettingsOpen = useAppStore((s) => s.setSettingsOpen);
  const [recents, setRecents] = useState<RecentProject[]>([]);
  const [onboardingDone, setOnboardingDone] = useState<Record<string, boolean>>(() => {
    try { return JSON.parse(localStorage.getItem("luxor.onboarding") || "{}"); } catch { return {}; }
  });

  useEffect(() => {
    ipc.recentList(5).then(setRecents, () => {});
  }, []);

  const reopen = async (r: RecentProject) => {
    const p = await useProjectsStore.getState().addProjectPath(r.path, r.name);
    if (p) useProjectsStore.getState().setActive(p.id);
  };

  const markOnboardingStep = (id: string) => {
    const next = { ...onboardingDone, [id]: true };
    setOnboardingDone(next);
    try { localStorage.setItem("luxor.onboarding", JSON.stringify(next)); } catch { /* ignore */ }
  };

  const onboardingComplete = ONBOARDING_STEPS.every((s) => onboardingDone[s.id]);

  const tips = blank ? BLANK_TIPS : WELCOME_TIPS;

  return (
    <div className="h-full overflow-auto bg-surface px-4 py-6 sm:px-6 sm:py-8">
      <div className="mx-auto flex min-h-full w-full max-w-6xl items-center">
        <div className="grid w-full grid-cols-1 gap-4 lg:grid-cols-[minmax(0,0.95fr)_minmax(22rem,0.75fr)]">
          <section className="lx-empty-state relative overflow-hidden rounded-lg border border-edge p-5 sm:p-7" style={{ boxShadow: "var(--lx-shadow-lg)" }}>
            
            <div className="relative">
              <div className="mb-5 flex flex-wrap items-center gap-3">
                <div className="flex h-14 w-14 items-center justify-center rounded-lg border border-edge bg-raised text-muted">
                  {blank ? <LayoutGrid size={26} /> : <SquareTerminal size={26} />}
                </div>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-baseline gap-2">
                    <h1 className="text-3xl font-bold tracking-tight text-strong sm:text-4xl">
                      {blank ? t("Blank workspace") : "Luxor"}
                    </h1>
                    {!blank && (
                      <span className="rounded-full border border-edge bg-bar px-2 py-0.5 font-mono text-2xs text-muted">
                        v{APP_VERSION}
                      </span>
                    )}
                  </div>
                  <p className="mt-1 max-w-2xl text-sm leading-6 text-muted">
                    {blank
                      ? t("A scratch space with no project folder. Open a terminal, or attach a folder to make it a project.")
                      : t("A desktop cockpit for code, Git, AI, terminals, browser work, sessions and project launchers.")}
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                <WelcomeAction
                  icon={SquareTerminal}
                  label={t("New terminal")}
                  hint="Ctrl+`"
                  primary
                  onClick={() => addTerminal()}
                />
                <WelcomeAction
                  icon={FolderPlus}
                  label={t("Open a project folder…")}
                  hint={t("adds a project tab")}
                  onClick={() => void addProject()}
                />
                <WelcomeAction
                  icon={Bot}
                  label={t("AI agents")}
                  hint={t("running tools")}
                  onClick={() => openPanel("agents")}
                />
                {blank ? (
                  <WelcomeAction
                    icon={FolderOpen}
                    label={t("Browse files")}
                    hint={t("file explorer")}
                    onClick={() => openPanel("files")}
                  />
                ) : (
                  <WelcomeAction
                    icon={LayoutGrid}
                    label={t("New blank workspace")}
                    hint={t("terminals, no folder")}
                    onClick={() => void addBlank()}
                  />
                )}
              </div>

              <div className="mt-5 grid grid-cols-1 gap-2 text-xs text-muted sm:grid-cols-3">
                <FeaturePill icon={Search} label={t("Command-first")} value="Ctrl+Shift+P" />
                <FeaturePill icon={FolderGit2} label={t("Git + GitHub")} value={t("inside app")} />
                <FeaturePill icon={Sparkles} label={t("Adaptive UI")} value={t("small windows") } />
              </div>
            </div>
          </section>

          <aside className="grid grid-cols-1 gap-4">
            {/* Onboarding checklist */}
            {!blank && !onboardingComplete && (
              <section className="rounded-lg border border-edge bg-surface/40 p-3">
                <div className="mb-2 flex items-center gap-1.5 px-1 text-2xs font-semibold uppercase tracking-wide text-accent">
                  <Rocket size={12} /> {t("welcome.get_started", "Get started")}
                </div>
                <div className="space-y-1">
                  {ONBOARDING_STEPS.map((step) => {
                    const done = onboardingDone[step.id];
                    return (
                      <button
                        key={step.id}
                        onClick={() => {
                          markOnboardingStep(step.id);
                          if (step.id === "open_folder") void addProject();
                          else if (step.id === "open_terminal") addTerminal();
                          else if (step.id === "open_ai") openPanel("agents");
                          else if (step.id === "open_settings") setSettingsOpen(true);
                        }}
                        className="group flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-sm hover:bg-raised"
                      >
                        {done ? (
                          <CheckCircle2 size={15} className="shrink-0 text-success" />
                        ) : (
                          <Circle size={15} className="shrink-0 text-muted" />
                        )}
                        <span className={`flex-1 ${done ? "text-muted line-through" : "text-strong"}`}>{t(step.label)}</span>
                        <step.icon size={13} className="shrink-0 text-muted opacity-0 group-hover:opacity-100 group-focus-within:opacity-100" />
                      </button>
                    );
                  })}
                </div>
              </section>
            )}

            <section className="rounded-lg border border-edge bg-bar/80 p-3">
              <div className="mb-2 flex items-center justify-between gap-2 px-1">
                <div className="flex items-center gap-1.5 text-2xs font-semibold uppercase tracking-wide text-muted">
                  <History size={12} /> {t("Recent projects")}
                </div>
                {recents.length > 0 && <span className="text-3xs text-muted">{recents.length}</span>}
              </div>
              <div className="space-y-1">
                {recents.map((r) => (
                  <button
                    key={r.path}
                    className="group flex w-full min-w-0 items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm hover:bg-raised disabled:cursor-not-allowed disabled:opacity-40"
                    disabled={!r.path_exists}
                    title={r.path_exists ? r.path : `${r.path} — ${t("folder not found")}`}
                    onClick={() => void reopen(r)}
                  >
                    {r.path_exists ? (
                      <FolderGit2 size={15} className="shrink-0 text-muted" />
                    ) : (
                      <TriangleAlert size={15} className="shrink-0 text-warning" />
                    )}
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium text-strong">{r.name}</span>
                      <span className="block truncate text-xs text-muted">{r.path}</span>
                    </span>
                    <ChevronRight size={14} className="shrink-0 text-muted opacity-0 group-hover:opacity-100 group-focus-within:opacity-100" />
                  </button>
                ))}
                {recents.length === 0 && (
                  <div className="rounded-lg border border-dashed border-edge px-3 py-5 text-center text-xs text-muted">
                    {t("No recent projects yet. Open a folder and it will stay here for fast return.")}
                  </div>
                )}
              </div>
            </section>

            <section className="rounded-lg border border-edge bg-bar/80 px-4 py-3 text-left text-xs text-muted">
              <div className="mb-1.5 flex items-center gap-1.5 font-semibold uppercase tracking-wide">
                <Lightbulb size={12} className="text-muted" /> {t("Tips")}
              </div>
              <ul className="space-y-1.5">
                {tips.map((tip) => (
                  <li key={tip} className="flex gap-2 leading-5">
                    <span className="select-none text-accent">·</span>
                    <span>{t(tip)}</span>
                  </li>
                ))}
              </ul>
            </section>

            <p className="text-center text-xs text-muted">
              {t("Press")} <Kbd>Ctrl</Kbd>+<Kbd>Shift</Kbd>+<Kbd>P</Kbd> {t("for the command palette.")}
            </p>
          </aside>
        </div>
      </div>
    </div>
  );
}

/** Memoized: dockview re-creates props objects on layout changes; the welcome
 *  screen has no meaningful props, so skip those re-renders entirely. */
export const WelcomePanel = React.memo(WelcomePanelImpl);

function Kbd({ children }: { children: React.ReactNode }) {
  return <kbd className="rounded border border-edge bg-raised px-1 font-mono text-2xs">{children}</kbd>;
}

function FeaturePill(props: { icon: React.ComponentType<{ size?: number; className?: string }>; label: string; value: string }) {
  return (
    <div className="flex min-w-0 items-center gap-2 rounded-lg border border-edge bg-bar/70 px-3 py-2">
      <props.icon size={14} className="shrink-0 text-accent" />
      <span className="min-w-0">
        <span className="block truncate text-3xs uppercase tracking-wide text-muted">{props.label}</span>
        <span className="block truncate text-xs font-medium text-strong">{props.value}</span>
      </span>
    </div>
  );
}

function WelcomeAction(props: {
  icon: React.ComponentType<{ size?: number; className?: string }>;
  label: string;
  hint: string;
  primary?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={props.onClick}
      className={`lx-hover-lift group flex min-w-0 items-center gap-3 rounded-lg border px-4 py-3 text-left ${
        props.primary
          ? "border-edge bg-raised text-strong hover:bg-surface"
          : "border-edge bg-bar/70 hover:border-muted hover:bg-raised"
      }`}
    >
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-raised text-muted">
        <props.icon size={17} />
      </span>
      <span className="flex min-w-0 flex-1 flex-col">
        {/* Wrap instead of truncating so labels stay fully readable in narrow layouts. */}
        <span className="text-pretty font-medium leading-snug text-strong">{props.label}</span>
        <span className="truncate text-xs text-muted" title={props.hint}>
          {props.hint}
        </span>
      </span>
      <ChevronRight size={15} className="shrink-0 text-muted opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100" />
    </button>
  );
}
