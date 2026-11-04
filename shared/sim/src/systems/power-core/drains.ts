import type { CompiledDataLike } from '../../kernel/config';
import { ENTITY_KIND } from '../../ecs/columns';
import { resolvePowerRow } from './index';

/** A grid consumer's standby draw (E/s) and brownout shed group, from its balance row (`powerDrainPerS`, `shedGroup`). */
export interface ConsumerDrain {
  drain: number;
  group: number;
}

/** Entity kind → the balance row (`table.id`) of every building that only consumes grid power. */
const CONSUMER_ROWS: ReadonlyArray<readonly [number, string, string]> = [
  [ENTITY_KIND.tradeHub, 'tradeHub', 't1'],
  [ENTITY_KIND.capacitor, 'grid', 'capacitor'],
  [ENTITY_KIND.supplyDepot, 'grid', 'supplyDepot'],
  [ENTITY_KIND.mineralsQuarry, 'grid', 'mineralsQuarry'],
  [ENTITY_KIND.waterExtractor, 'grid', 'waterExtractor'],
  [ENTITY_KIND.petroleumWell, 'grid', 'petroleumWell'],
  [ENTITY_KIND.metalsExtractor, 'economyT1Basic', 'metalsExtractor'],
];

/**
 * The consumer drains of the step's data (one lookup per call, so a `tune` of `powerDrainPerS` / `shedGroup` takes
 * effect on the next step). Kinds without a row in `data` fall back to the W02/W03 defaults (`resolvePowerRow`).
 */
export function resolveConsumerDrains(data?: CompiledDataLike): Map<number, ConsumerDrain> {
  const out = new Map<number, ConsumerDrain>();
  for (const [kind, table, id] of CONSUMER_ROWS) {
    const row = resolvePowerRow(data, table, id);
    out.set(kind, { drain: Number(row.powerDrainPerS ?? 0), group: Number(row.shedGroup ?? 3) });
  }
  return out;
}

/** Standby draw of one Power Pylon (`grid.pylon.powerDrainPerS`, E/s). */
export function pylonDrainPerS(data?: CompiledDataLike): number {
  return Number(resolvePowerRow(data, 'grid', 'pylon').powerDrainPerS ?? 0);
}

/** Max discharge of one Capacitor Bank (`grid.capacitor.maxDischargePerS`, E/s). */
export function capacitorMaxDischargePerS(data?: CompiledDataLike): number {
  return Number(resolvePowerRow(data, 'grid', 'capacitor').maxDischargePerS ?? 0);
}
