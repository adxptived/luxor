import { describe, expect, it } from "bun:test";

import { extensionOf, fileBadge, folderColor, isDimmedFolder, DEFAULT_FOLDER } from "./fileIcons";

describe("extensionOf", () => {
  it("returns the last extension, lower-cased", () => {
    expect(extensionOf("App.TSX")).toBe("tsx");
    expect(extensionOf("archive.tar.gz")).toBe("gz");
    expect(extensionOf("C:\\dev\\a.rs")).toBe("rs");
    expect(extensionOf("/home/me/a.md")).toBe("md");
  });

  it("treats dotfiles and trailing dots as extension-less where sensible", () => {
    expect(extensionOf("Makefile")).toBe("");
    expect(extensionOf("name.")).toBe("");
    expect(extensionOf(".env")).toBe("env");
  });
});

describe("fileBadge", () => {
  it("maps common extensions", () => {
    expect(fileBadge("main.rs").kind).toBe("rust");
    expect(fileBadge("App.tsx").kind).toBe("tsx");
    expect(fileBadge("styles.css").kind).toBe("css");
    expect(fileBadge("photo.PNG").kind).toBe("image");
  });

  it("prefers special file names over extensions", () => {
    expect(fileBadge("package.json").kind).toBe("npm");
    expect(fileBadge("tsconfig.json").kind).toBe("tsconfig");
    expect(fileBadge("Cargo.toml").kind).toBe("cargo");
    expect(fileBadge("Cargo.lock").kind).toBe("lock");
    expect(fileBadge("README.md").kind).toBe("readme");
    expect(fileBadge("notes.md").kind).toBe("markdown");
    expect(fileBadge("Dockerfile").kind).toBe("docker");
  });

  it("recognises .env variants", () => {
    expect(fileBadge(".env").kind).toBe("env");
    expect(fileBadge(".env.local").kind).toBe("env");
    expect(fileBadge(".env.production").kind).toBe("env");
  });

  it("works on paths, not just names", () => {
    expect(fileBadge("src/panels/FilesPanel.tsx").kind).toBe("tsx");
    expect(fileBadge("C:\\dev\\luxor\\Cargo.toml").kind).toBe("cargo");
  });

  it("falls back to a neutral badge labelled with the extension", () => {
    const unknown = fileBadge("data.weird");
    expect(unknown.kind).toBe("file");
    expect(unknown.label).toBe("WEI");
    expect(fileBadge("noext").label).toBe("");
  });

  it("gives every badge a label no longer than 3 characters and a colour", () => {
    for (const name of ["a.ts", "a.tsx", "a.rs", "a.md", "a.zip", "a.unknownext", "Dockerfile", ".gitignore"]) {
      const badge = fileBadge(name);
      expect(badge.label.length).toBeLessThanOrEqual(3);
      expect(badge.bg).toMatch(/^#[0-9a-f]{6}$/i);
      expect(badge.fg).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });
});

describe("folderColor", () => {
  it("colours well-known folders and defaults the rest", () => {
    expect(folderColor("src")).not.toBe(DEFAULT_FOLDER);
    expect(folderColor("SRC")).toBe(folderColor("src"));
    expect(folderColor("my-feature")).toBe(DEFAULT_FOLDER);
  });

  it("dims generated and vendored folders", () => {
    expect(isDimmedFolder("node_modules")).toBe(true);
    expect(isDimmedFolder("target")).toBe(true);
    expect(isDimmedFolder(".git")).toBe(true);
    expect(isDimmedFolder("src")).toBe(false);
  });
});
