import { RESOURCE_KEYS } from '@terra/contracts';
import { RESIDUAL_SCALE, splitLegacyAmount } from '../../economy/residual';
import type { SnapshotObject } from './index';

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Statistics counters (`production.produced` / `capped`) were floats with dust; they are whole units from v3. */
function roundCounters(rec: unknown): void {
  if (!isObj(rec)) return;
  for (const k of Object.keys(rec)) if (typeof rec[k] === 'number') rec[k] = Math.round(rec[k] as number);
}

/**
 * SIM_VERSION 2 -> 3 (LED-16): `col.stock` was allowed to hold fractions (per-tick production, 50 % refunds). It becomes
 * whole units plus `col.residual[key]` (integer micro-units): `12.75` restores as `stock 12`, `residual 750000`, so the
 * value `stock + residual / 1e6` is preserved to the micro-unit (float dust below that, such as `0.30000000000000004`,
 * rounds away). An existing `residual` (none in v2) is added to the value first. `production.produced` and
 * `production.capped` are rounded to whole units. Everything else is untouched; running it again changes nothing.
 */
export function migrateWholeStock(snap: SnapshotObject): SnapshotObject {
  const colonies = snap.state.colonies;
  if (!Array.isArray(colonies)) return snap;
  for (const col of colonies) {
    if (!isObj(col) || !isObj(col.stock)) continue;
    const stock = col.stock;
    const oldResidual = isObj(col.residual) ? col.residual : {};
    const residual: Record<string, number> = {};
    for (const key of RESOURCE_KEYS) {
      const s = typeof stock[key] === 'number' ? (stock[key] as number) : 0;
      const r = typeof oldResidual[key] === 'number' ? (oldResidual[key] as number) : 0;
      const whole = splitLegacyAmount(s + r / RESIDUAL_SCALE);
      stock[key] = whole.stock;
      residual[key] = whole.residual;
    }
    col.residual = residual;
    if (isObj(col.production)) {
      roundCounters(col.production.produced);
      roundCounters(col.production.capped);
    }
  }
  return snap;
}
