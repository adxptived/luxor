import React from "react";
import ReactDOM from "react-dom/client";

import { TrayPopup } from "./TrayPopup";
import { isTauri, configGet } from "@/lib/ipc";

import "./tray.css";

// Apply the user's theme preference before first paint so the popup
// doesn't flash the wrong theme.
(async function initTheme() {
  if (!isTauri) return;
  try {
    const cfg = await configGet();
    const theme = cfg.theme;
    // Map the theme to dark/light data attribute; custom themes default to dark.
    const isLight =
      theme === "light" || theme === "catppuccin_latte";
    document.documentElement.setAttribute(
      "data-theme",
      isLight ? "light" : "dark",
    );
  } catch {
    /* defaults to dark */
  }
})();

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <TrayPopup />
  </React.StrictMode>,
);