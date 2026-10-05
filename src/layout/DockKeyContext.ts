import { createContext, useContext } from "react";

/**
 * The dock (project) a panel lives in. Panels need it to scope persisted state:
 * panel ids are not unique across docks (a layout preset keeps its ids), and a
 * panel's `containerApi` is not reliably the object registered for its dock.
 */
export const DockKeyContext = createContext<string>("");

export const useDockKey = (): string => useContext(DockKeyContext);
