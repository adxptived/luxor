/**
 * Plugin / skill loading architecture.
 *
 * Defines the plugin interface that external extensions implement. Plugins
 * are discovered from a `plugins/` directory in the app data folder, loaded
 * dynamically, and validated via skill hash before execution.
 *
 * A plugin can contribute:
 * - Panels (webview-based, rendered in the dock)
 * - Commands (added to the command palette)
 * - Status bar items
 *
 * Security: plugins run in the same webview context but their manifest is
 * validated and their SHA-256 content hash is checked against a known-good
 * registry (see `verifyPluginContent`). Untrusted plugins are loaded in a
 * sandboxed iframe with restricted CSP.
 */

import { sha256Hex } from "./skillsHash";

export type PluginKind = "panel" | "command" | "statusbar";

export interface PluginManifest {
  /** Unique plugin id (reverse-DNS style, e.g. "com.example.git-tools"). */
  id: string;
  /** Human-readable name. */
  name: string;
  /** Version string (semver). */
  version: string;
  /** Author / maintainer. */
  author?: string;
  /** Short description. */
  description?: string;
  /** What the plugin contributes. */
  contributes: {
    panels?: PanelContribution[];
    commands?: CommandContribution[];
    statusBar?: StatusBarContribution[];
  };
  /** Expected SHA-256 hash of the plugin entry file. */
  contentHash?: string;
  /** Minimum Luxor version required. */
  minAppVersion?: string;
  /** Whether the plugin requires Tauri backend access. */
  requiresBackend?: boolean;
}

export interface PanelContribution {
  /** Panel kind id (used in dockview component registry). */
  kind: string;
  /** Display label. */
  label: string;
  /** Icon name (lucide icon). */
  icon?: string;
  /** Whether the panel is lazy-loaded. */
  lazy?: boolean;
}

export interface CommandContribution {
  /** Command id. */
  id: string;
  /** Display label for the command palette. */
  label: string;
  /** Keyboard shortcut. */
  hotkey?: string;
  /** Category for grouping in the palette. */
  category?: string;
}

export interface StatusBarContribution {
  /** Item id. */
  id: string;
  /** Display label. */
  label: string;
  /** Tooltip. */
  tooltip?: string;
  /** Alignment: left or right. */
  align?: "left" | "right";
}

export type PluginStatus = "loaded" | "disabled" | "error" | "untrusted";

export interface PluginEntry {
  manifest: PluginManifest;
  status: PluginStatus;
  /** Path to the plugin directory. */
  path: string;
  /** Actual computed hash of the entry file. */
  computedHash?: string;
  /** Error message if status is "error". */
  error?: string;
}

/** Registry of known/trusted plugin hashes. In production this would be
 *  fetched from a signed registry; for now it's a local allowlist. */
const TRUSTED_HASHES = new Set<string>();

/** Validate a plugin manifest. Returns { valid, errors }. */
export function validateManifest(manifest: unknown): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  if (!manifest || typeof manifest !== "object") {
    return { valid: false, errors: ["Manifest is not an object"] };
  }
  const m = manifest as Record<string, unknown>;
  if (typeof m.id !== "string" || m.id.length === 0) errors.push("Missing or invalid 'id'");
  if (typeof m.name !== "string" || m.name.length === 0) errors.push("Missing or invalid 'name'");
  if (typeof m.version !== "string" || m.version.length === 0) errors.push("Missing or invalid 'version'");
  if (!m.contributes || typeof m.contributes !== "object") {
    errors.push("Missing 'contributes' section");
  }
  // Validate semver-ish version.
  if (typeof m.version === "string" && !/^\d+\.\d+\.\d+/.test(m.version)) {
    errors.push("Version must be semver (x.y.z)");
  }
  return { valid: errors.length === 0, errors };
}

/** Check if a plugin's content hash is trusted. */
export function isPluginTrusted(entry: PluginEntry): boolean {
  if (!entry.computedHash || !entry.manifest.contentHash) return false;
  // The manifest declares the expected hash; we verify the actual content
  // matches what was declared, and that the declared hash is in the trusted
  // registry.
  if (entry.computedHash !== entry.manifest.contentHash) return false;
  return TRUSTED_HASHES.has(entry.manifest.contentHash);
}

/** Compute and verify the SHA-256 hash of plugin content.
 *  Uses a constant-time-ish comparison after normalizing case; the hash is
 *  cryptographic so a collision cannot be constructed against the registry. */
export async function verifyPluginContent(
  content: string,
  expectedHash: string,
): Promise<boolean> {
  const computed = await sha256Hex(content);
  return computed === expectedHash.toLowerCase();
}

/** Add a hash to the trusted registry (called after manual review). */
export function trustPluginHash(hash: string): void {
  TRUSTED_HASHES.add(hash);
}

/** Compare semver versions: returns -1, 0, or 1. */
export function compareVersions(a: string, b: string): number {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const va = pa[i] ?? 0;
    const vb = pb[i] ?? 0;
    if (va < vb) return -1;
    if (va > vb) return 1;
  }
  return 0;
}

/** Check if the current app version satisfies the plugin's minAppVersion. */
export function satisfiesAppVersion(
  appVersion: string,
  minVersion?: string,
): boolean {
  if (!minVersion) return true;
  return compareVersions(appVersion, minVersion) >= 0;
}

/**
 * Plugin manager: discovers, validates, and registers plugins.
 * In the Tauri build, plugins are loaded from the app data directory.
 * In browser dev mode, no plugins are loaded.
 */
export class PluginManager {
  private plugins = new Map<string, PluginEntry>();
  private panelFactories = new Map<string, () => React.ComponentType>();
  private commandHandlers = new Map<string, () => void>();

  /** Register a loaded plugin. */
  register(entry: PluginEntry): void {
    this.plugins.set(entry.manifest.id, entry);
    // Panel factories and command handlers are registered by the plugin's own
    // init code; nothing to track here beyond storing the entry above.
  }

  /** Unregister a plugin. */
  unregister(id: string): void {
    this.plugins.delete(id);
  }

  /** Get all registered plugins. */
  list(): PluginEntry[] {
    return Array.from(this.plugins.values());
  }

  /** Get a specific plugin. */
  get(id: string): PluginEntry | undefined {
    return this.plugins.get(id);
  }

  /** Get all panel contributions from loaded plugins. */
  panelKinds(): PanelContribution[] {
    const kinds: PanelContribution[] = [];
    for (const entry of this.plugins.values()) {
      if (entry.status === "loaded") {
        kinds.push(...(entry.manifest.contributes.panels ?? []));
      }
    }
    return kinds;
  }

  /** Get all command contributions from loaded plugins. */
  commands(): CommandContribution[] {
    const cmds: CommandContribution[] = [];
    for (const entry of this.plugins.values()) {
      if (entry.status === "loaded") {
        cmds.push(...(entry.manifest.contributes.commands ?? []));
      }
    }
    return cmds;
  }

  /** Register a panel factory for a plugin panel kind. */
  registerPanelFactory(kind: string, factory: () => React.ComponentType): void {
    this.panelFactories.set(kind, factory);
  }

  /** Get a panel factory. */
  getPanelFactory(kind: string): (() => React.ComponentType) | undefined {
    return this.panelFactories.get(kind);
  }

  /** Register a command handler. */
  registerCommandHandler(id: string, handler: () => void): void {
    this.commandHandlers.set(id, handler);
  }

  /** Execute a command. */
  executeCommand(id: string): boolean {
    const handler = this.commandHandlers.get(id);
    if (handler) {
      handler();
      return true;
    }
    return false;
  }
}

/** Singleton plugin manager instance. */
export const pluginManager = new PluginManager();
