import { useEffect, useState } from "react";

import { terminalPanelState, useDockStore } from "./dockStore";

/**
 * Whether the active dock's terminal panel exists / is hidden / is visible,
 * kept up to date as the layout changes (for the status-bar toggle).
 */
export function useTerminalPanelState(): "none" | "hidden" | "visible" {
  const api = useDockStore((s) => s.apis[s.activeKey] ?? null);
  const [state, setState] = useState(() => terminalPanelState(api));
  useEffect(() => {
    setState(terminalPanelState(api));
    if (!api) return;
    const refresh = () => setState(terminalPanelState(api));
    const subs = [api.onDidLayoutChange(refresh), api.onDidActivePanelChange(refresh), api.onDidRemovePanel(refresh)];
    return () => subs.forEach((d) => d.dispose());
  }, [api]);
  return state;
}
