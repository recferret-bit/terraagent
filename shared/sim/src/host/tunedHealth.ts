import type { CompiledRow, CompiledTable } from '../data';
import { ENTITY_KIND } from '../ecs/columns';
import { setField } from '../ecs/store';
import type { CompiledDataLike } from '../kernel/config';
import type { PlanetState } from '../kernel/state';
import { notifyUnitChanged } from '../units/mobility';
import { syncReconView } from '../systems/factories-hub/robotics';
import { getFaunaHivesState, saveFaunaHivesState } from '../systems/fauna/state';

function entityKind(table: string, row: CompiledRow): number | undefined {
  const name = table === 'hq' && row.id === 't1' ? 'hq' : row.unit ?? row.building ?? row.id;
  return typeof name === 'string' ? ENTITY_KIND[name as keyof typeof ENTITY_KIND] : undefined;
}

/** Live max-health edits preserve damage fraction on existing entities, including reset to base values. */
export function applyTunedEntityHealth(state: PlanetState, before: CompiledDataLike, after: CompiledDataLike): void {
  const changes: Array<{ kind: number; tier: number; hp: number }> = [];
  for (const [table, rows] of Object.entries(after.tables)) {
    for (const row of Object.values(rows as CompiledTable)) {
      const kind = entityKind(table, row);
      const prev = (before.tables[table] as CompiledTable | undefined)?.[row.id];
      if (kind === undefined || typeof row.hp !== 'number' || row.hp === prev?.hp) continue;
      if (!Number.isFinite(row.hp) || row.hp <= 0) throw new Error(`${table}.${row.id}.hp must be positive and finite`);
      changes.push({ kind, tier: Number(row.tier ?? 1), hp: row.hp });
    }
  }
  if (changes.length === 0) return;
  // Mutations belong to the next pending delta, even when tuning arrives just after the current tick was sent.
  const tick = state.meta.tick + 1;
  const cols = state.entities.cols;
  const fauna = getFaunaHivesState(state);
  let faunaChanged = false;
  for (let row = 0; row < state.entities.count; row++) {
    const change = changes.find(c => c.kind === cols.kind[row] && c.tier === Math.max(1, cols.tier[row]));
    if (!change || cols.hp[row] <= 0) continue;
    const fraction = cols.hpMax[row] > 0 ? Math.min(1, Math.max(0, cols.hp[row] / cols.hpMax[row])) : 1;
    setField(state.entities, row, 'hpMax', change.hp, tick);
    setField(state.entities, row, 'hp', change.hp * fraction, tick);
    const id = cols.id[row];
    const hive = fauna.hivesById[id];
    if (hive || fauna.bugsById[id]) {
      // A balance edit is not damage and must not trigger the provocation fallback.
      fauna.lastSeenHpByEntityId[id] = cols.hp[row];
      if (hive) { hive.hp = cols.hp[row]; hive.hpMax = cols.hpMax[row]; }
      faunaChanged = true;
    }
    notifyUnitChanged(state, row, tick, after);
    if (change.kind === ENTITY_KIND.recon) syncReconView(state, row, tick, after);
  }
  if (faunaChanged) saveFaunaHivesState(state, fauna, tick);
}
