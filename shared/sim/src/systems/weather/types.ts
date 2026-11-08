import { ENTITY_KIND, ENTITY_STATE } from '../../ecs/columns';
import { removeRow, rowOf, setField } from '../../ecs/store';
import { hexDistance, inHex } from '../../grid/hex';
import { bumpPathEpoch } from '../../grid/tileModel';
import type { CompiledDataLike } from '../../kernel/config';
import { setBlob, type PlanetState } from '../../kernel/state';
import { getBuildingJobs, saveBuildingJobs } from '../economy/buildJob';
import { readConstructionOrders, writeConstructionOrders } from '../construction/orders';
import { occupiesGround } from '../construction/placement';
import { getEntityFootprintTiles } from '../power-core/graph';
import { evaluateWindOutput } from '../power-core/windAndCap';
import { removeTerraformOrder } from '../terraform-basic/queue';
import { cancelWorkJobs } from '../terraform-basic/workJobs';
import { cancelMove } from '../../units/movement/orchestrator';
import { getLandingPods } from '../landing';
import { initiateHqRespawn, recordHqColonyDeployed, refreshHqRespawnTargets } from '../landing/hqRespawn';

export const WEATHER_BLOB_KEY = 'weather';
export const OFFLINE_OVERLOAD_TICKS = 75; // 15s at 5 TPS
export const TWISTER_RISE_TICKS = 10; // 2s slowly rising
export const TWISTER_DURATION_TICKS = 50; // 10s total
export const TWISTER_FALL_DELAY_TICKS = 10; // 2s airborne before falling and dying
export const TWISTER_SPEED_HEX_PER_TICK = 0.22; // ~1.1 hexes/sec at 5 TPS
export const TWISTER_MIN_WIND_FACTOR = 1.2; // >= 120% wind

export type SimRainLevel = 'none' | 'minor' | 'heavy';

export interface SuckedUnitRecord {
  id: number;
  kind: number;
  owner: number;
  tier: number;
  q: number;
  r: number;
  suckedAtTick: number;
  fallTick: number;
  dead: boolean;
}

export interface UprootedTreeRecord {
  q: number;
  r: number;
  suckedAtTick: number;
}

export interface ActiveTwisterState {
  id: number;
  startQ: number;
  startR: number;
  x: number; // current axial q float
  y: number; // current axial r float
  dx: number; // axial q velocity per tick
  dy: number; // axial r velocity per tick
  dirRad: number;
  startTick: number;
  riseTicks: number; // e.g. 10 ticks (2s) where twister slowly rises
  durationTicks: number; // e.g. 50 ticks (10s total)
  suckedUnits: SuckedUnitRecord[];
  uprootedTrees: UprootedTreeRecord[];
  damagedEntityIds: number[];
}

export interface MeteorCraterState {
  id: number;
  q: number;
  r: number;
  tiles: Array<{ q: number; r: number }>;
  tick: number;
}

export interface WeatherBlobState {
  rainLevel: SimRainLevel;
  rainIntensity: number; // 0..1 (0 = none, 0.35 = minor, 0.85 = heavy)
  stormActive: boolean;
  nextTwisterId: number;
  activeTwisters: ActiveTwisterState[];
  /** entityId -> tick until which the building remains offline due to lightning electricity overload */
  overloadUntilByEntity: Record<number, number>;
  nextCraterId?: number;
  craters?: MeteorCraterState[];
  nextLightningSiteId?: number;
  lightningSites?: MeteorCraterState[];
  lastMeteor?: {
    q: number;
    r: number;
    tick: number;
    tiles: Array<{ q: number; r: number }>;
    destroyedEntityIds: number[];
  };
  lastLightning?: {
    q: number;
    r: number;
    tick: number;
    tiles: Array<{ q: number; r: number }>;
    damagedEntityIds: number[];
    overloadedEntityIds: number[];
    offlineUntilTick: number;
    hitWater?: boolean;
  };
}

export type WeatherBlob = WeatherBlobState;

export function defaultWeatherState(): WeatherBlobState {
  return {
    rainLevel: 'none',
    rainIntensity: 0,
    stormActive: false,
    nextTwisterId: 1,
    activeTwisters: [],
    overloadUntilByEntity: {},
    nextCraterId: 1,
    craters: [],
    nextLightningSiteId: 1,
    lightningSites: [],
  };
}

/** Reads or initializes the planet's `s.blobs.weather` state as a fresh mutable clone. */
export function getWeatherState(state: PlanetState): WeatherBlobState {
  const rawBlob = state.blobs[WEATHER_BLOB_KEY] as unknown;
  const raw = (
    rawBlob && typeof rawBlob === 'object' && 'value' in rawBlob
      ? (rawBlob as { value?: unknown }).value
      : rawBlob
  ) as Partial<WeatherBlobState> | undefined;
  if (!raw || typeof raw !== 'object') return defaultWeatherState();
  return {
    rainLevel: raw.rainLevel === 'minor' || raw.rainLevel === 'heavy' ? raw.rainLevel : 'none',
    rainIntensity: typeof raw.rainIntensity === 'number' && Number.isFinite(raw.rainIntensity) ? raw.rainIntensity : 0,
    stormActive: Boolean(raw.stormActive),
    nextTwisterId: typeof raw.nextTwisterId === 'number' && raw.nextTwisterId >= 1 ? raw.nextTwisterId : 1,
    activeTwisters: Array.isArray(raw.activeTwisters)
      ? raw.activeTwisters.map((t) => ({
          ...t,
          suckedUnits: Array.isArray(t.suckedUnits) ? t.suckedUnits.map((u) => ({ ...u })) : [],
          uprootedTrees: Array.isArray(t.uprootedTrees) ? t.uprootedTrees.map((tr) => ({ ...tr })) : [],
          damagedEntityIds: Array.isArray(t.damagedEntityIds) ? [...t.damagedEntityIds] : [],
        }))
      : [],
    overloadUntilByEntity: raw.overloadUntilByEntity ? { ...raw.overloadUntilByEntity } : {},
    nextCraterId: typeof raw.nextCraterId === 'number' && raw.nextCraterId >= 1 ? raw.nextCraterId : 1,
    craters: Array.isArray(raw.craters)
      ? raw.craters.map((c) => ({
          id: c.id,
          q: c.q,
          r: c.r,
          tick: c.tick,
          tiles: Array.isArray(c.tiles) ? c.tiles.map((t) => ({ q: t.q, r: t.r })) : [],
        }))
      : [],
    nextLightningSiteId:
      typeof raw.nextLightningSiteId === 'number' && raw.nextLightningSiteId >= 1 ? raw.nextLightningSiteId : 1,
    lightningSites: Array.isArray(raw.lightningSites)
      ? raw.lightningSites.map((c) => ({
          id: c.id,
          q: c.q,
          r: c.r,
          tick: c.tick,
          tiles: Array.isArray(c.tiles) ? c.tiles.map((t) => ({ q: t.q, r: t.r })) : [],
        }))
      : [],
    ...(raw.lastMeteor ? { lastMeteor: { ...raw.lastMeteor, tiles: [...raw.lastMeteor.tiles], destroyedEntityIds: [...raw.lastMeteor.destroyedEntityIds] } } : {}),
    ...(raw.lastLightning
      ? {
          lastLightning: {
            ...raw.lastLightning,
            tiles: [...raw.lastLightning.tiles],
            damagedEntityIds: [...raw.lastLightning.damagedEntityIds],
            overloadedEntityIds: [...raw.lastLightning.overloadedEntityIds],
          },
        }
      : {}),
  };
}

/** Persists `weather` into `s.blobs.weather` and stamps `changedAt = tick` for delta replication. */
export function saveWeatherState(state: PlanetState, weather: WeatherBlobState, tick: number): void {
  setBlob(state, WEATHER_BLOB_KEY, weather, tick);
  refreshHqRespawnTargets(state, tick);
}

/** Returns whether `(q, r)` is within the hexagonal map of `radius`. */
export function inBounds(radius: number, q: number, r: number): boolean {
  return Number.isInteger(q) && Number.isInteger(r) && inHex(q, r, radius);
}

/** Resolves the axial tiles occupied by entity row `row` (1x1 for units/pylons, WxD for buildings). */
export function footprintTilesOfEntity(state: PlanetState, row: number): Array<{ q: number; r: number }> {
  const cols = state.entities.cols;
  const kind = cols.kind[row];
  const q = cols.q[row];
  const r = cols.r[row];
  const defaultSize =
    kind === ENTITY_KIND.commandHub
      ? 3
      : kind === ENTITY_KIND.pylon
        ? 1
        : occupiesGround({ kind, hp: 1, hpMax: 1 })
          ? 2
          : 1;
  const w = cols.footprintW?.[row] || defaultSize;
  const d = cols.footprintD?.[row] || defaultSize;
  if (w <= 1 && d <= 1) return [{ q, r }];
  return getEntityFootprintTiles(q, r, w, d, cols.rot[row]);
}

/** Finds a default in-bounds tile offset by `(dq, dr)` from the colony's Hub/HQ/Pod, falling back to `(0, 0)`. */
export function resolveDefaultHazardTile(
  state: PlanetState,
  colonyIndex: number,
  dq: number,
  dr: number,
): { q: number; r: number } {
  const e = state.entities, cols = e.cols;
  let anchorQ = 0;
  let anchorR = 0;
  let found = false;
  for (let row = 0; row < e.count; row++) {
    if (cols.owner[row] !== colonyIndex || cols.hp[row] <= 0) continue;
    const k = cols.kind[row];
    if (k === ENTITY_KIND.commandHub || k === ENTITY_KIND.hq || k === ENTITY_KIND.pod) {
      anchorQ = cols.q[row];
      anchorR = cols.r[row];
      found = true;
      if (k === ENTITY_KIND.hq || k === ENTITY_KIND.commandHub) break;
    }
  }
  if (!found && e.count > 0) {
    anchorQ = cols.q[0];
    anchorR = cols.r[0];
  }
  const candQ = anchorQ + dq;
  const candR = anchorR + dr;
  if (inBounds(state.grid.radius, candQ, candR)) return { q: candQ, r: candR };
  if (inBounds(state.grid.radius, anchorQ, anchorR)) return { q: anchorQ, r: anchorR };
  return { q: 0, r: 0 };
}

/** Validates explicit `(q, r)` hazard coordinates or resolves a default target via `fallback`. */
export function resolveHazardTargetTile(
  state: PlanetState,
  args: { q?: number; r?: number },
  hazardLabel: string,
  fallback: () => { q: number; r: number },
): { ok: true; q: number; r: number } | { ok: false; code: 'out_of_bounds'; detail: string } {
  if (args.q !== undefined || args.r !== undefined) {
    if (
      typeof args.q !== 'number' ||
      typeof args.r !== 'number' ||
      !Number.isInteger(args.q) ||
      !Number.isInteger(args.r)
    ) {
      return { ok: false, code: 'out_of_bounds', detail: `${hazardLabel} target coordinates must be in-bounds integers` };
    }
    if (!inBounds(state.grid.radius, args.q, args.r)) {
      return { ok: false, code: 'out_of_bounds', detail: `Tile (${args.q}, ${args.r}) is outside the planet` };
    }
    return { ok: true, q: args.q, r: args.r };
  }
  const def = fallback();
  return { ok: true, q: def.q, r: def.r };
}

/** Reads the effective wind factor for `colonyIndex` (1.2 = 120%). */
export function getColonyWindFactor(
  state: PlanetState,
  colonyIndex = 0,
  tick = state.meta.tick,
  data?: CompiledDataLike,
): number {
  const col = state.colonies[colonyIndex] as
    | { windFactorOverride?: number; windFactor?: number; power?: { windFactor?: number } }
    | undefined;
  if (typeof col?.windFactorOverride === 'number' && Number.isFinite(col.windFactorOverride)) {
    return col.windFactorOverride;
  }
  const rawOverride = (state.blobs as Record<string, unknown>).windOverride;
  if (typeof rawOverride === 'number' && Number.isFinite(rawOverride)) {
    return rawOverride;
  }
  if (rawOverride && typeof rawOverride === 'object') {
    const val = (rawOverride as { value?: unknown; factor?: unknown }).value ?? rawOverride;
    if (typeof val === 'number' && Number.isFinite(val)) return val;
    if (val && typeof val === 'object' && typeof (val as { factor?: unknown }).factor === 'number') {
      return (val as { factor: number }).factor;
    }
  }
  const windBlob = state.blobs.wind?.value as { factor?: number; override?: boolean } | undefined;
  if (windBlob && typeof windBlob.factor === 'number' && Number.isFinite(windBlob.factor)) {
    return windBlob.factor;
  }
  if (typeof col?.windFactor === 'number' && Number.isFinite(col.windFactor)) {
    return col.windFactor;
  }
  if (typeof col?.power?.windFactor === 'number' && Number.isFinite(col.power.windFactor)) {
    return col.power.windFactor;
  }
  const evaluated = evaluateWindOutput(state, colonyIndex, tick, data).windFactor;
  return typeof evaluated === 'number' && Number.isFinite(evaluated) ? evaluated : 1.0;
}

/** Destroys an entity in a weather hazard without writing `.x`/`.y`/`.q`/`.r` (SIM-M-01), cleaning up build jobs. */
export function destroyHazardEntity(
  state: PlanetState,
  entityId: number,
  tick: number,
  data?: CompiledDataLike,
): boolean {
  const row = rowOf(state.entities, entityId);
  if (row < 0) return false;
  const cols = state.entities.cols;
  const kind = cols.kind[row];
  if (kind === ENTITY_KIND.pod && cols.state[row] === ENTITY_STATE.descending) return false;
  const owner = cols.owner[row];
  const entQ = cols.q[row];
  const entR = cols.r[row];

  cancelMove(state, entityId, tick);
  cancelWorkJobs(state, undefined, { workerEntityId: entityId }, tick);

  const jobs = getBuildingJobs(state);
  const job = jobs[entityId];
  if (job) {
    if (job.prepOrderId) removeTerraformOrder(state, owner, job.prepOrderId, tick, data);
    delete jobs[entityId];
    saveBuildingJobs(state, jobs, tick);
  }

  const orders = readConstructionOrders(state);
  const matchingOrder = orders.find((o) => o.entityId === entityId);
  if (matchingOrder) {
    if (matchingOrder.linkedPrepOrderId) {
      removeTerraformOrder(state, matchingOrder.colonyId, matchingOrder.linkedPrepOrderId, tick, data);
    }
    writeConstructionOrders(
      state,
      orders.filter((o) => o.entityId !== entityId),
      tick,
    );
  }

  if (state.colonies[owner]?.hubEntityId === entityId) {
    delete state.colonies[owner].hubEntityId;
  }

  if (kind === ENTITY_KIND.pod) {
    recordHqColonyDeployed(state, owner, entQ, entR, tick);
    const pods = getLandingPods(state);
    const nextPods = pods.filter((p) => p.podEntityId !== entityId);
    if (nextPods.length !== pods.length) {
      setBlob(state, 'landingPods', nextPods, tick);
    }
  }

  setField(state.entities, row, 'hp', 0, tick);
  setField(state.entities, row, 'state', ENTITY_STATE.inert, tick);
  removeRow(state.entities, entityId, tick);
  if (kind === ENTITY_KIND.hq) {
    recordHqColonyDeployed(state, owner, entQ, entR, tick, true);
    initiateHqRespawn(state, owner, entQ, entR, tick);
  }
  bumpPathEpoch(state.meta);
  return true;
}

/** Minimum hex distance between `(q, r)` and any footprint tile of entity at `row`. */
export function distanceToEntityFootprint(state: PlanetState, row: number, q: number, r: number): number {
  let best = Infinity;
  for (const t of footprintTilesOfEntity(state, row)) {
    const d = hexDistance(q, r, t.q, t.r);
    if (d < best) best = d;
  }
  return best;
}
