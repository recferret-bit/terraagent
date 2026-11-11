import { compileData } from '../../data';
import { hexDistance, hexIndex } from '../../grid/hex';
import { DEPOSIT, PREP, TERRAIN } from '../../grid/layers';
import { setTileHeight, setTileOwner, setTilePrep, setTileTerrain } from '../../grid/tileModel';
import { getSpawnSlots } from '../../gen/spawnSlots';
import { ensureColonyRecord } from '../../kernel/colonies';
import type { CompiledDataLike } from '../../kernel/config';
import type { StepContext } from '../../kernel/context';
import type { PlanetState } from '../../kernel/state';
import { applyAutopilot } from '../away/store';
import { ensureColonyCargoState } from '../cargo/state';
import { mirrorAutopilotOnDirector } from '../director/store';
import { readDiplomacyBlob, writeDiplomacyBlob } from '../diplomacy/store';
import { setColonyStock, treasuryCtx } from '../../economy';
import { startBuildingConstruction } from '../economy/construction';
import { ensureColonyLedger } from '../economy/ledger';
import { produceReconAtFactoryEdge, spawnWorkerUnit } from '../factories-hub';
import { setColonyPriorities } from '../goals/priorities';
import { spawnHqUnit } from '../hq';
import { initColonyNewcomerShield } from '../pvp/shield';
import {
  readRivalAiBlob,
  writeRivalAiBlob,
  type RivalColonyMeta,
  type RivalPersona,
} from './store';

export interface SeedRivalAiOptions {
  count?: 1 | 2;
  capacity?: number;
  tick?: number;
  data?: CompiledDataLike;
  ctx?: StepContext;
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
  for (let dq = -7; dq <= 7; dq++) {
    for (let dr = -7; dr <= 7; dr++) {
      if (hexDistance(0, 0, dq, dr) > 7) continue;
      const i = hx.indexOf(cx + dq, cy + dr);
      if (i < 0) continue;
      if (state.grid.layers.valid && state.grid.layers.valid[i] === 0) continue;
      setTileTerrain(state.grid, i, TERRAIN.flat, tick);
      setTilePrep(state.grid, i, PREP.prepared, tick);
      setTileHeight(state.grid, i, 0, tick);
      setTileOwner(state.grid, i, colonyIndex);
      state.grid.layers.deposit[i] = 0;
      if (state.grid.layers.feature) state.grid.layers.feature[i] = 0;
    }
  }
  const metalTile = hx.indexOf(cx - 5, cy + 2);
  if (metalTile >= 0) state.grid.layers.deposit[metalTile] = DEPOSIT.metals;
  const mineralTile = hx.indexOf(cx - 5, cy + 4);
  if (mineralTile >= 0) state.grid.layers.deposit[mineralTile] = DEPOSIT.minerals;
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
    const spec = RIVAL_SPECS[k]!;
    const anchor = anchors[k]!;
    const colonyIndex = Math.max(1 + k, capacity - count + k);
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
    colRec.spawnQ = anchor.q;
    colRec.spawnR = anchor.r;
    colRec.awayRaids = spec.awayRaids;

    setColonyStock(state, colonyIndex, spec.stock, opts.ctx ? treasuryCtx(tick, opts.ctx) : undefined);
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

    spawnHqUnit(state, { owner: colonyIndex, q: anchor.q - 1, r: anchor.r + 2 });
    startBuildingConstruction(state, { owner: colonyIndex, building: 'commandHub', q: anchor.q, r: anchor.r, instant: true, costOverride: {}, data });
    startBuildingConstruction(state, { owner: colonyIndex, building: 'solar', q: anchor.q + 3, r: anchor.r - 1, instant: true, costOverride: {}, data });
    startBuildingConstruction(state, { owner: colonyIndex, building: 'solar', q: anchor.q + 1, r: anchor.r + 3, instant: true, costOverride: {}, data });
    startBuildingConstruction(state, { owner: colonyIndex, building: 'wind', q: anchor.q + 3, r: anchor.r - 3, instant: true, costOverride: {}, data });
    startBuildingConstruction(state, { owner: colonyIndex, building: 'depot', q: anchor.q - 4, r: anchor.r + 2, instant: true, costOverride: {}, data });
    startBuildingConstruction(state, { owner: colonyIndex, building: 'tradeHub', q: anchor.q - 3, r: anchor.r - 1, instant: true, costOverride: {}, data });
    startBuildingConstruction(state, { owner: colonyIndex, building: 'roboticsFactory', q: anchor.q, r: anchor.r - 3, instant: true, costOverride: {}, data });
    startBuildingConstruction(state, { owner: colonyIndex, building: 'turret', q: anchor.q + 3, r: anchor.r + 1, instant: true, costOverride: {}, data });
    if (spec.persona === 'warlord') {
      startBuildingConstruction(state, { owner: colonyIndex, building: 'turret', q: anchor.q - 4, r: anchor.r, instant: true, costOverride: {}, data });
    }

    spawnWorkerUnit(state, { owner: colonyIndex, q: anchor.q + 2, r: anchor.r - 1, tick, data }, opts.ctx);
    spawnWorkerUnit(state, { owner: colonyIndex, q: anchor.q - 2, r: anchor.r + 1, tick, data }, opts.ctx);
    for (let u = 0; u < spec.recons; u++) {
      produceReconAtFactoryEdge(state, colonyIndex, opts.ctx);
    }

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
