import {
  Activity,
  AppWindow,
  ArrowDown,
  ArrowUp,
  Bell,
  BellOff,
  Bug,
  Check,
  ClipboardCheck,
  Copy,
  Download,
  Eye,
  EyeOff,
  FolderGit2,
  FolderOpen,
  Code2,
  Info,
  Keyboard,
  Minimize2,
  Minus,
  MonitorPlay,
  Palette,
  PanelTop,
  Plus,
  RefreshCw,
  Rocket,
  ScrollText,
  Search,
  Square,
  SquareTerminal,
  Trash2,
  Upload,
  X,
  type LucideIcon,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import * as ipc from "@/lib/ipc";
import { parseConfigImport, serializeConfig } from "@/lib/configShare";
import { loadProfiles, createProfile, deleteProfile, saveProfiles, encodeConfigToUrl, decodeConfigFromUrl, type SettingsProfile } from "@/lib/settingsProfiles";
import { BUILTIN_PRESETS, decodePresetFromUrl, encodePresetToUrl } from "@/lib/settingsPresets";
import { searchSettings } from "@/lib/settingsSearch";
import { effectiveShellArgs, formatShellArgs, parseShellArgs } from "@/lib/shellArgs";

import pkg from "../../package.json";

const APP_VERSION: string = (pkg as { version: string }).version;

/** Icons for built-in quick presets; falls back to Rocket for unknown ids. */
const PRESET_ICONS: Record<string, LucideIcon> = {
  focus: Eye,
  presentation: MonitorPlay,
  compact: Minimize2,
  "quiet-terminal": BellOff,
};
import { HOTKEY_ACTIONS, chordFromEvent, effectiveHotkeys, normalizeChord } from "@/lib/hotkeys";
import { NAV_BUTTONS, nudgeNavButton, resolveNavOrder } from "@/lib/navButtons";
import { isMac } from "@/lib/platform";
import { SEGMENT_TOGGLES, nudgeSegment, resolveSegmentOrder, segmentLabel } from "@/lib/statusSegments";
import { DEFAULT_SIDE_WIDGETS, SIDE_PANEL_WIDGETS } from "@/components/SidePanel";
import { EMBEDDABLE_PANELS, RIGHT_PANEL_WIDGETS } from "@/components/RightPanel";
import {
  parseRightPanelConfig,
  serializeRightPanelConfig,
  setWidgetEnabled,
  toLegacyWidgetList,
  type RightWidgetId,
} from "@/lib/rightPanelConfig";
import { CODEMIRROR_THEMES as EDITOR_THEMES } from "@/lib/codemirrorThemeMeta";
import { THEMES, themeMeta, resolveTheme } from "@/lib/themes";
import { ZOOM_MAX, ZOOM_MIN } from "@/lib/zoom";
import { useDelayedUnmount } from "@/lib/dismiss";
import { useFocusTrap } from "@/lib/useFocusTrap";
import { errorMessage } from "@/lib/types";
import type { AppConfig, DetectedIde, DetectedProgram } from "@/lib/types";
import type { Project, TrayConfig } from "@/lib/types";
import { TrayMenu } from "@/tray/TrayMenu";
import { LANGUAGES, t } from "@/lib/i18n";
import {
  AboutLink,
  DevToolButton,
  Input,
  NumberInput,
  ProgramPicker,
  Row,
  Select,
  Toggle,
} from "./settings/controls";
import { latestStartup, subscribeLogs } from "@/lib/logBuffer";
import { PLUS_MENU_PANELS } from "@/lib/plusMenu";
import * as ipcExtra from "@/lib/ipc";
import type { UpdateInfo } from "@/lib/types";
import { useAppStore } from "@/state/appStore";
import { useUiStore } from "@/state/uiStore";

type SectionId = "appearance" | "interface" | "notifications" | "terminal" | "git" | "launcher" | "statusbar" | "hotkeys" | "developer" | "about";

const SECTIONS: { id: SectionId; label: string; icon: LucideIcon }[] = [
  { id: "appearance", label: "Appearance", icon: Palette },
  { id: "interface", label: "Interface", icon: PanelTop },
  { id: "notifications", label: "Notifications", icon: Bell },
  { id: "terminal", label: "Terminal", icon: SquareTerminal },
  { id: "git", label: "Git", icon: FolderGit2 },
  { id: "launcher", label: "Launcher & IDEs", icon: Rocket },
  { id: "statusbar", label: "Status bar", icon: Activity },
  { id: "hotkeys", label: "Hotkeys", icon: Keyboard },
  { id: "developer", label: "Developer", icon: Bug },
  { id: "about", label: "About", icon: Info },
];

/** Short blurb under each section title. */
const SECTION_DESCRIPTIONS: Record<SectionId, string> = {
  appearance: "Themes, colors and how Luxor looks.",
  interface: "Tab bar, side panel, browser, tray and zoom.",
  notifications: "When Luxor alerts you: finished commands, AI agents.",
  terminal: "Shell, font and terminal behavior.",
  git: "Diff view and refresh cadence.",
  launcher: "External editors, IDEs and how projects open.",
  statusbar: "Pick and arrange the bottom-bar segments.",
  hotkeys: "Rebind keyboard shortcuts.",
  developer: "Live log feed, startup timing and shareable diagnostics.",
  about: "Version, author and update checks.",
};

const ACCENT_SWATCHES = [
  "#e8b059",
  "#5db1e8",
  "#7ee87e",
  "#22c55e",
  "#38bdf8",
  "#3b82f6",
  "#818cf8",
  "#a78bfa",
  "#e879f9",
  "#f472b6",
  "#ef4444",
  "#f97316",
  "#facc15",
  "#94a3b8",
];

// Curated font presets (label → CSS font-family). "" = the theme default.
const UI_FONTS: { label: string; value: string }[] = [
  { label: "System default", value: "" },
  { label: "Inter", value: 'Inter, ui-sans-serif, system-ui, sans-serif' },
  { label: "Segoe UI", value: '"Segoe UI", ui-sans-serif, system-ui, sans-serif' },
  { label: "Roboto", value: 'Roboto, ui-sans-serif, system-ui, sans-serif' },
  { label: "Helvetica", value: '"Helvetica Neue", Helvetica, Arial, sans-serif' },
  { label: "Georgia (serif)", value: 'Georgia, "Times New Roman", serif' },
  { label: "JetBrains Mono", value: '"JetBrains Mono", ui-monospace, monospace' },
];
const MONO_FONTS: { label: string; value: string }[] = [
  { label: "Default", value: "" },
  { label: "JetBrains Mono", value: '"JetBrains Mono", ui-monospace, monospace' },
  { label: "Fira Code", value: '"Fira Code", ui-monospace, monospace' },
  { label: "Cascadia Code", value: '"Cascadia Code", "Cascadia Mono", ui-monospace, monospace' },
  { label: "Source Code Pro", value: '"Source Code Pro", ui-monospace, monospace' },
  { label: "Consolas", value: 'Consolas, "Liberation Mono", monospace' },
  { label: "Menlo / Monaco", value: 'Menlo, Monaco, ui-monospace, monospace' },
];

/** Fallback tray config for older saved configs that predate the field. */
const DEFAULT_TRAY: TrayConfig = {
  show_projects: true,
  show_new_terminal: true,
  show_new_window: false,
  show_settings: true,
  show_close_to_tray: true,
};

/** Settings-window scale (Ctrl+= / Ctrl+- / Ctrl+0 while the modal is open).
 *  Scales ONLY the settings dialog — the app-wide zoom keeps its bindings when
 *  the modal is closed. Persisted so the preferred size sticks across opens. */
const SETTINGS_SCALE_KEY = "luxor.settingsScale";
const SETTINGS_SCALE_MIN = 0.7;
const SETTINGS_SCALE_MAX = 1.5;
const SETTINGS_SCALE_STEP = 0.1;

function clampSettingsScale(v: number): number {
  if (!Number.isFinite(v)) return 1;
  return Math.round(Math.min(SETTINGS_SCALE_MAX, Math.max(SETTINGS_SCALE_MIN, v)) * 100) / 100;
}

function loadSettingsScale(): number {
  try {
    const raw = localStorage.getItem(SETTINGS_SCALE_KEY);
    return raw === null ? 1 : clampSettingsScale(Number(raw));
  } catch {
    return 1;
  }
}

/** Stable sample projects for the tray-menu preview. */
const TRAY_PREVIEW_PROJECTS: Project[] = [
  { id: "preview-1", name: "luxor", path: "~/dev/luxor" } as Project,
  { id: "preview-2", name: "aeterna", path: "~/dev/aeterna" } as Project,
];

/** A preset dropdown plus a free-text field for any installed font family. */
function FontPicker({
  value,
  options,
  onChange,
}: {
  value: string;
  options: { label: string; value: string }[];
  onChange: (v: string) => void;
}) {
  const known = options.some((o) => o.value === value);
  return (
    <div className="flex items-center gap-1.5">
      <select
        value={known ? value : "__custom__"}
        onChange={(e) => onChange(e.target.value === "__custom__" ? value : e.target.value)}
        className="rounded border border-edge bg-raised px-2 py-1 text-xs text-strong outline-none focus:border-muted"
      >
        {options.map((o) => (
          <option key={o.label} value={o.value}>
            {o.label}
          </option>
        ))}
        {!known && <option value="__custom__">Custom…</option>}
      </select>
      <input
        value={value}
        placeholder="font-family"
        onChange={(e) => onChange(e.target.value)}
        className="w-40 rounded border border-edge bg-raised px-2 py-1 font-mono text-2xs text-strong outline-none focus:border-muted"
      />
    </div>
  );
}

/** Extra keywords per section so the settings search finds them. */
const SECTION_KEYWORDS: Record<SectionId, string> = {
  appearance: "theme accent color dark light tabs confirm editor monaco syntax monokai dracula nord transparent transparency glass blur opacity translucent acrylic vibrancy see-through",
  interface: "sidebar nav buttons zoom scale quick actions width height order hide browser web youtube tray background close quit startup autostart login boot side panel widgets second window multi",
  notifications: "notify toast os native windows command done finished agent claude codex gemini duration alert",
  terminal: "shell args arguments font scrollback cursor webgl copy emulator external powershell bash zsh ghostty alacritty fast startup nologo noprofile profile loading",
  git: "diff refresh branch",
  launcher: "ide editor custom default detect explorer system open with",
  statusbar: "status bar segments cpu ram network ping project order clock time zoom tasks",
  hotkeys: "keyboard shortcuts keybindings chord",
    developer: "developer dev logs log panel frontend.log diagnostics share copy export clear startup timing performance first paint errors freeze console troubleshoot bug report diagnostics tab discord rpc health checks devtools",
  about: "about version author adxptived github repository update check release changelog license credits",
};


function NavPreview({ config }: { config: AppConfig }) {
  const { nav_order, nav_hidden, nav_sidebar, nav_chrome, nav_topbar_left, nav_topbar_center } = config.ui;
  const order = resolveNavOrder(nav_order ?? []);
  const hidden = nav_hidden ?? [];
  const sidebar = nav_sidebar ?? [];
  const chrome = nav_chrome ?? [];
  const left = nav_topbar_left ?? [];
  const center = nav_topbar_center ?? [];

  const pick = (test: (id: string) => boolean) =>
    order
      .filter((id) => !hidden.includes(id) && test(id))
      .map((id) => NAV_BUTTONS.find((b) => b.id === id))
      .filter((b): b is (typeof NAV_BUTTONS)[number] => Boolean(b));

  // Top-bar buttons split into their three alignment zones; anything not
  // sidebar/chrome/left/center falls back to the right group ("Top bar — right").
  const leftBtns = pick((id) => left.includes(id));
  const centerBtns = pick((id) => center.includes(id));
  const rightBtns = pick(
    (id) => !sidebar.includes(id) && !chrome.includes(id) && !left.includes(id) && !center.includes(id),
  );
  const chromeBtns = pick((id) => chrome.includes(id));
  const sidebarBtns = pick((id) => sidebar.includes(id));

  const Btn = ({ b, filled }: { b: (typeof NAV_BUTTONS)[number]; filled?: boolean }) => (
    <div
      className={`flex h-5 w-5 items-center justify-center rounded text-muted ${filled ? "bg-raised" : ""}`}
      title={b.label}
    >
      <b.icon size={10} />
    </div>
  );

  // Traffic lights (macOS) sit at the far left; Windows draws min/max/close at
  // the far right. This mirrors where the real window controls live per OS.
  const trafficLights = (
    <div className="ml-1 mr-2 flex gap-1">
      <div className="h-2 w-2 rounded-full bg-danger" />
      <div className="h-2 w-2 rounded-full bg-warning" />
      <div className="h-2 w-2 rounded-full bg-success" />
    </div>
  );
  const winControls = (
    <div className="ml-1 flex items-center gap-1.5 pl-1 text-muted">
      <Minus size={11} />
      <Square size={9} />
      <X size={11} />
    </div>
  );

  return (
    <div className="mb-4 overflow-hidden rounded-lg border border-edge shadow-sm">
      {/* Mini top bar */}
      <div className="flex h-8 items-center border-b border-edge bg-surface px-1">
        <div className="flex flex-1 items-center gap-0.5">
          {isMac && trafficLights}
          {leftBtns.map((b) => <Btn key={b.id} b={b} filled />)}
        </div>
        <div className="flex items-center gap-0.5">
          {centerBtns.map((b) => <Btn key={b.id} b={b} filled />)}
        </div>
        <div className="flex flex-1 items-center justify-end gap-0.5 pr-1">
          {rightBtns.map((b) => <Btn key={b.id} b={b} filled />)}
          {chromeBtns.map((b) => <Btn key={b.id} b={b} />)}
          {!isMac && winControls}
        </div>
      </div>
      {/* Mini body */}
      <div className="flex h-24 bg-surface">
        {/* Mini sidebar */}
        <div className="flex w-6 flex-col items-center gap-1 border-r border-edge bg-bar p-1">
          {sidebarBtns.map((b) => (
            <div key={b.id} className="flex h-4 w-4 items-center justify-center rounded text-muted" title={b.label}>
              <b.icon size={10} />
            </div>
          ))}
        </div>
        {/* Content area */}
        <div className="flex-1 bg-bar/30 p-2">
          <div className="h-full w-full rounded border border-dashed border-edge/50 bg-raised/20" />
        </div>
      </div>
    </div>
  );
}

export function SettingsModal() {
  const open = useAppStore((s) => s.settingsOpen);
  const requestedSection = useAppStore((s) => s.settingsSection);
  const setOpen = useAppStore((s) => s.setSettingsOpen);
  const config = useAppStore((s) => s.config);
  const saveConfig = useAppStore((s) => s.saveConfig);
  const [draft, setDraft] = useState<AppConfig | null>(null);
  const [shellArgsText, setShellArgsText] = useState("");
  const [shellArgsError, setShellArgsError] = useState<string | null>(null);
  const [section, setSection] = useState<SectionId>("appearance");
  // Detected shells / terminal emulators for the terminal pickers.
  const [shells, setShells] = useState<DetectedProgram[]>([]);
  const [terminals, setTerminals] = useState<DetectedProgram[]>([]);
  const [detectedIdes, setDetectedIdes] = useState<DetectedIde[]>([]);
  useEffect(() => {
    ipc.ptyDetectShells().then(setShells, () => {});
    ipc.launcherDetectTerminals().then(setTerminals, () => {});
    ipc.launcherDetectIdes().then(setDetectedIdes, () => {});
  }, []);
  const [recording, setRecording] = useState<string | null>(null);
  // A recorded chord that collides with another action's binding, awaiting the
  // user's choice to reassign (steal it) or cancel. Cleared when resolved.
  const [hotkeyConflict, setHotkeyConflict] = useState<{
    action: string;
    chord: string;
    conflictWith: string;
  } | null>(null);
  const [search, setSearch] = useState("");
  // Focus trap (audit D): keep Tab within the modal and restore focus on close,
  // matching CommandPalette/ProjectSwitcher. Initial focus goes to search.
  const dialogRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  useFocusTrap(dialogRef, open, { initialFocus: searchRef });
  // Phase 21: Settings profiles. MUST be declared before the early return below
  // so the hook count is identical on every render — otherwise React throws
  // error #310 ("rendered more hooks than during the previous render") the first
  // time the modal mounts.
  const [profiles, setProfiles] = useState<SettingsProfile[]>(loadProfiles());
  const { mounted, leaving } = useDelayedUnmount(open, 200);

  // Modal-only scale: Ctrl+= / Ctrl+- resize the settings window, Ctrl+0 resets.
  const [scale, setScale] = useState(loadSettingsScale);
  const bumpScale = useCallback((delta: number) => {
    setScale((cur) => {
      const next = clampSettingsScale(cur + delta);
      try {
        localStorage.setItem(SETTINGS_SCALE_KEY, String(next));
      } catch {
        /* private mode — best effort */
      }
      return next;
    });
  }, []);
  const resetScale = useCallback(() => {
    setScale(() => {
      try {
        localStorage.setItem(SETTINGS_SCALE_KEY, "1");
      } catch {
        /* best effort */
      }
      return 1;
    });
  }, []);

  // Capture-phase: while the modal is open these chords resize the modal and
  // never reach the app-wide zoom handler in App.tsx (bubble-phase on window).
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
      if (e.code === "Equal" || e.code === "NumpadAdd") bumpScale(SETTINGS_SCALE_STEP);
      else if (e.code === "Minus" || e.code === "NumpadSubtract") bumpScale(-SETTINGS_SCALE_STEP);
      else if (!e.shiftKey && (e.code === "Digit0" || e.code === "Numpad0")) resetScale();
      else return;
      e.preventDefault();
      e.stopPropagation();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [open, bumpScale, resetScale]);

  // Ctrl+wheel over the modal resizes it too (and doesn't zoom the app behind).
  // The non-passive wheel listener is only attached WHILE Ctrl/Meta is held,
  // so plain scrolling inside the modal stays on the compositor thread and
  // never waits on a JS handler (see the matching gate in App.tsx).
  useEffect(() => {
    const el = dialogRef.current;
    if (!open || !el) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey || e.deltaY === 0) return;
      e.preventDefault();
      e.stopPropagation();
      bumpScale(e.deltaY < 0 ? SETTINGS_SCALE_STEP : -SETTINGS_SCALE_STEP);
    };
    let attached = false;
    const attach = () => {
      if (attached) return;
      attached = true;
      el.addEventListener("wheel", onWheel, { passive: false });
    };
    const detach = () => {
      if (!attached) return;
      attached = false;
      el.removeEventListener("wheel", onWheel);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey) attach();
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (!e.ctrlKey && !e.metaKey) detach();
    };
    const onReset = () => detach();
    window.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("keyup", onKeyUp, true);
    window.addEventListener("blur", onReset);
    document.addEventListener("visibilitychange", onReset);
    return () => {
      window.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("keyup", onKeyUp, true);
      window.removeEventListener("blur", onReset);
      document.removeEventListener("visibilitychange", onReset);
      detach();
    };
  }, [open, mounted, bumpScale]);

  useEffect(() => {
    if (open && config) {
      setDraft(structuredClone(config));
      setShellArgsText(formatShellArgs(config.terminal.shell_args));
      setShellArgsError(null);
    }
    if (open) {
      setSearch("");
      if (requestedSection && SECTIONS.some((s) => s.id === requestedSection)) {
        setSection(requestedSection as SectionId);
      }
    }
  }, [open, config, requestedSection]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        // First Escape clears an active search (keeps the modal open so the
        // user lands back on the full section list); second Escape closes.
        if (searchRef.current?.value) {
          setSearch("");
          searchRef.current.focus();
          return;
        }
        setOpen(false);
      }
      // Ctrl/Cmd+F jumps to the settings search instead of the browser find.
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === "f") {
        e.preventDefault();
        searchRef.current?.focus();
        searchRef.current?.select();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, setOpen]);

  // Keep the content pane in sync with the search: if the open section has no
  // hit, jump to the first section that does, so results show without an extra
  // click. Uses the same union (label + keywords + per-item index) as the nav.
  useEffect(() => {
    const q = search.toLowerCase().trim();
    if (!q) return;
    const found = searchSettings(search);
    const visible = SECTIONS.filter(
      (s) =>
        s.label.toLowerCase().includes(q) ||
        SECTION_KEYWORDS[s.id].includes(q) ||
        found.sections.includes(s.id),
    );
    if (visible.length > 0) {
      setSection((cur) => (visible.some((s) => s.id === cur) ? cur : visible[0].id));
    }
     
  }, [search]);

  if (!mounted || !draft) return null;

  /** Auto-save: every change is applied to the latest draft and persisted immediately. */
  const set = (patch: Partial<AppConfig>) => {
    setDraft((prev) => {
      if (!prev) return prev;
      const next = { ...prev, ...patch };
      void saveConfig(next);
      return next;
    });
  };

  const updateShellArgs = (text: string) => {
    setShellArgsText(text);
    const parsed = parseShellArgs(text);
    if (!parsed.ok) {
      setShellArgsError(parsed.error);
      return;
    }
    setShellArgsError(null);
    setDraft((prev) => {
      if (!prev) return prev;
      const next = { ...prev, terminal: { ...prev.terminal, shell_args: parsed.args } };
      void saveConfig(next);
      return next;
    });
  };

  /** Apply imported or profile config through the same migration/sync path. */
  const applyImportedConfig = (text: string): AppConfig => {
    const next = parseConfigImport(text, draft);
    setDraft(next);
    setShellArgsText(formatShellArgs(next.terminal.shell_args));
    setShellArgsError(null);
    void saveConfig(next);
    return next;
  };

  /** Export the current draft as a shareable JSON file into a picked folder. */
  const exportConfig = async () => {
    const toast = useAppStore.getState().toast;
    try {
      const json = serializeConfig(draft, APP_VERSION);
      const dir = await ipc.pickDirectory();
      if (!dir) return;
      const file = `${dir.replace(/[\\/]+$/, "")}/luxor-settings.json`;
      await ipc.fsWriteText(file, json);
      toast(`Settings exported to ${file}`, "success");
    } catch (e) {
      toast(`Export failed: ${errorMessage(e)}`, "error");
    }
  };

  /** Import a settings JSON over the current draft (saved on Save). */
  const importConfig = async () => {
    const toast = useAppStore.getState().toast;
    try {
      const file = await ipc.pickFile();
      if (!file) return;
      const { content } = await ipc.fsReadText(file);
      applyImportedConfig(content);
      toast("Settings imported — applied automatically", "success");
    } catch (e) {
      toast(`Import failed: ${errorMessage(e)}`, "error");
    }
  };

  /** Persist a new profile list to storage and state together. */
  const persistProfiles = (next: SettingsProfile[]) => {
    const capped = next.slice(0, 20);
    saveProfiles(capped);
    setProfiles(capped);
  };

  const saveProfile = async () => {
    const toast = useAppStore.getState().toast;
    try {
      const name = await useUiStore.getState().prompt({ title: t("settings.profile_name", "Profile name"), placeholder: "e.g. Dark + large fonts" });
      if (!name?.trim()) return;
      const updated = createProfile(name.trim(), draft);
      persistProfiles([updated, ...profiles]);
      toast(`Profile "${name}" saved`, "success");
    } catch (e) {
      toast(`Failed to save profile: ${errorMessage(e)}`, "error");
    }
  };

  const applyProfile = (profile: SettingsProfile) => {
    const toast = useAppStore.getState().toast;
    try {
      applyImportedConfig(JSON.stringify(profile.config));
      toast(`Profile "${profile.name}" loaded — applied automatically`, "info");
    } catch (e) {
      toast(`Profile "${profile.name}" is invalid: ${errorMessage(e)}`, "error");
    }
  };

  const removeProfile = (id: string) => {
    setProfiles(deleteProfile(id));
  };

  /** Apply a built-in quick preset (partial patch, type-checked merge). */
  const applyBuiltinPreset = (presetId: string) => {
    const toast = useAppStore.getState().toast;
    const preset = BUILTIN_PRESETS.find((p) => p.id === presetId);
    if (!preset) return;
    try {
      applyImportedConfig(JSON.stringify(preset.patch));
      toast(t("settings.preset_applied", `Preset "${preset.name}" applied`), "success");
    } catch (e) {
      toast(`Failed to apply preset: ${errorMessage(e)}`, "error");
    }
  };

  /**
   * Copy a share string for one saved profile. Clipboard access can be denied
   * (WebView policies, Linux portals) — fall back to a dialog whose input is
   * preselected so the user can copy the link manually.
   */
  const shareProfile = async (profile: SettingsProfile) => {
    const toast = useAppStore.getState().toast;
    const url = encodePresetToUrl(profile.name, profile.config, profile.description);
    if (!url) {
      toast("Failed to encode preset", "error");
      return;
    }
    try {
      await navigator.clipboard.writeText(url);
      toast(t("settings.preset_copied", `Preset "${profile.name}" copied — send it to anyone`), "success");
    } catch {
      // Clipboard blocked: show the link in a prompt for manual copying.
      await useUiStore.getState().prompt({
        title: t("settings.share_preset", "Copy share link"),
        message: t("settings.share_preset_manual", "Clipboard is unavailable — copy the link below manually."),
        initial: url,
        confirmLabel: t("Done"),
      });
    }
  };

  /** Import a shared preset string: saves it as a profile and applies it. */
  const importPresetText = (text: string): boolean => {
    const toast = useAppStore.getState().toast;
    const shared = decodePresetFromUrl(text);
    if (shared) {
      const next = applyImportedConfig(JSON.stringify(shared.config));
      const profile = createProfile(shared.name, next, shared.description);
      persistProfiles([profile, ...profiles.filter((p) => p.name !== shared.name)]);
      toast(t("settings.preset_imported", `Preset "${shared.name}" imported and applied`), "success");
      return true;
    }
    // Fall back to whole-config settings URLs so one button handles both.
    const config = decodeConfigFromUrl(text);
    if (!config) return false;
    applyImportedConfig(JSON.stringify(config));
    toast("Settings imported from URL — applied automatically", "success");
    return true;
  };

  /** Import a shared preset from the clipboard, with a manual-paste fallback. */
  const importPresetFromClipboard = async () => {
    const toast = useAppStore.getState().toast;
    try {
      let text = "";
      try {
        text = (await navigator.clipboard.readText()) ?? "";
      } catch {
        /* clipboard read denied — ask below */
      }
      if (!text.trim() || !importPresetText(text)) {
        // No usable clipboard content: let the user paste the link directly.
        const pasted = await useUiStore.getState().prompt({
          title: t("settings.import_preset", "Paste a shared preset link"),
          placeholder: "luxor://preset#…",
        });
        if (!pasted?.trim()) return;
        if (!importPresetText(pasted)) {
          toast("Not a valid Luxor preset or settings link", "error");
        }
      }
    } catch (e) {
      toast(`Import failed: ${errorMessage(e)}`, "error");
    }
  };

  // Phase 21: Share config via URL
  const shareConfigUrl = async () => {
    const toast = useAppStore.getState().toast;
    try {
      const url = encodeConfigToUrl(draft);
      if (!url) {
        toast("Failed to encode config", "error");
        return;
      }
      await navigator.clipboard?.writeText(url);
      toast("Settings URL copied to clipboard", "success");
    } catch (e) {
      toast(`Failed to share: ${errorMessage(e)}`, "error");
    }
  };

  // Phase 21: Import config from URL (check clipboard for a luxor:// URL)
  const importConfigFromUrl = async () => {
    const toast = useAppStore.getState().toast;
    try {
      const text = await navigator.clipboard?.readText();
      if (!text) {
        toast("Clipboard is empty", "info");
        return;
      }
      const config = decodeConfigFromUrl(text);
      if (!config) {
        toast("No Luxor settings URL found in clipboard", "error");
        return;
      }
      applyImportedConfig(JSON.stringify(config));
      toast("Settings imported from URL — applied automatically", "success");
    } catch (e) {
      toast(`Import failed: ${errorMessage(e)}`, "error");
    }
  };
  const accentValid = /^#[0-9a-fA-F]{6}$/.test(draft.accent_color.trim());
  // Color shown in the live preview: the chosen accent when valid, otherwise
  // the current theme's default so the preview never goes blank while typing.
  const accentPreview = accentValid ? draft.accent_color.trim() : themeMeta(resolveTheme(draft.theme)).accent;

  return (
    <div
      className={`lx-settings-modal fixed inset-0 z-[var(--lx-z-overlay)] flex items-center justify-center bg-black/60 p-3 ${leaving ? "lx-modal-leaving" : ""}`} style={{ backdropFilter: "blur(4px)", WebkitBackdropFilter: "blur(4px)" }}
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      aria-label={t("Settings")}
      onClick={() => setOpen(false)}
    >
      <div
        className="lx-glass flex h-[44rem] max-h-[92vh] w-[58rem] max-w-[98vw] overflow-hidden text-sm"
        style={
          {
            borderRadius: "var(--lx-radius-xl)",
            // CSS zoom scales layout + text together; the max caps are divided
            // by the scale so the zoomed dialog never overflows the viewport.
            ...(scale !== 1
              ? { zoom: scale, maxWidth: `calc(98vw / ${scale})`, maxHeight: `calc(92vh / ${scale})` }
              : {}),
          } as React.CSSProperties
        }
        data-testid="settings-modal"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Section nav */}
        <nav className="flex w-48 shrink-0 flex-col border-r border-edge bg-surface/35 p-2">
          <div className="px-2 pb-1 pt-1 text-lg font-semibold text-strong">Settings</div>
          <div className="px-2 pb-2 text-2xs leading-4 text-muted">Search, tune and export your Luxor workspace.</div>
          <div className="mb-2 flex items-center gap-1.5 rounded-lg border border-edge bg-raised px-2 py-1.5 transition-colors focus-within:border-transparent">
            <Search size={12} className="shrink-0 text-muted" />
            <input
              ref={searchRef}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t("Search settings…")}
              aria-label={t("Search settings")}
              className="w-full bg-transparent text-xs text-strong outline-none placeholder:text-muted"
            />
            {search && (
              <button
                onClick={() => setSearch("")}
                aria-label={t("Clear search")}
                title={t("Clear")}
                className="shrink-0 rounded p-0.5 text-muted transition-colors hover:bg-surface hover:text-strong"
              >
                <X size={12} />
              </button>
            )}
          </div>
          {(() => {
            const q = search.toLowerCase().trim();
            const found = searchSettings(search);
            const visible = SECTIONS.filter((s) => {
              if (!q) return true;
              return (
                s.label.toLowerCase().includes(q) ||
                SECTION_KEYWORDS[s.id].includes(q) ||
                found.sections.includes(s.id)
              );
            });
            if (q && visible.length === 0)
              return (
                <div className="m-1 rounded-lg border border-dashed border-edge px-3 py-5 text-center text-xs text-muted">
                  <Search size={16} className="mx-auto mb-2 text-muted" />
                  <div className="font-medium text-strong">No settings match</div>
                  <div className="mt-1 leading-4">Try another keyword or clear search to browse all sections.</div>
                </div>
              );
            return (
              <>
                {q && (
                  <div className="mb-1 px-2 text-3xs uppercase tracking-wider text-muted">
                    {visible.length} section{visible.length > 1 ? "s" : ""} match
                  </div>
                )}
                {visible.map((s) => (
                  <button
                    key={s.id}
                    onClick={() => setSection(s.id)}
                    className={`relative flex w-full flex-col rounded-md px-2 py-2 text-left transition-colors duration-200 ${
                      section === s.id
                        ? "bg-surface text-strong lx-active-strip"
                        : "text-muted hover:bg-raised/60 hover:text-strong"
                    }`}
                  >
                    <span className="flex items-center gap-2">
                      <s.icon size={14} className={`shrink-0 ${section === s.id ? "text-accent opacity-100" : "opacity-80"}`} />
                      {t(`settings.section.${s.id}`, s.label)}
                    </span>
                    {q && (found.matches[s.id]?.length ?? 0) > 0 && (
                      <span className="mt-0.5 truncate pl-6 text-2xs text-muted" data-testid={`settings-hit-${s.id}`}>
                        {found.matches[s.id]!.join(" · ")}
                      </span>
                    )}
                  </button>
                ))}
              </>
            );
          })()}
          {/* Modal scale controls (Ctrl+= / Ctrl+- / Ctrl+0 while open).
              Full-bleed (-mx-2 -mb-2) and h-8 to exactly match the content
              pane's footer bar, so both border-t lines form one straight line. */}
          <div
            className="-mx-2 -mb-2 mt-auto flex h-8 shrink-0 items-center justify-between border-t border-edge bg-surface/35 px-3 text-2xs text-muted"
            title={`${t("settings.scale_hint", "Resize this window")}: Ctrl+= / Ctrl+- · Ctrl+0`}
          >
            <span>{t("settings.scale", "Window scale")}</span>
            <div className="flex items-center gap-0.5">
              <button
                onClick={() => bumpScale(-SETTINGS_SCALE_STEP)}
                aria-label={t("Zoom out")}
                className="rounded p-0.5 hover:bg-raised hover:text-strong"
              >
                <Minus size={11} />
              </button>
              <button
                onClick={resetScale}
                title={t("Reset (Ctrl+0)")}
                className="min-w-9 rounded px-1 py-0.5 tabular-nums hover:bg-raised hover:text-strong"
                data-testid="settings-scale"
              >
                {Math.round(scale * 100)}%
              </button>
              <button
                onClick={() => bumpScale(SETTINGS_SCALE_STEP)}
                aria-label={t("Zoom in")}
                className="rounded p-0.5 hover:bg-raised hover:text-strong"
              >
                <Plus size={11} />
              </button>
            </div>
          </div>
        </nav>

        {/* Section body — keyed on `section` so switching tabs replays a quick
            fade/slide entrance instead of an abrupt content swap. */}
        <div className="flex min-w-0 flex-1 flex-col">
          <div key={section} className="lx-anim-fade-in min-h-0 flex-1 overflow-auto p-4">
            {/* Compact section heading: a boxed card here wasted a full row of
                vertical space before the first setting appeared. */}
            <div className="mb-3 border-b border-edge/50 px-2 pb-3">
              <div className="flex items-center gap-2 text-base font-semibold text-strong">
                {(() => {
                  const active = SECTIONS.find((s) => s.id === section);
                  const Icon = active?.icon;
                  return <>{Icon && <Icon size={16} className="text-accent" />} {active?.label}</>;
                })()}
              </div>
              <div className="mt-0.5 text-xs leading-5 text-muted">{t(`settings.desc.${section}`, SECTION_DESCRIPTIONS[section])}</div>
            </div>
            {section === "appearance" && (
              <>
                <div className="mb-3">
                  <div className="mb-2 text-muted">Theme</div>
                  <div className="grid grid-cols-3 gap-2">
                    {THEMES.map((t) => (
                      <button
                        key={t.id}
                        onClick={() => set({ theme: t.id })}
                        className={`flex items-center gap-2 rounded-lg border px-2 py-2 text-left text-xs ${
                          draft.theme === t.id
                            ? "border-muted bg-raised text-strong"
                            : "border-edge text-muted hover:border-strong/40 hover:text-strong"
                        }`}
                      >
                        <span className="flex shrink-0 overflow-hidden rounded border border-edge">
                          {t.swatch.map((c) => (
                            <span key={c} className="h-5 w-2.5" style={{ background: c }} />
                          ))}
                        </span>
                        <span className="truncate">{t.label}</span>
                      </button>
                    ))}
                  </div>
                  <p className="mt-1 text-xs text-muted">System follows the OS light/dark preference.</p>
                </div>
                <Row label="Code editor theme" help="Syntax colors for the editor and diff views.">
                  <select
                    value={draft.ui.editor_theme ?? "luxor-dark"}
                    onChange={(e) => set({ ui: { ...draft.ui, editor_theme: e.target.value } })}
                    className="rounded border border-edge bg-raised px-2 py-1 text-xs text-strong outline-none focus:border-muted"
                  >
                    {EDITOR_THEMES.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.label}
                        {t.light ? " (light)" : ""}
                      </option>
                    ))}
                  </select>
                </Row>
                <Row label="Editor minimap" help="Code overview strip on the right edge of editor panels.">
                  <Toggle
                    checked={draft.ui.editor_minimap}
                    onChange={(v) => set({ ui: { ...draft.ui, editor_minimap: v } })}
                  />
                </Row>
                <Row
                  label={t("settings.editor_autosave", "Editor autosave")}
                  help={t(
                    "settings.editor_autosave.hint",
                    "Save edited files automatically ~1 second after the last change.",
                  )}
                >
                  <Toggle
                    checked={draft.ui.editor_autosave}
                    onChange={(v) => set({ ui: { ...draft.ui, editor_autosave: v } })}
                  />
                </Row>
                <Row label="Project tabs">
                  <Select
                    value={draft.tab_bar_position}
                    options={["top", "side"]}
                    onChange={(pos) => set({ tab_bar_position: pos as AppConfig["tab_bar_position"] })}
                  />
                </Row>
                <Row
                  label="Accent color"
                  help="The highlight color used across the app: primary buttons, toggles, links, the active sidebar tab, focus rings, selections and more."
                >
                  <div className="flex flex-wrap items-center gap-2">
                    {ACCENT_SWATCHES.map((c) => {
                      const selected = draft.accent_color.toLowerCase() === c.toLowerCase();
                      return (
                        <button
                          key={c}
                          title={c}
                          aria-label={`Accent ${c}`}
                          aria-pressed={selected}
                          onClick={() => set({ accent_color: c })}
                          style={{ background: c }}
                          className={`relative flex h-6 w-6 items-center justify-center rounded-full ring-2 transition-transform hover:scale-110 ${
                            selected ? "ring-strong" : "ring-transparent"
                          }`}
                        >
                          {selected && <Check size={12} className="text-black/80" strokeWidth={3} />}
                        </button>
                      );
                    })}
                    {/* Native OS color picker for anything off-palette. */}
                    <label
                      className="relative h-6 w-6 shrink-0 cursor-pointer overflow-hidden rounded-full ring-2 ring-edge"
                      title={t("Custom color…")}
                    >
                      <span
                        className="absolute inset-0"
                        style={{ background: "conic-gradient(red,#f97316,#facc15,#22c55e,#38bdf8,#3b82f6,#a78bfa,#e879f9,red)" }}
                      />
                      <input
                        type="color"
                        value={accentValid ? draft.accent_color : "#e8b059"}
                        onChange={(e) => set({ accent_color: e.target.value })}
                        className="absolute -inset-2 cursor-pointer opacity-0"
                      />
                    </label>
                    <input
                      value={draft.accent_color}
                      spellCheck={false}
                      onChange={(e) => set({ accent_color: e.target.value })}
                      className={`w-24 rounded border bg-raised px-2 py-1 font-mono text-xs text-strong outline-none ${
                        accentValid ? "border-edge focus:border-muted" : "border-danger"
                      }`}
                    />
                    <button
                      onClick={() => set({ accent_color: themeMeta(resolveTheme(draft.theme)).accent })}
                      className="rounded border border-edge px-2 py-1 text-xs text-muted hover:border-accent hover:text-accent"
                    >
                      Reset
                    </button>
                  </div>
                </Row>
                <Row
                  label="Transparent elements"
                  help="Semi-transparent menus, popups, modals and sidebars with a blur behind them. Content panes (terminal, editor) stay opaque."
                >
                  <Toggle
                    checked={draft.ui.glass_enabled ?? true}
                    onChange={(v) => set({ ui: { ...draft.ui, glass_enabled: v } })}
                  />
                </Row>
                {(draft.ui.glass_enabled ?? true) && (
                  <Row label="Transparency strength" help="How see-through the glass surfaces are (0 = opaque).">
                    <div className="flex items-center gap-2">
                      <input
                        type="range"
                        min={0}
                        max={60}
                        step={5}
                        value={draft.ui.glass_opacity ?? 20}
                        onChange={(e) => set({ ui: { ...draft.ui, glass_opacity: Number(e.target.value) } })}
                        className="w-40"
                      />
                      <span className="w-8 text-right tabular-nums text-muted">{draft.ui.glass_opacity ?? 20}%</span>
                    </div>
                  </Row>
                )}
                {!accentValid && (
                  <p className="mb-2 text-xs text-danger">Use a hex color like #e8b059.</p>
                )}
                {/* Live preview — updates instantly as the accent changes. */}
                <div className="mb-3 rounded-lg border border-edge bg-surface/40 p-3">
                  <div className="mb-2 text-3xs uppercase tracking-wider text-muted">Preview</div>
                  <div className="flex flex-wrap items-center gap-2.5">
                    <button
                      className="rounded-md px-3 py-1.5 text-xs font-semibold text-on-accent shadow-sm"
                      style={{ background: accentPreview }}
                    >
                      Primary
                    </button>
                    <button
                      className="rounded-md border bg-transparent px-3 py-1.5 text-xs font-medium"
                      style={{ borderColor: accentPreview, color: accentPreview }}
                    >
                      Outline
                    </button>
                    <span
                      className="rounded-md px-2 py-1 text-xs font-semibold"
                      style={{ background: `color-mix(in srgb, ${accentPreview} 16%, transparent)`, color: accentPreview }}
                    >
                      Badge
                    </span>
                    <span className="cursor-pointer text-xs font-medium underline underline-offset-2" style={{ color: accentPreview }}>
                      A link
                    </span>
                    <span
                      className="relative inline-block h-5 w-9 shrink-0 rounded-full"
                      style={{ background: accentPreview }}
                      aria-hidden
                    >
                      <span className="absolute left-[1.15rem] top-0.5 h-4 w-4 rounded-full bg-white shadow" />
                    </span>
                    <span
                      className="rounded px-1 text-xs text-strong"
                      style={{ background: `color-mix(in srgb, ${accentPreview} 32%, transparent)` }}
                    >
                      selected text
                    </span>
                  </div>
                </div>
                <Row label="UI font" help="Font family for the whole interface. Pick a preset or type any installed font.">
                  <FontPicker
                    value={draft.ui.ui_font ?? ""}
                    options={UI_FONTS}
                    onChange={(v) => set({ ui: { ...draft.ui, ui_font: v } })}
                  />
                </Row>
                <Row label="Monospace font" help="Font for code blocks and markdown (terminal font is set in the Terminal tab).">
                  <FontPicker
                    value={draft.ui.mono_font ?? ""}
                    options={MONO_FONTS}
                    onChange={(v) => set({ ui: { ...draft.ui, mono_font: v } })}
                  />
                </Row>
                <Row label="UI text scale (%)" help="Scales interface text (100 = default). Independent of the whole-app zoom.">
                  <NumberInput
                    value={draft.ui.ui_font_scale ?? 100}
                    min={80}
                    max={130}
                    onChange={(v) => set({ ui: { ...draft.ui, ui_font_scale: v } })}
                  />
                </Row>
                <Row label="Confirm destructive actions" help="Ask before discard, branch delete, project removal.">
                  <Toggle
                    checked={draft.confirm_destructive}
                    onChange={(v) => set({ confirm_destructive: v })}
                  />
                </Row>
                <Row wide label="Share settings" help="Export the whole config as JSON (themes, hotkeys, everything) or apply someone else's file.">
                  <span className="flex flex-wrap items-center gap-1.5">
                    <button
                      className="flex items-center gap-1 rounded border border-edge px-2.5 py-1 text-xs text-muted hover:border-accent hover:text-accent"
                      data-testid="settings-export"
                      onClick={() => void exportConfig()}
                    >
                      <Download size={12} /> Export…
                    </button>
                    <button
                      className="flex items-center gap-1 rounded border border-edge px-2.5 py-1 text-xs text-muted hover:border-accent hover:text-accent"
                      data-testid="settings-import"
                      onClick={() => void importConfig()}
                    >
                      <Upload size={12} /> Import…
                    </button>
                    <button
                      className="flex items-center gap-1 rounded border border-edge px-2.5 py-1 text-xs text-muted hover:border-accent hover:text-accent"
                      onClick={() => void shareConfigUrl()}
                      title={t("settings.share_url", "Copy a shareable URL")}
                    >
                      <Copy size={12} /> URL
                    </button>
                    <button
                      className="flex items-center gap-1 rounded border border-edge px-2.5 py-1 text-xs text-muted hover:border-accent hover:text-accent"
                      onClick={() => void importConfigFromUrl()}
                      title={t("settings.import_url", "Import from URL in clipboard")}
                    >
                      <Upload size={12} /> From URL
                    </button>
                  </span>
                </Row>

                {/* Built-in quick presets: one-click partial patches. */}
                <Row
                  wide
                  label={t("settings.quick_presets", "Quick presets")}
                  help={t("settings.quick_presets_help", "One-click setups. Each changes only its own settings — hotkeys, shells and paths stay untouched.")}
                >
                  <span className="grid w-full grid-cols-1 gap-1.5 sm:grid-cols-2">
                    {BUILTIN_PRESETS.map((p) => {
                      const PresetIcon = PRESET_ICONS[p.id] ?? Rocket;
                      return (
                        <button
                          key={p.id}
                          onClick={() => applyBuiltinPreset(p.id)}
                          className="group flex items-start gap-2.5 rounded-md border border-edge bg-raised px-3 py-2 text-left transition-colors hover:border-accent"
                          data-testid={`preset-${p.id}`}
                        >
                          <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-edge text-muted transition-colors group-hover:border-accent group-hover:text-accent">
                            <PresetIcon size={14} />
                          </span>
                          <span className="min-w-0">
                            <span className="block text-xs font-semibold">{t(`preset.${p.id}.name`, p.name)}</span>
                            <span className="block text-2xs leading-snug text-muted">{t(`preset.${p.id}.desc`, p.description)}</span>
                          </span>
                        </button>
                      );
                    })}
                  </span>
                </Row>

                {/* Phase 21: Settings profiles (custom presets, shareable). */}
                <Row
                  wide
                  label={t("settings.profiles", "My presets")}
                  help={t("settings.profiles_help", "Named presets you can switch instantly, share as a link, or import from a link.")}
                >
                  <span className="flex flex-wrap items-center gap-1.5">
                    <button
                      className="flex items-center gap-1 rounded border border-edge px-2.5 py-1 text-xs text-muted hover:border-accent hover:text-accent"
                      onClick={() => void saveProfile()}
                    >
                      <Plus size={12} /> {t("Save preset")}
                    </button>
                    <button
                      className="flex items-center gap-1 rounded border border-edge px-2.5 py-1 text-xs text-muted hover:border-accent hover:text-accent"
                      onClick={() => void importPresetFromClipboard()}
                      title={t("settings.import_preset", "Paste a shared preset link from the clipboard")}
                      data-testid="preset-import"
                    >
                      <Upload size={12} /> {t("Paste preset")}
                    </button>
                    {profiles.length === 0 && (
                      <span className="w-full rounded-md border border-dashed border-edge px-3 py-2 text-2xs text-muted">
                        {t("settings.no_presets", "No saved presets yet. Save the current settings, or paste a preset link a friend shared with you.")}
                      </span>
                    )}
                    {profiles.map((p) => (
                      <span
                        key={p.id}
                        className="flex items-center gap-1.5 rounded-md border border-edge bg-raised px-2.5 py-1.5 text-xs"
                      >
                        <button
                          onClick={() => applyProfile(p)}
                          className="font-medium hover:text-accent"
                          title={p.description ?? t("settings.apply_preset", "Apply this preset")}
                        >
                          {p.name}
                        </button>
                        <button
                          onClick={() => void shareProfile(p)}
                          className="rounded p-0.5 text-muted hover:text-accent"
                          title={t("settings.share_preset", "Copy share link")}
                          aria-label={t("settings.share_preset_named", `Share preset ${p.name}`)}
                        >
                          <Copy size={11} />
                        </button>
                        <button
                          onClick={() => removeProfile(p.id)}
                          className="rounded p-0.5 text-muted hover:text-danger"
                          title={t("Delete")}
                          aria-label={t("settings.delete_preset_named", `Delete preset ${p.name}`)}
                        >
                          <Trash2 size={11} />
                        </button>
                      </span>
                    ))}
                  </span>
                </Row>
              </>
            )}

            {section === "interface" && (
              <>
                <Row
                  label={t("settings.language", "UI language")}
                  help={t("settings.language.hint", "Language of interface elements. Applies immediately.")}
                >
                  <Select
                    value={draft.ui.language ?? "en"}
                    options={LANGUAGES.map((l) => l.id)}
                    labels={Object.fromEntries(LANGUAGES.map((l) => [l.id, l.label]))}
                    onChange={(v) => set({ ui: { ...draft.ui, language: v } })}
                  />
                </Row>
                <Row
                  label={t("settings.updates.repo", "Update repo (owner/repo)")}
                  help={t("settings.updates.repo.hint", "GitHub repository that publishes Luxor releases.")}
                >
                  <input
                    value={draft.ui.update_repo ?? ""}
                    onChange={(e) => set({ ui: { ...draft.ui, update_repo: e.target.value.trim() } })}
                    placeholder="owner/repo"
                    className="w-48 rounded border border-edge bg-raised px-2 py-1 text-strong outline-none focus:border-muted"
                  />
                </Row>
                <Row
                  label={t("settings.diag", "Diagnostics")}
                  help={t("settings.diag.hint", "Save a report with the app version, OS, config, crash reports and the recent error/freeze log — attach it when reporting a problem.")}
                >
                  <DiagExportButton />
                </Row>
                <Row
                  label={t("settings.plusmenu", "\"+\" menu panels")}
                  help={t("settings.plusmenu.hint", "Choose which panels appear in the tab-strip \"+\" menu (click or right-click the + button).")}
                >
                  <div className="grid max-w-md grid-cols-2 gap-x-4 gap-y-1">
                    {PLUS_MENU_PANELS.map((def) => {
                      const hidden = draft.ui.plus_menu_hidden ?? [];
                      const isHidden = hidden.includes(def.kind);
                      return (
                        <label key={def.kind} className="flex cursor-pointer items-center gap-2 text-xs text-muted hover:text-strong">
                          <input
                            type="checkbox"
                            checked={!isHidden}
                            onChange={() =>
                              set({
                                ui: {
                                  ...draft.ui,
                                  plus_menu_hidden: isHidden
                                    ? hidden.filter((k) => k !== def.kind)
                                    : [...hidden, def.kind],
                                },
                              })
                            }
                          />
                          <def.icon size={12} className="opacity-70" />
                          {t(`panel.${def.kind}`, def.label)}
                        </label>
                      );
                    })}
                  </div>
                </Row>
                <Row label="Tab bar height (px)" help="Height of the top project tab bar.">
                  <NumberInput
                    value={draft.ui.topbar_size}
                    min={28}
                    max={64}
                    onChange={(v) => set({ ui: { ...draft.ui, topbar_size: v } })}
                  />
                </Row>
                <Row label="Sidebar width (px)" help="Width of the side tab bar (drag its edge to resize too).">
                  <NumberInput
                    value={draft.ui.sidebar_width}
                    min={140}
                    max={420}
                    onChange={(v) => set({ ui: { ...draft.ui, sidebar_width: v } })}
                  />
                </Row>
                <Row label="Tab rounding (px)" help="0 = square tabs, 6–8 = subtle rounded default, 18 = very round.">
                  <NumberInput
                    value={draft.ui.tab_radius ?? 7}
                    min={0}
                    max={18}
                    onChange={(v) => set({ ui: { ...draft.ui, tab_radius: v } })}
                  />
                </Row>
  <Row
  label="Active tab outline"
  help="Off (default): the selected tab is shown by its background colour only and melts into the panel. On: adds a visible border + soft lift around the active tab."
  >
  <Toggle
  checked={draft.ui.tab_outline ?? false}
  onChange={(v) => set({ ui: { ...draft.ui, tab_outline: v } })}
  />
                </Row>
                <Row label="Left sidebar icon mode" help="Collapse the left side panel to a clickable icon rail instead of hiding it completely.">
                  <Toggle
                    checked={draft.ui.left_sidebar_collapsed ?? false}
                    onChange={(v) => set({ ui: { ...draft.ui, left_sidebar_collapsed: v } })}
                  />
                </Row>
                <Row label="Left sidebar icon position" help="Place collapsed side-panel/action-rail icons at the top, center or bottom of the left edge.">
                  <Select
                    value={draft.ui.left_sidebar_icon_position ?? "top"}
                    options={["top", "middle", "bottom"]}
                    labels={{ top: "Top", middle: "Middle", bottom: "Bottom" }}
                    onChange={(v) =>
                      set({
                        ui: {
                          ...draft.ui,
                          left_sidebar_icon_position: v as AppConfig["ui"]["left_sidebar_icon_position"],
                        },
                      })
                    }
                  />
                </Row>
                <Row
                  label="Web browser panel"
                  help="Adds a Browser nav button (iframe + native app windows). Off by default — uses no resources unless opened."
                >
                  <Toggle
                    checked={draft.ui.browser_enabled ?? false}
                    onChange={(v) => set({ ui: { ...draft.ui, browser_enabled: v } })}
                  />
                </Row>
                <Row
                  label={t("Keep running in the background")}
                  help={t("The window close button (X) hides Luxor to the system tray instead of quitting — terminals and agents keep running. Reopen from the tray icon; fully quit from its menu. Turn this off to make X quit Luxor.")}
                >
                  <Toggle
                    checked={draft.ui.close_to_tray ?? true}
                    onChange={(v) => set({ ui: { ...draft.ui, close_to_tray: v } })}
                  />
                </Row>
                <Row
                  label="Launch on startup"
                  help="Start Luxor automatically when you log in. Off by default; disabling removes the OS startup entry."
                >
                  <Toggle
                    checked={draft.ui.launch_on_startup ?? false}
                    onChange={(v) => set({ ui: { ...draft.ui, launch_on_startup: v } })}
                  />
                </Row>
                <Row
                  label="Allow second window"
                  help="Adds a 'New window' entry to the tray menu and below — handy for a second monitor. Terminals live per-window."
                >
                  <Toggle
                    checked={draft.ui.allow_second_window ?? false}
                    onChange={(v) => set({ ui: { ...draft.ui, allow_second_window: v } })}
                  />
                </Row>
                {(draft.ui.allow_second_window ?? false) && (
                  <Row label="Open new window" help="Opens another full Luxor window now.">
                    <button
                      className="rounded border border-edge px-2 py-1 text-xs hover:bg-raised"
                      onClick={() =>
                        void ipcExtra.windowOpenNew().catch((e) => useAppStore.getState().toast(errorMessage(e), "error"))
                      }
                    >
                      {t("settings.open_window", "Open window")}
                    </button>
                  </Row>
                )}
                {/* Tray menu — choose which rows the tray popup shows, with a
                    live preview that mirrors the real popup exactly. */}
                <div className="mt-2 rounded-lg border border-edge bg-bar/30 p-3">
                  <div className="mb-2 flex items-center justify-between">
                    <div className="text-xs font-semibold text-strong">{t("Tray menu", "Tray menu")}</div>
                    <div className="text-2xs text-muted">{t("Right-click the tray icon", "Right-click the tray icon")}</div>
                  </div>
                  <div className="flex flex-col gap-4 md:flex-row">
                    <div className="flex-1 space-y-1">
                      <Row label="Recent projects" help="List recent projects in the tray menu.">
                        <Toggle
                          checked={(draft.ui.tray ?? DEFAULT_TRAY).show_projects}
                          onChange={(v) =>
                            set({ ui: { ...draft.ui, tray: { ...(draft.ui.tray ?? DEFAULT_TRAY), show_projects: v } } })
                          }
                        />
                      </Row>
                      <Row label="New terminal" help="Open a terminal in the active project.">
                        <Toggle
                          checked={(draft.ui.tray ?? DEFAULT_TRAY).show_new_terminal}
                          onChange={(v) =>
                            set({ ui: { ...draft.ui, tray: { ...(draft.ui.tray ?? DEFAULT_TRAY), show_new_terminal: v } } })
                          }
                        />
                      </Row>
                      <Row label="New window" help="Requires ‘Allow second window’ above.">
                        <Toggle
                          checked={(draft.ui.tray ?? DEFAULT_TRAY).show_new_window}
                          onChange={(v) =>
                            set({ ui: { ...draft.ui, tray: { ...(draft.ui.tray ?? DEFAULT_TRAY), show_new_window: v } } })
                          }
                        />
                      </Row>
                      <Row label="Settings" help="Open Luxor settings from the tray.">
                        <Toggle
                          checked={(draft.ui.tray ?? DEFAULT_TRAY).show_settings}
                          onChange={(v) =>
                            set({ ui: { ...draft.ui, tray: { ...(draft.ui.tray ?? DEFAULT_TRAY), show_settings: v } } })
                          }
                        />
                      </Row>
                      <Row label="‘Keep running’ toggle" help="Show the background-mode checkbox in the menu.">
                        <Toggle
                          checked={(draft.ui.tray ?? DEFAULT_TRAY).show_close_to_tray}
                          onChange={(v) =>
                            set({ ui: { ...draft.ui, tray: { ...(draft.ui.tray ?? DEFAULT_TRAY), show_close_to_tray: v } } })
                          }
                        />
                      </Row>
                    </div>
                    <div className="shrink-0 md:w-[256px]">
                      <div className="mb-1.5 text-3xs uppercase tracking-wider text-muted">{t("Preview", "Preview")}</div>
                      <div className="pointer-events-none select-none rounded-lg" style={{ width: 256, boxShadow: "var(--lx-shadow-lg)" }}>
                        <TrayMenu
                          config={draft.ui.tray ?? DEFAULT_TRAY}
                          projects={TRAY_PREVIEW_PROJECTS}
                          closeToTray={draft.ui.close_to_tray ?? true}
                          allowSecondWindow={draft.ui.allow_second_window ?? false}
                          preview
                        />
                      </div>
                    </div>
                  </div>
                </div>
                <Row label="Side panel" help="Compact info panel on the left with configurable widgets.">
                  <Toggle
                    checked={draft.ui.side_panel_enabled ?? false}
                    onChange={(v) => set({ ui: { ...draft.ui, side_panel_enabled: v } })}
                  />
                </Row>
                {(draft.ui.side_panel_enabled ?? false) && (
                  <>
                    <Row label="Side panel width (px)">
                      <NumberInput
                        value={draft.ui.side_panel_width ?? 260}
                        min={180}
                        max={480}
                        onChange={(v) => set({ ui: { ...draft.ui, side_panel_width: v } })}
                      />
                    </Row>
                    <Row label="Side panel widgets" help="Pick what the panel shows.">
                      <div className="flex flex-wrap gap-1.5">
                        {SIDE_PANEL_WIDGETS.map((w) => {
                          const list = draft.ui.side_panel_widgets?.length
                            ? draft.ui.side_panel_widgets
                            : DEFAULT_SIDE_WIDGETS;
                          const on = list.includes(w.id);
                          return (
                            <button
                              key={w.id}
                              onClick={() =>
                                set({
                                  ui: {
                                    ...draft.ui,
                                    side_panel_widgets: on
                                      ? list.filter((x) => x !== w.id)
                                      : [...list, w.id],
                                  },
                                })
                              }
                              className={`rounded border px-2 py-0.5 text-xs ${
                                on
                                  ? "border-accent text-accent"
                                  : "border-edge text-muted hover:text-strong"
                              }`}
                            >
                              {t(w.label)}
                            </button>
                          );
                        })}
                      </div>
                    </Row>
                  </>
                )}
                <Row label="Right panel" help="Configurable panel on the right with diverse widgets (clock, scratchpad, git, quick launch, …).">
                  <Toggle
                    checked={draft.ui.right_panel_enabled ?? false}
                    onChange={(v) => set({ ui: { ...draft.ui, right_panel_enabled: v } })}
                  />
                </Row>
                {(draft.ui.right_panel_enabled ?? false) && (
                  <>
                    <Row label="Right panel width (px)">
                      <NumberInput
                        value={draft.ui.right_panel_width ?? 280}
                        min={200}
                        max={520}
                        onChange={(v) => set({ ui: { ...draft.ui, right_panel_width: v } })}
                      />
                    </Row>
                    <Row
                      label="Right panel widgets"
                      help="Click to toggle. Reorder, tint and tune widgets with the pencil icon in the panel itself."
                    >
                      <div className="flex flex-wrap gap-1.5">
                        {RIGHT_PANEL_WIDGETS.map((w) => {
                          // Write through the rich per-widget config so panel-side
                          // customization (order, accents, options) is preserved.
                          const rp = parseRightPanelConfig(
                            draft.ui.right_panel_config ?? "",
                            draft.ui.right_panel_widgets ?? [],
                          );
                          const on = rp.widgets.some((x) => x.id === w.id && x.enabled);
                          return (
                            <button
                              key={w.id}
                              onClick={() => {
                                const next = setWidgetEnabled(rp, w.id as RightWidgetId, !on);
                                set({
                                  ui: {
                                    ...draft.ui,
                                    right_panel_config: serializeRightPanelConfig(next),
                                    right_panel_widgets: toLegacyWidgetList(next),
                                  },
                                });
                              }}
                              className={`rounded border px-2 py-0.5 text-xs ${
                                on ? "border-accent text-accent" : "border-edge text-muted hover:text-strong"
                              }`}
                            >
                              {t(w.label)}
                            </button>
                          );
                        })}
                      </div>
                    </Row>
                    <Row
                      label="Embedded panel"
                      help={'Panel mounted inside the right sidebar\u2019s "Embedded panel" widget (enable that widget above).'}
                    >
                      <select
                        value={draft.ui.right_panel_embed ?? ""}
                        onChange={(e) => set({ ui: { ...draft.ui, right_panel_embed: e.target.value } })}
                        className="rounded border border-edge bg-raised px-2 py-1 text-xs text-strong outline-none focus:border-muted"
                      >
                        <option value="">{t("None")}</option>
                        {EMBEDDABLE_PANELS.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.label}
                          </option>
                        ))}
                      </select>
                    </Row>
                  </>
                )}
                <Row label="Quick action buttons" help="Where the launcher buttons (terminal, file manager, IDE, favorites) live.">
                  <Select
                    value={draft.ui.quick_actions}
                    options={["top", "side", "hidden"]}
                    labels={{ top: "Top bar", side: "Side rail", hidden: "Hidden" }}
                    onChange={(v) => set({ ui: { ...draft.ui, quick_actions: v as AppConfig["ui"]["quick_actions"] } })}
                  />
                </Row>
                <Row label="App zoom (%)" help="Scales the whole UI. Also: Ctrl +/− and Ctrl+wheel.">
                  <NumberInput
                    value={Math.round((draft.ui.zoom ?? 1) * 100)}
                    min={ZOOM_MIN * 100}
                    max={ZOOM_MAX * 100}
                    onChange={(v) => set({ ui: { ...draft.ui, zoom: v / 100 } })}
                  />
                </Row>

                <div className="mb-2 mt-5 font-medium text-strong">Sidebar / nav buttons</div>
                <p className="mb-2 text-xs text-muted">
                  Reorder with the arrows, choose whether each visible button lives in the top bar, right corner, or left sidebar rail,
                  or hide the ones you don&apos;t use. At least one stays visible.
                </p>
                <NavPreview config={draft as AppConfig} />
                {resolveNavOrder(draft.ui.nav_order ?? []).map((id, i, arr) => {
                  const def = NAV_BUTTONS.find((b) => b.id === id);
                  if (!def) return null;
                  const hiddenList = draft.ui.nav_hidden ?? [];
                  const sidebarList = draft.ui.nav_sidebar ?? [];
                  const hidden = hiddenList.includes(id);
                  const visibleCount = arr.length - hiddenList.filter((h) => arr.includes(h)).length;
                  const chromeList = draft.ui.nav_chrome ?? [];
                  const leftList = draft.ui.nav_topbar_left ?? [];
                  const centerList = draft.ui.nav_topbar_center ?? [];
                  const placement = hidden
                    ? "hidden"
                    : chromeList.includes(id)
                      ? "chrome"
                      : sidebarList.includes(id)
                        ? "sidebar"
                        : leftList.includes(id)
                          ? "topbar-left"
                          : centerList.includes(id)
                            ? "topbar-center"
                            : "topbar";
                  const setPlacement = (next: string) => {
                    if (next === "hidden" && !hidden && visibleCount <= 1) return;
                    const strip = (arr: string[]) => arr.filter((x) => x !== id);
                    set({
                      ui: {
                        ...draft.ui,
                        nav_hidden: next === "hidden" ? [...strip(hiddenList), id] : strip(hiddenList),
                        nav_sidebar: next === "sidebar" ? [...strip(sidebarList), id] : strip(sidebarList),
                        nav_chrome: next === "chrome" ? [...strip(chromeList), id] : strip(chromeList),
                        nav_topbar_left: next === "topbar-left" ? [...strip(leftList), id] : strip(leftList),
                        nav_topbar_center: next === "topbar-center" ? [...strip(centerList), id] : strip(centerList),
                      },
                    });
                  };
                  return (
                    <div
                      key={id}
                      data-testid={`nav-row-${id}`}
                      className={`mb-1 flex items-center gap-2 rounded border border-edge px-2 py-1 ${
                        hidden ? "opacity-50" : ""
                      }`}
                    >
                      <def.icon size={14} className="shrink-0 text-muted" />
                      <span className="min-w-0 flex-1 truncate text-strong">{def.label}</span>
                      <select
                        value={placement}
                        onChange={(e) => setPlacement(e.target.value)}
                        className="rounded border border-edge bg-raised px-1.5 py-0.5 text-2xs text-strong outline-none focus:border-muted"
                      >
                        <option value="topbar-left">Top bar — left</option>
                        <option value="topbar-center">Top bar — center</option>
                        <option value="topbar">Top bar — right</option>
                        <option value="chrome">Window corner</option>
                        <option value="sidebar">Sidebar</option>
                        <option value="hidden" disabled={!hidden && visibleCount <= 1}>
                          Hidden
                        </option>
                      </select>
                      <button
                        className="rounded p-1 text-muted hover:bg-raised hover:text-strong disabled:opacity-30"
                        title={t("Move up")}
                        disabled={i === 0}
                        onClick={() => set({ ui: { ...draft.ui, nav_order: nudgeNavButton(draft.ui.nav_order ?? [], id, -1) } })}
                      >
                        <ArrowUp size={13} />
                      </button>
                      <button
                        className="rounded p-1 text-muted hover:bg-raised hover:text-strong disabled:opacity-30"
                        title={t("Move down")}
                        disabled={i === arr.length - 1}
                        onClick={() => set({ ui: { ...draft.ui, nav_order: nudgeNavButton(draft.ui.nav_order ?? [], id, 1) } })}
                      >
                        <ArrowDown size={13} />
                      </button>
                      <button
                        className="rounded p-1 text-muted hover:bg-raised hover:text-strong disabled:opacity-30"
                        title={hidden ? t("Show button") : t("Hide button")}
                        disabled={!hidden && visibleCount <= 1}
                        onClick={() =>
                          set({
                            ui: {
                              ...draft.ui,
                              nav_hidden: hidden ? hiddenList.filter((h) => h !== id) : [...hiddenList, id],
                              nav_sidebar: hidden ? sidebarList : sidebarList.filter((x) => x !== id),
                              nav_chrome: hidden ? chromeList : chromeList.filter((x) => x !== id),
                              nav_topbar_left: hidden ? leftList : leftList.filter((x) => x !== id),
                              nav_topbar_center: hidden ? centerList : centerList.filter((x) => x !== id),
                            },
                          })
                        }
                      >
                        {hidden ? <EyeOff size={13} /> : <Eye size={13} />}
                      </button>
                    </div>
                  );
                })}
              </>
            )}

            {section === "notifications" && (
              <>
                <Row label="Enable notifications" help="Master switch for completion toasts and OS notifications.">
                  <Toggle
                    checked={draft.notifications.enabled}
                    onChange={(v) => set({ notifications: { ...draft.notifications, enabled: v } })}
                  />
                </Row>
                <Row
                  label="OS notifications"
                  help="Also show a native system notification when the Luxor window is hidden or unfocused."
                >
                  <Toggle
                    checked={draft.notifications.os_native}
                    onChange={(v) => set({ notifications: { ...draft.notifications, os_native: v } })}
                  />
                </Row>
                <Row label="Command finished" help="Notify when a terminal command completes (duration + exit code).">
                  <Toggle
                    checked={draft.notifications.command_done}
                    onChange={(v) => set({ notifications: { ...draft.notifications, command_done: v } })}
                  />
                </Row>
                <Row
                  label="Minimum command duration (s)"
                  help="Commands faster than this don't notify — keeps quick ls/git status quiet."
                >
                  <NumberInput
                    value={draft.notifications.min_command_secs}
                    min={0}
                    max={3600}
                    onChange={(v) => set({ notifications: { ...draft.notifications, min_command_secs: v } })}
                  />
                </Row>
                <Row
                  label="AI agent finished"
                  help="Notify when Claude Code, Codex, Gemini, Qoder… stops streaming output and waits for you."
                >
                  <Toggle
                    checked={draft.notifications.agent_done}
                    onChange={(v) => set({ notifications: { ...draft.notifications, agent_done: v } })}
                  />
                </Row>
              </>
            )}

            {section === "terminal" && (
              <>
                <Row label="Shell" help="Empty = system default (PowerShell / $SHELL).">
                  <ProgramPicker
                    value={draft.terminal.shell ?? ""}
                    detected={shells}
                    placeholder="e.g. powershell.exe / /bin/zsh"
                    onChange={(v) => set({ terminal: { ...draft.terminal, shell: v || null } })}
                  />
                </Row>
                <Row
                  label="Load my PowerShell profile"
                  help={
                    draft.terminal.shell_args.length > 0
                      ? "Overridden while explicit shell arguments are set below."
                      : "Loads your PowerShell profile (oh-my-posh prompt, aliases, functions) like Windows Terminal does. Off = faster startup with -NoProfile. Applies to PowerShell only."
                  }
                >
                  <Toggle
                    checked={!draft.terminal.fast_powershell_startup}
                    disabled={draft.terminal.shell_args.length > 0}
                    onChange={(v) => set({ terminal: { ...draft.terminal, fast_powershell_startup: !v } })}
                  />
                </Row>
                <Row
                  label="Shell arguments"
                  help="Advanced: override the launch arguments entirely. Supports quotes, e.g. -NoLogo -ExecutionPolicy Bypass."
                >
                  <Input
                    value={shellArgsText}
                    placeholder='e.g. -NoLogo -NoProfile or -Command "Write-Host hi"'
                    onChange={updateShellArgs}
                  />
                  {shellArgsError ? (
                    <p className="mt-1 text-xs text-danger">{shellArgsError}</p>
                  ) : draft.terminal.shell_args.length > 0 ? (
                    <p className="mt-1 text-xs text-muted">
                      Parsed as {draft.terminal.shell_args.length} argument{draft.terminal.shell_args.length === 1 ? "" : "s"}. Explicit args override the PowerShell profile option above.
                    </p>
                  ) : (
                    <p className="mt-1 text-xs text-muted">Leave empty to let the PowerShell profile option above choose safe startup flags.</p>
                  )}
                </Row>
                <Row
                  label="Launches"
                  help="The exact command Luxor runs for each new embedded terminal."
                >
                  {(() => {
                    const resolved =
                      (draft.terminal.shell ?? "").trim() || shells[0]?.command || "powershell.exe";
                    const argv = effectiveShellArgs(
                      resolved,
                      draft.terminal.shell_args,
                      draft.terminal.fast_powershell_startup,
                    );
                    return (
                      <code className="inline-block max-w-full truncate rounded border border-edge bg-raised px-2 py-1 font-mono text-xs text-strong">
                        {[resolved, ...argv].join(" ")}
                      </code>
                    );
                  })()}
                </Row>
                <Row
                  label="External terminal"
                  help='Used by the "Open external terminal" quick action. Empty = platform default.'
                >
                  <ProgramPicker
                    value={draft.terminal.external_terminal ?? ""}
                    detected={terminals}
                    placeholder="e.g. wt.exe / ghostty / alacritty"
                    onChange={(v) => set({ terminal: { ...draft.terminal, external_terminal: v || null } })}
                  />
                </Row>
                <Row label="Font family">
                  <Input
                    value={draft.terminal.font_family}
                    onChange={(v) => set({ terminal: { ...draft.terminal, font_family: v } })}
                  />
                </Row>
                <Row label="Font size">
                  <NumberInput
                    value={draft.terminal.font_size}
                    min={8}
                    max={40}
                    onChange={(v) => set({ terminal: { ...draft.terminal, font_size: v } })}
                  />
                </Row>
                <Row label="Scrollback lines">
                  <NumberInput
                    value={draft.terminal.scrollback}
                    min={100}
                    max={200000}
                    onChange={(v) => set({ terminal: { ...draft.terminal, scrollback: v } })}
                  />
                </Row>
                <Row label="Cursor style">
                  <Select
                    value={draft.terminal.cursor_style}
                    options={["block", "underline", "bar"]}
                    onChange={(v) =>
                      set({ terminal: { ...draft.terminal, cursor_style: v as AppConfig["terminal"]["cursor_style"] } })
                    }
                  />
                </Row>
                <Row label="Cursor blink">
                  <Toggle
                    checked={draft.terminal.cursor_blink}
                    onChange={(v) => set({ terminal: { ...draft.terminal, cursor_blink: v } })}
                  />
                </Row>
                <Row label="Copy on select" help="Selected text is copied to the clipboard automatically.">
                  <Toggle
                    checked={draft.terminal.copy_on_select}
                    onChange={(v) => set({ terminal: { ...draft.terminal, copy_on_select: v } })}
                  />
                </Row>
                <Row label="Bell notifications" help="Show a notification when a background terminal rings the bell (e.g. an agent finished and waits for input).">
                  <Toggle
                    checked={draft.terminal.bell_notifications}
                    onChange={(v) => set({ terminal: { ...draft.terminal, bell_notifications: v } })}
                  />
                </Row>
                <Row label="CPU / RAM badge" help="Show live resource usage of each terminal's process tree in the panel corner.">
                  <Toggle
                    checked={draft.terminal.show_stats}
                    onChange={(v) => set({ terminal: { ...draft.terminal, show_stats: v } })}
                  />
                </Row>
                <Row label="WebGL renderer" help="Faster rendering; falls back automatically when unavailable.">
                  <Toggle
                    checked={draft.terminal.webgl}
                    onChange={(v) => set({ terminal: { ...draft.terminal, webgl: v } })}
                  />
                </Row>
                <p className="mt-3 text-xs text-muted">
                  Font and cursor changes apply to newly opened terminals.
                </p>
              </>
            )}

            {section === "git" && (
              <>
                <Row label="Diff view">
                  <Select
                    value={draft.git.diff_view}
                    options={["side_by_side", "inline"]}
                    labels={{ side_by_side: "Side by side", inline: "Inline" }}
                    onChange={(v) => set({ git: { ...draft.git, diff_view: v as AppConfig["git"]["diff_view"] } })}
                  />
                </Row>
                <Row label="Auto-refresh (seconds)" help="0 disables background refresh of the git panel.">
                  <NumberInput
                    value={draft.git.auto_refresh_secs}
                    min={0}
                    max={300}
                    onChange={(v) => set({ git: { ...draft.git, auto_refresh_secs: v } })}
                  />
                </Row>
              </>
            )}


            {section === "launcher" && (
              <>
                <Row label="Preferred editors" help="Priority order, comma-separated commands.">
                  <Input
                    value={draft.preferred_editors.join(", ")}
                    placeholder="code, cursor, zed"
                    onChange={(v) =>
                      set({ preferred_editors: v.split(",").map((s) => s.trim()).filter(Boolean) })
                    }
                  />
                </Row>
                <div className="mb-3">
                  <div className="mb-2 flex items-center justify-between">
                    <span className="text-muted">Custom IDEs / editors</span>
                    <button
                      className="flex items-center gap-1 rounded border border-edge px-2 py-0.5 text-xs text-muted hover:bg-raised hover:text-strong"
                      onClick={() =>
                        set({ custom_ides: [...draft.custom_ides, { label: "", command: "" }] })
                      }
                    >
                      <Plus size={12} /> Add
                    </button>
                  </div>
                  {draft.custom_ides.length === 0 && (
                    <p className="text-xs text-muted">
                      Add editors that aren't on PATH — pick the .exe and give it a name.
                    </p>
                  )}
                  {draft.custom_ides.map((ide, i) => (
                    <div key={i} className="mb-1.5 flex items-center gap-1.5">
                      <input
                        value={ide.label}
                        placeholder={t("Name")}
                        onChange={(e) =>
                          set({
                            custom_ides: draft.custom_ides.map((x, j) =>
                              j === i ? { ...x, label: e.target.value } : x,
                            ),
                          })
                        }
                        className="w-32 rounded border border-edge bg-raised px-2 py-1 text-xs text-strong outline-none focus:border-muted"
                      />
                      <input
                        value={ide.command}
                        placeholder={t("Command or path to .exe")}
                        onChange={(e) =>
                          set({
                            custom_ides: draft.custom_ides.map((x, j) =>
                              j === i ? { ...x, command: e.target.value } : x,
                            ),
                          })
                        }
                        className="min-w-0 flex-1 rounded border border-edge bg-raised px-2 py-1 font-mono text-xs text-strong outline-none focus:border-muted"
                      />
                      <button
                        className="rounded border border-edge px-2 py-1 text-xs text-muted hover:bg-raised hover:text-strong"
                        title={t("Browse for executable")}
                        onClick={() =>
                          void ipc.pickFile().then((path) => {
                            if (!path) return;
                            const name = path.split(/[\\/]/).pop()?.replace(/\.exe$/i, "") ?? "";
                            set({
                              custom_ides: draft.custom_ides.map((x, j) =>
                                j === i ? { label: x.label || name, command: path } : x,
                              ),
                            });
                          })
                        }
                      >
                        …
                      </button>
                      <button
                        className="rounded p-1 text-muted hover:text-danger"
                        title={t("Remove")}
                        onClick={() =>
                          set({ custom_ides: draft.custom_ides.filter((_, j) => j !== i) })
                        }
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                  ))}
                </div>
                <Row label="Default IDE" help="Used by the IDE button. Installed IDEs are detected automatically.">
                  <div className="flex items-center gap-1.5">
                    <AppWindow size={14} className="shrink-0 text-muted" />
                    <select
                      value={draft.default_ide ?? ""}
                      onChange={(e) => set({ default_ide: e.target.value || null })}
                      className="w-full rounded border border-edge bg-raised px-2 py-1 text-xs text-strong outline-none focus:border-muted"
                    >
                      <option value="">Auto (first detected)</option>
                      {draft.custom_ides
                        .filter((c) => c.command.trim())
                        .map((c) => (
                          <option key={`custom-${c.command}`} value={c.command}>
                            {c.label || c.command} (custom)
                          </option>
                        ))}
                      {detectedIdes
                        .filter((d) => !draft.custom_ides.some((c) => c.command === d.command))
                        .map((d) => (
                          <option key={d.command} value={d.command}>
                            {d.label}
                          </option>
                        ))}
                      <option value="__default__">System default app (like Windows "Open with")</option>
                      <option value="__explorer__">File explorer</option>
                      {draft.default_ide &&
                        !["__default__", "__explorer__"].includes(draft.default_ide) &&
                        !detectedIdes.some((d) => d.command === draft.default_ide) &&
                        !draft.custom_ides.some((c) => c.command === draft.default_ide) && (
                          <option value={draft.default_ide}>{draft.default_ide}</option>
                        )}
                    </select>
                  </div>
                </Row>
                <p className="mt-3 text-xs text-muted">
                  Per-project favorite commands and pinned executables live in the Launcher panel.
                </p>
              </>
            )}

            {section === "statusbar" && (
              <>
                <Row label="Project name">
                  <Toggle checked={draft.status_bar.show_project} onChange={(v) => set({ status_bar: { ...draft.status_bar, show_project: v } })} />
                </Row>
                <Row label="Git branch">
                  <Toggle checked={draft.status_bar.show_git} onChange={(v) => set({ status_bar: { ...draft.status_bar, show_git: v } })} />
                </Row>
                <Row label="CPU usage">
                  <Toggle checked={draft.status_bar.show_cpu} onChange={(v) => set({ status_bar: { ...draft.status_bar, show_cpu: v } })} />
                </Row>
                <Row label="RAM usage">
                  <Toggle checked={draft.status_bar.show_ram} onChange={(v) => set({ status_bar: { ...draft.status_bar, show_ram: v } })} />
                </Row>
                <Row label="Network throughput">
                  <Toggle checked={draft.status_bar.show_net} onChange={(v) => set({ status_bar: { ...draft.status_bar, show_net: v } })} />
                </Row>
                <Row label="Ping">
                  <Toggle checked={draft.status_bar.show_ping} onChange={(v) => set({ status_bar: { ...draft.status_bar, show_ping: v } })} />
                </Row>
                <Row label="Open tasks">
                  <Toggle checked={draft.status_bar.show_tasks} onChange={(v) => set({ status_bar: { ...draft.status_bar, show_tasks: v } })} />
                </Row>
                <Row label="Focus timer" help="Show the running focus timer in the status bar (only while a session is active).">
                  <Toggle checked={draft.status_bar.show_timer} onChange={(v) => set({ status_bar: { ...draft.status_bar, show_timer: v } })} />
                </Row>
                <Row label="Clock">
                  <Toggle checked={draft.status_bar.show_clock} onChange={(v) => set({ status_bar: { ...draft.status_bar, show_clock: v } })} />
                </Row>
                <Row label="Zoom level">
                  <Toggle checked={draft.status_bar.show_zoom} onChange={(v) => set({ status_bar: { ...draft.status_bar, show_zoom: v } })} />
                </Row>
                <Row label="Ping host" help="host:port — measured as a TCP connect round-trip.">
                  <Input
                    value={draft.status_bar.ping_host}
                    placeholder="1.1.1.1:443"
                    onChange={(v) => set({ status_bar: { ...draft.status_bar, ping_host: v } })}
                  />
                </Row>
                <Row label="Refresh interval (s)">
                  <NumberInput
                    value={draft.status_bar.refresh_secs}
                    min={1}
                    max={60}
                    onChange={(v) => set({ status_bar: { ...draft.status_bar, refresh_secs: v } })}
                  />
                </Row>

                <div className="mb-2 mt-5 font-medium text-strong">Segment order</div>
                <p className="mb-2 text-xs text-muted">
                  Everything before the spacer is left-aligned, everything after — right-aligned. You can also drag
                  segments directly in the status bar or right-click it for quick toggles.
                </p>
                {resolveSegmentOrder(draft.status_bar.segment_order ?? []).map((id, i, arr) => {
                  const toggleKey = SEGMENT_TOGGLES[id];
                  const shown = toggleKey ? Boolean(draft.status_bar[toggleKey]) : true;
                  return (
                    <div
                      key={id}
                      className={`mb-1 flex items-center gap-2 rounded border border-edge px-2 py-1 ${
                        shown ? "" : "opacity-50"
                      }`}
                    >
                      <span className="min-w-0 flex-1 truncate text-strong">{segmentLabel(id)}</span>
                      <button
                        className="rounded p-1 text-muted hover:bg-raised hover:text-strong disabled:opacity-30"
                        title={t("Move left/up")}
                        disabled={i === 0}
                        onClick={() =>
                          set({ status_bar: { ...draft.status_bar, segment_order: nudgeSegment(draft.status_bar.segment_order ?? [], id, -1) } })
                        }
                      >
                        <ArrowUp size={13} />
                      </button>
                      <button
                        className="rounded p-1 text-muted hover:bg-raised hover:text-strong disabled:opacity-30"
                        title={t("Move right/down")}
                        disabled={i === arr.length - 1}
                        onClick={() =>
                          set({ status_bar: { ...draft.status_bar, segment_order: nudgeSegment(draft.status_bar.segment_order ?? [], id, 1) } })
                        }
                      >
                        <ArrowDown size={13} />
                      </button>
                      {toggleKey && (
                        <button
                          className="rounded p-1 text-muted hover:bg-raised hover:text-strong"
                          title={shown ? "Hide segment" : "Show segment"}
                          onClick={() => set({ status_bar: { ...draft.status_bar, [toggleKey]: !shown } })}
                        >
                          {shown ? <Eye size={13} /> : <EyeOff size={13} />}
                        </button>
                      )}
                    </div>
                  );
                })}
              </>
            )}

            {section === "hotkeys" && (
              <>
                {HOTKEY_ACTIONS.map((hk) => {
                  const override = draft.hotkeys.find((h) => h.action === hk.id);
                  return (
                    <Row key={hk.id} label={t(hk.label)}>
                      <div className="flex items-center gap-2">
                        {recording === hk.id ? (
                          <input
                            autoFocus
                            readOnly
                            value="Press keys…"
                            onBlur={() => setRecording(null)}
                            onKeyDown={(e) => {
                              e.preventDefault();
                              if (e.key === "Escape") {
                                setRecording(null);
                                return;
                              }
                              const chord = chordFromEvent(e);
                              if (!chord) return;
                              // Check the new chord against every OTHER action's
                              // effective binding. If it's already taken, surface
                              // a conflict prompt instead of silently creating two
                              // actions that fire on the same keystroke.
                              const normalized = normalizeChord(chord);
                              const effective = effectiveHotkeys(draft);
                              const clash = Object.entries(effective).find(
                                ([action, c]) => action !== hk.id && c === normalized,
                              );
                              if (clash) {
                                setHotkeyConflict({
                                  action: hk.id,
                                  chord,
                                  conflictWith: clash[0],
                                });
                                setRecording(null);
                                return;
                              }
                              set({
                                hotkeys: [
                                  ...draft.hotkeys.filter((h) => h.action !== hk.id),
                                  { action: hk.id, chord },
                                ],
                              });
                              setRecording(null);
                            }}
                            className="w-32 rounded border border-accent bg-raised px-2 py-0.5 text-center font-mono text-xs text-accent outline-none"
                          />
                        ) : (
                          <button
                            className="rounded border border-edge bg-raised px-2 py-0.5 font-mono text-xs hover:border-accent"
                            title={t("Click to record a new hotkey")}
                            onClick={() => setRecording(hk.id)}
                          >
                            {override?.chord ?? hk.default}
                          </button>
                        )}
                        {override && (
                          <button
                            className="text-xs text-muted hover:text-strong"
                            onClick={() =>
                              set({ hotkeys: draft.hotkeys.filter((h) => h.action !== hk.id) })
                            }
                          >
                            reset
                          </button>
                        )}
                      </div>
                    </Row>
                  );
                })}
                {hotkeyConflict && (
                  <div
                    role="alertdialog"
                    aria-label={t("Hotkey conflict")}
                    className="mt-3 rounded-lg border border-warning-soft-strong bg-warning-soft p-3 text-xs"
                  >
                    <p className="text-strong">
                      <span className="font-mono font-semibold">{hotkeyConflict.chord}</span>{" "}
                      {t("is already assigned to")}{" "}
                      <span className="font-semibold">
                        {(() => {
                          const label = HOTKEY_ACTIONS.find((a) => a.id === hotkeyConflict.conflictWith)?.label;
                          return label ? t(label) : hotkeyConflict.conflictWith;
                        })()}
                      </span>
                      .
                    </p>
                    <div className="mt-2 flex gap-2">
                      <button
                        className="rounded border border-edge bg-raised px-2 py-0.5 font-medium text-strong hover:border-accent"
                        onClick={() => {
                          // Steal the chord: remove it from the conflicting action
                          // (falls back to no binding) and assign it to the target.
                          set({
                            hotkeys: [
                              ...draft.hotkeys.filter(
                                (h) =>
                                  h.action !== hotkeyConflict.action &&
                                  h.action !== hotkeyConflict.conflictWith,
                              ),
                              { action: hotkeyConflict.action, chord: hotkeyConflict.chord },
                            ],
                          });
                          setHotkeyConflict(null);
                        }}
                      >
                        {t("Reassign")}
                      </button>
                      <button
                        className="rounded px-2 py-0.5 text-muted hover:text-strong"
                        onClick={() => setHotkeyConflict(null)}
                      >
                        {t("common.cancel", "Cancel")}
                      </button>
                    </div>
                  </div>
                )}
              </>
            )}

            {section === "developer" && (
              <>
                <Row
                  label={t("settings.diagnostics_tab", "Diagnostics tab in Dev Tools")}
                  help={t("settings.diagnostics_tab_help", "Adds a Diagnostics tab with read-only health checks (Discord RPC, IPC, Git, Docker and more). Off by default.")}
                >
                  <Toggle
                    checked={draft.ui.diagnostics_tab ?? false}
                    onChange={(v) => set({ ui: { ...draft.ui, diagnostics_tab: v } })}
                  />
                </Row>
                <DeveloperSection />
              </>
            )}

            {section === "about" && (
              <>
                {/* Hero card */}
                <div className="mb-4 overflow-hidden rounded-lg border border-edge">
                  <div className="flex items-center gap-4 bg-raised px-5 py-5">
                    <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-lg border border-edge bg-bar text-accent shadow-inner">
                      <SquareTerminal size={30} />
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-2xl font-bold tracking-tight text-strong">Luxor</span>
                        <span className="rounded-full border border-edge bg-bar px-2 py-0.5 font-mono text-2xs text-muted">
                          v{APP_VERSION}
                        </span>
                      </div>
                      <div className="mt-0.5 text-xs text-muted">
                        {t("settings.about.tagline", "Cockpit for AI-assisted coding")}
                      </div>
                      <div className="mt-1 text-2xs text-muted">
                        {t("settings.about.by", "by")}{" "}
                        <button
                          className="text-accent hover:underline"
                          onClick={() => void ipcExtra.openUrl("https://github.com/adxptived")}
                        >
                          adxptived
                        </button>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Link cards */}
                <div className="mb-4 grid grid-cols-1 gap-2 sm:grid-cols-3">
                  <AboutLink
                    icon={Code2}
                    label={t("settings.about.repo", "Repository")}
                    sub="adxptived/luxor"
                    onClick={() => void ipcExtra.openUrl("https://github.com/adxptived/luxor")}
                  />
                  <AboutLink
                    icon={Rocket}
                    label={t("settings.about.releases", "Releases")}
                    sub={t("settings.about.changelog", "Changelog & downloads")}
                    onClick={() => void ipcExtra.openUrl("https://github.com/adxptived/luxor/releases")}
                  />
                  <AboutLink
                    icon={Bug}
                    label={t("settings.about.issues", "Report an issue")}
                    sub={t("settings.about.issues.sub", "Bugs & ideas")}
                    onClick={() => void ipcExtra.openUrl("https://github.com/adxptived/luxor/issues")}
                  />
                </div>

                {/* Updates */}
                <div className="rounded-lg border border-edge p-4">
                  <div className="mb-2 text-sm font-semibold text-strong">
                    {t("settings.about.updates", "Updates")}
                  </div>
                  <div className="mb-3 flex items-center justify-between gap-3">
                    <span className="text-xs text-muted">
                      {t("settings.updates.auto", "Check for updates on startup")}
                    </span>
                    <Toggle
                      checked={draft.ui.update_check ?? true}
                      onChange={(v) => set({ ui: { ...draft.ui, update_check: v } })}
                    />
                  </div>
                  <UpdateCheckButton repo={draft.ui.update_repo || "adxptived/luxor"} />
                </div>

                <p className="mt-4 text-center text-xs text-muted">
                  © {new Date().getFullYear()} adxptived · {t("settings.about.thanks", "Built with Luxor.")}
                </p>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/** A clickable card linking out to a URL (used on the About page). */
function DiagExportButton() {
  const toast = useAppStore((s) => s.toast);
  const [busy, setBusy] = useState(false);
  return (
    <button
      disabled={busy}
      onClick={() => {
        setBusy(true);
        void ipc
          .diagCollect()
          .then((report) => ipc.saveTextFile("luxor-diagnostics.txt", report))
          .then((path) => {
            if (path) toast(t("settings.diag.saved", "Diagnostics report saved"), "success");
          })
          .catch((e) => toast(String(e), "error"))
          .finally(() => setBusy(false));
      }}
      className="rounded border border-edge px-3 py-1 text-xs text-muted hover:text-strong disabled:opacity-50"
    >
      {t("settings.diag.export", "Export diagnostics report")}
    </button>
  );
}

/** A small toolbar button used across the Developer log panel. */
function DeveloperSection() {
  const toast = useAppStore((s) => s.toast);
  const [logs, setLogs] = useState("");
  const [loading, setLoading] = useState(true);
  const [errorsOnly, setErrorsOnly] = useState(false);
  const [copied, setCopied] = useState(false);
  const [startup, setStartup] = useState<Record<string, string> | null>(null);

  const refresh = useCallback(() => {
    setLoading(true);
    void ipc
      .frontendLogRead()
      .then((text) => setLogs(text))
      .catch((e) => setLogs(errorMessage(e)))
      .finally(() => {
        setStartup(latestStartup());
        setLoading(false);
      });
  }, []);

  // Load on mount and live-update as new entries are pushed this session.
  useEffect(() => {
    refresh();
    const off = subscribeLogs(() => {
      void ipc.frontendLogRead().then((text) => setLogs(text)).catch(() => {});
      setStartup(latestStartup());
    });
    return off;
  }, [refresh]);

  const shown = errorsOnly
    ? logs
        .split("\n")
        .filter((l) => /ERROR|FREEZE|panic|Unhandled/i.test(l))
        .join("\n")
    : logs;
  const lineCount = logs ? logs.trimEnd().split("\n").filter(Boolean).length : 0;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(shown || "(log is empty)");
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch (e) {
      toast(errorMessage(e), "error");
    }
  };

  const saveLogs = () =>
    void ipc
      .saveTextFile("luxor-frontend.log", shown)
      .then((path) => path && toast(t("settings.dev.saved", "Log saved"), "success"))
      .catch((e) => toast(errorMessage(e), "error"));

  const exportDiag = () =>
    void ipc
      .diagCollect()
      .then((report) => ipc.saveTextFile("luxor-diagnostics.txt", report))
      .then((path) => path && toast(t("settings.diag.saved", "Diagnostics report saved"), "success"))
      .catch((e) => toast(errorMessage(e), "error"));

  const clear = () => {
    void ipc.frontendLogClear().then(refresh).catch((e) => toast(errorMessage(e), "error"));
    toast(t("settings.dev.cleared", "Logs cleared"), "success");
  };

  const STARTUP_LABELS: Record<string, string> = {
    firstPaint: t("settings.dev.firstpaint", "First paint"),
    htmlLoaded: t("settings.dev.htmlloaded", "HTML loaded"),
    jsReady: t("settings.dev.jsready", "JS ready"),
    bundleFetch: t("settings.dev.bundlefetch", "Bundle fetch (webview/AV)"),
    bundleExec: t("settings.dev.bundleexec", "Bundle exec (JS)"),
    render: t("settings.dev.render", "Render"),
    appReady: t("settings.dev.appready", "App ready"),
  };

  return (
    <>
      {/* Startup timing summary */}
      <div className="mb-4 rounded-lg border border-edge bg-surface/40 p-3">
        <div className="mb-2 flex items-center gap-1.5 text-xs font-medium text-strong">
          <Activity size={13} className="text-accent" />
          {t("settings.dev.startup", "Startup timing (last launch)")}
        </div>
        {startup ? (
          <div className="flex flex-wrap gap-x-6 gap-y-1">
            {Object.entries(startup).map(([k, v]) => (
              <div key={k} className="flex items-baseline gap-1.5">
                <span className="text-xs text-muted">{STARTUP_LABELS[k] ?? k}</span>
                <span className="font-mono text-sm text-strong">{v}</span>
              </div>
            ))}
          </div>
        ) : (
          <div className="text-xs text-muted">
            {t("settings.dev.startup.none", "No startup telemetry yet — relaunch Luxor to record it.")}
          </div>
        )}
      </div>

      {/* Log feed */}
      <div className="mb-2 flex items-center justify-between">
        <div className="flex items-center gap-1.5 text-xs font-medium text-strong">
          <ScrollText size={13} className="text-accent" />
          {t("settings.dev.log", "Frontend log")}
          <span className="text-muted">· {lineCount} {t("settings.dev.lines", "lines")}</span>
        </div>
        <label className="flex cursor-pointer items-center gap-1.5 text-xs text-muted hover:text-strong">
          <input type="checkbox" checked={errorsOnly} onChange={(e) => setErrorsOnly(e.target.checked)} />
          {t("settings.dev.errorsonly", "Errors & freezes only")}
        </label>
      </div>

      <div className="mb-2 flex flex-wrap items-center gap-1">
        <DevToolButton icon={RefreshCw} label={t("settings.dev.refresh", "Refresh")} onClick={refresh} disabled={loading} />
        <DevToolButton icon={copied ? ClipboardCheck : Copy} label={copied ? t("settings.dev.copied", "Copied") : t("settings.dev.copy", "Copy")} onClick={() => void copy()} accent={copied} />
        <DevToolButton icon={Download} label={t("settings.dev.savelog", "Save .log")} onClick={saveLogs} />
        <DevToolButton icon={Bug} label={t("settings.dev.exportdiag", "Export diagnostics")} onClick={exportDiag} />
        <DevToolButton icon={FolderOpen} label={t("settings.dev.openfolder", "Open log folder")} onClick={() => void ipc.openLogFolder()} />
        <DevToolButton icon={Trash2} label={t("settings.dev.clear", "Clear")} onClick={clear} />
      </div>

      <pre className="h-72 overflow-auto whitespace-pre-wrap break-all rounded-lg border border-edge bg-surface/60 p-3 font-mono text-2xs leading-5 text-strong">
        {shown.trim() ? shown : t("settings.dev.empty", "No log entries yet. Errors, UI freezes and startup timing will appear here.")}
      </pre>
      <p className="mt-2 text-xs leading-5 text-muted">
        {t(
          "settings.dev.hint",
          "This is what Luxor records for troubleshooting — JS errors, UI freezes and startup timing. No secrets are stored. Copy or export it to share when reporting a problem.",
        )}
      </p>
    </>
  );
}

function UpdateCheckButton({ repo }: { repo: string }) {
  const toast = useAppStore((s) => s.toast);
  const [busy, setBusy] = useState(false);
  const [info, setInfo] = useState<UpdateInfo | null>(null);

  const check = async () => {
    setBusy(true);
    setInfo(null);
    try {
      const result = await ipcExtra.updateCheck(repo);
      setInfo(result);
      if (!result.update_available) {
        toast(t("settings.updates.latest", "You are on the latest version"), "success");
      }
    } catch (e) {
      toast(errorMessage(e), "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex items-center gap-2">
      <button
        onClick={() => void check()}
        disabled={busy || !repo.includes("/")}
        className="rounded border border-edge px-2 py-1 text-xs text-muted hover:text-strong disabled:opacity-40"
      >
        {busy ? t("settings.updates.checking", "Checking…") : t("settings.updates.check", "Check now")}
      </button>
      {info?.update_available && (
        <button
          onClick={() => void ipcExtra.openUrl(info.html_url)}
          className="rounded border border-accent px-2 py-1 text-xs text-accent"
          title={info.latest}
        >
          {t("settings.updates.available", "New version available")}: {info.latest} — {t("settings.updates.download", "Download")}
        </button>
      )}
    </div>
  );
}
