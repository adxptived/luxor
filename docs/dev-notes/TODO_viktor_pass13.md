# Pass 13 — UI/UX polish everywhere + REAL embedded browser

## Task 2 (priority): fix embedded browser "любой ценой"
Root cause: iframe is subject to X-Frame-Options / CSP frame-ancestors → most
sites refuse to embed. Fix = stop using an iframe; embed a REAL native child
webview (Tauri 2 `unstable` multiwebview, `Window::add_child`). A child webview
loads pages as TOP-LEVEL documents → framing rules don't apply → every site loads.

- [ ] Enable `unstable` feature on tauri in src-tauri/Cargo.toml
- [ ] commands/browser.rs: embed_show / set_bounds / navigate / back / forward / reload / hide / close
- [ ] on_page_load → emit `browser://nav` {url, loading} to frontend
- [ ] register in commands/mod.rs + lib.rs invoke_handler
- [ ] ipc.ts wrappers + event listener
- [ ] BrowserPanel.tsx: native path (overlay viewport + rAF bounds tracking + overlay suppression); keep iframe fallback for !isTauri
- [ ] hide embed when overlays open (palette/settings/menu/dialog) or dock hidden (aria-hidden) or rect empty
- [ ] tests for new pure helpers

## Task 1: polish UI/UX everywhere
- [ ] audit components for rough edges, inconsistent spacing/states, a11y
- [ ] fix concrete issues found

## Verify
- [ ] tsc 0, bun test green, bun run build OK
- [ ] cargo fmt/clippy/test green (luxor-core)
- [ ] NOTE: src-tauri cannot compile in sandbox (no webkit) — be honest
