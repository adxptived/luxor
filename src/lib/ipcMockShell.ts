/**
 * A tiny simulated shell for the browser/dev mock backend.
 *
 * Without Tauri there is no PTY, so terminals used to stay blank: nothing was
 * echoed, no prompt appeared, and the restore/title/command-tracking code paths
 * could not be seen in `bun run dev`, the e2e suite or the screenshots. This
 * shell echoes keystrokes, prints a prompt, reports its folder via OSC 7 and its
 * title via OSC 0, and answers a handful of commands from the demo project
 * (`ls`, `cd`, `cat`, `git status`, `bun test`, …).
 *
 * Only imported by `ipcMock.ts` (never part of the desktop build).
 */

import { DEMO_GIT_STATUS, DEMO_ROOT, demoList, demoRead, inDemo } from "./ipcMockFs";

type Handler = (payload: unknown) => void;

const listeners = new Map<string, Set<Handler>>();

/** Mock replacement for Tauri's event `listen`. */
export function mockListen(event: string, handler: Handler): () => void {
  let set = listeners.get(event);
  if (!set) {
    set = new Set();
    listeners.set(event, set);
  }
  set.add(handler);
  return () => set?.delete(handler);
}

function emit(event: string, payload: unknown): void {
  for (const h of listeners.get(event) ?? []) {
    try {
      h(payload);
    } catch {
      /* a broken listener must not stop the others */
    }
  }
}

function toB64(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(bin);
}

function fromB64(b64: string): string {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

interface Session {
  id: string;
  cwd: string;
  line: string;
  alive: boolean;
}

const sessions = new Map<string, Session>();
let seq = 0;

const HOME = "/home/dev";
const ESC = "\x1b";

function out(s: Session, text: string): void {
  if (!s.alive) return;
  emit("luxor://pty-output", { session_id: s.id, data_b64: toB64(text) });
}

const tilde = (path: string) => (path === HOME ? "~" : path.startsWith(`${HOME}/`) ? `~${path.slice(HOME.length)}` : path);
const base = (path: string) => path.split("/").filter(Boolean).pop() ?? "/";

function prompt(s: Session): string {
  // OSC 7 (cwd) + OSC 0 (window title) + OSC 133;A (prompt start), like a
  // shell with integration enabled.
  return (
    `${ESC}]7;file://localhost${s.cwd}\x07` +
    `${ESC}]0;${base(s.cwd)}\x07` +
    `${ESC}]133;A\x07` +
    `${ESC}[32mdev@luxor${ESC}[0m:${ESC}[34m${tilde(s.cwd)}${ESC}[0m$ ` +
    `${ESC}]133;B\x07`
  );
}

function resolve(cwd: string, arg: string): string {
  if (!arg || arg === "~") return HOME;
  let path = arg.startsWith("/") ? arg : arg.startsWith("~/") ? `${HOME}/${arg.slice(2)}` : `${cwd}/${arg}`;
  const parts: string[] = [];
  for (const part of path.split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") parts.pop();
    else parts.push(part);
  }
  path = `/${parts.join("/")}`;
  return path;
}

const lines = (text: string) => text.replace(/\r?\n/g, "\r\n");

function run(s: Session, raw: string): string {
  const cmd = raw.trim();
  if (!cmd) return "";
  const [name, ...args] = cmd.split(/\s+/);
  switch (name) {
    case "help":
      return lines(
        "Simulated shell (browser preview). Try: ls, cd <dir>, pwd, cat <file>, git status, bun test, bun run dev, clear\n",
      );
    case "pwd":
      return `${s.cwd}\r\n`;
    case "whoami":
      return "dev\r\n";
    case "date":
      return `${new Date().toUTCString()}\r\n`;
    case "echo":
      return `${args.join(" ")}\r\n`;
    case "clear":
      return `${ESC}[2J${ESC}[3J${ESC}[H`;
    case "cd": {
      const target = resolve(s.cwd, args[0] ?? "~");
      if (target === HOME || target === "/" || target === "/home") {
        s.cwd = target;
        return "";
      }
      if (inDemo(target)) {
        try {
          demoList(target);
          s.cwd = target;
          return "";
        } catch {
          /* fall through */
        }
      }
      return `cd: ${args[0]}: No such file or directory\r\n`;
    }
    case "ls": {
      const dir = args[0] ? resolve(s.cwd, args[0]) : s.cwd;
      if (dir === HOME) return `${ESC}[34maurora-shop${ESC}[0m\r\n`;
      if (!inDemo(dir)) return "\r\n";
      try {
        const names = demoList(dir).map((e) => (e.is_dir ? `${ESC}[34m${e.name}${ESC}[0m` : e.name));
        return `${names.join("  ")}\r\n`;
      } catch {
        return `ls: cannot access '${args[0] ?? dir}': No such file or directory\r\n`;
      }
    }
    case "cat": {
      if (!args[0]) return "";
      const path = resolve(s.cwd, args[0]);
      try {
        const text = demoRead(path).content;
        return lines(text.endsWith("\n") ? text : `${text}\n`);
      } catch {
        return `cat: ${args[0]}: No such file or directory\r\n`;
      }
    }
    case "git": {
      if (args[0] !== "status") return `git: '${args[0] ?? ""}' is not available in the demo shell\r\n`;
      const st = DEMO_GIT_STATUS;
      const staged = st.entries.filter((e) => e.staged).map((e) => `\t${ESC}[32m${e.staged}:   ${e.path}${ESC}[0m`);
      const unstaged = st.entries.filter((e) => e.unstaged).map((e) => `\t${ESC}[31m${e.unstaged}:   ${e.path}${ESC}[0m`);
      return lines(
        [
          `On branch ${st.branch}`,
          `Your branch is ahead of 'origin/${st.branch}' by ${st.ahead} commits.`,
          "",
          "Changes to be committed:",
          ...staged,
          "",
          "Changes not staged for commit:",
          ...unstaged,
          "",
        ].join("\n"),
      );
    }
    case "bun":
    case "npm":
    case "pnpm": {
      const sub = args[0] === "run" ? args[1] : args[0];
      if (sub === "test")
        return lines(
          [
            "bun test v1.3.8",
            "",
            "tests/cart.test.ts:",
            `${ESC}[32m✓${ESC}[0m formats cents as dollars [0.41ms]`,
            "",
            ` ${ESC}[32m1 pass${ESC}[0m`,
            " 0 fail",
            "Ran 1 tests across 1 files. [18.00ms]",
            "",
          ].join("\n"),
        );
      if (sub === "dev")
        return lines(
          [
            "",
            `  ${ESC}[32mVITE${ESC}[0m v6.3.5  ready in 312 ms`,
            "",
            `  ➜  Local:   ${ESC}[36mhttp://localhost:5173/${ESC}[0m`,
            "  ➜  Network: use --host to expose",
            "",
          ].join("\n"),
        );
      if (sub === "build")
        return lines(
          [
            "src/lib/api.ts:9:3 - warning: unused variable 'retries'",
            `${ESC}[32m✓${ESC}[0m built in 1.42s`,
            "",
          ].join("\n"),
        );
      return `${name}: '${sub ?? ""}' is not available in the demo shell\r\n`;
    }
    default:
      return `${name}: command not found (demo shell — type 'help')\r\n`;
  }
}

export function mockPtySpawn(opts: { cwd?: string | null } | undefined): {
  session_id: string;
  shell: string;
  cwd: string;
  pid: number;
} {
  seq += 1;
  const cwd = opts?.cwd || HOME;
  const s: Session = { id: `mock-${Date.now()}-${seq}`, cwd, line: "", alive: true };
  sessions.set(s.id, s);
  // After the spawn promise resolves (the panel attaches through the pty bus,
  // which buffers anything that arrives first).
  setTimeout(() => {
    out(s, `${ESC}[90mLuxor demo shell — commands are simulated in the browser preview. Type 'help'.${ESC}[0m\r\n`);
    out(s, prompt(s));
  }, 30);
  return { session_id: s.id, shell: "demo-sh", cwd, pid: 4242 };
}

export function mockPtyWrite(sessionId: string, dataB64: string): void {
  const s = sessions.get(sessionId);
  if (!s) return;
  const data = fromB64(dataB64);
  // Arrow keys and other escape sequences: ignore (no line editing here).
  if (data.startsWith(ESC)) return;
  let echo = "";
  for (const ch of data) {
    if (ch === "\r" || ch === "\n") {
      echo += "\r\n";
      const cmd = s.line;
      s.line = "";
      out(s, echo);
      echo = "";
      if (cmd.trim()) out(s, `${ESC}]133;C\x07`);
      out(s, run(s, cmd));
      if (cmd.trim()) out(s, `${ESC}]133;D;0\x07`);
      out(s, prompt(s));
    } else if (ch === "\x7f" || ch === "\b") {
      if (s.line.length > 0) {
        s.line = s.line.slice(0, -1);
        echo += "\b \b";
      }
    } else if (ch === "\x03") {
      s.line = "";
      out(s, `${echo}^C\r\n`);
      echo = "";
      out(s, prompt(s));
    } else if (ch === "\x0c") {
      out(s, `${echo}${ESC}[2J${ESC}[H`);
      echo = "";
      out(s, prompt(s) + s.line);
    } else if (ch >= " ") {
      s.line += ch;
      echo += ch;
    }
  }
  if (echo) out(s, echo);
}

export function mockPtyKill(sessionId: string): void {
  const s = sessions.get(sessionId);
  if (!s) return;
  s.alive = false;
  sessions.delete(sessionId);
}

export { DEMO_ROOT };
