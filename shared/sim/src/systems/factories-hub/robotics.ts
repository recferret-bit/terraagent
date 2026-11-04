import { dataRow, type CompiledRow } from '../../data';
import { ENTITY_KIND, ENTITY_STATE } from '../../ecs/columns';
import { placeSpawnedEntity } from '../../ecs/placement';
import { insertRow, rowOf } from '../../ecs/store';
import { hexDistance, hexIndex } from '../../grid/hex';
import { PREP, TERRAIN } from '../../grid/layers';
import type { CompiledDataLike } from '../../kernel/config';
import type { StepContext } from '../../kernel/context';
import { setBlob, type PlanetState } from '../../kernel/state';
import { buildingFootprints } from '../construction/occupancy';
import { colonyWho } from '../find';
import { withoutUnitView } from '../harvest/unit';
import { revealVision } from '../hq';
import type { QueueEntry } from '../queue/types';
import { issueUnitCommand } from '../units';
import { defaultHubData } from './unit';

export const ROBOTICS_PRODUCER_BUFFER_LIMIT = 5;

export interface ReconUnitView {
  entityId: number;
  kind: number;
  unit: 'recon';
  label: string;
  archetype: string;
  owner: number;
  tier: number;
  q: number;
  r: number;
  x: number;
  y: number;
  hp: number;
  hpMax: number;
  supply: number;
  powerDrainPerS: number;
  speedTilesPerS: number;
  designSpeedTilesPerS: number;
  viewRadius: number;
  radius: number;
  cost: Record<string, number>;
  buildS: number;
  designBuildS: number;
  targetQ: number;
  targetR: number;
  state: number;
}

interface RallyPointsBlob {
  byEntityId?: Record<number, { q: number; r: number }>;
  byColony?: Record<number, { q: number; r: number }>;
  pendingMoves?: Array<{ entityId: number; q: number; r: number }>;
}

export function resolveReconRow(data?: CompiledDataLike): CompiledRow {
  const table = data?.tables?.combatUnits as Record<string, CompiledRow> | undefined;
  if (table?.recon) return table.recon;
  return dataRow(defaultHubData(), 'combatUnits', 'recon');
}

export function resolveRoboticsFactoryRow(data?: CompiledDataLike): CompiledRow {
  const table = data?.tables?.combatUnits as Record<string, CompiledRow> | undefined;
  if (table?.roboticsFactory) return table.roboticsFactory;
  return dataRow(defaultHubData(), 'combatUnits', 'roboticsFactory');
}

export function findColonyRoboticsFactories(state: PlanetState, owner: number): number[] {
  const e = state.entities, cols = e.cols;
  const rows: number[] = [];
  for (let row = 0; row < e.count; row++) {
    if (cols.owner[row] !== owner || cols.kind[row] !== ENTITY_KIND.roboticsFactory) continue;
    if (cols.hp[row] <= 0) continue;
    if (cols.state[row] === ENTITY_STATE.constructing || cols.state[row] === ENTITY_STATE.inert) continue;
    rows.push(row);
  }
  return rows;
}

function countProducerLoad(
  activeUnitsLane: readonly QueueEntry[],
  producerId: number,
  isSoleFactory: boolean,
): number {
  let count = 0;
  for (const e of activeUnitsLane) {
    if (e.task.kind !== 'buildUnit') continue;
    if (e.task.producerId === producerId) count++;
    else if (isSoleFactory && e.task.producerId === undefined && e.task.unit === 'recon') count++;
  }
  return count;
}

export function selectRoboticsFactoryProducer(
  state: PlanetState,
  owner: number,
  activeUnitsLane: readonly QueueEntry[],
  preferredProducerId?: number,
): { ok: true; producerId?: number } | { ok: false; code: 'queue_full' | 'invalid_args'; detail: string } {
  const cols = state.entities.cols;
  const factoryRows = findColonyRoboticsFactories(state, owner);
  if (preferredProducerId !== undefined) {
    const pRow = rowOf(state.entities, preferredProducerId);
    if (
      pRow >= 0 &&
      (cols.owner[pRow] !== owner ||
        cols.kind[pRow] !== ENTITY_KIND.roboticsFactory ||
        cols.hp[pRow] <= 0 ||
        cols.state[pRow] === ENTITY_STATE.constructing ||
        cols.state[pRow] === ENTITY_STATE.inert)
    ) {
      return { ok: false, code: 'invalid_args', detail: 'invalid robotics factory producer' };
    }
    const load = countProducerLoad(activeUnitsLane, preferredProducerId, factoryRows.length === 1 && cols.id[factoryRows[0]] === preferredProducerId);
    if (load >= ROBOTICS_PRODUCER_BUFFER_LIMIT) {
      return { ok: false, code: 'queue_full', detail: 'producer buffer full' };
    }
    return { ok: true, producerId: preferredProducerId };
  }

  if (factoryRows.length === 0) {
    const unassignedRecon = activeUnitsLane.filter((e) => e.task.kind === 'buildUnit' && e.task.unit === 'recon' && e.task.producerId === undefined).length;
    if (unassignedRecon >= ROBOTICS_PRODUCER_BUFFER_LIMIT) {
      return { ok: false, code: 'queue_full', detail: 'producer buffer full' };
    }
    return { ok: true, producerId: undefined };
  }

  const candidates = factoryRows
    .map((r) => ({
      id: cols.id[r],
      online: cols.state[r] === ENTITY_STATE.active || cols.state[r] === ENTITY_STATE.idle,
      load: countProducerLoad(activeUnitsLane, cols.id[r], factoryRows.length === 1),
    }))
    .filter((c) => c.load < ROBOTICS_PRODUCER_BUFFER_LIMIT)
    .sort((a, b) => {
      if (a.online !== b.online) return a.online ? -1 : 1;
      if (a.load !== b.load) return a.load - b.load;
      return a.id - b.id;
    });

  if (candidates.length === 0) {
    return { ok: false, code: 'queue_full', detail: 'producer buffer full' };
  }
  return { ok: true, producerId: candidates[0].id };
}

export function setFactoryRallyPoint(
  state: PlanetState,
  colonyIndex: number,
  q: number,
  r: number,
  producerId?: number,
  tick: number = state.meta.tick,
): { q: number; r: number } {
  const prev = (state.blobs.rallyPoints?.value as RallyPointsBlob | undefined) ?? {};
  const byEntityId = { ...(prev.byEntityId ?? {}) };
  const byColony = { ...(prev.byColony ?? {}) };
  const pt = { q, r };
  if (producerId !== undefined) byEntityId[producerId] = pt;
  byColony[colonyIndex] = pt;
  setBlob(state, 'rallyPoints', { byEntityId, byColony }, tick);
  const col = state.colonies[colonyIndex];
  if (col) {
    (col as { rallyPoint?: { q: number; r: number } }).rallyPoint = pt;
    col.changedAt = tick;
  }
  return pt;
}

export function getFactoryRallyPoint(
  state: PlanetState,
  colonyIndex: number,
  producerId?: number,
): { q: number; r: number } | null {
  const blob = state.blobs.rallyPoints?.value as RallyPointsBlob | undefined;
  if (producerId !== undefined && blob?.byEntityId?.[producerId]) {
    return blob.byEntityId[producerId];
  }
  const col = state.colonies[colonyIndex] as { rallyPoint?: { q: number; r: number } } | undefined;
  if (col?.rallyPoint && typeof col.rallyPoint.q === 'number' && typeof col.rallyPoint.r === 'number') {
    return { q: col.rallyPoint.q, r: col.rallyPoint.r };
  }
  if (blob?.byColony?.[colonyIndex]) {
    return blob.byColony[colonyIndex];
  }
  if (producerId === undefined && blob?.byEntityId) {
    for (const r of findColonyRoboticsFactories(state, colonyIndex)) {
      const id = state.entities.cols.id[r];
      if (blob.byEntityId[id]) return blob.byEntityId[id];
    }
  }
  return null;
}

function buildPerimeterCandidates(facQ: number, facR: number, facW: number, facD: number): Array<{ q: number; r: number }> {
  const minQ = -Math.floor((facW - 1) / 2), maxQ = minQ + facW - 1;
  const minR = -Math.floor((facD - 1) / 2), maxR = minR + facD - 1;
  const ringDist = Math.max(1, maxQ + 1);
  const candidates: Array<{ q: number; r: number }> = [
    { q: facQ + maxQ + 1, r: facR },
    { q: facQ + maxQ + 1, r: facR - 1 },
    { q: facQ, r: facR + maxR + 1 },
    { q: facQ + minQ - 1, r: facR },
    { q: facQ, r: facR + minR - 1 },
    { q: facQ + minQ - 1, r: facR + 1 },
  ];
  for (let dr = minR - 1; dr <= maxR + 1; dr++) {
    for (let dq = minQ - 1; dq <= maxQ + 1; dq++) {
      if (dq >= minQ && dq <= maxQ && dr >= minR && dr <= maxR) continue;
      if (hexDistance(0, 0, dq, dr) === ringDist) {
        candidates.push({ q: facQ + dq, r: facR + dr });
      }
    }
  }
  for (let dr = minR - 1; dr <= maxR + 1; dr++) {
    for (let dq = minQ - 1; dq <= maxQ + 1; dq++) {
      if (dq >= minQ && dq <= maxQ && dr >= minR && dr <= maxR) continue;
      candidates.push({ q: facQ + dq, r: facR + dr });
    }
  }
  return candidates;
}

export function findFactoryEdgeSpawnTile(
  state: PlanetState,
  owner: number,
  producerId?: number,
  data?: CompiledDataLike,
): { q: number; r: number; producerRow: number; producerEntityId?: number } {
  const e = state.entities, cols = e.cols;
  let producerRow = -1;
  if (producerId !== undefined) {
    const r = rowOf(e, producerId);
    if (r >= 0 && cols.owner[r] === owner && cols.hp[r] > 0) producerRow = r;
  }
  if (producerRow < 0) {
    const factories = findColonyRoboticsFactories(state, owner);
    producerRow = factories.find((r) => cols.state[r] === ENTITY_STATE.active || cols.state[r] === ENTITY_STATE.idle) ?? factories[0] ?? -1;
  }
  if (producerRow < 0) {
    for (let r = 0; r < e.count; r++) {
      if (cols.owner[r] === owner && (cols.kind[r] === ENTITY_KIND.commandHub || cols.kind[r] === ENTITY_KIND.hq) && cols.hp[r] > 0) {
        producerRow = r;
        break;
      }
    }
  }
  const facQ = producerRow >= 0 ? cols.q[producerRow] : 0;
  const facR = producerRow >= 0 ? cols.r[producerRow] : 0;
  const defaultSpan = producerRow >= 0 && cols.kind[producerRow] === ENTITY_KIND.hq ? 1 : 3;
  const facW = (producerRow >= 0 ? cols.footprintW[producerRow] : 0) || defaultSpan;
  const facD = (producerRow >= 0 ? cols.footprintD[producerRow] : 0) || defaultSpan;
  const producerEntityId = producerRow >= 0 ? cols.id[producerRow] : producerId;

  const idx = hexIndex(state.grid.radius);
  const occupied = new Set<number>();
  for (const fp of buildingFootprints(state, data)) {
    for (const i of fp) occupied.add(i);
  }
  for (let r = 0; r < e.count; r++) {
    if (cols.kind[r] !== ENTITY_KIND.roboticsFactory || cols.hp[r] <= 0) continue;
    const w = cols.footprintW[r] || 3, d = cols.footprintD[r] || 3;
    const minQ = -Math.floor((w - 1) / 2), minR = -Math.floor((d - 1) / 2);
    for (let dr = minR; dr < minR + d; dr++) {
      for (let dq = minQ; dq < minQ + w; dq++) {
        const ti = idx.indexOf(cols.q[r] + dq, cols.r[r] + dr);
        if (ti >= 0) occupied.add(ti);
      }
    }
  }

  const layers = state.grid.layers;
  const candidates = buildPerimeterCandidates(facQ, facR, facW, facD);
  for (const c of candidates) {
    const t = idx.indexOf(c.q, c.r);
    if (
      t >= 0 &&
      !occupied.has(t) &&
      layers.terrain[t] !== TERRAIN.deep &&
      layers.terrain[t] !== TERRAIN.hole &&
      layers.prep[t] !== PREP.ridge &&
      layers.prep[t] !== PREP.moat
    ) {
      return { q: c.q, r: c.r, producerRow, producerEntityId };
    }
  }
  return { q: facQ + Math.floor(facW / 2) + 1, r: facR, producerRow, producerEntityId };
}

export function syncReconView(
  state: PlanetState,
  row: number,
  tick: number,
  data?: CompiledDataLike,
): ReconUnitView {
  const cols = state.entities.cols;
  const rRow = resolveReconRow(data);
  const unitView: ReconUnitView = {
    entityId: cols.id[row],
    kind: cols.kind[row],
    unit: 'recon',
    label: String(rRow.label ?? 'Recon Drone'),
    archetype: String(rRow.archetype ?? 'unit.recon'),
    owner: cols.owner[row],
    tier: cols.tier[row],
    q: cols.q[row],
    r: cols.r[row],
    x: cols.x[row],
    y: cols.y[row],
    hp: cols.hp[row],
    hpMax: cols.hpMax[row],
    supply: Number(rRow.supply ?? 1),
    powerDrainPerS: Number(rRow.powerDrainPerS ?? 2),
    speedTilesPerS: Number(rRow.designSpeed ?? 3.5),
    designSpeedTilesPerS: Number(rRow.designSpeed ?? 3.5),
    viewRadius: Number(rRow.viewRadius ?? 8),
    radius: Number(rRow.radius ?? 0.35),
    cost: { ...((rRow.cost ?? {}) as Record<string, number>) },
    buildS: Number(rRow.buildS ?? 50),
    designBuildS: Number(rRow.designBuildS ?? 10),
    targetQ: cols.targetQ[row],
    targetR: cols.targetR[row],
    state: cols.state[row],
  };
  const prevObj = (state.blobs.units?.value as Record<string, unknown> | undefined) ?? {};
  prevObj[unitView.entityId] = unitView;
  setBlob(state, 'units', prevObj, tick);
  const owner = cols.owner[row];
  if (owner >= 0 && state.colonies[owner]) {
    const col = state.colonies[owner];
    col.units = [...withoutUnitView(col.units, unitView.entityId), unitView];
    col.changedAt = tick;
  }
  return unitView;
}

export function flushPendingRallyMoves(state: PlanetState, ctx: StepContext): void {
  const blob = state.blobs.rallyPoints?.value as RallyPointsBlob | undefined;
  const pending = blob?.pendingMoves;
  if (!pending || pending.length === 0) return;
  setBlob(
    state,
    'rallyPoints',
    { byEntityId: blob.byEntityId ?? {}, byColony: blob.byColony ?? {} },
    ctx.tick,
  );
  const cols = state.entities.cols;
  for (const m of pending) {
    const row = rowOf(state.entities, m.entityId);
    if (row < 0 || cols.hp[row] <= 0) continue;
    cols.targetQ[row] = m.q;
    cols.targetR[row] = m.r;
    cols.state[row] = ENTITY_STATE.moving;
    cols.changedAt[row] = ctx.tick;
    issueUnitCommand(state, row, { kind: 'move', source: 'player', q: m.q, r: m.r }, ctx);
    syncReconView(state, row, ctx.tick, ctx.data);
  }
}

export function produceReconAtFactoryEdge(
  state: PlanetState,
  owner: number,
  ctx?: StepContext,
  producerId?: number,
): number | null {
  const tick = ctx?.tick ?? state.meta.tick;
  const data = ctx?.data ?? defaultHubData();
  const reconRow = resolveReconRow(data);
  const spawn = findFactoryEdgeSpawnTile(state, owner, producerId, data);
  const entityId = ctx ? ctx.newEntityId() : state.meta.nextEntityId++;
  const row = insertRow(state.entities, entityId, tick);
  const cols = state.entities.cols;
  const hp = Math.fround(Number(reconRow.hp ?? 160));

  cols.kind[row] = ENTITY_KIND.recon;
  cols.owner[row] = owner;
  cols.tier[row] = Number(reconRow.tier ?? 1);
  placeSpawnedEntity(state.entities, row, spawn.q, spawn.r, tick);
  cols.rot[row] = 0;
  cols.hp[row] = hp;
  cols.hpMax[row] = hp;
  cols.state[row] = ENTITY_STATE.idle;
  cols.progress[row] = 0;
  cols.targetQ[row] = spawn.q;
  cols.targetR[row] = spawn.r;
  cols.workRate[row] = 1.0;
  cols.createdAt[row] = tick;
  cols.changedAt[row] = tick;

  revealVision(state, owner, spawn.q, spawn.r, Number(reconRow.viewRadius ?? 8), tick);

  const rally = getFactoryRallyPoint(state, owner, spawn.producerEntityId);
  if (rally && (rally.q !== spawn.q || rally.r !== spawn.r)) {
    cols.targetQ[row] = rally.q;
    cols.targetR[row] = rally.r;
    if (ctx && ctx.flags.has('W02')) {
      const prev = (state.blobs.rallyPoints?.value as RallyPointsBlob | undefined) ?? {};
      const pendingMoves = [...(prev.pendingMoves ?? []), { entityId, q: rally.q, r: rally.r }];
      setBlob(state, 'rallyPoints', { ...prev, pendingMoves }, tick);
    } else {
      const stepCtx: StepContext = ctx ?? {
        dt: 1,
        tick,
        flags: new Set(['W00', 'W01', 'W02', 'W03', 'W07']),
        data,
        events: [],
        postings: [],
        record: () => {},
        rng: (s) => state.rng[s],
        newEntityId: () => state.meta.nextEntityId++,
        emit: () => {},
      };
      cols.state[row] = ENTITY_STATE.moving;
      issueUnitCommand(state, row, { kind: 'move', source: 'player', q: rally.q, r: rally.r }, stepCtx);
    }
  }

  syncReconView(state, row, tick, data);

  if (ctx) {
    const { colonyIdStr, who } = colonyWho(state, owner);
    ctx.emit({
      kind: 'unitProduced',
      colonyIds: [colonyIdStr],
      data: {
        ...who,
        colonyIndex: owner,
        tick,
        entityId,
        unit: 'recon',
        unitKind: 'recon',
        ...(spawn.producerEntityId !== undefined ? { producerId: spawn.producerEntityId } : {}),
        q: spawn.q,
        r: spawn.r,
      },
    });
  }

  return entityId;
}
