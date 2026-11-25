import { flagsFromList, type ResourceKey } from '@terra/contracts';
import { setColonyStock, treasuryCtx } from '../../economy';
import { createPlanet } from '../../gen/createPlanet';
import {
  DEV_PLANET_CAPACITY,
  DEV_PLANET_RADIUS,
  type DevPlanetType,
} from '../../gen/flat';
import { ENTITY_KIND } from '../../ecs/columns';
import { HEX_DIRS, hexDistance, hexIndex, inHex } from '../../grid/hex';
import { DEPOSIT, PREP, TERRAIN } from '../../grid/layers';
import { bumpPathEpoch, setTileDeposit, setTileOwner } from '../../grid/tileModel';
import { SimHost } from '../../host/SimHost';
import type { CompiledDataLike } from '../../kernel/config';
import type { LedgerPosting } from '../../kernel/context';
import { setBlob, touchTile, type PlanetState } from '../../kernel/state';
import { ensureColonyAt, syncColonyDepotCaps } from '../economy/ledger';
import { materializeWorldgenHives, spawnHiveSite } from '../fauna/spawn';
import { SPECIES_ORDER, type FaunaSpeciesId } from '../fauna/types';
import { revealVision } from '../hq';
import { recomputeAllColonyPower } from '../power-core';
import { syncColonyThreatStage } from '../progression/threatStage';
import { dropColonyShield } from '../pvp/shield';
import { getPvpState, savePvpState } from '../pvp/store';
import { seedRivalAiColonies } from '../rival-ai/seed';
import { syncColonySupply } from '../supply';

export const COMBAT_TEST_BIOMES: readonly DevPlanetType[] = ['desert', 'ocean', 'temperate'];

export const COMBAT_TEST_FLAGS: readonly string[] = [
  'W00', 'W01', 'W02', 'W03', 'W04', 'W05', 'W06', 'W07', 'W08', 'W09', 'W10', 'W11', 'W12', 'W13', 'W14', 'W18', 'W20',
];

const BIOME_ALIASES: Readonly<Record<string, DevPlanetType>> = {
  desert: 'desert',
  dune: 'desert',
  ocean: 'ocean',
  oceanForest: 'ocean',
  oceanforest: 'ocean',
  temperate: 'temperate',
  forestRock: 'temperate',
  forestrock: 'temperate',
};

const SANDBOX_STORAGE_CAP = 200_000;

const SANDBOX_STOCK: Readonly<Partial<Record<ResourceKey, number>>> = {
  'metals.t1': 50_000,
  'minerals.t1': 50_000,
  'bio.water': 50_000,
  'bio.biomass': 50_000,
  'metals.t2': 10_000,
  'minerals.t2': 10_000,
  'bio.t2': 10_000,
};

export interface CombatTestSetupOptions {
  planetType?: DevPlanetType;
  seed?: string;
  botCount?: number;
  flags?: readonly string[];
  data?: CompiledDataLike;
  revealMap?: boolean;
  recordPosting?: (posting: LedgerPosting) => void;
}

export interface CombatTestWorldMeta {
  enabled: boolean;
  biome: DevPlanetType;
  radius: number;
  staging: { q: number; r: number };
  botCount: number;
  pvpProtection: false;
  noHqRequired: true;
}

export function normalizeCombatTestBiome(raw?: string | null): DevPlanetType {
  if (!raw) return 'temperate';
  const trimmed = raw.trim();
  return BIOME_ALIASES[trimmed] ?? BIOME_ALIASES[trimmed.toLowerCase()] ?? 'temperate';
}

function isDryLandDisk(state: PlanetState, cq: number, cr: number, checkRadius: number): number {
  const hx = hexIndex(state.grid.radius);
  const terrain = state.grid.layers.terrain;
  let score = 0;
  for (let dq = -checkRadius; dq <= checkRadius; dq++) {
    for (let dr = -checkRadius; dr <= checkRadius; dr++) {
      const dist = hexDistance(0, 0, dq, dr);
      if (dist > checkRadius) continue;
      const q = cq + dq;
      const r = cr + dr;
      if (!inHex(q, r, state.grid.radius)) return -1;
      const idx = hx.indexOf(q, r);
      if (idx < 0) return -1;
      const t = terrain[idx] ?? TERRAIN.flat;
      if (t === TERRAIN.shallow || t === TERRAIN.deep) return -1;
      if (t === TERRAIN.flat) score += 2;
      else if (t === TERRAIN.forest) score += 1;
    }
  }
  return score;
}

export function findCombatTestStagingSite(state: PlanetState): { q: number; r: number } {
  let bestQ = 0;
  let bestR = 0;
  let bestScore = -1;
  const maxRing = Math.max(4, state.grid.radius - 8);
  for (let dist = 0; dist <= maxRing; dist += 2) {
    for (let dq = -dist; dq <= dist; dq += 2) {
      for (let dr = -dist; dr <= dist; dr += 2) {
        if (Math.abs(hexDistance(0, 0, dq, dr) - dist) > 1) continue;
        const s = isDryLandDisk(state, dq, dr, 3);
        if (s < 0) continue;
        if (s >= 70) return { q: dq, r: dr };
        if (s > bestScore) {
          bestQ = dq;
          bestR = dr;
          bestScore = s;
        }
      }
    }
    if (bestScore >= 0) return { q: bestQ, r: bestR };
  }
  const hx = hexIndex(state.grid.radius);
  const terrain = state.grid.layers.terrain;
  for (let idx = 0; idx < hx.count; idx++) {
    const t = terrain[idx] ?? TERRAIN.flat;
    if (t !== TERRAIN.shallow && t !== TERRAIN.deep) {
      return { q: hx.q[idx]!, r: hx.r[idx]! };
    }
  }
  return { q: 0, r: 0 };
}

function clearAndClaimPlayerStaging(state: PlanetState, center: { q: number; r: number }, tick: number): void {
  const hx = hexIndex(state.grid.radius);
  const terrain = state.grid.layers.terrain as Uint8Array;
  const prep = state.grid.layers.prep as Uint8Array;
  const height = state.grid.layers.height as Float32Array;
  const deposit = state.grid.layers.deposit;
  for (let dq = -3; dq <= 3; dq++) {
    for (let dr = -3; dr <= 3; dr++) {
      const dist = hexDistance(0, 0, dq, dr);
      if (dist > 3) continue;
      const idx = hx.indexOf(center.q + dq, center.r + dr);
      if (idx < 0) continue;
      if (terrain[idx] !== TERRAIN.shallow && terrain[idx] !== TERRAIN.deep) {
        if (dist <= 2) {
          terrain[idx] = TERRAIN.flat;
          prep[idx] = PREP.prepared;
          height[idx] = Math.fround(0.1);
          if ((deposit[idx] ?? DEPOSIT.none) !== DEPOSIT.none) {
            setTileDeposit(state.grid, idx, DEPOSIT.none, 0, tick, 0);
          }
        }
        setTileOwner(state.grid, idx, 0, tick);
        touchTile(state, idx, tick);
      }
    }
  }
  bumpPathEpoch(state.meta);
}

function stripAllPvpProtection(state: PlanetState, data?: CompiledDataLike): void {
  const tick = state.meta.tick;
  for (const col of state.colonies) {
    if (!col) continue;
    dropColonyShield(state, col.index, tick, data);
    col.raidProtectedUntil = 0;
    col.changedAt = tick;
  }
  const pvp = getPvpState(state);
  pvp.crossSectorEnabled = true;
  for (const [k, rec] of Object.entries(pvp.byColony)) {
    pvp.byColony[k] = {
      ...rec,
      raidProtectedUntil: 0,
      shieldDropped: true,
      manualShieldOverride: true,
    };
    pvp.raidProtectedUntilByColony[k] = 0;
  }
  savePvpState(state, pvp, tick);
}

function isSafeWildHiveTile(state: PlanetState, q: number, r: number, staging: { q: number; r: number }): boolean {
  if (!inHex(q, r, state.grid.radius - 3)) return false;
  if (hexDistance(q, r, staging.q, staging.r) < 12) return false;
  const hx = hexIndex(state.grid.radius);
  const terrain = state.grid.layers.terrain;
  const cols = state.entities.cols;
  for (let row = 0; row < state.entities.count; row++) {
    if (cols.hp[row]! <= 0) continue;
    if (hexDistance(q, r, Math.round(cols.q[row]!), Math.round(cols.r[row]!)) < 10) return false;
  }
  for (let dq = -1; dq <= 1; dq++) {
    for (let dr = -1; dr <= 1; dr++) {
      if (hexDistance(0, 0, dq, dr) > 1) continue;
      const idx = hx.indexOf(q + dq, r + dr);
      if (idx < 0) return false;
      const t = terrain[idx] ?? TERRAIN.flat;
      if (t === TERRAIN.shallow || t === TERRAIN.deep) return false;
    }
  }
  return true;
}

function ensureReachableCombatHives(
  state: PlanetState,
  staging: { q: number; r: number },
  data?: CompiledDataLike,
): void {
  materializeWorldgenHives(state, state.meta.tick, data);
  const cols = state.entities.cols;
  let hiveCount = 0;
  let nearestDist = Infinity;
  for (let row = 0; row < state.entities.count; row++) {
    if (cols.hp[row]! <= 0) continue;
    const k = cols.kind[row]!;
    if (k === ENTITY_KIND.hiveBlackAnt || k === ENTITY_KIND.hiveBlueBeetle || k === ENTITY_KIND.hiveGreenSpitter) {
      hiveCount++;
      const dist = hexDistance(staging.q, staging.r, Math.round(cols.q[row]!), Math.round(cols.r[row]!));
      if (dist < nearestDist) nearestDist = dist;
    }
  }
  if (hiveCount >= 3 && nearestDist <= 26) return;

  const targetCount = Math.max(0, 3 - hiveCount) + (nearestDist > 26 ? 1 : 0);
  let placed = 0;
  for (let ring = 14; ring <= Math.min(28, state.grid.radius - 4) && placed < targetCount; ring += 3) {
    for (let dir = 0; dir < HEX_DIRS.length && placed < targetCount; dir++) {
      const [dq, dr] = HEX_DIRS[(dir + placed) % HEX_DIRS.length]!;
      const cq = staging.q + dq * ring;
      const cr = staging.r + dr * ring;
      if (!isSafeWildHiveTile(state, cq, cr, staging)) continue;
      const species: FaunaSpeciesId = SPECIES_ORDER[placed % SPECIES_ORDER.length]!;
      spawnHiveSite(state, { species, q: cq, r: cr, initialResidents: 4, popCap: 6 }, state.meta.tick, data);
      placed++;
    }
  }
}

export function setupCombatTestWorld(state: PlanetState, opts: CombatTestSetupOptions = {}): CombatTestWorldMeta {
  const biome = opts.planetType ?? 'temperate';
  const botCount = Math.max(1, Math.min(5, Math.floor(opts.botCount ?? 3)));
  const tick = state.meta.tick;
  const data = opts.data;

  const staging = findCombatTestStagingSite(state);
  clearAndClaimPlayerStaging(state, staging, tick);

  const playerCol = ensureColonyAt(state, 0, tick) as ReturnType<typeof ensureColonyAt> & {
    combatSandbox?: boolean;
    noPowerGridLock?: boolean;
    powerSupplyOverride?: number;
    supplyCapOverride?: number;
    storageCapOverride?: number;
    spawnQ?: number;
    spawnR?: number;
  };
  playerCol.name = 'Combat Test Force';
  playerCol.status = 'active';
  playerCol.stage = 4;
  playerCol.threatStage = 4;
  playerCol.hq = null;
  playerCol.spawnQ = staging.q;
  playerCol.spawnR = staging.r;
  delete playerCol.hubEntityId;
  playerCol.combatSandbox = true;
  playerCol.noPowerGridLock = true;
  playerCol.powerSupplyOverride = 10000;
  playerCol.supplyCapOverride = 200;
  playerCol.storageCapOverride = SANDBOX_STORAGE_CAP;
  playerCol.changedAt = tick;

  syncColonyDepotCaps(state, 0, tick);
  const stockCtx = opts.recordPosting
    ? treasuryCtx(tick, { record: opts.recordPosting, data })
    : undefined;
  setColonyStock(state, 0, SANDBOX_STOCK, stockCtx);
  syncColonyThreatStage(state, 0, tick);

  const colonyIndices = Array.from({ length: botCount }, (_, idx) => idx + 1);
  seedRivalAiColonies(state, {
    count: botCount,
    colonyIndices,
    capacity: Math.max(DEV_PLANET_CAPACITY, botCount + 1),
    tick,
    data,
    ...(opts.recordPosting ? { recordPosting: opts.recordPosting } : {}),
  });

  stripAllPvpProtection(state, data);
  ensureReachableCombatHives(state, staging, data);
  if (opts.revealMap !== false) {
    revealVision(state, 0, staging.q, staging.r, state.grid.radius * 2 + 4, tick);
  }
  syncColonySupply(state, 0, tick, data);
  recomputeAllColonyPower(state, data, tick);

  const meta: CombatTestWorldMeta = {
    enabled: true,
    biome,
    radius: state.grid.radius,
    staging,
    botCount: state.colonies.filter((c) => c && c.index > 0 && c.status !== 'eliminated' && c.isBot === true).length,
    pvpProtection: false,
    noHqRequired: true,
  };
  setBlob(state, 'combatTest', meta, tick);
  return meta;
}

export function createCombatTestHost(opts: CombatTestSetupOptions = {}): {
  host: SimHost;
  meta: CombatTestWorldMeta;
  setupPostings: readonly LedgerPosting[];
} {
  const biome = opts.planetType ?? 'temperate';
  const flags = opts.flags?.length ? opts.flags : COMBAT_TEST_FLAGS;
  const botCount = Math.max(1, Math.min(5, Math.floor(opts.botCount ?? 3)));
  const host = new SimHost({
    flags: flagsFromList(flags),
    hostRole: 'authority_external_bots',
  });
  const seed = opts.seed ?? `combat-test-${biome}`;
  const state = createPlanet({
    type: biome,
    planetType: biome,
    seed,
    planetId: `pl_combat_test_${biome}`,
    radius: DEV_PLANET_RADIUS,
    capacity: Math.max(DEV_PLANET_CAPACITY, botCount + 1),
  });
  const setupPostings: LedgerPosting[] = [];
  const off = host.onPostings((p) => setupPostings.push(...p));
  let meta: CombatTestWorldMeta;
  try {
    meta = setupCombatTestWorld(state, {
      ...opts,
      botCount,
      planetType: biome,
      data: opts.data ?? host.pipeline.config.data,
      recordPosting: (p) => {
        setupPostings.push(p);
        opts.recordPosting?.(p);
      },
    });
    host.load(state);
  } finally {
    off();
  }
  return { host, meta, setupPostings };
}
