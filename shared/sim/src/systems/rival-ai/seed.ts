import { compileData } from '../../data';
import { resolveTileSector } from '../../atlas/crossSectorGameplay';
import { hexDistance, hexIndex } from '../../grid/hex';
import { DEPOSIT, PREP, TERRAIN } from '../../grid/layers';
import { isGroundPassable, setTileHeight, setTileOwner, setTilePrep, setTileTerrain } from '../../grid/tileModel';
import { getSpawnSlots } from '../../gen/spawnSlots';
import { getDepositRichnessBp } from '../../gen/temperate';
import { ensureColonyRecord } from '../../kernel/colonies';
import type { CompiledDataLike } from '../../kernel/config';
import type { LedgerPosting, StepContext } from '../../kernel/context';
import type { PlanetState } from '../../kernel/state';
import { applyAutopilot } from '../away/store';
import { ensureColonyCargoState } from '../cargo/state';
import { occupiedGroundTiles } from '../construction/occupancy';
import { mirrorAutopilotOnDirector } from '../director/store';
import { readDiplomacyBlob, writeDiplomacyBlob } from '../diplomacy/store';
import { setColonyStock, treasuryCtx } from '../../economy';
import { startBuildingConstruction } from '../economy/construction';
import { ensureColonyLedger } from '../economy/ledger';
import { produceReconAtFactoryEdge, spawnWorkerUnit } from '../factories-hub';
import { setColonyPriorities } from '../goals/priorities';
import { spawnHqUnit } from '../hq';
import { initColonyNewcomerShield } from '../pvp/shield';
import { selectDeterministicBuildSite } from '../rule-engine/site';
import {
  readRivalAiBlob,
  writeRivalAiBlob,
  type RivalColonyMeta,
  type RivalPersona,
} from './store';

export interface SeedRivalAiOptions {
  count?: number;
  colonyIndices?: readonly number[];
  capacity?: number;
  tick?: number;
  data?: CompiledDataLike;
  ctx?: StepContext;
  recordPosting?: (posting: LedgerPosting) => void;
}

const RIVAL_SPECS: ReadonlyArray<{
  persona: RivalPersona;
  name: string;
  handle: string;
  color: number;
  risk: 'conservative' | 'risky';
  awayRaids: boolean;
  recons: number;
  priorities: { economy: number; expansion: number; defense: number; power: number; terraform: number };
  stock: Record<string, number>;
}> = [
  {
    persona: 'trader',
    name: 'Iron Guild Outpost',
    handle: 'iron_guild_ai',
    color: 2,
    risk: 'conservative',
    awayRaids: false,
    recons: 2,
    priorities: { economy: 80, expansion: 50, defense: 60, power: 60, terraform: 70 },
    stock: { 'metals.t1': 360, 'minerals.t1': 320, 'bio.water': 280, 'bio.biomass': 180 },
  },
  {
    persona: 'warlord',
    name: 'Crimson Vanguard',
    handle: 'crimson_vanguard_ai',
    color: 5,
    risk: 'risky',
    awayRaids: true,
    recons: 3,
    priorities: { economy: 60, expansion: 70, defense: 80, power: 60, terraform: 50 },
    stock: { 'metals.t1': 420, 'minerals.t1': 260, 'bio.water': 220, 'bio.biomass': 140 },
  },
];

let cachedSeedData: CompiledDataLike | null = null;
function resolveSeedData(data?: CompiledDataLike): CompiledDataLike {
  if (data) return data;
  if (!cachedSeedData) {
    cachedSeedData = compileData(
      new Set(['W00', 'W01', 'W02', 'W03', 'W04', 'W05', 'W06', 'W07', 'W08', 'W09', 'W10', 'W16', 'W18', 'W22']),
    );
  }
  return cachedSeedData;
}

function pickRivalAnchors(state: PlanetState, count: number): Array<{ q: number; r: number }> {
  const occupiedCenters: Array<{ q: number; r: number }> = [];
  for (const col of state.colonies) {
    if (!col || col.status === 'eliminated') continue;
    if (typeof col.spawnQ === 'number' && typeof col.spawnR === 'number') {
      occupiedCenters.push({ q: col.spawnQ, r: col.spawnR });
    }
  }
  const candidates: Array<{ q: number; r: number }> = getSpawnSlots(state).map((s) => ({ q: s.q, r: s.r }));
  const r = Math.max(6, Math.floor(Math.min(state.grid.radius, 42) * 0.55));
  candidates.push({ q: r, r: 0 }, { q: -r, r: r }, { q: 0, r: -r }, { q: -r, r: 0 });

  const chosen: Array<{ q: number; r: number }> = [];
  for (const cand of candidates) {
    if (chosen.length >= count) break;
    if (hexDistance(0, 0, cand.q, cand.r) + 7 > state.grid.radius) continue;
    const allPlaced = [...occupiedCenters, ...chosen];
    if (allPlaced.some((p) => hexDistance(p.q, p.r, cand.q, cand.r) < 10)) continue;
    chosen.push({ q: cand.q, r: cand.r });
  }
  return chosen;
}

function prepareRivalPad(state: PlanetState, colonyIndex: number, cx: number, cy: number, tick: number): void {
  const hx = hexIndex(state.grid.radius);
  const padRadius = Math.max(7, Math.min(9, state.grid.radius - hexDistance(0, 0, cx, cy)));
  for (let dq = -padRadius; dq <= padRadius; dq++) {
    for (let dr = -padRadius; dr <= padRadius; dr++) {
      if (hexDistance(0, 0, dq, dr) > padRadius) continue;
      const i = hx.indexOf(cx + dq, cy + dr);
      if (i < 0) continue;
      if (state.grid.layers.valid && state.grid.layers.valid[i] === 0) continue;
      const curOwner = state.grid.layers.owner[i] ?? -1;
      if (curOwner >= 0 && curOwner !== colonyIndex) continue;
      setTileTerrain(state.grid, i, TERRAIN.flat, tick);
      setTilePrep(state.grid, i, PREP.prepared, tick);
      setTileHeight(state.grid, i, 0, tick);
      setTileOwner(state.grid, i, colonyIndex);
      state.grid.layers.deposit[i] = 0;
      if (state.grid.layers.feature) state.grid.layers.feature[i] = 0;
    }
  }
  const outerOff = Math.min(6, padRadius - 1);
  const metalTile = hx.indexOf(cx - 2, cy + outerOff);
  if (metalTile >= 0 && state.grid.layers.owner[metalTile] === colonyIndex) {
    state.grid.layers.deposit[metalTile] = DEPOSIT.metals;
    (state.grid.layers.richness as Float32Array)[metalTile] = getDepositRichnessBp(
      state.meta.seed,
      metalTile,
      DEPOSIT.metals,
      state.meta.planetType,
    );
    if (state.grid.layers.depositTier) (state.grid.layers.depositTier as Uint8Array)[metalTile] = 1;
  }
  const mineralTile = hx.indexOf(cx - outerOff, cy + 4);
  if (mineralTile >= 0 && state.grid.layers.owner[mineralTile] === colonyIndex) {
    state.grid.layers.deposit[mineralTile] = DEPOSIT.minerals;
    (state.grid.layers.richness as Float32Array)[mineralTile] = getDepositRichnessBp(
      state.meta.seed,
      mineralTile,
      DEPOSIT.minerals,
      state.meta.planetType,
    );
    if (state.grid.layers.depositTier) (state.grid.layers.depositTier as Uint8Array)[mineralTile] = 1;
  }
}

export function linkAllActiveColonyContacts(state: PlanetState, tick: number): void {
  const activeIndices = state.colonies
    .filter((c): c is NonNullable<typeof c> => Boolean(c && c.status !== 'eliminated'))
    .map((c) => c.index);
  if (activeIndices.length < 2) return;
  const dip = readDiplomacyBlob(state);
  for (const a of activeIndices) {
    const cur = new Set(dip.contactsByColony[a] ?? []);
    for (const b of activeIndices) {
      if (a !== b) cur.add(b);
    }
    dip.contactsByColony[a] = [...cur].sort((x, y) => x - y);
  }
  writeDiplomacyBlob(state, dip, tick);
}

function findSeedUnitSpawnTiles(
  state: PlanetState,
  anchorQ: number,
  anchorR: number,
  needed: number,
  data: CompiledDataLike,
): Array<{ q: number; r: number }> {
  const hx = hexIndex(state.grid.radius);
  const occupied = occupiedGroundTiles(state, data);
  const deposit = state.grid.layers.deposit;
  const used = new Set<number>();
  const out: Array<{ q: number; r: number }> = [];

  for (let dist = 2; dist <= 5 && out.length < needed; dist++) {
    for (let dr = -dist; dr <= dist && out.length < needed; dr++) {
      for (let dq = -dist; dq <= dist && out.length < needed; dq++) {
        if (hexDistance(0, 0, dq, dr) !== dist) continue;
        const q = anchorQ + dq;
        const r = anchorR + dr;
        const idx = hx.indexOf(q, r);
        if (idx < 0 || used.has(idx) || occupied.has(idx)) continue;
        if (!isGroundPassable(state, idx, data)) continue;
        if (deposit && deposit[idx] !== DEPOSIT.none) continue;
        used.add(idx);
        out.push({ q, r });
      }
    }
  }
  while (out.length < needed) {
    out.push({ q: anchorQ + 2 + out.length, r: anchorR });
  }
  return out;
}

function seedRivalColonyEntities(
  state: PlanetState,
  colonyIndex: number,
  anchor: { q: number; r: number },
  persona: RivalPersona,
  recons: number,
  tick: number,
  data: CompiledDataLike,
  ctx?: StepContext,
): void {
  startBuildingConstruction(state, { owner: colonyIndex, building: 'commandHub', q: anchor.q, r: anchor.r, instant: true, costOverride: {}, data });

  const pylonOffsets: ReadonlyArray<readonly [number, number]> = [
    [5, -2],
    [-5, 1],
  ];
  for (const [dq, dr] of pylonOffsets) {
    const first = startBuildingConstruction(state, {
      owner: colonyIndex,
      building: 'pylon',
      q: anchor.q + dq,
      r: anchor.r + dr,
      instant: true,
      costOverride: {},
      data,
    });
    if (!first.ok) {
      const site = selectDeterministicBuildSite(state, colonyIndex, 'pylon', { data, maxRadius: 9 });
      if (site) {
        startBuildingConstruction(state, { owner: colonyIndex, building: 'pylon', q: site.q, r: site.r, instant: true, costOverride: {}, data });
      }
    }
  }

  const starterBuildings = ['roboticsFactory', 'tradeHub', 'depot', 'solar', 'solar', 'wind', 'turret'];
  if (persona === 'warlord') starterBuildings.push('turret');
  for (const building of starterBuildings) {
    const site = selectDeterministicBuildSite(state, colonyIndex, building, { data, maxRadius: 9 });
    if (site) {
      startBuildingConstruction(state, {
        owner: colonyIndex,
        building,
        q: site.q,
        r: site.r,
        instant: true,
        costOverride: {},
        data,
      });
    }
  }

  const unitSpawns = findSeedUnitSpawnTiles(state, anchor.q, anchor.r, 3, data);
  spawnHqUnit(state, { owner: colonyIndex, q: unitSpawns[0]!.q, r: unitSpawns[0]!.r });
  spawnWorkerUnit(state, { owner: colonyIndex, q: unitSpawns[1]!.q, r: unitSpawns[1]!.r, tick, data }, ctx);
  spawnWorkerUnit(state, { owner: colonyIndex, q: unitSpawns[2]!.q, r: unitSpawns[2]!.r, tick, data }, ctx);
  for (let u = 0; u < recons; u++) {
    produceReconAtFactoryEdge(state, colonyIndex, ctx);
  }
}

/**
 * Seeds up to 2 Stage-4 unshielded Rival AI Colonies (`Iron Guild Outpost` conservative Trader +
 * `Crimson Vanguard` risky Warlord) at back seat indices (`capacity - 2`, `capacity - 1`) so human
 * players joining at `0, 1, ...` never collide and Rival AIs immediately trade, terraform, raid, and truce.
 */
export function seedRivalAiColonies(
  state: PlanetState,
  opts: SeedRivalAiOptions = {},
): RivalColonyMeta[] {
  const blob = readRivalAiBlob(state);
  if (blob.seeded) return Object.values(blob.rivals);

  const count = opts.count ?? 2;
  const metaCap = (state.meta as { capacity?: number }).capacity;
  const capacity = Math.max(4, opts.capacity ?? metaCap ?? 8);
  const tick = opts.tick ?? state.meta.tick;
  const data = resolveSeedData(opts.data);
  const anchors = pickRivalAnchors(state, count);
  const created: RivalColonyMeta[] = [];

  for (let k = 0; k < Math.min(count, anchors.length); k++) {
    const baseSpec = RIVAL_SPECS[k % RIVAL_SPECS.length]!;
    const tier = Math.floor(k / RIVAL_SPECS.length);
    const spec = tier === 0
      ? baseSpec
      : {
          ...baseSpec,
          name: `${baseSpec.name} #${tier + 1}`,
          handle: `${baseSpec.handle}_${k + 1}`,
          color: (baseSpec.color + k) % 8,
        };
    const anchor = anchors[k]!;
    const colonyIndex =
      opts.colonyIndices && typeof opts.colonyIndices[k] === 'number'
        ? opts.colonyIndices[k]!
        : Math.max(1 + k, capacity - count + k);
    const existing = state.colonies[colonyIndex];
    if (existing && existing.status === 'active' && !(existing as { isAiColony?: boolean }).isAiColony) {
      continue;
    }

    prepareRivalPad(state, colonyIndex, anchor.q, anchor.r, tick);
    const col = ensureColonyLedger(ensureColonyRecord(state, colonyIndex, tick), { baseCap: 2500 });
    const colRec = col as unknown as Record<string, unknown>;
    col.id = `col_${colonyIndex}`;
    col.name = spec.name;
    col.color = spec.color;
    col.status = 'active';
    col.aiEnabled = true;
    col.stage = 4;
    col.unlockStage = 4;
    colRec.playerId = `ai:${spec.handle}`;
    colRec.handle = spec.handle;
    colRec.isAiColony = true;
    colRec.isBot = true;
    colRec.botPersona = spec.persona;
    colRec.foundingSectorId = resolveTileSector(state, anchor.q, anchor.r)?.sectorId ?? 'sec_0_0';
    colRec.spawnQ = anchor.q;
    colRec.spawnR = anchor.r;
    colRec.awayRaids = spec.awayRaids;

    const stockCtx = opts.ctx
      ? treasuryCtx(tick, opts.ctx)
      : opts.recordPosting
        ? treasuryCtx(tick, { record: opts.recordPosting, data })
        : undefined;
    setColonyStock(state, colonyIndex, spec.stock, stockCtx);
    const cargo = ensureColonyCargoState(col);
    cargo.inOrbit = { ...cargo.inOrbit, 'metals.t1': 180, 'minerals.t1': 120, 'bio.water': 120, 'bio.biomass': 80 };
    setColonyPriorities(state, colonyIndex, spec.priorities, tick);
    applyAutopilot(
      state,
      colonyIndex,
      { mode: 'director', awayRaids: spec.awayRaids },
      data,
      tick,
    );
    mirrorAutopilotOnDirector(state, colonyIndex, { mode: 'director', awayRaids: spec.awayRaids }, tick);

    seedRivalColonyEntities(state, colonyIndex, anchor, spec.persona, spec.recons, tick, data, opts.ctx);

    initColonyNewcomerShield(state, colonyIndex, tick, data);

    const meta: RivalColonyMeta = {
      colonyIndex,
      colonyId: col.id,
      name: spec.name,
      persona: spec.persona,
      risk: spec.risk,
      allowWarDiplomacy: true,
      anchorQ: anchor.q,
      anchorR: anchor.r,
      seededAtTick: tick,
    };
    blob.rivals[colonyIndex] = meta;
    created.push(meta);
  }

  blob.seeded = true;
  blob.governorEnabled = true;
  writeRivalAiBlob(state, blob, tick);
  linkAllActiveColonyContacts(state, tick);
  return created;
}
