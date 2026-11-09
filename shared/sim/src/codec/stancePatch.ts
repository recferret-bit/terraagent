import type { Blob, PlanetState } from '../kernel/state';
import { ALL_STANCE_FIELDS, STANCE_CHANGES_BLOB, STANCE_FIELDS, type StanceChanges } from '../systems/combat/stanceChanges';
import type { CombatStancesBlob, UnitStanceRecord } from '../systems/combat/stances';

type StanceRow = [entityId: number, changedMask: number, definedMask: number, ...values: unknown[]];
export type PackedStancePatch = [version: 1, changedAt: number, replace: boolean, rows: StanceRow[]];

/** Only changed fields travel; a defined-mask distinguishes clearing an optional field from setting null. */
export function packStancePatch(state: PlanetState, fromTick: number, blob: Blob): PackedStancePatch {
  const journal = state.blobs[STANCE_CHANGES_BLOB]?.value as StanceChanges | undefined;
  const replace = !journal || fromTick < journal.sinceTick || journal.stanceTick !== blob.changedAt;
  const rows: StanceRow[] = [];
  const records = (blob.value as CombatStancesBlob).byEntityId;
  for (const [id, record] of Object.entries(records)) {
    const mask = replace ? ALL_STANCE_FIELDS : STANCE_FIELDS.reduce((m, [, bit]) => (journal.fieldsById[id]?.[bit] ?? -1) > fromTick ? m | bit : m, 0);
    if (!mask) continue;
    const values: unknown[] = [];
    let defined = 0;
    for (const [field, bit] of STANCE_FIELDS) {
      if (!(mask & bit) || record[field] === undefined) continue;
      defined |= bit;
      values.push(record[field]);
    }
    rows.push([Number(id), mask, defined, ...values]);
  }
  if (!replace) for (const [id, tick] of Object.entries(journal.removedAt)) if (tick > fromTick) rows.push([Number(id), -1, 0]);
  return [1, blob.changedAt, replace, rows];
}

/** Merges a wire patch into the canonical record map; snapshots and consumers never see packed rows. */
export function applyStancePatch(state: PlanetState, patch: PackedStancePatch): void {
  if (patch[0] !== 1) throw new Error(`unsupported stance patch format ${patch[0]}`);
  const old = state.blobs.combatStances?.value as CombatStancesBlob | undefined;
  const records: Record<number, UnitStanceRecord> = patch[2] ? {} : { ...old?.byEntityId };
  for (const [id, changed, defined, ...values] of patch[3]) {
    if (changed === -1) { delete records[id]; continue; }
    if (!records[id] && changed !== ALL_STANCE_FIELDS) throw new Error('stance patch requires a base record');
    const record = { ...records[id] } as Record<string, unknown>;
    let next = 0;
    for (const [field, bit] of STANCE_FIELDS) {
      if (!(changed & bit)) continue;
      if (defined & bit) record[field] = values[next++];
      else delete record[field];
    }
    if (next !== values.length) throw new Error('invalid stance patch values');
    records[id] = record as unknown as UnitStanceRecord;
  }
  state.blobs.combatStances = { changedAt: patch[1], value: { byEntityId: records } };
}
