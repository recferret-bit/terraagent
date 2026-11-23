import { ENTITY_KIND } from '../../ecs/columns';
import { regionViewOf } from '../../economy/regions/pin';
import { rollRegionalDeposit, type RegionView } from '../../economy/regions/sourcePolicy';
import { getDepositRichnessBp } from '../../gen/temperate';
import { hash2d, seedOf } from '../../gen/world/noise';
import { hexDistance, hexIndex, type HexIndex } from '../../grid/hex';
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
  faunaKilled: number;
  scheduledRaidBonus: number;
}

const EMPTY_LEDGER: Readonly<ColonyPlanetDamageLedger> = {
  forestCleared: 0,
  tilesTerraformed: 0,
  hivesHarmed: 0,
  faunaKilled: 0,
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
    const match = /^col[_-](\d+)$/.exec(rawId) ?? /^(\d+)$/.exec(rawId);
    if (match) return Number(match[1]);
    for (const [idxStr, col] of Object.entries(state.colonies)) {
      if ((col as { id?: string } | undefined)?.id === rawId) return Number(idxStr);
    }
  }
  return null;
}

function collectColonyAnchors(state: PlanetState): Map<number, { q: number; r: number }> {
  const anchors = new Map<number, { q: number; r: number }>();
  const cols = state.entities.cols;
  for (let r = 0; r < state.entities.count; r++) {
    const owner = cols.owner[r]!;
    if (owner < 0 || cols.hp[r]! <= 0) continue;
    const kind = cols.kind[r]!;
    if (!anchors.has(owner) || kind === ENTITY_KIND.commandHub || kind === ENTITY_KIND.hq) {
      anchors.set(owner, { q: cols.q[r]!, r: cols.r[r]! });
    }
  }
  return anchors;
}

function isUnownedDepositAttributedToColony(
  anchors: ReadonlyMap<number, { q: number; r: number }>,
  colonyCount: number,
  colonyIndex: number,
  q: number,
  r: number,
): boolean {
  if (colonyCount <= 1 && anchors.size <= 1) return true;
  const mine = anchors.get(colonyIndex);
  if (!mine) return false;
  const myDist = hexDistance(q, r, mine.q, mine.r);
  if (myDist > 18) return false;
  for (const [otherIdx, pos] of anchors) {
    if (otherIdx === colonyIndex) continue;
    const d = hexDistance(q, r, pos.q, pos.r);
    if (d < myDist || (d === myDist && otherIdx < colonyIndex)) return false;
  }
  return true;
}

function expectedInitialDepositRichnessBp(
  state: PlanetState,
  region: RegionView | undefined,
  hx: HexIndex,
  pickSeed: number,
  reserveSeed: number,
  tileIdx: number,
  depKind: number,
): number {
  if (region) {
    const roll = rollRegionalDeposit(region, 'surfaceDeposit', {
      pick: hash2d(hx.q[tileIdx]!, hx.r[tileIdx]!, pickSeed),
      reserve: hash2d(hx.q[tileIdx]!, hx.r[tileIdx]!, reserveSeed),
    });
    if (roll && roll.deposit === depKind) return roll.richnessBp;
    if ((state.grid.layers.changedAt?.[tileIdx] ?? 0) === 0) {
      return Number(state.grid.layers.richness?.[tileIdx] ?? 10000);
    }
    return 8000;
  }
  return Math.min(10000, getDepositRichnessBp(String(state.meta.seed), tileIdx, depKind, state.meta.planetType));
}

function countGridEcologicalFootprint(state: PlanetState, colonyIndex: number): { alteredOwnedTiles: number; drainedDeposits: number } {
  const { layers, count, radius } = state.grid;
  const { owner, prep, deposit, richness } = layers;
  const region = regionViewOf(state);
  const hx = hexIndex(radius);
  const baseSeed = String(state.meta.seed);
  const pickSeed = region ? seedOf(`${baseSeed}|gen:regionalPick`) : 0;
  const reserveSeed = region ? seedOf(`${baseSeed}|gen:regionalReserve`) : 0;
  const anchors = collectColonyAnchors(state);
  const colonyCount = Object.keys(state.colonies).length;
  let alteredOwnedTiles = 0;
  let drainedDeposits = 0;

  for (let i = 0; i < count; i++) {
    const tileOwner = owner ? owner[i]! : -1;
    const isOwned = owner ? tileOwner === colonyIndex : false;
    const p = prep[i] ?? 0;
    if (isOwned && (p === PREP.prepared || p === PREP.irrigated || p === PREP.living || p === PREP.ridge || p === PREP.moat)) {
      alteredOwnedTiles++;
    }
    const depKind = deposit ? deposit[i]! : DEPOSIT.none;
    if (depKind !== DEPOSIT.none && richness) {
      const curRich = Number(richness[i] ?? 0);
      const initRich = expectedInitialDepositRichnessBp(state, region, hx, pickSeed, reserveSeed, i, depKind);
      if (curRich <= 0 || curRich < initRich * 0.85) {
        if (isOwned || (tileOwner === -1 && isUnownedDepositAttributedToColony(anchors, colonyCount, colonyIndex, hx.q[i]!, hx.r[i]!))) {
          drainedDeposits++;
        }
      }
    }
  }
  return { alteredOwnedTiles, drainedDeposits };
}

function computeIndustrialPollutionScore(state: PlanetState, colonyIndex: number): number {
  const counts = countColonyEntities(state, colonyIndex);
  const b = counts.buildingCountsByKind;
  const hubsT1 = b.commandHub ?? 0;
  const hubsUpgraded = (b.commandHub_t2 ?? 0) + (b.commandHub_t3 ?? 0);
  const factoriesT1 = b.roboticsFactory ?? 0;
  const factoriesUpgraded = b.roboticsFactory_t2 ?? 0;
  const heavy = (b.smelter ?? 0) + (b.heavyFoundry ?? 0) * 1.3;
  const thermals = (b.thermalGenerator ?? 0) + (b.thermal ?? 0);
  return Math.round(
    hubsT1 * 5 +
    hubsUpgraded * 11 +
    factoriesT1 * 10 +
    factoriesUpgraded * 16 +
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
  const sprawlTilesBeyondBasePad = Math.max(0, alteredOwnedTiles - 24);
  const effectiveTerraformed = Math.max(ledger.tilesTerraformed, Math.min(20, Math.floor(sprawlTilesBeyondBasePad / 3)));
  const faunaKilled = ledger.faunaKilled ?? 0;

  const damageScore =
    ledger.forestCleared * 5 +
    effectiveTerraformed * 2 +
    drainedDeposits * 4 +
    industrialPollution +
    ledger.hivesHarmed * 18 +
    faunaKilled * 4;

  const damagedEnough = damageScore >= PLANET_DAMAGE_AGGRESSION_THRESHOLD;
  const scheduledRaidBonus = damagedEnough
    ? Math.min(0.65, ledger.forestCleared * 0.025 + effectiveTerraformed * 0.006 + drainedDeposits * 0.015 + faunaKilled * 0.015)
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
    faunaKilled,
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
  const seenTileOps = new Set<string>();
  for (let idx = 0; idx < startIdx; idx++) {
    const prev = ctx.events[idx];
    if (prev?.atTick === tick && prev.kind === 'tileStateChanged') {
      const pd = (prev.data ?? {}) as Record<string, unknown>;
      const pCol = resolveEventColonyIndex(state, pd, prev.colonyIds);
      if (pCol !== null && typeof pd.q === 'number' && typeof pd.r === 'number') {
        seenTileOps.add(`${pCol}:${pd.q},${pd.r}`);
      }
    }
  }
  let dirty = false;

  for (let idx = startIdx; idx < ctx.events.length; idx++) {
    const ev = ctx.events[idx]!;
    if (ev.atTick !== tick) continue;
    const d = (ev.data ?? {}) as Record<string, unknown>;
    const colonyIndex = resolveEventColonyIndex(state, d, ev.colonyIds);
    if (colonyIndex === null || colonyIndex < 0) continue;
    const entry = ensureColonyLedgerEntry(map, colonyIndex);

    if (ev.kind === 'tileStateChanged' || ev.kind === 'obstacleRemoved') {
      const hasCoords = typeof d.q === 'number' && typeof d.r === 'number';
      const dedupKey = hasCoords ? `${colonyIndex}:${d.q},${d.r}` : '';
      if (dedupKey && seenTileOps.has(dedupKey)) continue;
      if (dedupKey) seenTileOps.add(dedupKey);
      const count = typeof d.count === 'number' && d.count > 1 ? Math.round(d.count) : 1;
      entry.tilesTerraformed += count;
      if (d.prevTerrain === 'forest' || d.op === 'clear') {
        entry.forestCleared += count;
      }
      entry.lastProcessedTick = tick;
      dirty = true;
      if (hasCoords) {
        touchedHabitats.push({ colonyIndex, q: d.q as number, r: d.r as number });
      }
    } else if (ev.kind === 'nestDestroyed') {
      entry.hivesHarmed += 1;
      entry.lastProcessedTick = tick;
      dirty = true;
    } else if (ev.kind === 'faunaKilled') {
      const count = typeof d.count === 'number' && d.count > 1 ? Math.round(d.count) : 1;
      entry.faunaKilled = (entry.faunaKilled ?? 0) + count;
      entry.lastProcessedTick = tick;
      dirty = true;
      if (typeof d.q === 'number' && typeof d.r === 'number') {
        touchedHabitats.push({ colonyIndex, q: d.q, r: d.r });
      }
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
