import { ENTITY_KIND } from '../../ecs/columns';
import { hexDistance, hexIndex } from '../../grid/hex';
import { DEPOSIT, PREP } from '../../grid/layers';
import type { CompiledDataLike } from '../../kernel/config';
import type { StepContext } from '../../kernel/context';
import type { PlanetState } from '../../kernel/state';
import { countColonyEntities } from '../progression/triggers';
import { provokeHiveAgainstColony } from './provocation';
import { getFaunaHivesState, saveFaunaHivesState } from './state';
import { SPECIES_ORDER, speciesOfEntityKind, type ColonyPlanetDamageLedger, type FaunaSpeciesId } from './types';

/** Minimum planetary ecological damage points before unprovoked / habitat-defense insect aggression activates. */
export const PLANET_DAMAGE_AGGRESSION_THRESHOLD = 25;

/** Extra distance beyond a hive's patrol radius within which deforestation / blasting provokes an already-stressed planet's hive. */
export const HIVE_HABITAT_DEFENSE_BUFFER_TILES = 3;

export interface ColonyPlanetDamageSummary {
  colonyIndex: number;
  damageScore: number;
  threshold: number;
  damagedEnough: boolean;
  forestCleared: number;
  tilesTerraformed: number;
  depositsMined: number;
  industrialPollution: number;
  hivesHarmed: number;
  scheduledRaidBonus: number;
}

const EMPTY_LEDGER: Readonly<ColonyPlanetDamageLedger> = {
  forestCleared: 0,
  tilesTerraformed: 0,
  hivesHarmed: 0,
  lastProcessedTick: -1,
};

function ensureColonyLedgerEntry(
  map: Record<number, ColonyPlanetDamageLedger>,
  colonyIndex: number,
): ColonyPlanetDamageLedger {
  const existing = map[colonyIndex];
  if (existing) return existing;
  const fresh: ColonyPlanetDamageLedger = { ...EMPTY_LEDGER };
  map[colonyIndex] = fresh;
  return fresh;
}

function resolveEventColonyIndex(state: PlanetState, data: Record<string, unknown>, colonyIds: readonly (number | string)[]): number | null {
  if (typeof data.colonyIndex === 'number' && Number.isInteger(data.colonyIndex) && data.colonyIndex >= 0) {
    return data.colonyIndex;
  }
  if (typeof data.owner === 'number' && Number.isInteger(data.owner) && data.owner >= 0) {
    return data.owner;
  }
  const rawId = typeof data.colonyId === 'string' ? data.colonyId : typeof colonyIds[0] === 'string' ? colonyIds[0] : null;
  if (typeof colonyIds[0] === 'number' && colonyIds[0] >= 0) return colonyIds[0];
  if (rawId) {
    const match = /^col_(\d+)$/.exec(rawId) ?? /^(\d+)$/.exec(rawId);
    if (match) return Number(match[1]);
    for (const [idxStr, col] of Object.entries(state.colonies)) {
      if ((col as { id?: string } | undefined)?.id === rawId) return Number(idxStr);
    }
  }
  return null;
}

function countGridEcologicalFootprint(state: PlanetState, colonyIndex: number): { alteredOwnedTiles: number; drainedDeposits: number } {
  const { layers, count } = state.grid;
  const owner = layers.owner;
  const prep = layers.prep;
  const deposit = layers.deposit;
  const richness = layers.richness;
  let alteredOwnedTiles = 0;
  let drainedDeposits = 0;

  for (let i = 0; i < count; i++) {
    const isOwned = owner ? owner[i] === colonyIndex : false;
    const p = prep[i] ?? 0;
    if (isOwned && (p === PREP.prepared || p === PREP.irrigated || p === PREP.living || p === PREP.ridge || p === PREP.moat)) {
      alteredOwnedTiles++;
    }
    if (deposit && richness && deposit[i] !== DEPOSIT.none && richness[i]! < 8500) {
      if (!owner || owner[i] === colonyIndex || owner[i] === -1) drainedDeposits++;
    }
  }
  return { alteredOwnedTiles, drainedDeposits };
}

function computeIndustrialPollutionScore(state: PlanetState, colonyIndex: number): number {
  const counts = countColonyEntities(state, colonyIndex);
  const b = counts.buildingCountsByKind;
  const hubs = (b.commandHub ?? 0) + (b.commandHub_t2 ?? 0) + (b.commandHub_t3 ?? 0);
  const factories = (b.roboticsFactory ?? 0) + (b.roboticsFactory_t2 ?? 0);
  const heavy = (b.smelter ?? 0) + (b.heavyFoundry ?? 0) * 1.3;
  const thermals = (b.thermalGenerator ?? 0) + (b.thermal ?? 0);
  return Math.round(
    hubs * 11 +
    factories * 14 +
    heavy * 14 +
    counts.completedExtractors * 6 +
    thermals * 12,
  );
}

/**
 * Only insect hive species (`blackAnt`, `blueBeetle`, `greenSpitter`) may ever become aggressive toward player colonies.
 * Warm-blooded animals, birds, and aquatic wildlife are passive biosphere creatures that flee from robot conquerors.
 */
export function canFaunaAttackPlayer(speciesOrKind: string | number): boolean {
  if (typeof speciesOrKind === 'number') {
    return (
      speciesOrKind === ENTITY_KIND.blackAnt ||
      speciesOrKind === ENTITY_KIND.blueBeetle ||
      speciesOrKind === ENTITY_KIND.greenSpitter ||
      speciesOfEntityKind(speciesOrKind) !== null
    );
  }
  return (SPECIES_ORDER as readonly string[]).includes(speciesOrKind as FaunaSpeciesId);
}

/**
 * Computes the cumulative planetary ecological damage inflicted by `colonyIndex`.
 * Insects only launch scheduled / habitat-defense aggression once `damageScore >= PLANET_DAMAGE_AGGRESSION_THRESHOLD`.
 */
export function computeColonyPlanetDamage(
  state: PlanetState,
  colonyIndex: number,
  _data?: CompiledDataLike,
): ColonyPlanetDamageSummary {
  const fauna = getFaunaHivesState(state);
  const ledger = fauna.planetDamageByColony?.[colonyIndex] ?? EMPTY_LEDGER;
  const { alteredOwnedTiles, drainedDeposits } = countGridEcologicalFootprint(state, colonyIndex);
  const industrialPollution = computeIndustrialPollutionScore(state, colonyIndex);
  const effectiveTerraformed = Math.max(ledger.tilesTerraformed, Math.min(20, Math.floor(alteredOwnedTiles / 3)));

  const damageScore =
    ledger.forestCleared * 5 +
    effectiveTerraformed * 2 +
    drainedDeposits * 4 +
    industrialPollution +
    ledger.hivesHarmed * 18;

  const damagedEnough = damageScore >= PLANET_DAMAGE_AGGRESSION_THRESHOLD;
  const scheduledRaidBonus = damagedEnough
    ? Math.min(0.65, ledger.forestCleared * 0.025 + effectiveTerraformed * 0.006 + drainedDeposits * 0.015)
    : 0;

  return {
    colonyIndex,
    damageScore,
    threshold: PLANET_DAMAGE_AGGRESSION_THRESHOLD,
    damagedEnough,
    forestCleared: ledger.forestCleared,
    tilesTerraformed: effectiveTerraformed,
    depositsMined: drainedDeposits,
    industrialPollution,
    hivesHarmed: ledger.hivesHarmed,
    scheduledRaidBonus,
  };
}

const processedEventCursor = new WeakMap<readonly unknown[], number>();

/**
 * Scans step events (`tileStateChanged`, `nestDestroyed`, `faunaKilled`) to record planetary ecological damage,
 * and provokes adjacent insect hives when a colony clear-cuts or blasts habitat after crossing the damage threshold.
 */
export function ingestEcologicalDamageEvents(
  state: PlanetState,
  tick = state.meta.tick,
  ctx?: StepContext,
): void {
  if (!ctx?.events || ctx.events.length === 0) return;
  const startIdx = processedEventCursor.get(ctx.events) ?? 0;
  if (startIdx >= ctx.events.length) return;
  processedEventCursor.set(ctx.events, ctx.events.length);

  const fauna = getFaunaHivesState(state);
  const map = fauna.planetDamageByColony;
  const touchedHabitats: Array<{ colonyIndex: number; q: number; r: number }> = [];
  let dirty = false;

  for (let idx = startIdx; idx < ctx.events.length; idx++) {
    const ev = ctx.events[idx]!;
    if (ev.atTick !== tick) continue;
    const d = (ev.data ?? {}) as Record<string, unknown>;
    const colonyIndex = resolveEventColonyIndex(state, d, ev.colonyIds);
    if (colonyIndex === null || colonyIndex < 0) continue;
    const entry = ensureColonyLedgerEntry(map, colonyIndex);

    if (ev.kind === 'tileStateChanged') {
      const count = typeof d.count === 'number' && d.count > 1 ? Math.round(d.count) : 1;
      entry.tilesTerraformed += count;
      if (d.prevTerrain === 'forest' || d.op === 'clear') {
        entry.forestCleared += count;
      }
      entry.lastProcessedTick = tick;
      dirty = true;
      if (typeof d.q === 'number' && typeof d.r === 'number') {
        touchedHabitats.push({ colonyIndex, q: d.q, r: d.r });
      }
    } else if (ev.kind === 'nestDestroyed') {
      entry.hivesHarmed += 1;
      entry.lastProcessedTick = tick;
      dirty = true;
    }
  }

  if (!dirty) return;
  saveFaunaHivesState(state, fauna, tick);

  for (const hit of touchedHabitats) {
    const summary = computeColonyPlanetDamage(state, hit.colonyIndex, ctx.data);
    if (!summary.damagedEnough) continue;
    const hx = hexIndex(state.grid.radius);
    if (hx.indexOf(hit.q, hit.r) < 0) continue;
    const latest = getFaunaHivesState(state);
    for (const hive of Object.values(latest.hivesById)) {
      if (hive.destroyed) continue;
      const dist = hexDistance(hit.q, hit.r, hive.q, hive.r);
      if (dist <= hive.patrolRadius + HIVE_HABITAT_DEFENSE_BUFFER_TILES) {
        provokeHiveAgainstColony(state, hive.hiveId, hit.colonyIndex, tick, ctx.data, ctx);
      }
    }
  }
}
