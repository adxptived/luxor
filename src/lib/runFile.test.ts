import { describe, expect, it } from "bun:test";

import { canRunFile, runFileCommand } from "./runFile";

describe("runFileCommand", () => {
  it("picks the interpreter by extension", () => {
    expect(runFileCommand("/p/app.py", null, false)).toBe("python3 /p/app.py");
    expect(runFileCommand("/p/app.py", null, true)).toBe("python /p/app.py");
    expect(runFileCommand("/p/x.mjs", null, false)).toBe("node /p/x.mjs");
    expect(runFileCommand("/p/run.sh", null, false)).toBe("bash /p/run.sh");
    expect(runFileCommand("/p/main.go", null, false)).toBe("go run /p/main.go");
    expect(runFileCommand("/p/README.md", null, false)).toBeNull();
    expect(canRunFile("/p/a.ts")).toBe(true);
    expect(canRunFile("/p/Makefile")).toBe(false);
  });

  it("uses a path relative to the terminal folder and quotes spaces", () => {
    expect(runFileCommand("/home/me/proj/scripts/build.py", "/home/me/proj", false)).toBe("python3 scripts/build.py");
    expect(runFileCommand("/home/me/proj/my tool.js", "/home/me/proj/", false)).toBe('node "my tool.js"');
    expect(runFileCommand("/elsewhere/x.py", "/home/me/proj", false)).toBe("python3 /elsewhere/x.py");
    expect(runFileCommand("C:\\Work\\proj\\tools\\a.ps1", "c:\\work\\proj", true)).toBe(
      "powershell -ExecutionPolicy Bypass -File tools\\a.ps1",
    );
  });
});
