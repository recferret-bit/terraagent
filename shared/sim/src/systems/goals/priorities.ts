import { ensureColonyRecord } from '../../kernel/colonies';
import { defineCommandHandler } from '../../kernel/commands';
import { setBlob, type PlanetState } from '../../kernel/state';
import { commandColony, parseArgs } from '../command';
import { DEFAULT_COLONY_PRIORITIES, PRIORITY_KEYS, type ColonyPriorities } from './types';

function clampPriority(value: unknown, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.max(0, Math.min(100, Math.round(value)));
}

function readPrioritiesMap(state: PlanetState): Record<string, ColonyPriorities> {
  const raw = state.blobs.priorities?.value;
  if (!raw || typeof raw !== 'object') return {};
  const obj = raw as Record<string, unknown>;
  const mapSource =
    obj.byColony && typeof obj.byColony === 'object' ? (obj.byColony as Record<string, unknown>) : obj;
  const out: Record<string, ColonyPriorities> = {};
  for (const [k, v] of Object.entries(mapSource)) {
    if (!v || typeof v !== 'object') continue;
    const rec = v as Partial<ColonyPriorities>;
    if (typeof rec.economy === 'number' || typeof rec.expansion === 'number' || typeof rec.defense === 'number') {
      out[k] = {
        economy: clampPriority(rec.economy, DEFAULT_COLONY_PRIORITIES.economy),
        expansion: clampPriority(rec.expansion, DEFAULT_COLONY_PRIORITIES.expansion),
        defense: clampPriority(rec.defense, DEFAULT_COLONY_PRIORITIES.defense),
        power: clampPriority(rec.power, DEFAULT_COLONY_PRIORITIES.power),
        terraform: clampPriority(rec.terraform, DEFAULT_COLONY_PRIORITIES.terraform),
      };
    }
  }
  return out;
}

/**
 * Returns the 5 canonical priority sliders (`economy, expansion, defense, power, terraform`) for `colonyIndex`.
 * Reads `colony.priorities` or `state.blobs.priorities[String(colonyIndex)]`, defaulting each key to `50`.
 */
export function getColonyPriorities(state: PlanetState, colonyIndex = 0): ColonyPriorities {
  const col = state.colonies[colonyIndex]?.priorities as Partial<ColonyPriorities> | undefined;
  if (col && typeof col === 'object') {
    return {
      economy: clampPriority(col.economy, DEFAULT_COLONY_PRIORITIES.economy),
      expansion: clampPriority(col.expansion, DEFAULT_COLONY_PRIORITIES.expansion),
      defense: clampPriority(col.defense, DEFAULT_COLONY_PRIORITIES.defense),
      power: clampPriority(col.power, DEFAULT_COLONY_PRIORITIES.power),
      terraform: clampPriority(col.terraform, DEFAULT_COLONY_PRIORITIES.terraform),
    };
  }
  const fromBlob = readPrioritiesMap(state)[String(colonyIndex)];
  if (fromBlob) return { ...fromBlob };
  return { ...DEFAULT_COLONY_PRIORITIES };
}

/**
 * Updates `colony.priorities` and `state.blobs.priorities[String(colonyIndex)]`, preserving unspecified keys.
 */
export function setColonyPriorities(
  state: PlanetState,
  colonyIndex: number,
  updates: Partial<ColonyPriorities>,
  tick: number = state.meta.tick,
): ColonyPriorities {
  const prev = getColonyPriorities(state, colonyIndex);
  const next: ColonyPriorities = { ...prev };
  for (const key of PRIORITY_KEYS) {
    if (updates[key] !== undefined) {
      next[key] = clampPriority(updates[key], prev[key]);
    }
  }
  const colony = ensureColonyRecord(state, colonyIndex, tick);
  colony.priorities = { ...next };
  colony.changedAt = tick;

  const map = readPrioritiesMap(state);
  map[String(colonyIndex)] = { ...next };
  setBlob(state, 'priorities', map, tick);
  return next;
}

export const applyColonyPriorities = setColonyPriorities;

export const setPrioritiesHandler = defineCommandHandler({
  kind: 'setPriorities',
  wave: 'W08',
  handle(state, cmd, ctx) {
    const colIdx = commandColony(cmd);
    if (typeof colIdx === 'string') return colIdx;
    const parsed = parseArgs('setPriorities', cmd.args);
    if (!parsed) return 'invalid_args';
    const updates = 'priorities' in parsed ? parsed.priorities : parsed;
    setColonyPriorities(state, colIdx, updates, ctx.tick);
  },
});
