import { dataRow, type CompiledRow } from '../../data';
import { INITIAL_CAPS, systemActor, treasury, treasuryCtx, type Amounts } from '../../economy';
import { ENTITY_KIND, ENTITY_STATE } from '../../ecs/columns';
import { placeSpawnedEntity } from '../../ecs/placement';
import { insertRow, rowOf, setField } from '../../ecs/store';
import { ensureStarterHubSpace, getSpawnSlots, type SpawnSlot } from '../../gen/spawnSlots';
import { hexDistance, inHex } from '../../grid/hex';
import { defineCommandHandler, type SimCommand } from '../../kernel/commands';
import type { CompiledDataLike } from '../../kernel/config';
import { ensureColonyRecord } from '../../kernel/colonies';
import { TICKS_PER_SECOND } from '../../kernel/constants';
import type { StepContext } from '../../kernel/context';
import { setBlob, type ColonyState, type PlanetState, type SimState } from '../../kernel/state';
import { defineSystem } from '../../kernel/system';
import { defineSimModule } from '../define';
import { defaultW01Data, resolveHqT1Row, revealVision, spawnHqUnit } from '../hq';

export type SystemCtx = StepContext;

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

export function resolveStartingKitRow(data?: CompiledDataLike): CompiledRow {
  const table = data?.tables.hq as Record<string, CompiledRow> | undefined;
  if (table?.startingKit) return table.startingKit;
  return dataRow(defaultW01Data(), 'hq', 'startingKit');
}

/** The landing pod's cargo (`hq.startingKit.cargo`, positive entries only): what a new colony starts with. */
export function resolveStartingCargo(data?: CompiledDataLike): Amounts {
  const kit = resolveStartingKitRow(data);
  const raw = (kit.cargo ?? { 'metals.t1': 600, 'minerals.t1': 350, 'bio.biomass': 200, 'bio.water': 200 }) as Amounts;
  const out: Amounts = {};
  for (const [k, v] of Object.entries(raw)) if (typeof v === 'number' && v > 0) out[k as keyof Amounts] = v;
  return out;
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
  const col = ensureColonyRecord(state, colonyId, tick);
  if (meta?.id) col.id = meta.id;
  if (meta?.name) col.name = meta.name;
  if (meta?.playerId !== undefined) col.playerId = meta.playerId;
  if (meta?.handle !== undefined) col.handle = meta.handle;
  if (typeof meta?.color === 'number') col.color = meta.color;
  col.changedAt = tick;
  return col;
}

/** The colony landing pods (`state.blobs.landingPods`). */
export function getLandingPods(state: SimState): LandingPodState[] {
  const raw = state.blobs.landingPods?.value;
  return Array.isArray(raw) ? (raw as LandingPodState[]) : [];
}

/**
 * Why a colony may not land: it already has a pod, the spot is another colony's (its slot, or too close to its pod),
 * or the spot is off the map.
 */
export type LandingRejectCode = 'already_landed' | 'landing_site_taken' | 'invalid_args';

export type SpawnColonyLandingResult =
  | { ok: true; podEntityId: number; q: number; r: number }
  | { ok: false; code: LandingRejectCode };

interface SpawnPlan {
  q: number;
  r: number;
  slot?: SpawnSlot;
}

/** Minimum hex distance between two colonies' landing pods (`hq.startingKit.minLandingSeparation`). */
export function resolveMinLandingSeparation(data?: CompiledDataLike): number {
  const v = Number(resolveStartingKitRow(data).minLandingSeparation);
  return Number.isFinite(v) && v >= 0 ? v : 6;
}

const freeFor = (slot: SpawnSlot, colonyId: number) => slot.claimedBy === undefined || slot.claimedBy === colonyId;

/**
 * Where `colonyId` would land, without changing anything: explicit `(q, r)` (taken if that slot belongs to another
 * colony), else its preferred slot (`slotIndex ?? colonyId`) when free, else the first free slot. Null = no free spot.
 */
function planSpawnCoords(state: SimState, colonyId: number, opts: { slotIndex?: number; q?: number; r?: number }): SpawnPlan | null {
  const slots = getSpawnSlots(state);
  if (Number.isInteger(opts.q) && Number.isInteger(opts.r)) {
    const q = opts.q as number;
    const r = opts.r as number;
    const slot = slots.find((s) => s.q === q && s.r === r);
    return slot && !freeFor(slot, colonyId) ? null : { q, r, slot };
  }
  if (slots.length === 0) return { q: 0, r: 0 };
  const preferred = slots[opts.slotIndex ?? colonyId];
  const slot = preferred && freeFor(preferred, colonyId) ? preferred : slots.find((s) => freeFor(s, colonyId));
  return slot ? { q: slot.q, r: slot.r, slot } : null;
}

/**
 * Validates a landing and returns where it would happen, or the reject code. A colony lands once (its cargo is
 * credited once); no two colonies share a slot or land within `minLandingSeparation` of each other's pod.
 */
export function checkColonyLanding(
  state: SimState,
  opts: Pick<SpawnColonyLandingOpts, 'colonyId' | 'slotIndex' | 'q' | 'r' | 'data'>,
): { ok: true; plan: SpawnPlan } | { ok: false; code: LandingRejectCode } {
  const pods = getLandingPods(state);
  if (pods.some((p) => p.colonyId === opts.colonyId)) return { ok: false, code: 'already_landed' };
  const plan = planSpawnCoords(state, opts.colonyId, opts);
  if (!plan) return { ok: false, code: 'landing_site_taken' };
  if (!inHex(plan.q, plan.r, state.grid.radius)) return { ok: false, code: 'invalid_args' };
  const minSep = resolveMinLandingSeparation(opts.data);
  if (pods.some((p) => hexDistance(p.q, p.r, plan.q, plan.r) < minSep)) return { ok: false, code: 'landing_site_taken' };
  return { ok: true, plan };
}

/**
 * Lands a colony: validates first ({@link checkColonyLanding}) and changes nothing when rejected; otherwise claims
 * the slot, clears the starter Hub space, credits the starting cargo (`landing.cargo`) and drops the pod.
 */
export function spawnColonyLanding(
  state: SimState,
  opts: SpawnColonyLandingOpts,
  ctx?: SystemCtx,
): SpawnColonyLandingResult {
  const tick = opts.tick ?? ctx?.tick ?? state.meta.tick;
  const data = opts.data ?? ctx?.data;
  const colonyId = opts.colonyId;
  const check = checkColonyLanding(state, { ...opts, data });
  if (!check.ok) return check;
  const col = ensureColony(state, colonyId, tick, {
    id: opts.colonyIdStr,
    playerId: opts.playerId,
    handle: opts.handle,
    name: opts.name ?? opts.handle,
    color: opts.color,
  });

  const { q, r, slot } = check.plan;
  if (slot) {
    slot.claimedBy = colonyId;
    setBlob(state, 'spawnSlots', getSpawnSlots(state), tick);
  }
  ensureStarterHubSpace(state, q, r, colonyId);
  const kit = resolveStartingKitRow(data);
  const totalTicks = resolveDescentTicks(kit);
  col.caps = { ...INITIAL_CAPS };
  treasury(state, treasuryCtx(tick, ctx)).add({
    colony: colonyId,
    amounts: resolveStartingCargo(data),
    reason: 'landing.cargo',
    actor: systemActor('landing'),
    ref: `colony:${colonyId}`,
  });
  col.changedAt = tick;

  const podEntityId = ctx ? ctx.newEntityId() : state.meta.nextEntityId++;
  const row = insertRow(state.entities, podEntityId, tick);
  const cols = state.entities.cols;
  cols.kind[row] = ENTITY_KIND.pod;
  cols.owner[row] = colonyId;
  cols.tier[row] = 1;
  placeSpawnedEntity(state.entities, row, q, r, tick);
  cols.rot[row] = 0;
  cols.hp[row] = 500;
  cols.hpMax[row] = 500;
  cols.state[row] = ENTITY_STATE.descending;
  cols.progress[row] = 0;
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

  return { ok: true, podEntityId, q, r };
}

/** Opens a landed pod: spawns the colony HQ next to it and emits `hqLanded`. */
export function deployPod(state: PlanetState, pod: LandingPodState, ctx: StepContext): number {
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
    const res = spawnColonyLanding(
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
    return res.ok ? undefined : res.code;
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
  handlers: [spawnColony],
});
