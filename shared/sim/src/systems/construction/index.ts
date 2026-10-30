import type { RejectCode } from '@terra/contracts';
import { ENTITY_KIND, ENTITY_STATE } from '../../ecs/columns';
import { insertRow } from '../../ecs/store';
import { defineCommandHandler } from '../../kernel/commands';
import type { StepContext } from '../../kernel/context';
import { setBlob, type PlanetState, type SimState } from '../../kernel/state';
import { defineSystem } from '../../kernel/system';
import { defineSimModule } from '../define';
import {
  checkBuildingAffordability,
  findAliveColonyHqRow,
  getBuildingFootprintTiles,
  getHubFootprintTiles,
  hasColonyHub,
  isHubBuildingKind,
  resolveHubT1Row,
  validateBuildingPlacement,
  validateHubPlacement,
  type BuildingAffordabilityResult,
  type FootprintTileInfo,
  type ValidateHubPlacementOpts,
  type ValidateHubPlacementResult,
} from './validate';

export {
  checkBuildingAffordability,
  findAliveColonyHqRow,
  getBuildingFootprintTiles,
  getHubFootprintTiles,
  hasColonyHub,
  isHubBuildingKind,
  resolveHubT1Row,
  validateBuildingPlacement,
  validateHubPlacement,
  type BuildingAffordabilityResult,
  type FootprintTileInfo,
  type ValidateHubPlacementOpts,
  type ValidateHubPlacementResult,
};

export interface ConstructionOrder {
  orderId: string;
  colonyId: number;
  building: string;
  tier: number;
  entityId: number;
  q: number;
  r: number;
  footprint: number;
  status: 'waiting_site' | 'waiting_resources' | 'in_progress' | 'completed' | 'cancelled';
  waitingReason?: string;
  preparedTiles: number;
  totalTiles: number;
  progress: number;
  buildTimeS: number;
  createdAtTick: number;
}

export interface PlaceBuildingArgs {
  building?: string;
  buildingKind?: string;
  kind?: string;
  archetype?: string;
  q?: number;
  r?: number;
  tier?: number;
  builderEntityId?: number;
  entityId?: number;
  unitId?: number;
}

function parsePlaceBuildingArgs(raw: unknown): {
  buildingKind?: string;
  q?: number;
  r?: number;
  tier?: number;
  builderEntityId?: number;
} {
  if (typeof raw !== 'object' || raw === null) return {};
  const obj = raw as PlaceBuildingArgs;
  const buildingKind =
    typeof obj.building === 'string'
      ? obj.building
      : typeof obj.buildingKind === 'string'
        ? obj.buildingKind
        : typeof obj.kind === 'string'
          ? obj.kind
          : typeof obj.archetype === 'string'
            ? obj.archetype
            : undefined;
  const q = typeof obj.q === 'number' ? obj.q : undefined;
  const r = typeof obj.r === 'number' ? obj.r : undefined;
  const tier = typeof obj.tier === 'number' ? obj.tier : undefined;
  const builderEntityId =
    typeof obj.builderEntityId === 'number'
      ? obj.builderEntityId
      : typeof obj.entityId === 'number'
        ? obj.entityId
        : typeof obj.unitId === 'number'
          ? obj.unitId
          : undefined;
  return { buildingKind, q, r, tier, builderEntityId };
}

function readConstructionOrders(state: SimState): ConstructionOrder[] {
  const raw = state.blobs.constructionQueue?.value ?? state.blobs.constructionQueue;
  if (Array.isArray(raw)) return raw as ConstructionOrder[];
  if (raw && typeof raw === 'object' && Array.isArray((raw as { orders?: unknown }).orders)) {
    return (raw as { orders: ConstructionOrder[] }).orders;
  }
  return [];
}

function writeConstructionOrders(state: SimState, orders: ConstructionOrder[], tick: number): void {
  const byColony: Record<number, ConstructionOrder[]> = {};
  for (const o of orders) {
    const list = byColony[o.colonyId] ?? (byColony[o.colonyId] = []);
    list.push(o);
  }
  setBlob(state, 'constructionQueue', { orders, byColony }, tick);
}

/** Returns all queued/active construction orders for `colonyId` (or all colonies when omitted). */
export function getConstructionOrders(state: SimState, colonyId?: number): ConstructionOrder[] {
  const all = readConstructionOrders(state);
  return colonyId === undefined ? all : all.filter((o) => o.colonyId === colonyId);
}

export interface PlaceHubResult {
  ok: boolean;
  reason?: RejectCode;
  entityId?: number;
  order?: ConstructionOrder;
  validation: ValidateHubPlacementResult;
}

/**
 * Validates and places a Command Hub (or structure) at `(opts.q, opts.r)` for `opts.colonyId`.
 * Spawns the pending Hub entity (`ENTITY_STATE.waiting` if tiles are unprepared, else `ENTITY_STATE.constructing`).
 */
export function placeBuildingOrder(
  state: PlanetState,
  opts: ValidateHubPlacementOpts & { orderId?: string; tick?: number },
  ctx?: Partial<StepContext>,
): PlaceHubResult {
  const validation = validateBuildingPlacement(state, {
    ...opts,
    data: opts.data ?? ctx?.data,
  });
  if (!validation.ok) {
    return { ok: false, reason: validation.reason ?? 'site_blocked', validation };
  }

  const hubRow = resolveHubT1Row(opts.data ?? ctx?.data);
  const colStock =
    state.colonies[opts.colonyId]?.stock ??
    (state.blobs.colonyStock?.value as Record<number | string, Record<string, number>> | undefined)?.[opts.colonyId];
  if (colStock !== undefined || opts.checkResources) {
    const cost = hubRow.cost as Record<string, number> | undefined;
    if (cost) {
      const afford = checkBuildingAffordability(cost, colStock as Record<string, number> | undefined);
      if (!afford.ok) {
        return {
          ok: false,
          reason: 'insufficient_resources',
          validation: {
            ...validation,
            ok: false,
            reason: 'insufficient_resources',
          },
        };
      }
    }
  }

  const tick = opts.tick ?? ctx?.tick ?? state.meta.tick;
  const isHub = isHubBuildingKind(opts.buildingKind);
  const entityId = ctx?.newEntityId ? ctx.newEntityId() : state.meta.nextEntityId++;
  const row = insertRow(state.entities, entityId, tick);
  const cols = state.entities.cols;
  const hp = Math.fround(Number(hubRow.hp ?? 1500));

  cols.kind[row] = isHub ? ENTITY_KIND.hub : ENTITY_KIND.hub;
  cols.owner[row] = opts.colonyId;
  cols.tier[row] = opts.tier ?? Number(hubRow.tier ?? 1);
  cols.q[row] = opts.q;
  cols.r[row] = opts.r;
  cols.x[row] = Math.fround(opts.q);
  cols.y[row] = Math.fround(opts.r);
  cols.rot[row] = 0;
  cols.hp[row] = hp;
  cols.hpMax[row] = hp;
  cols.state[row] = validation.unpreparedCount > 0 ? ENTITY_STATE.waiting : ENTITY_STATE.constructing;
  cols.progress[row] = 0;
  cols.targetQ[row] = opts.q;
  cols.targetR[row] = opts.r;
  cols.createdAt[row] = tick;
  cols.changedAt[row] = tick;

  const totalTiles = validation.tiles.length;
  const preparedTiles = validation.preparedCount;
  const existing = readConstructionOrders(state);
  const orderId = opts.orderId ?? `build_${opts.colonyId}_${tick}_${existing.length + 1}`;
  const order: ConstructionOrder = {
    orderId,
    colonyId: opts.colonyId,
    building: opts.buildingKind ?? 'commandHub',
    tier: opts.tier ?? 1,
    entityId,
    q: opts.q,
    r: opts.r,
    footprint: isHub ? 3 : 1,
    status: validation.unpreparedCount > 0 ? 'waiting_site' : 'in_progress',
    ...(validation.unpreparedCount > 0
      ? { waitingReason: `waiting(site: ${preparedTiles}/${totalTiles})` }
      : {}),
    preparedTiles,
    totalTiles,
    progress: 0,
    buildTimeS: Number(hubRow.designBuildS ?? hubRow.buildTimeS ?? 30),
    createdAtTick: tick,
  };
  writeConstructionOrders(state, [...existing, order], tick);

  return { ok: true, entityId, order, validation };
}

export const placeBuilding = defineCommandHandler({
  kind: 'placeBuilding',
  wave: 'W01',
  handle(state, cmd, ctx) {
    const colonyId = cmd.colonyIndex ?? (cmd as { colony?: number }).colony ?? 0;
    const parsed = parsePlaceBuildingArgs(cmd.args);
    if (typeof parsed.q !== 'number' || typeof parsed.r !== 'number') {
      return 'invalid_args';
    }
    const res = placeBuildingOrder(
      state,
      {
        colonyId,
        q: parsed.q,
        r: parsed.r,
        buildingKind: parsed.buildingKind ?? 'commandHub',
        tier: parsed.tier,
        builderEntityId: parsed.builderEntityId,
        orderId: cmd.commandId,
        tick: ctx.tick,
        data: ctx.data,
      },
      ctx,
    );
    if (!res.ok) return res.reason ?? 'site_blocked';
  },
});

/** Steps building construction state (expanded in W01-15 linked prep and W01-16 Hub construction). */
export function stepConstruction(_state: PlanetState, _ctx?: Partial<StepContext>): void {
  // Linked prep (W01-15) and construction progress (W01-16) extend this system.
}

export const construction = defineSystem({
  id: 'construction',
  slot: 6,
  wave: 'W01',
  run(state, ctx) {
    stepConstruction(state, ctx);
  },
});

export default defineSimModule({
  id: 'construction',
  wave: 'W01',
  systems: [construction],
  handlers: [placeBuilding],
});
