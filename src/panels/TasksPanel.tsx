/** Kanban task board. Tasks are written so they can be handed straight to an
 *  AI agent: every card has a "Copy as agent prompt" action. One board per
 *  project (plus a global board when no project is active); stored in the
 *  app's SQLite database. */

import {
  ChevronLeft,
  ChevronRight,
  ClipboardCopy,
  Eraser,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  SquareKanban,
  Trash2,
  X,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import * as ipc from "@/lib/ipc";
import { t } from "@/lib/i18n";
import { setDragGhost } from "@/lib/dragGhost";
import type { Task } from "@/lib/types";
import { errorMessage } from "@/lib/types";
import { useAppStore } from "@/state/appStore";
import { confirmDestructive, openContextMenu } from "@/state/uiStore";
import { useActiveProject } from "@/state/projectsStore";

const COLUMNS: { id: string; label: string }[] = [
  { id: "backlog", label: "Backlog" },
  { id: "todo", label: "To do" },
  { id: "in_progress", label: "In progress" },
  { id: "done", label: "Done" },
];

/** Format a task as a ready-to-paste prompt for an AI agent. */
export function taskToAgentPrompt(task: Task, projectName?: string | null): string {
  const lines = [`Task: ${task.title}`];
  if (task.description.trim()) lines.push("", task.description.trim());
  if (projectName) lines.push("", `Project: ${projectName}`);
  return lines.join("\n");
}

export function TasksPanel() {
  const project = useActiveProject();
  const toast = useAppStore((s) => s.toast);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [filter, setFilter] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [dropHint, setDropHint] = useState<{ status: string; index: number } | null>(null);
  const dragId = useRef<string | null>(null);
  const projectId = project?.id ?? null;

  const reload = useCallback(async () => {
    try {
      setTasks(await ipc.taskList(projectId));
    } catch (e) {
      toast(`${t("Failed to load tasks:")} ${errorMessage(e)}`, "error");
    }
  }, [projectId, toast]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const addTask = async (status: string, title: string) => {
    if (!title.trim()) return;
    try {
      await ipc.taskAdd(projectId, title.trim(), "", status);
      await reload();
    } catch (e) {
      toast(`${t("Failed to add task:")} ${errorMessage(e)}`, "error");
    }
  };

  const saveTask = async (task: Task) => {
    try {
      await ipc.taskUpdate(task);
      await reload();
    } catch (e) {
      toast(`${t("Failed to save task:")} ${errorMessage(e)}`, "error");
    }
  };

  const deleteTask = async (task: Task) => {
    if (!(await confirmDestructive({ title: `${t("Delete task")} “${task.title}”?` }))) return;
    try {
      await ipc.taskDelete(task.id);
      setEditingId((id) => (id === task.id ? null : id));
      await reload();
    } catch (e) {
      toast(`${t("Failed to delete task:")} ${errorMessage(e)}`, "error");
    }
  };

  const copyPrompt = async (task: Task) => {
    await navigator.clipboard.writeText(taskToAgentPrompt(task, project?.name));
    toast(t("Agent prompt copied to clipboard"), "success");
  };

  const moveTask = async (id: string, status: string, position: number) => {
    try {
      await ipc.taskMove(id, status, position);
      await reload();
    } catch (e) {
      toast(`${t("Failed to move task:")} ${errorMessage(e)}`, "error");
    }
  };

  const onDrop = (status: string, index: number) => {
    const id = dragId.current;
    dragId.current = null;
    setDropHint(null);
    if (id) void moveTask(id, status, index);
  };

  /** Move a card one column left/right (quick buttons + shift+click). */
  const shiftTask = (task: Task, delta: 1 | -1) => {
    const idx = COLUMNS.findIndex((c) => c.id === task.status);
    const target = COLUMNS[idx + delta];
    if (!target) return;
    const count = tasks.filter((t) => t.status === target.id).length;
    void moveTask(task.id, target.id, count);
  };

  const clearDone = async () => {
    const done = tasks.filter((t) => t.status === "done");
    if (done.length === 0) return;
    const ok = await confirmDestructive({
      title: `${t("Delete completed tasks:")} ${done.length}?`,
      confirmLabel: t("Clear done"),
    });
    if (!ok) return;
    try {
      for (const t of done) await ipc.taskDelete(t.id);
      await reload();
      toast(`${t("Cleared done tasks:")} ${done.length}`, "success");
    } catch (e) {
      toast(`${t("Failed to clear:")} ${errorMessage(e)}`, "error");
    }
  };

  const cardMenu = (e: React.MouseEvent, task: Task) => {
    openContextMenu(e, [
      { label: t("Edit task…"), icon: Pencil, onClick: () => setEditingId(task.id) },
      { label: t("Copy as agent prompt"), icon: ClipboardCopy, onClick: () => void copyPrompt(task) },
      { separator: true },
      ...COLUMNS.filter((c) => c.id !== task.status).map((c) => ({
        label: `${t("Move to")} ${t(c.label)}`,
        icon: SquareKanban,
        onClick: () => {
          const count = tasks.filter((t) => t.status === c.id).length;
          void moveTask(task.id, c.id, count);
        },
      })),
      { separator: true },
      { label: t("Delete task"), icon: Trash2, danger: true, onClick: () => void deleteTask(task) },
    ]);
  };

  return (
    <div className="flex h-full flex-col bg-surface text-sm" data-testid="tasks-panel">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 border-b border-edge px-3 py-2">
        <span className="flex shrink-0 items-center gap-1.5 font-semibold text-strong">
          <SquareKanban size={15} /> Tasks
        </span>
        <span className="min-w-0 truncate text-muted">{project ? project.name : "global board"}</span>
        {tasks.length > 0 && (
          <span className="shrink-0 rounded bg-raised px-1.5 py-0.5 text-3xs text-muted">
            {tasks.filter((t) => t.status === "done").length}/{tasks.length} done
          </span>
        )}
        <span className="ml-auto flex shrink-0 flex-wrap items-center justify-end gap-1">
          <span className="relative">
            <Search size={12} className="pointer-events-none absolute left-1.5 top-1/2 -translate-y-1/2 text-muted" />
            <input
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape" && filter) {
                  e.stopPropagation();
                  setFilter("");
                }
              }}
              placeholder={t("Filter tasks…")}
              data-testid="task-filter"
              className="w-36 rounded border border-edge bg-surface py-0.5 pl-6 pr-5 text-xs text-strong outline-none placeholder:text-muted focus:border-muted/60"
            />
            {filter && (
              <button
                className="absolute right-1 top-1/2 -translate-y-1/2 rounded text-muted hover:text-strong"
                title={t("Clear filter")}
                onClick={() => setFilter("")}
              >
                <X size={12} />
              </button>
            )}
          </span>
          <button
            className="flex items-center gap-1 rounded p-1 text-xs text-muted hover:bg-raised hover:text-strong disabled:opacity-30"
            title={t("Delete all tasks in Done")}
            disabled={!tasks.some((t) => t.status === "done")}
            onClick={() => void clearDone()}
          >
            <Eraser size={14} /> Clear done
          </button>
          <button
            className="rounded p-1 text-muted hover:bg-raised hover:text-strong"
            title={t("Reload tasks")}
            onClick={() => void reload()}
          >
            <RefreshCw size={14} />
          </button>
        </span>
      </div>
      <div className="flex min-h-0 flex-1 gap-3 overflow-x-auto p-3">
        {COLUMNS.map((col) => {
          const q = filter.toLowerCase().trim();
          const colTasks = tasks
            .filter((t) => t.status === col.id)
            .filter(
              (t) =>
                !q ||
                t.title.toLowerCase().includes(q) ||
                t.description.toLowerCase().includes(q),
            )
            .sort((a, b) => a.position - b.position);
          return (
            <div
              key={col.id}
              data-testid={`task-col-${col.id}`}
              className="flex min-w-[220px] flex-1 basis-0 flex-col rounded-lg border border-edge bg-raised/40"
              onDragOver={(e) => {
                if (q) return; // drag & drop is disabled while filtering
                e.preventDefault();
                if (dropHint?.status !== col.id || dropHint.index !== colTasks.length) {
                  setDropHint({ status: col.id, index: colTasks.length });
                }
              }}
              onDragLeave={() => setDropHint(null)}
              onDrop={(e) => {
                if (q) return;
                e.preventDefault();
                onDrop(col.id, colTasks.length);
              }}
            >
              <div className="flex items-center gap-1.5 px-2 py-1.5 text-xs font-semibold uppercase tracking-wide text-muted">
                {t(col.label)}
                <span className="rounded bg-raised px-1.5 text-3xs">{colTasks.length}</span>
              </div>
              <div className="flex min-h-0 flex-1 flex-col gap-1.5 overflow-y-auto px-1.5 pb-1.5">
                {colTasks.map((task, i) => (
                  <TaskCard
                    key={task.id}
                    task={task}
                    editing={editingId === task.id}
                    highlight={dropHint?.status === col.id && dropHint.index === i}
                    draggable={!q}
                    onDragStart={(e) => {
                      dragId.current = task.id;
                      setDragGhost(e, task.title);
                    }}
                    onDragOverCard={(e) => {
                      if (q) return;
                      e.preventDefault();
                      e.stopPropagation();
                      if (dropHint?.status !== col.id || dropHint.index !== i) {
                        setDropHint({ status: col.id, index: i });
                      }
                    }}
                    onDropOnCard={(e) => {
                      if (q) return;
                      e.preventDefault();
                      e.stopPropagation();
                      onDrop(col.id, i);
                    }}
                    onContextMenu={(e) => cardMenu(e, task)}
                    onEdit={() => setEditingId(task.id)}
                    onCloseEdit={() => setEditingId(null)}
                    onSave={(t) => void saveTask(t)}
                    onDelete={() => void deleteTask(task)}
                    onCopyPrompt={() => void copyPrompt(task)}
                    onShift={(delta) => shiftTask(task, delta)}
                    canLeft={col.id !== COLUMNS[0].id}
                    canRight={col.id !== COLUMNS[COLUMNS.length - 1].id}
                  />
                ))}
                {colTasks.length === 0 && (
                  <div className="rounded-lg border border-dashed border-edge bg-surface/55 px-2 py-3 text-center text-xs text-muted">
                    {q ? t("No matching tasks") : t("Drop tasks here or add a new one")}
                  </div>
                )}
                <AddCard onAdd={(title) => void addTask(col.id, title)} />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function TaskCard(props: {
  task: Task;
  editing: boolean;
  highlight: boolean;
  draggable: boolean;
  onDragStart: (e: React.DragEvent) => void;
  onDragOverCard: (e: React.DragEvent) => void;
  onDropOnCard: (e: React.DragEvent) => void;
  onContextMenu: (e: React.MouseEvent) => void;
  onEdit: () => void;
  onCloseEdit: () => void;
  onSave: (task: Task) => void;
  onDelete: () => void;
  onCopyPrompt: () => void;
  onShift: (delta: 1 | -1) => void;
  canLeft: boolean;
  canRight: boolean;
}) {
  const { task } = props;
  const [title, setTitle] = useState(task.title);
  const [description, setDescription] = useState(task.description);

  useEffect(() => {
    setTitle(task.title);
    setDescription(task.description);
  }, [task.title, task.description, props.editing]);

  if (props.editing) {
    return (
      <div className="rounded-lg border border-edge bg-surface p-2 shadow-sm" data-testid="task-card">
        <input
          autoFocus
          className="mb-1.5 w-full rounded border border-edge bg-raised px-2 py-1 text-strong outline-none focus:border-accent"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder={t("Task title")}
        />
        <textarea
          className="mb-1.5 h-20 w-full resize-none rounded border border-edge bg-raised px-2 py-1 text-strong outline-none focus:border-accent"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder={t("Details for the agent (optional)…")}
        />
        <div className="flex gap-1.5">
          <button
            className="rounded bg-raised border border-edge px-2 py-0.5 text-xs font-medium text-strong hover:bg-surface disabled:opacity-40"
            disabled={!title.trim()}
            onClick={() => {
              props.onSave({ ...task, title: title.trim(), description });
              props.onCloseEdit();
            }}
          >
            {t("Save")}
          </button>
          <button
            className="rounded border border-edge px-2 py-0.5 text-xs text-muted hover:text-strong"
            onClick={props.onCloseEdit}
          >
            {t("common.cancel", "Cancel")}
          </button>
          <button
            className="ml-auto rounded p-1 text-muted hover:text-danger"
            title={t("Delete task")}
            onClick={props.onDelete}
           aria-label={t("Delete task")}>
            <Trash2 size={13} />
          </button>
        </div>
      </div>
    );
  }

  return (
    <div
      draggable={props.draggable}
      data-testid="task-card"
      className={`group cursor-grab rounded border bg-surface p-2 transition-colors hover:border-muted ${
        props.highlight ? "border-muted" : "border-edge"
      }`}
      onDragStart={props.onDragStart}
      onDragOver={props.onDragOverCard}
      onDrop={props.onDropOnCard}
      onContextMenu={props.onContextMenu}
      onDoubleClick={props.onEdit}
      onClick={(e) => {
        // Shift+click: quick-advance the card to the next column.
        if (e.shiftKey && props.canRight) props.onShift(1);
      }}
      title={t("Double-click to edit · ⇧ Click to advance · drag to move")}
    >
      <div className="flex items-start gap-1.5">
        <span className="min-w-0 flex-1 break-words text-strong">{task.title}</span>
        <span className="flex shrink-0 gap-0.5">
          <button
            className="rounded p-0.5 text-muted hover:text-strong disabled:opacity-20"
            title={t("Move left")}
            disabled={!props.canLeft}
            onClick={(e) => {
              e.stopPropagation();
              props.onShift(-1);
            }}
          >
            <ChevronLeft size={12} />
          </button>
          <button
            className="rounded p-0.5 text-muted hover:text-strong disabled:opacity-20"
            title={t("Move right (⇧ Click card)")}
            disabled={!props.canRight}
            onClick={(e) => {
              e.stopPropagation();
              props.onShift(1);
            }}
          >
            <ChevronRight size={12} />
          </button>
          <button
            className="rounded p-0.5 text-muted hover:text-accent"
            title={t("Copy as agent prompt")}
            onClick={(e) => {
              e.stopPropagation();
              props.onCopyPrompt();
            }}
          >
            <ClipboardCopy size={12} />
          </button>
          <button
            className="rounded p-0.5 text-muted hover:text-accent"
            title={t("Edit task")}
            onClick={(e) => {
              e.stopPropagation();
              props.onEdit();
            }}
          >
            <Pencil size={12} />
          </button>
        </span>
      </div>
      {task.description.trim() && (
        <div className="mt-1 line-clamp-3 whitespace-pre-wrap text-xs text-muted">{task.description}</div>
      )}
    </div>
  );
}

function AddCard(props: { onAdd: (title: string) => void }) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");

  if (!open) {
    return (
      <button
        className="flex items-center justify-center gap-1 rounded-lg border border-dashed border-edge px-2 py-1.5 text-left text-xs text-muted hover:bg-raised hover:text-strong"
        onClick={() => setOpen(true)}
      >
        <Plus size={13} /> {t("Add task")}
      </button>
    );
  }
  const submit = (keepOpen = false) => {
    if (title.trim()) props.onAdd(title.trim());
    setTitle("");
    // Enter keeps the input open for rapid entry; blur/Escape closes it.
    if (!keepOpen) setOpen(false);
  };
  return (
    <input
      autoFocus
      className="w-full rounded border border-edge bg-surface px-2 py-1 text-strong outline-none focus:border-muted"
      placeholder={t("Task title — Enter to add")}
      value={title}
      onChange={(e) => setTitle(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === "Enter") submit(true);
        if (e.key === "Escape") {
          setTitle("");
          setOpen(false);
        }
      }}
      onBlur={() => submit()}
    />
  );
}
