import { dataRow, type CompiledRow } from '../../data';
import { ENTITY_KIND, ENTITY_STATE } from '../../ecs/columns';
import { insertRow, rowOf, setField } from '../../ecs/store';
import { getSpawnSlots } from '../../gen/spawnSlots';
import { defineCommandHandler, type SimCommand } from '../../kernel/commands';
import type { CompiledDataLike } from '../../kernel/config';
import { TICKS_PER_SECOND } from '../../kernel/constants';
import type { StepContext } from '../../kernel/context';
import { setBlob, type ColonyState, type PlanetState, type SimState } from '../../kernel/state';
import { defineSystem } from '../../kernel/system';
import { defineSimModule } from '../define';
import { defaultW01Data, resolveHqT1Row, revealVision, spawnHqUnit } from '../hq';

export type SystemCtx = StepContext;

export interface ColonyCaps {
  metals: number;
  minerals: number;
  energy: number;
  bio: number;
  item: number;
}

export interface LandingPodState {
  podEntityId: number;
  colonyId: number;
  q: number;
  r: number;
  ticksRemaining: number;
  totalTicks: number;
  deployed: boolean;
}

export interface SpawnColonyLandingOpts {
  colonyId: number;
  colonyIdStr?: string;
  playerId?: string;
  handle?: string;
  name?: string;
  color?: number;
  slotIndex?: number;
  q?: number;
  r?: number;
  tick?: number;
  data?: CompiledDataLike;
}

const DEFAULT_COLONY_COLORS = [0xff6a2a, 0x2ec4b6, 0xe71d36, 0xff9f1c, 0x8338ec, 0x3a86ff] as const;

const INITIAL_CAPS: ColonyCaps = {
  metals: 600,
  minerals: 500,
  energy: 0,
  bio: 500,
  item: 0,
};

export function resolveStartingKitRow(data?: CompiledDataLike): CompiledRow {
  const table = data?.tables.hq as Record<string, CompiledRow> | undefined;
  if (table?.startingKit) return table.startingKit;
  return dataRow(defaultW01Data(), 'hq', 'startingKit');
}

function resolveDescentTicks(kit: CompiledRow): number {
  const raw = Number(kit.podDescentS ?? 30);
  const design = typeof kit.designPodDescentS === 'number' ? kit.designPodDescentS : undefined;
  if (design !== undefined && raw !== design) {
    return Math.max(1, Math.round(raw));
  }
  return Math.max(1, Math.round(raw * TICKS_PER_SECOND));
}

function ensureColony(
  state: SimState,
  colonyId: number,
  tick: number,
  meta?: { id?: string; playerId?: string; handle?: string; name?: string; color?: number },
): ColonyState {
  while (state.colonies.length <= colonyId) {
    const idx = state.colonies.length;
    state.colonies.push({
      index: idx,
      id: `col_${idx}`,
      name: `Colony ${idx + 1}`,
      color: DEFAULT_COLONY_COLORS[idx % DEFAULT_COLONY_COLORS.length],
      status: 'founding',
      changedAt: tick,
    });
  }
  const col = state.colonies[colonyId];
  if (meta?.id) col.id = meta.id;
  if (meta?.name) col.name = meta.name;
  if (meta?.playerId !== undefined) col.playerId = meta.playerId;
  if (meta?.handle !== undefined) col.handle = meta.handle;
  if (typeof meta?.color === 'number') col.color = meta.color;
  col.changedAt = tick;
  return col;
}

function summarizeResources(stock: Record<string, number>): {
  metals: number;
  minerals: number;
  biomass: number;
  water: number;
} {
  return {
    metals: (stock['metals.t1'] ?? 0) + (stock['metals.t2'] ?? 0) + (stock['metals.t3'] ?? 0),
    minerals: (stock['minerals.t1'] ?? 0) + (stock['minerals.t2'] ?? 0) + (stock['minerals.t3'] ?? 0),
    biomass: stock['bio.biomass'] ?? 0,
    water: stock['bio.water'] ?? 0,
  };
}

function readStockBlob(state: SimState): Record<number, Record<string, number>> {
  const raw = state.blobs.colonyStock?.value;
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    return raw as Record<number, Record<string, number>>;
  }
  return {};
}

export function getColonyStock(state: SimState, colonyId: number): Record<string, number> {
  const blobMap = readStockBlob(state);
  if (blobMap[colonyId]) return { ...blobMap[colonyId] };
  const colStock = state.colonies[colonyId]?.stock;
  if (colStock && typeof colStock === 'object' && !Array.isArray(colStock)) {
    return { ...(colStock as Record<string, number>) };
  }
  return {};
}

export function setColonyStock(state: SimState, colonyId: number, stock: Record<string, number>): void {
  const tick = state.meta.tick;
  const col = ensureColony(state, colonyId, tick);
  const next = { ...stock };
  col.stock = next;
  col.resources = summarizeResources(next);
  col.changedAt = tick;
  const blobMap = { ...readStockBlob(state), [colonyId]: next };
  setBlob(state, 'colonyStock', blobMap, tick);
}

export function getColonyCaps(state: SimState, colonyId: number): ColonyCaps {
  const col = state.colonies[colonyId];
  const raw = col?.caps as Partial<ColonyCaps> | undefined;
  return {
    metals: typeof raw?.metals === 'number' ? raw.metals : INITIAL_CAPS.metals,
    minerals: typeof raw?.minerals === 'number' ? raw.minerals : INITIAL_CAPS.minerals,
    energy: typeof raw?.energy === 'number' ? raw.energy : INITIAL_CAPS.energy,
    bio: typeof raw?.bio === 'number' ? raw.bio : INITIAL_CAPS.bio,
    item: typeof raw?.item === 'number' ? raw.item : INITIAL_CAPS.item,
  };
}

function familyTotalOf(stock: Record<string, number>, family: 'metals' | 'minerals' | 'bio'): number {
  const prefix = `${family}.`;
  let sum = 0;
  for (const [k, v] of Object.entries(stock)) {
    if (k.startsWith(prefix) && typeof v === 'number') sum += v;
  }
  return sum;
}

export function addColonyStock(
  state: SimState,
  colonyId: number,
  delta: Record<string, number>,
  enforceCap = false,
): void {
  const stock = getColonyStock(state, colonyId);
  const caps = getColonyCaps(state, colonyId);
  for (const [key, amount] of Object.entries(delta)) {
    if (typeof amount !== 'number' || !Number.isFinite(amount) || amount === 0) continue;
    const cur = stock[key] ?? 0;
    if (amount < 0) {
      stock[key] = Math.max(0, cur + amount);
      continue;
    }
    if (!enforceCap) {
      stock[key] = cur + amount;
      continue;
    }
    const family = key.startsWith('metals.')
      ? 'metals'
      : key.startsWith('minerals.')
        ? 'minerals'
        : key.startsWith('bio.')
          ? 'bio'
          : null;
    if (!family) {
      stock[key] = cur + amount;
      continue;
    }
    const total = familyTotalOf(stock, family);
    const room = Math.max(0, caps[family] - total);
    stock[key] = cur + Math.min(amount, room);
  }
  setColonyStock(state, colonyId, stock);
}

function getLandingPods(state: SimState): LandingPodState[] {
  const raw = state.blobs.landingPods?.value;
  return Array.isArray(raw) ? (raw as LandingPodState[]) : [];
}

function resolveSpawnCoords(
  state: SimState,
  colonyId: number,
  opts: { slotIndex?: number; q?: number; r?: number },
  tick: number,
): { q: number; r: number } {
  const slots = getSpawnSlots(state);
  if (typeof opts.q === 'number' && typeof opts.r === 'number' && Number.isInteger(opts.q) && Number.isInteger(opts.r)) {
    const match = slots.find((s) => s.q === opts.q && s.r === opts.r);
    if (match) {
      match.claimedBy = colonyId;
      setBlob(state, 'spawnSlots', slots, tick);
    }
    return { q: opts.q, r: opts.r };
  }
  if (slots.length > 0) {
    const idx = opts.slotIndex ?? colonyId;
    const slot =
      slots[idx] ??
      slots.find((s) => s.claimedBy === undefined || s.claimedBy === colonyId) ??
      slots[idx % slots.length];
    slot.claimedBy = colonyId;
    setBlob(state, 'spawnSlots', slots, tick);
    return { q: slot.q, r: slot.r };
  }
  return { q: 0, r: 0 };
}

export function spawnColonyLanding(
  state: SimState,
  opts: SpawnColonyLandingOpts,
  ctx?: SystemCtx,
): { podEntityId: number; q: number; r: number } {
  const tick = opts.tick ?? ctx?.tick ?? state.meta.tick;
  const data = opts.data ?? ctx?.data;
  const colonyId = opts.colonyId;
  const col = ensureColony(state, colonyId, tick, {
    id: opts.colonyIdStr,
    playerId: opts.playerId,
    handle: opts.handle,
    name: opts.name ?? opts.handle,
    color: opts.color,
  });

  const { q, r } = resolveSpawnCoords(state, colonyId, opts, tick);
  const kit = resolveStartingKitRow(data);
  const totalTicks = resolveDescentTicks(kit);
  const rawCargo = (kit.cargo ?? {
    'metals.t1': 600,
    'minerals.t1': 350,
    'bio.biomass': 200,
    'bio.water': 200,
  }) as Record<string, number>;
  const initialStock: Record<string, number> = {};
  for (const [k, v] of Object.entries(rawCargo)) {
    if (typeof v === 'number' && v > 0) initialStock[k] = v;
  }
  col.caps = { ...INITIAL_CAPS };
  setColonyStock(state, colonyId, initialStock);
  col.changedAt = tick;

  const podEntityId = ctx ? ctx.newEntityId() : state.meta.nextEntityId++;
  const row = insertRow(state.entities, podEntityId, tick);
  const cols = state.entities.cols;
  cols.kind[row] = ENTITY_KIND.pod;
  cols.owner[row] = colonyId;
  cols.tier[row] = 1;
  cols.q[row] = q;
  cols.r[row] = r;
  cols.x[row] = Math.fround(q);
  cols.y[row] = Math.fround(r);
  cols.rot[row] = 0;
  cols.hp[row] = 500;
  cols.hpMax[row] = 500;
  cols.state[row] = ENTITY_STATE.descending;
  cols.progress[row] = 0;
  cols.targetQ[row] = q;
  cols.targetR[row] = r;
  cols.createdAt[row] = tick;
  cols.changedAt[row] = tick;

  const viewRadius = Number(resolveHqT1Row(data).viewRadius ?? 9);
  revealVision(state, colonyId, q, r, viewRadius, tick);

  const pods = [...getLandingPods(state)];
  pods.push({
    podEntityId,
    colonyId,
    q,
    r,
    ticksRemaining: totalTicks,
    totalTicks,
    deployed: false,
  });
  setBlob(state, 'landingPods', pods, tick);

  return { podEntityId, q, r };
}

function deployPod(state: PlanetState, pod: LandingPodState, ctx: StepContext): number {
  pod.ticksRemaining = 0;
  pod.deployed = true;
  const podRow = rowOf(state.entities, pod.podEntityId);
  if (podRow >= 0) {
    setField(state.entities, podRow, 'state', ENTITY_STATE.idle, ctx.tick);
    setField(state.entities, podRow, 'progress', 1, ctx.tick);
  }
  const col = state.colonies[pod.colonyId];
  if (col) col.changedAt = ctx.tick;

  const hqEntityId = spawnHqUnit(
    state,
    { owner: pod.colonyId, q: pod.q, r: pod.r, tick: ctx.tick, data: ctx.data },
    ctx,
  );
  const colonyIdStr = col?.id ?? `col_${pod.colonyId}`;
  ctx.emit({
    kind: 'hqLanded',
    severity: 'info',
    colonyIds: [colonyIdStr],
    data: {
      colonyId: colonyIdStr,
      entityId: hqEntityId,
      podEntityId: pod.podEntityId,
      q: pod.q,
      r: pod.r,
    },
  });
  return hqEntityId;
}

interface SpawnColonyCommandArgs {
  colonyId?: string | number;
  colonyIndex?: number;
  playerId?: string;
  handle?: string;
  name?: string;
  colonyName?: string;
  color?: number;
  slotIndex?: number;
  q?: number;
  r?: number;
}

function resolveCommandColonyIndex(state: PlanetState, cmd: SimCommand, args: SpawnColonyCommandArgs): number {
  const legacyColony = (cmd as { colony?: unknown }).colony;
  if (typeof cmd.colonyIndex === 'number' && cmd.colonyIndex >= 0) return cmd.colonyIndex;
  if (typeof legacyColony === 'number' && legacyColony >= 0) return legacyColony;
  if (typeof args.colonyIndex === 'number' && args.colonyIndex >= 0) return args.colonyIndex;
  if (typeof args.colonyId === 'number' && args.colonyId >= 0) return args.colonyId;
  if (typeof args.colonyId === 'string') {
    const existing = state.colonies.find((c) => c.id === args.colonyId);
    if (existing) return existing.index;
    const match = /^col_(\d+)$/.exec(args.colonyId);
    if (match) return Number(match[1]);
  }
  return state.colonies.length;
}

export const spawnColony = defineCommandHandler({
  kind: 'system.spawnColony',
  wave: 'W01',
  handle(state, cmd, ctx) {
    const args = (cmd.args ?? {}) as SpawnColonyCommandArgs;
    const colonyId = resolveCommandColonyIndex(state, cmd, args);
    const colonyIdStr = typeof args.colonyId === 'string' ? args.colonyId : undefined;
    spawnColonyLanding(
      state,
      {
        colonyId,
        colonyIdStr,
        playerId: args.playerId,
        handle: args.handle,
        name: args.name ?? args.colonyName ?? args.handle,
        color: args.color,
        slotIndex: args.slotIndex,
        q: args.q,
        r: args.r,
        tick: ctx.tick,
        data: ctx.data,
      },
      ctx,
    );
  },
});

export const devLand = defineCommandHandler({
  kind: 'dev.land',
  wave: 'W01',
  handle(state, cmd, ctx) {
    const args = (cmd.args ?? {}) as { q?: number; r?: number; colonyId?: number };
    const legacyColony = (cmd as { colony?: unknown }).colony;
    const targetColony =
      typeof cmd.colonyIndex === 'number'
        ? cmd.colonyIndex
        : typeof legacyColony === 'number'
          ? legacyColony
          : typeof args.colonyId === 'number'
            ? args.colonyId
            : null;

    const pods = getLandingPods(state);
    const matching = pods.filter((p) => !p.deployed && (targetColony === null || p.colonyId === targetColony));
    if (matching.length === 0) {
      const colIdx = targetColony ?? 0;
      spawnColonyLanding(state, { colonyId: colIdx, q: args.q, r: args.r, tick: ctx.tick, data: ctx.data }, ctx);
      const updatedPods = getLandingPods(state);
      for (const pod of updatedPods) {
        if (!pod.deployed && pod.colonyId === colIdx) deployPod(state, pod, ctx);
      }
      setBlob(state, 'landingPods', updatedPods, ctx.tick);
      return;
    }

    for (const pod of matching) {
      if (typeof args.q === 'number' && typeof args.r === 'number') {
        pod.q = args.q;
        pod.r = args.r;
        const row = rowOf(state.entities, pod.podEntityId);
        if (row >= 0) {
          setField(state.entities, row, 'q', args.q, ctx.tick);
          setField(state.entities, row, 'r', args.r, ctx.tick);
          setField(state.entities, row, 'x', Math.fround(args.q), ctx.tick);
          setField(state.entities, row, 'y', Math.fround(args.r), ctx.tick);
        }
      }
      deployPod(state, pod, ctx);
    }
    setBlob(state, 'landingPods', pods, ctx.tick);
  },
});

export const landing = defineSystem({
  id: 'landing',
  slot: 2,
  wave: 'W01',
  run(state, ctx) {
    const pods = getLandingPods(state);
    if (pods.length === 0) return;
    let changed = false;
    for (const pod of pods) {
      if (pod.deployed) continue;
      changed = true;
      pod.ticksRemaining = Math.max(0, pod.ticksRemaining - ctx.dt);
      if (pod.ticksRemaining <= 0) {
        deployPod(state, pod, ctx);
      } else {
        const podRow = rowOf(state.entities, pod.podEntityId);
        if (podRow >= 0) {
          const progress = Math.fround((pod.totalTicks - pod.ticksRemaining) / pod.totalTicks);
          setField(state.entities, podRow, 'progress', progress, ctx.tick);
        }
      }
    }
    if (changed) {
      setBlob(state, 'landingPods', pods, ctx.tick);
    }
  },
});

export default defineSimModule({
  id: 'landing',
  wave: 'W01',
  systems: [landing],
  handlers: [spawnColony, devLand],
});
