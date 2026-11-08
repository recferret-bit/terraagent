import { ENTITY_KIND } from '../ecs/columns';
import type { PathQueueEntry } from '../grid/pathQueue';
import type { Blob, PlanetState } from '../kernel/state';
import type { UnitMotion } from '../units/movement/orchestrator';
import type { UnitRecord } from '../units/book';
import { rowOf } from '../ecs/store';
import { decodeValue, encodeValue } from './values';

export const FAUNA_MOTION_SEED = 'faunaMotionSeed';
const BUG_KINDS: readonly number[] = [ENTITY_KIND.blackAnt, ENTITY_KIND.blueBeetle, ENTITY_KIND.greenSpitter];
export interface FaunaMotionSeed { ids?: number[]; unitMotion?: Blob; pathQueue?: Blob; faunaAggression?: Blob; units?: Blob }
interface MotionValue { nextReq: number; byId: Record<string, UnitMotion>; changeTicks?: Record<string, number> }
interface UnitsValue { byId: Record<string, UnitRecord>; [key: string]: unknown }

/** Welcome seed or sparse material-route patch; never sent just because a unit advances along its route. */
export function faunaMotionSeed(state: PlanetState, sinceTick?: number): Blob | undefined {
  const motion = state.blobs.unitMotion;
  const value = motion?.value as MotionValue | undefined;
  const ids = new Set<number>();
  const cols = state.entities.cols;
  for (let row = 0; row < state.entities.count; row++) {
    if (BUG_KINDS.includes(cols.kind[row]) && (sinceTick === undefined || (value?.changeTicks?.[cols.id[row]] ?? -1) > sinceTick)) ids.add(cols.id[row]);
  }
  if (!ids.size) return undefined;
  const units = state.blobs.units;
  const records = units?.value as UnitsValue | undefined;
  const aggression = state.blobs.faunaAggression;
  const timing = (aggression?.value as { bugTimingById?: Record<string, unknown> } | undefined)?.bugTimingById ?? {};
  const seed: FaunaMotionSeed = {
    ids: [...ids],
    ...(aggression ? { faunaAggression: sinceTick === undefined ? aggression : { ...aggression,
      value: { bugTimingById: Object.fromEntries(Object.entries(timing).filter(([id]) => ids.has(Number(id)))) } } } : {}),
    ...(records ? { units: { ...units, value: { byId: Object.fromEntries(Object.entries(records.byId ?? {}).filter(([id]) => ids.has(Number(id)))) } } } : {}),
    ...(value ? { unitMotion: { ...motion, value: { nextReq: value.nextReq, byId: Object.fromEntries(Object.entries(value.byId).filter(([id]) => ids.has(Number(id)))) } } } : {}),
    // Pending paths wait for the authoritative resolved-route patch: local colony search pressure may differ.
    pathQueue: { changedAt: state.meta.tick, value: [] },
  };
  return { changedAt: state.meta.tick, value: seed };
}

/** Installs replica-only route/timing inputs without replacing colony-unit prediction records. */
export function installFaunaMotionSeed(state: PlanetState, input: FaunaMotionSeed): void {
  // A running shadow must never share mutable routes/commands with the confirmed state or prediction clone.
  const seed = decodeValue(encodeValue(input)) as FaunaMotionSeed;
  const scoped = seed.ids ? new Set(seed.ids) : null;
  const keep = (id: string): boolean => {
    const row = rowOf(state.entities, Number(id));
    return row >= 0 && (scoped ? !scoped.has(Number(id)) : !BUG_KINDS.includes(state.entities.cols.kind[row]));
  };
  if (seed.unitMotion) {
    const old = state.blobs.unitMotion?.value as MotionValue | undefined;
    const value = seed.unitMotion.value as MotionValue;
    state.blobs.unitMotion = { ...seed.unitMotion, value: { nextReq: Math.max(old?.nextReq ?? 1, value.nextReq),
      byId: { ...Object.fromEntries(Object.entries(old?.byId ?? {}).filter(([id]) => keep(id))), ...value.byId } } };
  }
  if (seed.units) {
    const old = state.blobs.units?.value as UnitsValue | undefined;
    const value = seed.units.value as UnitsValue;
    state.blobs.units = { ...seed.units, value: { ...old,
      byId: { ...Object.fromEntries(Object.entries(old?.byId ?? {}).filter(([id]) => keep(id))), ...value.byId } } };
  }
  if (seed.pathQueue) {
    const old = state.blobs.pathQueue?.value as PathQueueEntry[] | undefined;
    state.blobs.pathQueue = { ...seed.pathQueue, value: [...(old ?? []).filter(e => e.entityId === undefined || keep(String(e.entityId))), ...seed.pathQueue.value as PathQueueEntry[]] };
  }
  if (seed.faunaAggression) {
    const old = state.blobs.faunaAggression?.value as Record<string, unknown> | undefined;
    const next = seed.faunaAggression.value as Record<string, unknown>;
    state.blobs.faunaAggression = { ...seed.faunaAggression, value: { ...old, ...next,
      bugTimingById: { ...old?.bugTimingById as object, ...next.bugTimingById as object } } };
  }
}
