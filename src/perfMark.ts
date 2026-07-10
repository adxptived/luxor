// First module to execute in the entry bundle. The moment this runs, the
// webview has finished *fetching + compiling* the entry chunk — so the gap
// between the inline `bodyParsed` mark (set while parsing index.html, before
// this deferred module) and `moduleStart` here isolates pure asset
// fetch/compile time (disk / WebView2 / AV) from our JS execution.
//
// Imported FIRST in main.tsx so it runs before any other module's top-level.
declare global {
  interface Window {
    __lx?: Record<string, number>;
  }
}

if (typeof window !== "undefined") {
  window.__lx ??= {};
  window.__lx.moduleStart = performance.now();
}

export {};
