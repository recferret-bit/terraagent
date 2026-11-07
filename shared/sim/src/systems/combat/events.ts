import type { CompiledDataLike } from '../../kernel/config';
import { TICKS_PER_SECOND } from '../../kernel/constants';
import type { StepContext } from '../../kernel/context';
import { setBlob, type PlanetState } from '../../kernel/state';
import { colonyWho } from '../find';

export const COMBAT_EVENTS_BLOB = 'combatEvents';

/** Default debounce duration in ticks (`60 s * 5 ticks/s = 300 ticks`, W07-16). */
export const UNDER_ATTACK_DEBOUNCE_TICKS = 300;

export interface ActiveRaidRecord {
  raidId: string;
  buildingLost: boolean;
}

export interface CombatEventsBlob {
  lastUnderAttackByColony: Record<number, number>;
  activeRaidsByColony?: Record<number, ActiveRaidRecord>;
}

export function getCombatEventsBlob(state: PlanetState): CombatEventsBlob {
  const raw = (state.blobs[COMBAT_EVENTS_BLOB]?.value ?? state.blobs[COMBAT_EVENTS_BLOB]) as
    | Partial<CombatEventsBlob>
    | undefined;
  return {
    lastUnderAttackByColony: { ...(raw?.lastUnderAttackByColony ?? {}) },
    activeRaidsByColony: { ...(raw?.activeRaidsByColony ?? {}) },
  };
}

export function setCombatEventsBlob(
  state: PlanetState,
  blob: CombatEventsBlob,
  tick: number,
): void {
  setBlob(state, COMBAT_EVENTS_BLOB, blob, tick);
  const rawEntry = state.blobs[COMBAT_EVENTS_BLOB] as unknown as Record<string, unknown> | undefined;
  if (rawEntry) {
    rawEntry.lastUnderAttackByColony = blob.lastUnderAttackByColony;
    rawEntry.activeRaidsByColony = blob.activeRaidsByColony;
  }
}

export function getUnderAttackDebounceTicks(data?: CompiledDataLike): number {
  const cfg = (data?.tables?.combatUnits as Record<string, Record<string, unknown>> | undefined)?.combatConfig;
  const debounceS = typeof cfg?.underAttackDebounceS === 'number' ? cfg.underAttackDebounceS : 60;
  return Math.round(debounceS * TICKS_PER_SECOND);
}

export interface EmitUnderAttackOptions {
  targetId: number;
  attackerId?: number;
  q: number;
  r: number;
  tick?: number;
}

/**
 * Emits `'underAttack'` when a colony entity takes hostile damage, debounced per colony (`W07-16`).
 * Also updates `colony.underAttackAtTick` for W08 rule-engine defense weight evaluation.
 */
export function emitUnderAttackIfDue(
  state: PlanetState,
  colonyIndex: number,
  opts: EmitUnderAttackOptions,
  ctx?: StepContext,
): boolean {
  if (colonyIndex < 0) return false;

  const tick = opts.tick ?? ctx?.tick ?? state.meta.tick;
  const blob = getCombatEventsBlob(state);
  const lastTick = blob.lastUnderAttackByColony[colonyIndex];
  const debounceTicks = getUnderAttackDebounceTicks(ctx?.data);

  if (lastTick !== undefined && tick - lastTick < debounceTicks) {
    return false;
  }

  blob.lastUnderAttackByColony[colonyIndex] = tick;
  setCombatEventsBlob(state, blob, tick);

  const colony = state.colonies[colonyIndex];
  if (colony) {
    (colony as { underAttackAtTick?: number }).underAttackAtTick = tick;
    colony.changedAt = tick;
  }

  if (ctx) {
    const { colonyIdStr, who } = colonyWho(state, colonyIndex);
    ctx.emit({
      kind: 'underAttack',
      severity: 'warn',
      colonyIds: [colonyIdStr],
      data: {
        ...who,
        colonyIndex,
        entityId: opts.targetId,
        ...(opts.attackerId !== undefined ? { attackerId: opts.attackerId } : {}),
        q: opts.q,
        r: opts.r,
      },
    });
  }

  return true;
}

export interface EmitRaidStartedOptions {
  colonyIndex: number;
  hiveId: number;
  species: 'blackAnt' | 'blueBeetle' | 'greenSpitter';
  waveNumber?: number;
  count: number;
  q: number;
  r: number;
  raidId?: string;
  tick?: number;
}

/**
 * Records an active raid and emits `'raidStarted'` (`UO-T-04`, `W07-15`, `W07-16`).
 */
export function emitRaidStarted(
  state: PlanetState,
  opts: EmitRaidStartedOptions,
  ctx?: StepContext,
): void {
  const tick = opts.tick ?? ctx?.tick ?? state.meta.tick;
  const raidId = opts.raidId ?? `raid_${opts.colonyIndex}_${tick}`;
  const blob = getCombatEventsBlob(state);
  blob.activeRaidsByColony ??= {};
  blob.activeRaidsByColony[opts.colonyIndex] = { raidId, buildingLost: false };
  setCombatEventsBlob(state, blob, tick);

  if (ctx) {
    const { colonyIdStr, who } = colonyWho(state, opts.colonyIndex);
    ctx.emit({
      kind: 'raidStarted',
      severity: 'warn',
      colonyIds: [colonyIdStr],
      data: {
        ...who,
        colonyIndex: opts.colonyIndex,
        hiveId: opts.hiveId,
        species: opts.species,
        ...(opts.waveNumber !== undefined && opts.waveNumber > 0 ? { waveIndex: opts.waveNumber } : {}),
        count: opts.count,
        q: opts.q,
        r: opts.r,
      },
    });
  }
}

/**
 * Notes that a colony building was destroyed during an active raid (`W07-16`).
 * If repelled afterwards, `unbreached` will resolve to `false`.
 */
export function noteColonyBuildingDestroyedDuringRaid(
  state: PlanetState,
  colonyIndex: number,
  tick = state.meta.tick,
): void {
  if (colonyIndex < 0) return;
  const blob = getCombatEventsBlob(state);
  if (blob.activeRaidsByColony?.[colonyIndex]) {
    blob.activeRaidsByColony[colonyIndex].buildingLost = true;
    setCombatEventsBlob(state, blob, tick);
  }
}

export interface EmitRaidRepelledOptions {
  colonyIndex: number;
  hiveId?: number;
  species?: 'blackAnt' | 'blueBeetle' | 'greenSpitter';
  raidId?: string;
  unbreached?: boolean;
  withdrawn?: boolean;
  count?: number;
  q?: number;
  r?: number;
  tick?: number;
}

/**
 * Clears active raid record and emits `'raidRepelled'` (`W07-16`, `W07-27`).
 * `unbreached` is `true` only if no colony building was destroyed during the raid.
 */
export function emitRaidRepelled(
  state: PlanetState,
  opts: EmitRaidRepelledOptions,
  ctx?: StepContext,
): boolean {
  const tick = opts.tick ?? ctx?.tick ?? state.meta.tick;
  const blob = getCombatEventsBlob(state);
  const activeRaid = blob.activeRaidsByColony?.[opts.colonyIndex];
  const unbreached = opts.unbreached ?? !(activeRaid?.buildingLost ?? false);

  if (blob.activeRaidsByColony?.[opts.colonyIndex]) {
    delete blob.activeRaidsByColony[opts.colonyIndex];
    setCombatEventsBlob(state, blob, tick);
  }

  if (ctx) {
    const { colonyIdStr, who } = colonyWho(state, opts.colonyIndex);
    ctx.emit({
      kind: 'raidRepelled',
      severity: 'info',
      colonyIds: [colonyIdStr],
      data: {
        ...who,
        colonyIndex: opts.colonyIndex,
        unbreached,
        ...(opts.hiveId !== undefined ? { hiveId: opts.hiveId } : {}),
        ...(opts.species !== undefined ? { species: opts.species } : {}),
        ...(opts.count !== undefined ? { count: opts.count } : {}),
        ...(opts.q !== undefined ? { q: opts.q } : {}),
        ...(opts.r !== undefined ? { r: opts.r } : {}),
      },
    });
  }

  return unbreached;
}
