/** Shared empty-state for panels that need a project folder.
 *
 *  Blank workspaces have `path === ""`; instead of a dead-end message every
 *  panel now offers to attach a folder right there: native picker, manual
 *  path entry, or the Settings shortcut. */

import { ArrowRight, FolderOpen, FolderSearch, Sparkles } from "lucide-react";
import { useState } from "react";

import * as ipc from "@/lib/ipc";
import { t } from "@/lib/i18n";
import { errorMessage } from "@/lib/types";
import { useAppStore } from "@/state/appStore";
import { useProjectsStore } from "@/state/projectsStore";

export function NoFolderCta({ hint }: { hint: string }) {
  const { projects, activeId, updateProject } = useProjectsStore();
  const toast = useAppStore((s) => s.toast);
  const project = projects.find((p) => p.id === activeId) ?? null;
  const [path, setPath] = useState("");

  const attach = async (folder: string) => {
    const target = folder.trim();
    if (!project || !target) return;
    try {
      await updateProject({ ...project, path: target });
      toast(`${t("Folder attached:")} ${target}`, "success");
    } catch (e) {
      toast(`${t("Failed to set folder:")} ${errorMessage(e)}`, "error");
    }
  };

  const browse = async () => {
    try {
      const picked = await ipc.pickDirectory();
      if (picked) await attach(picked);
    } catch (e) {
      toast(`${t("Folder picker failed:")} ${errorMessage(e)}`, "error");
    }
  };

  if (!project) {
    return (
      <div className="flex h-full items-center justify-center bg-surface px-6 text-center text-sm text-muted">
        {t("Open a project to get started.")}
      </div>
    );
  }

  return (
    <div
      className="flex h-full items-center justify-center overflow-auto bg-[radial-gradient(circle_at_top,var(--lx-raised),transparent_42%)] px-5 py-8 text-sm text-muted"
      data-testid="no-folder-cta"
    >
      <div className="w-full max-w-xl rounded-lg border border-edge bg-bar/90 p-5 text-center shadow-2xl shadow-black/10">
        <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-lg border border-edge bg-raised text-muted">
          <FolderSearch size={24} />
        </div>
        <div className="mb-1 text-base font-semibold text-strong">{t("This workspace has no folder")}</div>
        <p className="mx-auto max-w-md text-xs leading-5 text-muted">{hint}</p>

        <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
          <button
            className="flex items-center gap-1.5 rounded-lg border border-accent bg-accent/10 px-3 py-1.5 text-xs font-medium text-accent hover:bg-accent/20"
            onClick={() => void browse()}
          >
            <FolderOpen size={13} /> {t("Choose folder…")}
          </button>
          <span className="flex items-center gap-1 rounded-full border border-edge bg-raised px-2 py-1 text-3xs uppercase tracking-wide text-muted">
            <Sparkles size={11} className="text-accent" /> {t("Enables Files, Git, Search and Launcher")}
          </span>
        </div>

        <div className="mx-auto mt-4 flex w-full max-w-md items-center gap-1.5 rounded-lg border border-edge bg-surface p-1 focus-within:border-transparent">
          <input
            className="min-w-0 flex-1 bg-transparent px-2 py-1.5 text-xs text-strong outline-none"
            placeholder={t("…or paste a path and press Enter")}
            value={path}
            onChange={(e) => setPath(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void attach(path);
            }}
          />
          <button
            className="rounded-lg bg-raised p-1.5 text-muted hover:text-accent disabled:opacity-30"
            disabled={!path.trim()}
            title={t("Attach folder")}
            onClick={() => void attach(path)}
          >
            <ArrowRight size={14} />
          </button>
        </div>
      </div>
    </div>
  );
}
