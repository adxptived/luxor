import { describe, expect, it } from "bun:test";

import { indentFromUnit, useEditorStatus } from "./editorStatusStore";

describe("editor status store", () => {
  it("maps indent units", () => {
    expect(indentFromUnit("\t")).toBe("tab");
    expect(indentFromUnit("  ")).toBe(2);
    expect(indentFromUnit("    ")).toBe(4);
    expect(indentFromUnit("")).toBeNull();
  });

  it("keeps the same state object when nothing changes", () => {
    const st = useEditorStatus.getState();
    st.set("p1", { line: 3, col: 4, lang: "typescript" });
    const before = useEditorStatus.getState().byPanel;
    st.set("p1", { line: 3, col: 4 });
    expect(useEditorStatus.getState().byPanel).toBe(before);
    st.set("p1", { line: 5 });
    expect(useEditorStatus.getState().byPanel.p1).toMatchObject({ line: 5, col: 4, lang: "typescript" });
    st.clear("p1");
    expect(useEditorStatus.getState().byPanel.p1).toBeUndefined();
  });

  it("tracks the active editor per project", () => {
    const st = useEditorStatus.getState();
    st.setActive("proj", "p2");
    expect(useEditorStatus.getState().activeByDock.proj).toBe("p2");
    st.setActive("proj", null);
    expect(useEditorStatus.getState().activeByDock.proj).toBeNull();
  });
});
