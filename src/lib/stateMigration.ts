/**
 * State migration system.
 *
 * Handles versioned state persistence across sessions. Each store can
 * register a migrator that upgrades older state shapes to the current
 * version. The migration runs automatically on load.
 */

export interface PersistedStateEnvelope<T> {
  /** Schema version of the stored data. */
  version: number;
  /** The actual state data. */
  data: T;
}

type Migrator<T> = (data: unknown, fromVersion: number) => T;

interface StoreMigration<T> {
  currentVersion: number;
  migrators: Map<number, Migrator<T>>; // fromVersion → migrator
}

const registry = new Map<string, StoreMigration<unknown>>();

/** Register a store's migration chain. */
export function registerMigration<T>(
  storeKey: string,
  currentVersion: number,
  migrators: Record<number, Migrator<T>>,
): void {
  const map = new Map<number, Migrator<T>>();
  for (const [fromVersion, migrator] of Object.entries(migrators)) {
    map.set(Number(fromVersion), migrator);
  }
  registry.set(storeKey, { currentVersion, migrators: map as unknown as Map<number, Migrator<unknown>> });
}

/** Load and migrate state from localStorage. Returns null if not found. */
export function loadState<T>(storeKey: string): T | null {
  try {
    const raw = localStorage.getItem(storeKey);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PersistedStateEnvelope<T> | T;

    // Handle unversioned (legacy) state: wrap it.
    let envelope: PersistedStateEnvelope<T>;
    if (parsed && typeof parsed === "object" && "version" in parsed && "data" in parsed) {
      envelope = parsed as PersistedStateEnvelope<T>;
    } else {
      envelope = { version: 0, data: parsed as T };
    }

    const migration = registry.get(storeKey);
    if (!migration) return envelope.data; // no migrator registered

    let { version, data } = envelope;
    // Run migrators in order from the stored version up to current.
    while (version < migration.currentVersion) {
      const migrator = migration.migrators.get(version);
      if (migrator) {
        data = migrator(data, version) as T;
      } else {
        // A missing migrator means a gap in the migration chain.
        // Log a warning so developers notice during testing rather than
        // silently passing through with potentially corrupt data.
        console.warn(
          `[stateMigration] No migrator registered for "${storeKey}" v${version}→v${version + 1}. ` +
          `Data shape may be inconsistent. Register a migrator for every version step.`
        );
      }
      version++;
    }

    return data;
  } catch {
    return null;
  }
}

/** Save state to localStorage with the current version envelope. */
export function saveState<T>(storeKey: string, data: T): void {
  try {
    const migration = registry.get(storeKey);
    const version = migration?.currentVersion ?? 1;
    const envelope: PersistedStateEnvelope<T> = { version, data };
    localStorage.setItem(storeKey, JSON.stringify(envelope));
  } catch { /* best effort */ }
}

/** Remove stored state. */
export function clearState(storeKey: string): void {
  try {
    localStorage.removeItem(storeKey);
  } catch { /* best effort */ }
}

// ---------------------------------------------------------------------------
// State serialization helpers
// ---------------------------------------------------------------------------

/** Deep clone via JSON (safe for plain data, not for class instances). */
export function deepClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value));
}

/** Check if two plain-data values are deeply equal. */
export function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b) return false;
  if (a === null || b === null) return false;
  if (typeof a !== "object") return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a)) {
    if (a.length !== (b as unknown[]).length) return false;
    return a.every((item, i) => deepEqual(item, (b as unknown[])[i]));
  }
  const objA = a as Record<string, unknown>;
  const objB = b as Record<string, unknown>;
  const keysA = Object.keys(objA);
  const keysB = Object.keys(objB);
  if (keysA.length !== keysB.length) return false;
  return keysA.every((k) => deepEqual(objA[k], objB[k]));
}

/** Serialize state to a compact JSON string. */
export function serializeState<T>(data: T): string {
  return JSON.stringify(data);
}

/** Deserialize state from a JSON string. Returns null on failure. */
export function deserializeState<T>(text: string): T | null {
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}