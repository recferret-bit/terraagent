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
  [ENTITY_KIND.roboticsFactory, 'combatUnits', 'roboticsFactory'],
  [ENTITY_KIND.droneControlArray, 'combatUnits', 'droneControlArray'],
  [ENTITY_KIND.autocannon, 'combatUnits', 'autocannon'],
  [ENTITY_KIND.laserTower, 'combatUnits', 'laserTower'],
];

/**
 * The consumer drains of the step's data (one lookup per call, so a `tune` of `powerDrainPerS` / `shedGroup` takes
 * effect on the next step). Kinds without a row in `data` fall back to the W02/W03/W07 defaults (`resolvePowerRow`).
 */
export function resolveConsumerDrains(data?: CompiledDataLike): Map<number, ConsumerDrain> {
  const out = new Map<number, ConsumerDrain>();
  for (const [kind, table, id] of CONSUMER_ROWS) {
    const row = resolvePowerRow(data, table, id);
    const drain = Number(row.powerDrainPerS ?? row.powerDrain ?? row.energyDrain ?? 0);
    out.set(kind, { drain, group: Number(row.shedGroup ?? 3) });
  }
  return out;
}

/** Standby draw of a building of `kind` (`powerDrainPerS` / `powerDrain` / `energyDrain`, E/s). */
export function buildingDrainPerS(kind: number, data?: CompiledDataLike): number {
  if (kind === ENTITY_KIND.pylon) return pylonDrainPerS(data);
  if (kind === ENTITY_KIND.commandHub) return Number(resolvePowerRow(data, 'hub', 't1').powerDrainPerS ?? 5);
  return resolveConsumerDrains(data).get(kind)?.drain ?? 0;
}

/** Standby draw of one Power Pylon (`grid.pylon.powerDrainPerS`, E/s). */
export function pylonDrainPerS(data?: CompiledDataLike): number {
  return Number(resolvePowerRow(data, 'grid', 'pylon').powerDrainPerS ?? 0);
}

/** Max discharge of one Capacitor Bank (`grid.capacitor.maxDischargePerS`, E/s). */
export function capacitorMaxDischargePerS(data?: CompiledDataLike): number {
  return Number(resolvePowerRow(data, 'grid', 'capacitor').maxDischargePerS ?? 0);
}
