import type { StepContext } from './context';
import type { PlanetState } from './state';
import type { WaveId } from './types';
import { PIPELINE_SLOTS } from './constants';

/**
 * A sim system: one stage of the fixed pipeline (SIMULATION §3, SIM-T). `slot` is its pipeline position (0–14);
 * several systems may share a slot and then run in `id` order. A system of a disabled wave does not run.
 */
export interface SimSystem {
  readonly id: string;
  readonly slot: number;
  readonly wave: WaveId;
  run(state: PlanetState, ctx: StepContext): void;
}

export const defineSystem = (s: SimSystem) => s;

export const SLOT_NAMES = [
  'commands', 'environment', 'hazards', 'fauna', 'ruleEngine', 'units', 'construction', 'power', 'production',
  'factories', 'combat', 'territory', 'progression', 'lifecycle', 'finalize',
] as const;

/** Systems in run order. Slots with no system are no-ops (SIM-T-01), so the order never shifts. */
export function orderSystems(systems: readonly SimSystem[]): SimSystem[] {
  for (const s of systems) {
    if (!Number.isInteger(s.slot) || s.slot < 0 || s.slot >= PIPELINE_SLOTS) throw new Error(`system ${s.id}: slot ${s.slot} outside 0..${PIPELINE_SLOTS - 1}`);
  }
  const ids = new Set<string>();
  for (const s of systems) {
    if (ids.has(s.id)) throw new Error(`duplicate system id ${s.id}`);
    ids.add(s.id);
  }
  return [...systems].sort((a, b) => a.slot - b.slot || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}
