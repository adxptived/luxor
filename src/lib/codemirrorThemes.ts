/**
 * CodeMirror 6 theme builder. Loaded only when an editor panel opens, so
 * importing this file from `codemirror.ts` does not pull CodeMirror into
 * the startup bundle. The theme *meta* list (labels, dark/light flag) lives
 * in `codemirrorThemeMeta.ts` and stays in the entry chunk.
 */

import type { Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { classHighlighter, tags as t } from "@lezer/highlight";

// Re-export the meta so callers (EditorPanel, DiffPanel) that already
// import from this file keep working.
export { CODEMIRROR_THEMES, EDITOR_THEMES, type EditorThemeMeta } from "./codemirrorThemeMeta";

interface Palette {
  bg: string;
  fg: string;
  comment: string;
  keyword: string;
  string: string;
  number: string;
  type: string;
  func: string;
  lineHighlight: string;
  selection: string;
  inactiveSelection: string;
  cursor: string;
  gutterFg: string;
}

const PALETTES: Record<string, Palette> = {
  "luxor-dark":  { bg: "#101014", fg: "#d6d6dc", comment: "#5c5c66", keyword: "#e8b059", string: "#9ece6a", number: "#d19a66", type: "#7aa2f7", func: "#e0af68", lineHighlight: "#1a1a21", selection: "#3a3540", inactiveSelection: "#2a2530", cursor: "#e8b059", gutterFg: "#5c5c66" },
  "luxor-light": { bg: "#fafafa", fg: "#33333a", comment: "#9c9ca6", keyword: "#b07818", string: "#50741f", number: "#a05a1f", type: "#3b5bdb", func: "#8a6116", lineHighlight: "#ededf0", selection: "#c4b387", inactiveSelection: "#d9cfb1", cursor: "#b07818", gutterFg: "#9c9ca6" },
  monokai:       { bg: "#272822", fg: "#f8f8f2", comment: "#75715e", keyword: "#f92672", string: "#e6db74", number: "#ae81ff", type: "#66d9ef", func: "#a6e22e", lineHighlight: "#3e3d32", selection: "#5a5a3a", inactiveSelection: "#49483e", cursor: "#f8f8f0", gutterFg: "#75715e" },
  "github-dark": { bg: "#0d1117", fg: "#c9d1d9", comment: "#8b949e", keyword: "#ff7b72", string: "#a5d6ff", number: "#79c0ff", type: "#ffa657", func: "#d2a8ff", lineHighlight: "#161b22", selection: "#26415e", inactiveSelection: "#1c2e44", cursor: "#c9d1d9", gutterFg: "#8b949e" },
  "one-dark":    { bg: "#282c34", fg: "#abb2bf", comment: "#5c6370", keyword: "#c678dd", string: "#98c379", number: "#d19a66", type: "#e5c07b", func: "#61afef", lineHighlight: "#2c313c", selection: "#475062", inactiveSelection: "#3a3f4d", cursor: "#abb2bf", gutterFg: "#5c6370" },
  dracula:       { bg: "#282a36", fg: "#f8f8f2", comment: "#6272a4", keyword: "#ff79c6", string: "#f1fa8c", number: "#bd93f9", type: "#8be9fd", func: "#50fa7b", lineHighlight: "#343746", selection: "#525270", inactiveSelection: "#42425b", cursor: "#f8f8f2", gutterFg: "#6272a4" },
  nord:          { bg: "#2e3440", fg: "#d8dee9", comment: "#616e88", keyword: "#81a1c1", string: "#a3be8c", number: "#b48ead", type: "#8fbcbb", func: "#88c0d0", lineHighlight: "#3b4252", selection: "#475064", inactiveSelection: "#3b4252", cursor: "#d8dee9", gutterFg: "#616e88" },
  "solarized-dark":  { bg: "#002b36", fg: "#839496", comment: "#586e75", keyword: "#859900", string: "#2aa198", number: "#d33682", type: "#b58900", func: "#268bd2", lineHighlight: "#073642", selection: "#1a4351", inactiveSelection: "#11303a", cursor: "#839496", gutterFg: "#586e75" },
  "solarized-light": { bg: "#fdf6e3", fg: "#657b83", comment: "#93a1a1", keyword: "#859900", string: "#2aa198", number: "#d33682", type: "#b58900", func: "#268bd2", lineHighlight: "#eee8d5", selection: "#d4c69a", inactiveSelection: "#e1d5a8", cursor: "#657b83", gutterFg: "#93a1a1" },
  "vs-dark":     { bg: "#1e1e1e", fg: "#d4d4d4", comment: "#6a9955", keyword: "#569cd6", string: "#ce9178", number: "#b5cea8", type: "#4ec9b0", func: "#dcdcaa", lineHighlight: "#2a2d2e", selection: "#264f78", inactiveSelection: "#1a3a5a", cursor: "#aeafad", gutterFg: "#858585" },
  "vs":          { bg: "#ffffff", fg: "#000000", comment: "#008000", keyword: "#0000ff", string: "#a31515", number: "#098658", type: "#267f99", func: "#795e26", lineHighlight: "#f0f0f0", selection: "#add6ff", inactiveSelection: "#e4f0ff", cursor: "#000000", gutterFg: "#237893" },
  "hc-black":    { bg: "#000000", fg: "#ffffff", comment: "#7ca668", keyword: "#569cd6", string: "#ce9178", number: "#b5cea8", type: "#4ec9b0", func: "#dcdcaa", lineHighlight: "#1a1a1a", selection: "#3f3f3f", inactiveSelection: "#2a2a2a", cursor: "#ffffff", gutterFg: "#858585" },
};

function buildHighlight(p: Palette): HighlightStyle {
  return HighlightStyle.define([
    // Keywords / control flow / operators
    { tag: [t.keyword, t.modifier, t.controlKeyword, t.operatorKeyword, t.moduleKeyword], color: p.keyword },
    { tag: [t.self, t.null, t.atom], color: p.number },
    // Strings & friends
    { tag: [t.string, t.special(t.string), t.docString, t.character], color: p.string },
    { tag: [t.regexp, t.escape], color: p.string },
    // Numbers / literals
    { tag: [t.number, t.bool, t.integer, t.float, t.constant(t.variableName)], color: p.number },
    // Types / classes / namespaces
    { tag: [t.typeName, t.className, t.namespace, t.changed, t.standard(t.typeName)], color: p.type },
    { tag: [t.standard(t.tagName), t.tagName], color: p.keyword },
    // Functions & definitions
    { tag: [t.function(t.variableName), t.function(t.propertyName), t.definition(t.function(t.variableName)), t.definition(t.function(t.propertyName)), t.macroName], color: p.func },
    { tag: [t.definition(t.variableName), t.definition(t.propertyName), t.definition(t.typeName), t.definition(t.className)], color: p.type },
    // Comments
    { tag: [t.comment, t.lineComment, t.blockComment, t.docComment], color: p.comment, fontStyle: "italic" },
    // Markdown / docs
    { tag: t.heading, color: p.keyword, fontWeight: "bold" },
    { tag: t.strong, fontWeight: "bold" },
    { tag: t.emphasis, fontStyle: "italic" },
    { tag: [t.link, t.url], color: p.type, textDecoration: "underline" },
    { tag: t.strikethrough, textDecoration: "line-through" },
    // Markup / structure
    { tag: [t.propertyName, t.attributeName, t.special(t.propertyName)], color: p.type },
    { tag: t.attributeValue, color: p.string },
    { tag: [t.operator, t.derefOperator, t.arithmeticOperator, t.logicOperator, t.compareOperator, t.definitionOperator, t.punctuation, t.separator, t.bracket, t.squareBracket, t.paren, t.angleBracket], color: p.fg },
    { tag: [t.meta, t.processingInstruction, t.annotation, t.monospace], color: p.comment },
    { tag: t.labelName, color: p.func },
    { tag: [t.variableName, t.special(t.variableName)], color: p.fg },
    { tag: t.invalid, color: "#f7768e" },
  ]);
}

export function buildEditorTheme(themeId: string, isLightTheme: boolean): Extension {
  const palette = PALETTES[themeId] ?? PALETTES[isLightTheme ? "luxor-light" : "luxor-dark"];
  // Single source of truth for the editor's line box. The gutter (line
  // numbers) and the text content MUST share the exact same font-family AND
  // line-height, otherwise CodeMirror's gutter elements and text rows drift
  // apart row-by-row — the line numbers end up "not next to" their lines and
  // visually shove the text around. We therefore pin BOTH layers to the same
  // values here and never let an outer container inject a conflicting
  // (px-based) line-height that only one of the two layers would inherit.
  const LINE_HEIGHT = "1.55";
  const MONO = "var(--lx-font-mono, monospace)";
  return [
    // Install both a CSS-class highlighter and a theme-owned inline highlighter.
    // The class layer is a hard fallback for WebView/theme injection edge cases:
    // as long as the language parser emits tokens, global `.tok-*` CSS below will
    // make syntax visibly coloured instead of looking like plain text.
    syntaxHighlighting(classHighlighter),
    syntaxHighlighting(buildHighlight(palette), { fallback: true }),
    EditorView.theme({
      "&": {
        backgroundColor: palette.bg,
        color: palette.fg,
        height: "100%",
        display: "flex",
        flexDirection: "column",
      },
      // Own the critical CodeMirror layout primitives in our app theme instead
      // of relying solely on CM's injected base stylesheet. If that base style is
      // late, deduped incorrectly, or trumped by global CSS, the gutters become a
      // normal block above the text layer (line numbers on top, content below).
      // These rules keep gutters and content in the same horizontal scroller.
      ".cm-scroller": {
        overflow: "auto",
        fontFamily: MONO,
        lineHeight: LINE_HEIGHT,
        flex: "1 1 0",
        height: "100%",
        width: "100%",
        display: "flex",
        alignItems: "stretch",
        position: "relative",
      },
      ".cm-gutters": {
        backgroundColor: palette.bg,
        color: palette.gutterFg,
        border: "none",
        // Match the text layer exactly so numbers line up with their rows.
        fontFamily: MONO,
        lineHeight: LINE_HEIGHT,
        display: "flex",
        flexShrink: 0,
        alignItems: "stretch",
        position: "sticky",
        left: 0,
        zIndex: 3,
      },
      ".cm-gutter": {
        display: "flex",
        flexDirection: "column",
        flexShrink: 0,
        boxSizing: "border-box",
      },
      ".cm-content": {
        caretColor: palette.cursor,
        fontFamily: MONO,
        lineHeight: LINE_HEIGHT,
        padding: "0 4px",
        minHeight: "100%",
        minWidth: "100%",
        width: "max-content",
        flex: "1 0 auto",
        boxSizing: "border-box",
      },
      ".cm-line": { lineHeight: LINE_HEIGHT },
      ".cm-cursor, .cm-dropCursor": { borderLeftColor: palette.cursor },
      "&.cm-focused .cm-selectionBackground, ::selection": { backgroundColor: palette.selection },
      ".cm-selectionBackground, ::selection": { backgroundColor: palette.inactiveSelection },
      ".cm-lineNumbers .cm-gutterElement, .cm-foldGutter .cm-gutterElement": {
        lineHeight: LINE_HEIGHT,
        padding: "0 3px 0 8px",
      },
      ".cm-activeLine": { backgroundColor: palette.lineHighlight },
      ".cm-activeLineGutter": { backgroundColor: palette.lineHighlight, color: palette.fg },
    }),
  ];
}

// Convenience re-export so the import in `codemirror.ts` stays short.
export const codemirrorThemeExtension = buildEditorTheme;
