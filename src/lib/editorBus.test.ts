import { afterEach, describe, expect, it } from "bun:test";

import {
  dirtyEditorCount,
  editorCount,
  registerEditor,
  resetEditorBus,
  revealInEditor,
  saveAllEditors,
  type EditorHandle,
} from "./editorBus";

afterEach(() => resetEditorBus());

function fakeEditor(over: Partial<EditorHandle> = {}): EditorHandle {
  return { save: async () => {}, reveal: () => {}, isDirty: () => false, ...over };
}

describe("editorBus", () => {
  it("registers and unregisters handles", () => {
    const off = registerEditor("editor:a", fakeEditor());
    expect(editorCount()).toBe(1);
    off();
    expect(editorCount()).toBe(0);
  });

  it("counts only dirty editors", () => {
    registerEditor("editor:a", fakeEditor({ isDirty: () => true }));
    registerEditor("editor:b", fakeEditor({ isDirty: () => false }));
    registerEditor("editor:c", fakeEditor({ isDirty: () => true }));
    expect(dirtyEditorCount()).toBe(2);
  });

  it("saveAllEditors saves only dirty ones and returns the count", async () => {
    let savedA = 0;
    let savedB = 0;
    registerEditor("editor:a", { save: async () => { savedA += 1; }, reveal: () => {}, isDirty: () => true });
    registerEditor("editor:b", { save: async () => { savedB += 1; }, reveal: () => {}, isDirty: () => false });
    const n = await saveAllEditors();
    expect(n).toBe(1);
    expect(savedA).toBe(1);
    expect(savedB).toBe(0);
  });

  it("keeps saving even if one editor throws", async () => {
    let saved = 0;
    registerEditor("editor:bad", { save: async () => { throw new Error("disk full"); }, reveal: () => {}, isDirty: () => true });
    registerEditor("editor:ok", { save: async () => { saved += 1; }, reveal: () => {}, isDirty: () => true });
    const n = await saveAllEditors();
    expect(n).toBe(1);
    expect(saved).toBe(1);
  });

  it("revealInEditor forwards to the matching editor and is a no-op otherwise", () => {
    const seen: number[] = [];
    registerEditor("editor:a", { save: async () => {}, reveal: (l, c) => { seen.push(l, c ?? 1); }, isDirty: () => false });
    revealInEditor("editor:a", 42, 7);
    expect(seen).toEqual([42, 7]);
    expect(() => revealInEditor("editor:missing", 1)).not.toThrow();
  });
});
