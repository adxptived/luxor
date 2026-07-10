/**
 * Visible drag previews for HTML5 drag & drop: a small floating chip with the
 * name of whatever is being dragged (tab, sidebar button, status segment).
 */

export function setDragGhost(e: React.DragEvent, label: string): void {
  try {
    const ghost = document.createElement("div");
    ghost.className = "lx-drag-ghost";
    ghost.textContent = label;
    document.body.appendChild(ghost);
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", label);
    e.dataTransfer.setDragImage(ghost, 16, 14);
    // The browser snapshots the element synchronously on dragstart; remove it
    // right after.
    setTimeout(() => ghost.remove(), 0);
  } catch {
    // Drag previews are best-effort (older webviews).
  }
}
