import { describe, expect, test } from "bun:test";
import type { IDockviewPanelProps } from "dockview";
import { renderToStaticMarkup } from "react-dom/server";

import { DbPanel } from "./DbPanel";
import { EditorPanel } from "./EditorPanel";
import { FilesPanel } from "./FilesPanel";
import { GitPanel } from "./GitPanel";
import { TerminalPanel } from "./TerminalPanel";

const dockProps = (params: Record<string, unknown> = {}): IDockviewPanelProps =>
  ({
    params,
    api: { id: "test-panel", isActive: false },
  }) as unknown as IDockviewPanelProps;

describe("critical panel component contracts", () => {
  test("Files renders a safe empty state without an active project", () => {
    const html = renderToStaticMarkup(<FilesPanel />);
    expect(html).toContain("Open a project to get started");
  });

  test("Git renders a safe empty state without an active project", () => {
    const html = renderToStaticMarkup(<GitPanel />);
    expect(html).toContain("Open a project to get started");
  });

  test("Database renders its empty table state and SQL action", () => {
    const html = renderToStaticMarkup(<DbPanel {...dockProps({ path: "/tmp/test.db" })} />);
    expect(html).toContain("test.db");
    expect(html).toContain("No tables.");
    expect(html).toContain("SQL console");
  });

  test("Editor renders the requested file shell before IPC loading", () => {
    const html = renderToStaticMarkup(<EditorPanel {...dockProps({ path: "/tmp/readme.md" })} />);
    expect(html).toContain("/tmp/readme.md");
  });

  test("Terminal renders its host surface before spawning a PTY", () => {
    const html = renderToStaticMarkup(<TerminalPanel {...dockProps()} />);
    expect(html).toContain("bg-surface");
  });
});
