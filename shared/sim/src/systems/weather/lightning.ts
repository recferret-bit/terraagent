import { ENTITY_KIND, ENTITY_STATE } from '../../ecs/columns';
import { setField } from '../../ecs/store';
import { HEX_DIRS, hexDistance, hexIndex } from '../../grid/hex';
import { DEPOSIT, PREP, TERRAIN } from '../../grid/layers';
import { bumpPathEpoch } from '../../grid/tileModel';
import { defineCommandHandler } from '../../kernel/commands';
import type { StepContext } from '../../kernel/context';
import { touchTile, type PlanetState } from '../../kernel/state';
import { cancelMove } from '../../units/movement/orchestrator';
import { occupiesGround } from '../construction/placement';
import { recomputeAllColonyPower } from '../power-core';
import { cancelWorkJobs, getWorkJobsMap } from '../terraform-basic/workJobs';
import {
  distanceToEntityFootprint,
  footprintTilesOfEntity,
  getWeatherState,
  inBounds,
  OFFLINE_OVERLOAD_TICKS,
  resolveDefaultHazardTile,
  resolveHazardTargetTile,
  saveWeatherState,
  type WeatherBlobState,
} from './types';

export interface LightningCommandArgs {
  q?: number;
  r?: number;
  hexCount?: number;
  rain?: boolean;
  colonyIndex?: number;
}

export type LightningStrikeResult =
  | {
      ok: true;
      q: number;
      r: number;
      tiles: Array<{ q: number; r: number }>;
      damagedEntityIds: number[];
      overloadedEntityIds: number[];
      offlineUntilTick: number;
      hitWater: boolean;
    }
  | {
      ok: false;
      code: 'out_of_bounds' | 'invalid_args';
      detail?: string;
    };

function isPowerGridBuildingKind(kind: number): boolean {
  return (
    occupiesGround({ kind, hp: 1, hpMax: 1 }) ||
    kind === ENTITY_KIND.pylon ||
    kind === ENTITY_KIND.solar ||
    kind === ENTITY_KIND.wind ||
    kind === ENTITY_KIND.thermal ||
    kind === ENTITY_KIND.capacitor ||
    kind === ENTITY_KIND.commandHub ||
    kind === ENTITY_KIND.hydro
  );
}

/**
 * Selects `targetCount` (default 4) in-bounds hexes for a lightning strike:
 * `(q, r)` + 3 adjacent ring-1 hexes (`(q+1, r)`, `(q, r+1)`, `(q-1, r+1)`),
 * falling back to remaining ring-1 (and ring-2) neighbors if near the map edge.
 */
export function collectLightningStrikeTiles(
  radius: number,
  q: number,
  r: number,
  targetCount = 4,
): Array<{ q: number; r: number }> {
  const count = Math.max(1, Math.min(19, Math.trunc(targetCount)));
  const candidates: Array<{ q: number; r: number }> = [
    { q, r },
    { q: q + 1, r },
    { q, r: r + 1 },
    { q: q - 1, r: r + 1 },
  ];

  for (const [dq, dr] of HEX_DIRS) {
    candidates.push({ q: q + dq, r: r + dr });
  }
  for (let dr = -2; dr <= 2; dr++) {
    for (let dq = -2; dq <= 2; dq++) {
      if (hexDistance(0, 0, dq, dr) === 2) candidates.push({ q: q + dq, r: r + dr });
    }
  }

  const seen = new Set<string>();
  const out: Array<{ q: number; r: number }> = [];
  for (const c of candidates) {
    if (out.length >= count) break;
    if (!inBounds(radius, c.q, c.r)) continue;
    const key = `${c.q},${c.r}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(c);
  }
  return out;
}

function resolveDefaultLightningTile(state: PlanetState, colonyIndex: number): { q: number; r: number } {
  const e = state.entities, cols = e.cols;
  for (let row = 0; row < e.count; row++) {
    if (cols.owner[row] !== colonyIndex || cols.hp[row] <= 0) continue;
    const k = cols.kind[row];
    if (isPowerGridBuildingKind(k) && k !== ENTITY_KIND.commandHub) {
      if (inBounds(state.grid.radius, cols.q[row], cols.r[row])) {
        return { q: cols.q[row], r: cols.r[row] };
      }
    }
  }
  return resolveDefaultHazardTile(state, colonyIndex, 2, 0);
}

function applyStrikeDamageAndOverload(
  state: PlanetState,
  row: number,
  offlineUntilTick: number,
  tick: number,
  overloadUntilByEntity: Record<number, number>,
  damagedEntityIds: number[],
  overloadedEntityIds: number[],
): void {
  const cols = state.entities.cols;
  const id = cols.id[row];
  const hpMax = cols.hpMax[row] || cols.hp[row] || 100;
  const dmg = Math.max(150, Math.round(hpMax * 0.65));
  const nextHp = Math.max(1, Math.round((cols.hp[row] - dmg) * 100) / 100);

  setField(state.entities, row, 'hp', nextHp, tick);
  setField(state.entities, row, 'state', ENTITY_STATE.offlineOverload, tick);
  overloadUntilByEntity[id] = offlineUntilTick;

  if (!damagedEntityIds.includes(id)) damagedEntityIds.push(id);
  if (!overloadedEntityIds.includes(id)) overloadedEntityIds.push(id);
}

function applyLightningToEntities(
  state: PlanetState,
  q: number,
  r: number,
  strikeKeys: ReadonlySet<string>,
  hitWater: boolean,
  offlineUntilTick: number,
  tick: number,
  overloadUntilByEntity: Record<number, number>,
): { damagedEntityIds: number[]; overloadedEntityIds: number[] } {
  const damagedEntityIds: number[] = [];
  const overloadedEntityIds: number[] = [];
  let hitGridBuilding = false;

  const hx = hexIndex(state.grid.radius);
  const L = state.grid.layers;
  const e = state.entities, cols = e.cols;
  for (let row = 0; row < e.count; row++) {
    if (cols.hp[row] <= 0) continue;
    const fp = footprintTilesOfEntity(state, row);
    const directHit = fp.some((t) => strikeKeys.has(`${t.q},${t.r}`));
    const waterConducted =
      hitWater &&
      (cols.kind[row] === ENTITY_KIND.hydro ||
        fp.some((t) => {
          const idx = hx.indexOf(t.q, t.r);
          return idx >= 0 && (L.terrain[idx] === TERRAIN.shallow || L.terrain[idx] === TERRAIN.deep);
        }));
    if (!directHit && !waterConducted) continue;
    if (isPowerGridBuildingKind(cols.kind[row])) hitGridBuilding = true;
    applyStrikeDamageAndOverload(
      state,
      row,
      offlineUntilTick,
      tick,
      overloadUntilByEntity,
      damagedEntityIds,
      overloadedEntityIds,
    );
  }

  if (!hitGridBuilding) {
    let bestRow = -1;
    let bestDist = Infinity;
    for (let row = 0; row < e.count; row++) {
      if (cols.hp[row] <= 0 || !isPowerGridBuildingKind(cols.kind[row])) continue;
      const dist = distanceToEntityFootprint(state, row, q, r);
      if (dist <= 3 && dist < bestDist) {
        bestDist = dist;
        bestRow = row;
      }
    }
    if (bestRow >= 0) {
      applyStrikeDamageAndOverload(
        state,
        bestRow,
        offlineUntilTick,
        tick,
        overloadUntilByEntity,
        damagedEntityIds,
        overloadedEntityIds,
      );
    }
  }
  return { damagedEntityIds, overloadedEntityIds };
}

function applyLightningToGrid(
  state: PlanetState,
  weather: WeatherBlobState,
  q: number,
  r: number,
  tiles: ReadonlyArray<{ q: number; r: number }>,
  tick: number,
): boolean {
  const hx = hexIndex(state.grid.radius);
  const L = state.grid.layers;
  const depositTier = (L as { depositTier?: Uint8Array }).depositTier;
  const subDeposit = (L as { subDeposit?: Uint8Array }).subDeposit;
  const subRichness = (L as { subRichness?: Float32Array }).subRichness;
  const strikeKeys = new Set(tiles.map((t) => `${t.q},${t.r}`));
  let hitWater = false;
  const landTiles: Array<{ q: number; r: number }> = [];

  for (const t of tiles) {
    const idx = hx.indexOf(t.q, t.r);
    if (idx < 0) continue;

    if (L.terrain[idx] === TERRAIN.deep || L.terrain[idx] === TERRAIN.shallow) {
      hitWater = true;
    } else {
      L.terrain[idx] = TERRAIN.hole;
      L.prep[idx] = PREP.wild;
      if (L.height) {
        const h = L.height[idx] ?? 0;
        L.height[idx] = Math.fround(Math.max(-0.28, Math.min(h - 0.22, -0.20)));
      }
      landTiles.push({ q: t.q, r: t.r });
    }

    if (L.deposit) L.deposit[idx] = DEPOSIT.none;
    if (depositTier) depositTier[idx] = 0;
    if (L.richness) L.richness[idx] = 0;
    if (subDeposit) subDeposit[idx] = DEPOSIT.none;
    if (subRichness) subRichness[idx] = 0;

    touchTile(state, idx, tick);
  }

  for (const wJob of Object.values(getWorkJobsMap(state))) {
    if (strikeKeys.has(`${wJob.q},${wJob.r}`)) {
      cancelWorkJobs(state, wJob.colonyId, { jobId: wJob.jobId }, tick);
    }
  }

  const e = state.entities, cols = e.cols;
  for (let row = 0; row < e.count; row++) {
    if (strikeKeys.has(`${cols.targetQ[row]},${cols.targetR[row]}`)) {
      cancelMove(state, cols.id[row], tick);
    }
  }

  bumpPathEpoch(state.meta);

  if (landTiles.length > 0) {
    const nextSiteId =
      typeof weather.nextLightningSiteId === 'number' && weather.nextLightningSiteId >= 1
        ? weather.nextLightningSiteId
        : 1;
    weather.nextLightningSiteId = nextSiteId + 1;
    const existingSites = (weather.lightningSites ?? []).filter(
      (s) => !(s.q === q && s.r === r) && !s.tiles.some((t) => strikeKeys.has(`${t.q},${t.r}`)),
    );
    weather.lightningSites = [
      ...existingSites,
      {
        id: nextSiteId,
        q,
        r,
        tiles: landTiles,
        tick,
      },
    ];
  }
  return hitWater;
}

function emitLightningEvents(
  state: PlanetState,
  colIdx: number,
  q: number,
  r: number,
  tiles: Array<{ q: number; r: number }>,
  damagedEntityIds: number[],
  overloadedEntityIds: number[],
  ctx?: Partial<Pick<StepContext, 'emit'>>,
): void {
  const colId = state.colonies[colIdx]?.id;
  ctx?.emit?.({
    kind: 'lightningStrike',
    severity: 'warn',
    colonyIds: [colIdx],
    data: {
      planetId: state.meta.planetId,
      ...(colId ? { colonyId: colId } : {}),
      q,
      r,
      damage: 180,
      tiles,
      damagedEntityIds,
      overloadedEntityIds,
      offlineDurationTicks: OFFLINE_OVERLOAD_TICKS,
    },
  });

  if (overloadedEntityIds.length > 0) {
    ctx?.emit?.({
      kind: 'powerOverload',
      severity: 'warn',
      colonyIds: [colIdx],
      data: {
        ...(colId ? { colonyId: colId } : {}),
        pylonId: overloadedEntityIds[0],
        flowPerS: 999,
        maxLoadPerS: 80,
        shedEntityIds: overloadedEntityIds,
      },
    });
  }
}

/** Triggers a 4-hex lightning strike that heavily damages targets and overloads building electricity for 75 ticks. */
export function triggerLightningStrike(
  state: PlanetState,
  args: LightningCommandArgs = {},
  ctx?: Partial<Pick<StepContext, 'tick' | 'data' | 'emit'>>,
): LightningStrikeResult {
  const tick = ctx?.tick ?? state.meta.tick;
  const colIdx = typeof args.colonyIndex === 'number' && args.colonyIndex >= 0 ? args.colonyIndex : 0;
  const resolved = resolveHazardTargetTile(state, args, 'Lightning', () =>
    resolveDefaultLightningTile(state, colIdx),
  );
  if (!resolved.ok) return resolved;
  const { q, r } = resolved;

  const tiles = collectLightningStrikeTiles(state.grid.radius, q, r, args.hexCount ?? 4);
  const strikeKeys = new Set(tiles.map((t) => `${t.q},${t.r}`));
  const offlineUntilTick = tick + OFFLINE_OVERLOAD_TICKS;

  const weather = getWeatherState(state);
  if (args.rain === true) {
    weather.rainLevel = 'heavy';
    weather.rainIntensity = 0.85;
  }

  const hitWater = applyLightningToGrid(state, weather, q, r, tiles, tick);
  const { damagedEntityIds, overloadedEntityIds } = applyLightningToEntities(
    state,
    q,
    r,
    strikeKeys,
    hitWater,
    offlineUntilTick,
    tick,
    weather.overloadUntilByEntity,
  );

  weather.lastLightning = {
    q,
    r,
    tick,
    tiles,
    damagedEntityIds,
    overloadedEntityIds,
    offlineUntilTick,
    hitWater,
  };
  saveWeatherState(state, weather, tick);
  recomputeAllColonyPower(state, ctx?.data, tick);
  emitLightningEvents(state, colIdx, q, r, tiles, damagedEntityIds, overloadedEntityIds, ctx);

  return { ok: true, q, r, tiles, damagedEntityIds, overloadedEntityIds, offlineUntilTick, hitWater };
}

export const devLightningHandler = defineCommandHandler({
  kind: 'dev.lightning',
  wave: 'W05',
  handle(state, cmd, ctx) {
    const args = (cmd.args ?? {}) as LightningCommandArgs;
    const colonyIndex = args.colonyIndex ?? (typeof cmd.colonyIndex === 'number' ? cmd.colonyIndex : 0);
    const res = triggerLightningStrike(state, { ...args, colonyIndex }, ctx);
    if (!res.ok) return { code: res.code, ...(res.detail ? { detail: res.detail } : {}) };
  },
});
