import { describe, expect, test } from "bun:test";

import { isInstallable, localFilter } from "./SkillsPanel";
import type { MarketSkill } from "@/lib/types";

const SKILLS: MarketSkill[] = [
  { source: "openai/skills", skill_id: "pdf", name: "pdf", installs: 7145, is_official: true, url: "" },
  { source: "vercel-labs/json-render", skill_id: "react-pdf", name: "react-pdf", installs: 1287, is_official: false, url: "" },
  { source: "anthropics/skills", skill_id: "frontend-design", name: "frontend-design", installs: 530372, is_official: true, url: "" },
];

describe("isInstallable", () => {
  test("accepts owner/repo GitHub sources", () => {
    expect(isInstallable("vercel-labs/skills")).toBe(true);
    expect(isInstallable("vercel-labs/json-render")).toBe(true);
    expect(isInstallable("anthropics/skills")).toBe(true);
  });

  test("rejects bare external-registry hosts (no repo path)", () => {
    expect(isInstallable("smithery.ai")).toBe(false);
    expect(isInstallable("modelscope.cn")).toBe(false);
    expect(isInstallable("skills.volces.com")).toBe(false);
  });

  test("rejects path-traversal attempts", () => {
    expect(isInstallable("../etc/passwd")).toBe(false);
    expect(isInstallable("a/../b")).toBe(false);
  });
});

describe("localFilter", () => {
  test("matches against name, id and source (case-insensitive)", () => {
    expect(localFilter(SKILLS, "PDF").length).toBe(2);
    expect(localFilter(SKILLS, "openai")[0].skill_id).toBe("pdf");
    expect(localFilter(SKILLS, "anthropics").length).toBe(1);
  });

  test("requires every term to match (AND semantics)", () => {
    expect(localFilter(SKILLS, "react pdf").length).toBe(1);
    expect(localFilter(SKILLS, "pdf nope").length).toBe(0);
  });

  test("empty query or null list yields nothing", () => {
    expect(localFilter(SKILLS, "   ")).toEqual([]);
    expect(localFilter(null, "pdf")).toEqual([]);
  });
});
