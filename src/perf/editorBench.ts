/**
 * Editor micro-benchmarks. Run with `bun run bench:editor`.
 *
 * Measures:
 *   - getCodeMirror()         cold-cache import cost of @codemirror/view
 *   - mountEditor (TS, 1k)    cost of constructing a state for a 1k-line TS doc
 *   - mountEditor (Rust, 200) cost of constructing a state for a 200-line Rust doc
 *   - per-language pack       cost of importing each @codemirror/lang-* on demand
 *
 * Anything that needs a real DOM (the EditorView construction itself) is
 * allowed to throw — the bench script catches it and reports "skipped" so
 * the rest of the suite still runs.
 */

import { bench, group, run } from "mitata";

const SAMPLE_1K = Array.from({ length: 1000 }, (_, i) => `let v${i} = ${i};`).join("\n");
const SAMPLE_200 = Array.from({ length: 200 }, (_, i) => `fn fib_${i}(n: u64) -> u64 { if n < 2 { n } else { fib_${i}(n-1) + fib_${i}(n-2) } }`).join("\n");

async function tryBench(name: string, fn: () => void | Promise<void>) {
  try {
    await fn();
  } catch (e) {
     
    console.warn(`[skip] ${name}: ${(e as Error).message.slice(0, 80)}`);
  }
}

group("editor (CodeMirror 6, Node)", () => {
  bench("getCodeMirror() – cold cache", async () => {
    await tryBench("import", async () => {
      // The promise is module-cached by Bun; this measures the cost of
      // resolving the dynamic import graph (the closest analogue to the
      // user opening a file for the first time).
      await import("@codemirror/view");
    });
  });

  bench("mountEditor (TS, 1k lines) – state build only", async () => {
    await tryBench("ts", async () => {
      const { resolveLanguageExtension } = await import("../lib/codemirrorLanguages");
      const { buildEditorTheme } = await import("../lib/codemirrorThemes");
      const { EditorState } = await import("@codemirror/state");
      const { defaultKeymap, history, historyKeymap, indentWithTab } = await import("@codemirror/commands");
      const { keymap, drawSelection, highlightActiveLine, lineNumbers, highlightActiveLineGutter } = await import("@codemirror/view");
      const { searchKeymap, highlightSelectionMatches } = await import("@codemirror/search");
      const langExt = await resolveLanguageExtension("typescript");
      const themeExt = buildEditorTheme("luxor-dark", false);
      EditorState.create({
        doc: SAMPLE_1K,
        extensions: [
          lineNumbers(),
          highlightActiveLine(),
          highlightActiveLineGutter(),
          highlightSelectionMatches(),
          drawSelection(),
          history(),
          keymap.of([indentWithTab, ...defaultKeymap, ...historyKeymap, ...searchKeymap]),
          themeExt,
          langExt,
        ],
      });
    });
  });

  bench("mountEditor (Rust, 200 lines) – state build only", async () => {
    await tryBench("rust", async () => {
      const { resolveLanguageExtension } = await import("../lib/codemirrorLanguages");
      const { buildEditorTheme } = await import("../lib/codemirrorThemes");
      const { EditorState } = await import("@codemirror/state");
      const { defaultKeymap, history, historyKeymap, indentWithTab } = await import("@codemirror/commands");
      const { keymap, drawSelection, highlightActiveLine, lineNumbers, highlightActiveLineGutter } = await import("@codemirror/view");
      const { searchKeymap, highlightSelectionMatches } = await import("@codemirror/search");
      const langExt = await resolveLanguageExtension("rust");
      const themeExt = buildEditorTheme("luxor-dark", false);
      EditorState.create({
        doc: SAMPLE_200,
        extensions: [
          lineNumbers(),
          highlightActiveLine(),
          highlightActiveLineGutter(),
          highlightSelectionMatches(),
          drawSelection(),
          history(),
          keymap.of([indentWithTab, ...defaultKeymap, ...historyKeymap, ...searchKeymap]),
          themeExt,
          langExt,
        ],
      });
    });
  });
});

group("editor language pack import cost (cold)", () => {
  bench("@codemirror/lang-javascript", async () => {
    await tryBench("js", async () => {
      const { javascript } = await import("@codemirror/lang-javascript");
      javascript({ typescript: true });
    });
  });
  bench("@codemirror/lang-rust", async () => {
    await tryBench("rust", async () => {
      const { rust } = await import("@codemirror/lang-rust");
      rust();
    });
  });
  bench("@codemirror/lang-python", async () => {
    await tryBench("py", async () => {
      const { python } = await import("@codemirror/lang-python");
      python();
    });
  });
  bench("@codemirror/lang-go", async () => {
    await tryBench("go", async () => {
      const { go } = await import("@codemirror/lang-go");
      go();
    });
  });
  bench("@codemirror/lang-yaml", async () => {
    await tryBench("yaml", async () => {
      const { yaml } = await import("@codemirror/lang-yaml");
      yaml();
    });
  });
  bench("@codemirror/lang-sql", async () => {
    await tryBench("sql", async () => {
      const { sql } = await import("@codemirror/lang-sql");
      sql();
    });
  });
  bench("@codemirror/lang-markdown", async () => {
    await tryBench("md", async () => {
      const { markdown } = await import("@codemirror/lang-markdown");
      markdown();
    });
  });
});

await run();
