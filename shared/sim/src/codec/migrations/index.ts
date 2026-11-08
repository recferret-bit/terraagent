/**
 * Snapshot migration registry (SIM-D-07). A migration upgrades the DECODED plain snapshot object (envelope with
 * `header` and `state`) from one `SIM_VERSION` to a later one. Chains are followed greedily (largest step that does
 * not overshoot). Built-in migrations always remain available; tests may register additional migrations.
 */
export type SnapshotObject = { header: { simVersion: number; [k: string]: unknown }; state: Record<string, unknown> };
export type MigrationFn = (snapshot: SnapshotObject) => SnapshotObject;

interface Migration { from: number; to: number; fn: MigrationFn }
// Version 3 changes the live transport contract, not canonical persisted state.
const builtins: readonly Migration[] = [{ from: 2, to: 3, fn: (snapshot) => snapshot }];
const migrations: Migration[] = [];

const nextMigration = (from: number, target: number): Migration | undefined =>
  [...builtins, ...migrations].filter((m) => m.from === from && m.to <= target).sort((a, b) => b.to - a.to)[0];

/** Whether a persisted snapshot can be restored without regenerating its planet. */
export function canMigrateSnapshot(from: number, target: number): boolean {
  while (from !== target) {
    const step = nextMigration(from, target);
    if (!step) return false;
    from = step.to;
  }
  return true;
}

export function registerMigration(from: number, to: number, fn: MigrationFn): void {
  if (!(to > from)) throw new Error(`migration ${from} -> ${to} must go to a later version`);
  if ([...builtins, ...migrations].some((m) => m.from === from && m.to === to)) throw new Error(`migration ${from} -> ${to} already registered`);
  migrations.push({ from, to, fn });
}

/** Removes dynamically registered migrations, preserving built-in save compatibility (tests only). */
export const clearMigrations = (): void => { migrations.length = 0; };

/** Runs the chain from the snapshot's version up to `target`. Throws when no path exists. */
export function migrate(snap: SnapshotObject, target: number): SnapshotObject {
  let cur = snap;
  while (cur.header.simVersion !== target) {
    const v = cur.header.simVersion;
    const step = nextMigration(v, target);
    if (!step) throw new Error(`snapshot is sim version ${snap.header.simVersion}; no migration path from ${v} to ${target}`);
    cur = step.fn(cur);
    cur.header.simVersion = step.to;
  }
  return cur;
}
