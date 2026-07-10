/**
 * Theme meta data only — safe to import from settings / app shell without
 * pulling the CodeMirror runtime into the startup bundle. The actual
 * `buildEditorTheme()` lives in `codemirrorThemes.ts` and is loaded
 * alongside the editor.
 */

export interface EditorThemeMeta {
  id: string;
  label: string;
  light: boolean;
}

export const CODEMIRROR_THEMES: EditorThemeMeta[] = [
  { id: "luxor-dark", label: "Luxor Dark", light: false },
  { id: "luxor-light", label: "Luxor Light", light: true },
  { id: "monokai", label: "Monokai", light: false },
  { id: "github-dark", label: "GitHub Dark", light: false },
  { id: "one-dark", label: "One Dark", light: false },
  { id: "dracula", label: "Dracula", light: false },
  { id: "nord", label: "Nord", light: false },
  { id: "solarized-dark", label: "Solarized Dark", light: false },
  { id: "solarized-light", label: "Solarized Light", light: true },
  { id: "vs-dark", label: "VS Dark (classic)", light: false },
  { id: "vs", label: "VS Light (classic)", light: true },
  { id: "hc-black", label: "High Contrast", light: false },
];

// Back-compat: SettingsModal still imports `EDITOR_THEMES` from the old path.
// Re-export under that name so we don't have to touch every caller.
export const EDITOR_THEMES = CODEMIRROR_THEMES;
