/**
 * Maps the editor language ids (the same ones `editorLanguage.ts` already
 * returns) to CodeMirror 6 language extensions.
 *
 * Language packs are loaded **lazily on first use** — the import for Rust
 * is only pulled in when someone actually opens a `.rs` file, so the entry
 * chunk and the cm-core chunk stay small.
 *
 * Coverage: every id `editorLanguage.ts` can return now resolves to a real
 * grammar. Dedicated `@codemirror/lang-*` packs are used where they exist
 * (richer grammars + indentation); everything else uses the battle-tested
 * `@codemirror/legacy-modes` StreamLanguage grammars. Truly unknown ids fall
 * back to a no-op plaintext grammar.
 *
 * `resolveLanguageExtension` returns a `Promise<Extension>` that resolves
 * to a real CM `Extension` (or the plaintext grammar for unknown ids) —
 * never a Promise itself, because CodeMirror's `ExtensionSet` does not
 * accept Promises.
 */

import type { Extension } from "@codemirror/state";
import { StreamLanguage, type StreamParser } from "@codemirror/language";

interface TokenState { [key: string]: unknown }
const PLAINTEXT = StreamLanguage.define<TokenState>({
  name: "plaintext",
  startState: () => ({}),
  token: (stream) => {
    stream.next();
    return null;
  },
});

// Tiny fallback grammars for config-ish languages that do not have a dedicated
// CodeMirror package in this app. This keeps the editor visibly syntax-aware
// instead of looking like a plain textarea when users open .bat, .tf/.hcl,
// .proto, or GraphQL files.
const lineCommentLang = (name: string, comment = "#") => StreamLanguage.define<TokenState>({
  name,
  startState: () => ({}),
  token: (stream) => {
    if (comment === "#" && stream.match(/#.*/)) return "comment";
    if (comment === "//" && stream.match(/\/\/.*/)) return "comment";
    if (stream.match(/"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'/)) return "string";
    if (stream.match(/\b\d+(?:\.\d+)?\b/)) return "number";
    if (stream.match(/[{}()[\],.;:=]/)) return "punctuation";
    if (stream.match(/[A-Za-z_][\w-]*/)) return "variableName";
    stream.next();
    return null;
  },
});

const batFallback = StreamLanguage.define<TokenState>({
  name: "bat",
  startState: () => ({}),
  token: (stream) => {
    if (stream.match(/\s*(?:rem\b|::).*/i)) return "comment";
    if (stream.match(/"(?:[^"]|"")*"/)) return "string";
    if (stream.match(/%[^%]+%|![^!]+!/)) return "variableName";
    if (stream.match(/\b(?:echo|set|if|else|for|in|do|goto|call|exit|cd|pushd|popd|mkdir|rmdir|copy|xcopy|move|del|pause)\b/i)) return "keyword";
    if (stream.match(/\b\d+\b/)) return "number";
    stream.next();
    return null;
  },
});

const graphqlFallback = StreamLanguage.define<TokenState>({
  name: "graphql",
  startState: () => ({}),
  token: (stream) => {
    if (stream.match(/#.*/)) return "comment";
    if (stream.match(/"""(?:.|\n)*?"""|"(?:[^"\\]|\\.)*"/)) return "string";
    if (stream.match(/\b(?:query|mutation|subscription|fragment|on|schema|type|interface|union|enum|input|extend|scalar|directive)\b/)) return "keyword";
    if (stream.match(/\b(?:true|false|null)\b|\b\d+(?:\.\d+)?\b/)) return "number";
    if (stream.match(/[!$():=@[\]{}|]/)) return "punctuation";
    if (stream.match(/[A-Za-z_][\w]*/)) return "variableName";
    stream.next();
    return null;
  },
});

/**
 * Each language loader is wrapped in a `Promise<Extension>` cache so the
 * import only happens once per id, on the first file open of that kind.
 * CodeMirror's `langCompartment.reconfigure` accepts an `Extension` array.
 */
type Loader = () => Promise<Extension>;
const cache = new Map<string, Promise<Extension>>();

function load(id: string, loader: Loader): Promise<Extension> {
  let p = cache.get(id);
  if (!p) {
    p = loader().catch((e) => {
      // If a pack ever fails to load, drop it from the cache so a later
      // open retries instead of poisoning the editor.
      cache.delete(id);
      throw e;
    });
    cache.set(id, p);
  }
  return p;
}

/** Wrap a legacy-modes StreamParser as a CM language Extension. */
function legacy(p: StreamParser<unknown>): Extension {
  return StreamLanguage.define(p);
}

// Dedicated packs (each becomes its own async chunk on first use). These have
// full Lezer grammars — proper indentation, folding and bracket awareness.
const loaders: Record<string, Loader> = {
  javascript: () => import("@codemirror/lang-javascript").then((m) => m.javascript()),
  typescript: () => import("@codemirror/lang-javascript").then((m) => m.javascript({ typescript: true })),
  jsx: () => import("@codemirror/lang-javascript").then((m) => m.javascript({ jsx: true })),
  tsx: () => import("@codemirror/lang-javascript").then((m) => m.javascript({ typescript: true, jsx: true })),
  json: () => import("@codemirror/lang-json").then((m) => m.json()),
  jsonc: () => import("@codemirror/lang-json").then((m) => m.json()),
  html: () => import("@codemirror/lang-html").then((m) => m.html()),
  vue: () => import("@codemirror/lang-vue").then((m) => m.vue()),
  css: () => import("@codemirror/lang-css").then((m) => m.css()),
  scss: () => import("@codemirror/lang-sass").then((m) => m.sass({ indented: false })),
  sass: () => import("@codemirror/lang-sass").then((m) => m.sass({ indented: true })),
  less: () => import("@codemirror/lang-less").then((m) => m.less()),
  sql: () => import("@codemirror/lang-sql").then((m) => m.sql()),
  python: () => import("@codemirror/lang-python").then((m) => m.python()),
  rust: () => import("@codemirror/lang-rust").then((m) => m.rust()),
  go: () => import("@codemirror/lang-go").then((m) => m.go()),
  yaml: () => import("@codemirror/lang-yaml").then((m) => m.yaml()),
  markdown: () => import("@codemirror/lang-markdown").then((m) => m.markdown()),
  xml: () => import("@codemirror/lang-xml").then((m) => m.xml()),
  java: () => import("@codemirror/lang-java").then((m) => m.java()),
  // The C/C++ pack also tokenizes plain C well.
  c: () => import("@codemirror/lang-cpp").then((m) => m.cpp()),
  cpp: () => import("@codemirror/lang-cpp").then((m) => m.cpp()),
  php: () => import("@codemirror/lang-php").then((m) => m.php()),

  // Legacy StreamLanguage grammars — smaller, no dedicated Lezer pack exists,
  // but they give solid keyword/string/comment/number highlighting. Each still
  // lands in its own chunk (see vite.config manualChunks).
  shell: () => import("@codemirror/legacy-modes/mode/shell").then((m) => legacy(m.shell)),
  powershell: () => import("@codemirror/legacy-modes/mode/powershell").then((m) => legacy(m.powerShell)),
  csharp: () => import("@codemirror/legacy-modes/mode/clike").then((m) => legacy(m.csharp)),
  kotlin: () => import("@codemirror/legacy-modes/mode/clike").then((m) => legacy(m.kotlin)),
  scala: () => import("@codemirror/legacy-modes/mode/clike").then((m) => legacy(m.scala)),
  dart: () => import("@codemirror/legacy-modes/mode/clike").then((m) => legacy(m.dart)),
  ruby: () => import("@codemirror/legacy-modes/mode/ruby").then((m) => legacy(m.ruby)),
  swift: () => import("@codemirror/legacy-modes/mode/swift").then((m) => legacy(m.swift)),
  lua: () => import("@codemirror/legacy-modes/mode/lua").then((m) => legacy(m.lua)),
  perl: () => import("@codemirror/legacy-modes/mode/perl").then((m) => legacy(m.perl)),
  r: () => import("@codemirror/legacy-modes/mode/r").then((m) => legacy(m.r)),
  groovy: () => import("@codemirror/legacy-modes/mode/groovy").then((m) => legacy(m.groovy)),
  toml: () => import("@codemirror/legacy-modes/mode/toml").then((m) => legacy(m.toml)),
  // .ini / .env / .conf / .cfg — key=value with comments.
  ini: () => import("@codemirror/legacy-modes/mode/properties").then((m) => legacy(m.properties)),
  dockerfile: () => import("@codemirror/legacy-modes/mode/dockerfile").then((m) => legacy(m.dockerFile)),
  diff: () => import("@codemirror/legacy-modes/mode/diff").then((m) => legacy(m.diff)),
  bat: () => Promise.resolve(batFallback as unknown as Extension),
  hcl: () => Promise.resolve(lineCommentLang("hcl") as unknown as Extension),
  proto: () => Promise.resolve(lineCommentLang("proto", "//") as unknown as Extension),
  graphql: () => Promise.resolve(graphqlFallback as unknown as Extension),
};

/**
 * Async resolver — call this from inside `mountEditor` (which is already
 * async) so the language extension is real by the time it reaches CM.
 */
export function resolveLanguageExtension(id: string): Promise<Extension> {
  const lower = (id ?? "").toLowerCase();
  if (!lower || lower === "plaintext") return Promise.resolve(PLAINTEXT as unknown as Extension);
  const loader = loaders[lower];
  if (loader) return load(lower, loader);
  // Unknown id: return the plaintext grammar synchronously — it's a sync
  // StreamLanguage with no async deps.
  return Promise.resolve(PLAINTEXT as unknown as Extension);
}

/** Test helper: synchronously check if the id is one we know about. */
export function isKnownLanguageId(id: string): boolean {
  if (!id) return false;
  return Object.prototype.hasOwnProperty.call(loaders, id.toLowerCase());
}

// Re-exported as the previous name for any callers that still use it.
export { resolveLanguageExtension as languageExtensionForId };
