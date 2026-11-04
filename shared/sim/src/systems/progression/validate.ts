import type { CompiledDataLike } from '../../kernel/config';
import { evaluateTradeHubUnlock } from '../cargo/unlock';
import { getItemUnlockStage } from '../../data/stages';
import type { PlanetState } from '../../kernel/state';
import { ownsCompletedBuilding } from './triggers';

export type StageLockCheckResult =
  | { ok: true }
  | { ok: false; code: 'stage_locked'; detail: string; unlocksAt: string };

const ITEM_STAGE_ALIASES: Readonly<Record<string, string>> = {
  hub: 'commandHub',
  extractor: 'metalsExtractor',
  solarCollector: 'solar',
  mineralsQuarry: 'mineralsExtractor',
  petroleumWell: 'biomassExtractor',
  supplyDepot: 'depot',
  storage_depot: 'storageDepot',
  robotics_factory: 'roboticsFactory',
  pulse_turret: 'pulseTurret',
  outpost_beacon: 'outpostBeacon',
  trade_hub: 'tradeHub',
  combat_engineer: 'combatEngineer',
  recon: 'scout',
};

function snakeToCamel(id: string): string {
  return id.replace(/_([a-z])/g, (_, ch: string) => ch.toUpperCase());
}

const TERRAFORM_OP_STAGE_UNLOCKS: Readonly<Record<string, number>> = {
  level: 2,
  fill: 2,
  reclaim: 4,
  irrigate: 4,
  seed: 4,
  deepReclaim: 5,
};

/**
 * Resolves the stage index (`0..10`) at which a building, unit, or order (`itemId`) unlocks in `stages.ts`.
 * Supports both canonical camelCase ids (`roboticsFactory`) and snake_case / alias ids (`robotics_factory`, `supplyDepot`).
 */
export function resolveItemUnlockStage(itemId: string): number {
  if (!itemId) return 0;
  if (typeof TERRAFORM_OP_STAGE_UNLOCKS[itemId] === 'number') {
    return TERRAFORM_OP_STAGE_UNLOCKS[itemId]!;
  }
  const direct = getItemUnlockStage(itemId);
  if (direct > 0) return direct;
  const aliased = ITEM_STAGE_ALIASES[itemId];
  if (aliased) {
    const stage = getItemUnlockStage(aliased);
    if (stage > 0) return stage;
  }
  if (itemId.includes('_')) {
    const camel = snakeToCamel(itemId);
    const stage = getItemUnlockStage(camel);
    if (stage > 0) return stage;
  }
  return 0;
}

function readBlobColonyStage(
  state: PlanetState,
  colonyIndex: number,
): { stage?: number; unlockStage?: number } | undefined {
  const raw = state.blobs.progression?.value;
  if (!raw || typeof raw !== 'object') return undefined;
  const obj = raw as Record<string, unknown>;
  const source =
    obj.byColony && typeof obj.byColony === 'object' ? (obj.byColony as Record<string, unknown>) : obj;
  const entry = source[String(colonyIndex)];
  if (!entry || typeof entry !== 'object') return undefined;
  return entry as { stage?: number; unlockStage?: number };
}

/**
 * Computes the effective `unlockStage` for `colonyIndex`:
 * `max(colony.unlockStage, colony.stage)` (or the progression blob record), raised to at least `1` (`S1`)
 * once the colony owns a completed Command Hub T1.
 */
export function resolveEffectiveUnlockStage(state: PlanetState, colonyIndex = 0): number {
  const col = state.colonies[colonyIndex];
  const blobEntry = readBlobColonyStage(state, colonyIndex);
  const colStage =
    typeof col?.stage === 'number' && Number.isFinite(col.stage) ? Math.max(0, Math.trunc(col.stage)) : undefined;
  const colUnlock =
    typeof col?.unlockStage === 'number' && Number.isFinite(col.unlockStage)
      ? Math.max(0, Math.trunc(col.unlockStage))
      : undefined;
  const blobStage =
    typeof blobEntry?.stage === 'number' && Number.isFinite(blobEntry.stage)
      ? Math.max(0, Math.trunc(blobEntry.stage))
      : undefined;
  const blobUnlock =
    typeof blobEntry?.unlockStage === 'number' && Number.isFinite(blobEntry.unlockStage)
      ? Math.max(0, Math.trunc(blobEntry.unlockStage))
      : undefined;

  let effective = 0;
  if (colUnlock !== undefined || colStage !== undefined) {
    effective = Math.max(colUnlock ?? 0, colStage ?? 0);
    if (effective === 0 && ((blobUnlock ?? 0) > 0 || (blobStage ?? 0) > 0)) {
      effective = Math.max(blobUnlock ?? 0, blobStage ?? 0);
    }
  } else if (blobUnlock !== undefined || blobStage !== undefined) {
    effective = Math.max(blobUnlock ?? 0, blobStage ?? 0);
  }

  if (effective < 1 && ownsCompletedBuilding(state, colonyIndex, 'commandHub')) {
    effective = 1;
  }
  return effective;
}

/**
 * Validates whether `colonyIndex` has unlocked `itemId` (`stage <= unlockStage`, `SIM-C-02`, `W08-10`).
 * When locked, returns `{ ok: false, code: 'stage_locked', detail: 'S<n>', unlocksAt: 'S<n>' }`.
 */
export function checkItemUnlockStage(
  state: PlanetState,
  colonyIndex: number,
  itemId: string,
  flags?: { has(wave: string): boolean },
  data?: CompiledDataLike,
): StageLockCheckResult {
  // W10 owns Trade Hub access (contact/guild/demo override); the W08 preview's S4 lock must not override it.
  if (flags?.has('W10') && ['tradeHub', 'trade_hub', 'interColonyTradeHub'].includes(itemId)) {
    const access = evaluateTradeHubUnlock(state, colonyIndex, data);
    return access.unlocked ? { ok: true } : { ok: false, code: 'stage_locked', detail: access.hint, unlocksAt: 'S2 contact / S5' };
  }
  const requiredStage = resolveItemUnlockStage(itemId);
  if (requiredStage <= 0) return { ok: true };

  const col = state.colonies[colonyIndex];
  const blobEntry = readBlobColonyStage(state, colonyIndex);
  const hasExplicitProgression =
    typeof col?.unlockStage === 'number' ||
    typeof col?.stage === 'number' ||
    blobEntry !== undefined;

  if (!hasExplicitProgression && flags && !flags.has('W08')) {
    return { ok: true };
  }

  const effectiveUnlockStage = resolveEffectiveUnlockStage(state, colonyIndex);
  if (requiredStage > effectiveUnlockStage) {
    const unlocksAt = `S${requiredStage}`;
    return { ok: false, code: 'stage_locked', detail: unlocksAt, unlocksAt };
  }
  return { ok: true };
}
