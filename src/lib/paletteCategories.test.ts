import { describe, expect, it } from "bun:test";

import { categoryIdFor, categoryOf, groupByCategory } from "./paletteCategories";

describe("palette categories", () => {
  it("groups by command id, so translated labels keep their category", () => {
    expect(categoryIdFor({ id: "terminal.new", label: "Терминал: новый терминал" })).toBe("terminal");
    expect(categoryIdFor({ id: "zoom.in", label: "Вид: увеличить" })).toBe("view");
    expect(categoryIdFor({ id: "db.open", label: "База данных: открыть" })).toBe("database");
    expect(categoryOf({ id: "git.open", label: "Git: открыть" }).id).toBe("git");
  });

  it("falls back to the English label prefix for unknown ids", () => {
    expect(categoryIdFor({ id: "misc.x", label: "Docker: Open" })).toBe("docker");
    expect(categoryIdFor({ label: "Something" })).toBe("command");
    expect(categoryOf("Git: Open panel").id).toBe("git");
  });

  it("does not dump translated commands into the generic group", () => {
    const groups = groupByCategory([
      { id: "terminal.new", label: "Терминал: новый терминал" },
      { id: "git.open", label: "Git: открыть панель Git" },
    ]);
    expect(groups.map((g) => g.category.id)).toEqual(["terminal", "git"]);
  });
});
