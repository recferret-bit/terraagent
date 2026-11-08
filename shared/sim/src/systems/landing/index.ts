import { W11_MAX_SMALL_ATLAS_COLONIES } from '@terra/contracts';
import { recordAtlasColonyFounding, syncAtlasColonySectorState } from '../../atlas/sectorMetrics';
import { checkMove, initialCaps, systemActor, treasury, treasuryCtx, type Amounts, type AddRequest } from '../../economy';
import { ENTITY_KIND, ENTITY_STATE } from '../../ecs/columns';
import { placeSpawnedEntity } from '../../ecs/placement';
import { insertRow, rowOf, setField } from '../../ecs/store';
import { ensureStarterHubSpace, getSpawnSlots, type SpawnSlot } from '../../gen/spawnSlots';
import { defineCommandHandler, type SimCommand } from '../../kernel/commands';
import type { CompiledDataLike } from '../../kernel/config';
import { ensureColonyRecord } from '../../kernel/colonies';
import type { StepContext } from '../../kernel/context';
import { setBlob, type ColonyState, type PlanetState, type SimState } from '../../kernel/state';
import { defineSystem } from '../../kernel/system';
import { minLandingSeparation, nextLandingSite } from '../../world/landingPlanner';
import { recordLanding } from '../../world/presence';
import { commandColony, parseArgs } from '../command';
import { defineSimModule } from '../define';
import { hqViewRadius, revealVision, spawnHqUnit } from '../hq';
import { resolveStartingKitRow, rowNum } from '../rows';
import { stepHqRespawns } from './hqRespawn';

export { resolveStartingKitRow } from '../rows';
export * from './hqRespawn';

/**
 * Colonies per planet: `grid.explored` is a `u8` bit mask (one bit per colony), so a planet takes 8 colonies (GP-17).
 * A ninth landing is refused `planet_full`; widen the layer before raising this.
 */
export const MAX_COLONIES_PER_PLANET = 8;

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
  unlockStage?: number;
  slotIndex?: number;
  sectorId?: string;
  landingSlotId?: string;
  q?: number;
  r?: number;
  tick?: number;
  data?: CompiledDataLike;
}

/**
 * The landing pod's cargo (`hq.startingKit.cargo`, zero entries dropped): what a new colony starts with. Anything that
 * is not a whole amount (a fraction, a negative, a non-number) is kept, so the landing check refuses it instead of
 * landing a colony without its cargo.
 */
export function resolveStartingCargo(data?: CompiledDataLike): Amounts {
  const raw = resolveStartingKitRow(data).cargo;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('data row hq.startingKit.cargo is not a resource map');
  const out: Amounts = {};
  for (const [k, v] of Object.entries(raw as Amounts)) if (v !== 0) out[k as keyof Amounts] = v;
  return out;
}

/** The `landing.cargo` credit of colony `colonyId`'s pod. */
function cargoCredit(colonyId: number, data?: CompiledDataLike): AddRequest {
  return { colony: colonyId, amounts: resolveStartingCargo(data), reason: 'landing.cargo', actor: systemActor('landing'), ref: `colony:${colonyId}` };
}

/** The pod's descent in ticks (`hq.startingKit.podDescentS`, compiled to ticks; at least one tick). */
export function resolveDescentTicks(data?: CompiledDataLike): number {
  return Math.max(1, Math.round(rowNum(resolveStartingKitRow(data), 'podDescentS')));
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
 * the spot is off the map, or the pod's cargo is not whole resource amounts (`invalid_args`).
 */
export type LandingRejectCode = 'already_landed' | 'landing_site_taken' | 'invalid_args' | 'planet_full';

export type SpawnColonyLandingResult =
  | { ok: true; podEntityId: number; q: number; r: number }
  | { ok: false; code: LandingRejectCode };

interface SpawnPlan {
  q: number;
  r: number;
  slot?: SpawnSlot;
}

/** Minimum hex distance between two landings (`hq.startingKit.minLandingSeparation`); see `world/landingPlanner.ts`. */
export function resolveMinLandingSeparation(data?: CompiledDataLike): number {
  return minLandingSeparation(data);
}

/**
 * Validates a landing and returns where it would happen, or the reject code. The site comes from the landing planner
 * (`nextLandingSite`, D-39): explicit `(q, r)` checked against the rules, else the preferred / first free spawn slot,
 * else the best free site on the planet. A colony lands once, and no landing ever comes within
 * `minLandingSeparation` of an earlier landing (any colony, alive or gone) or of another colony's pod / HQ / buildings.
 */
export function checkColonyLanding(
  state: SimState,
  opts: Pick<SpawnColonyLandingOpts, 'colonyId' | 'slotIndex' | 'sectorId' | 'landingSlotId' | 'q' | 'r' | 'data'>,
): { ok: true; plan: SpawnPlan } | { ok: false; code: LandingRejectCode } {
  if (!Number.isInteger(opts.colonyId) || opts.colonyId < 0) return { ok: false, code: 'invalid_args' };
  const maxColonies = state.blobs.atlas ? W11_MAX_SMALL_ATLAS_COLONIES : MAX_COLONIES_PER_PLANET;
  if (opts.colonyId >= maxColonies) return { ok: false, code: 'planet_full' };
  // Planets saved before the landing history existed still know their pods.
  if (getLandingPods(state).some((p) => p.colonyId === opts.colonyId)) return { ok: false, code: 'already_landed' };
  // The cargo is credited after the landing changed the world, so it is checked first: a refused cargo lands nothing.
  if (checkMove(cargoCredit(opts.colonyId, opts.data), 'add')) return { ok: false, code: 'invalid_args' };
  const explicit = Number.isInteger(opts.q) && Number.isInteger(opts.r);
  const next = nextLandingSite(state, opts.colonyId, {
    slotIndex: opts.slotIndex,
    ...(opts.sectorId !== undefined ? { sectorId: opts.sectorId } : {}),
    ...(opts.landingSlotId !== undefined ? { landingSlotId: opts.landingSlotId } : {}),
    ...(explicit ? { q: opts.q, r: opts.r } : {}),
    data: opts.data,
  });
  if (!next.ok) return next;
  return { ok: true, plan: { q: next.site.q, r: next.site.r, ...(next.site.slot ? { slot: next.site.slot } : {}) } };
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
  const stageNum = typeof col.stage === 'number' ? col.stage : 0;
  col.stage = stageNum;
  const prevUnlockStage = typeof col.unlockStage === 'number' ? col.unlockStage : 0;
  const nextUnlockStage =
    typeof opts.unlockStage === 'number' && Number.isFinite(opts.unlockStage) && opts.unlockStage >= 0
      ? Math.max(prevUnlockStage, Math.floor(opts.unlockStage), stageNum)
      : Math.max(prevUnlockStage, stageNum);
  col.unlockStage = nextUnlockStage;
  if (typeof col.threatStage !== 'number') col.threatStage = 0;
  if (ctx && nextUnlockStage > prevUnlockStage) {
    ctx.emit({
      kind: 'stageUnlocked',
      colonyIds: [colonyId],
      data: {
        colonyIndex: colonyId,
        unlockStage: nextUnlockStage,
        previousUnlockStage: prevUnlockStage,
      },
    });
  }

  const { q, r, slot } = check.plan;
  if (slot) {
    slot.claimedBy = colonyId;
    setBlob(state, 'spawnSlots', getSpawnSlots(state), tick);
  }
  const resolvedLandingSlotId = opts.landingSlotId ?? slot?.landingSlotId ?? slot?.slotId;
  if (typeof resolvedLandingSlotId === 'string') {
    col.landingSlotId = resolvedLandingSlotId;
  }
  // Remembered forever: the planner never lands anyone here (or within the separation) again (D-39).
  recordLanding(state, { colony: colonyId, ...(col.id ? { colonyId: col.id } : {}), ...(opts.playerId ? { playerId: opts.playerId } : {}), q, r, tick, ...(slot ? { slot: slot.index } : {}) }, tick);
  ensureStarterHubSpace(state, q, r, colonyId);
  const totalTicks = resolveDescentTicks(data);
  col.caps = initialCaps(data);
  // Validated by checkColonyLanding; uncapped (the pod's hold is what the colony starts with).
  treasury(state, treasuryCtx(tick, ctx)).add(cargoCredit(colonyId, data));
  col.changedAt = tick;

  const podEntityId = ctx ? ctx.newEntityId() : state.meta.nextEntityId++;
  const row = insertRow(state.entities, podEntityId, tick);
  const cols = state.entities.cols;
  cols.kind[row] = ENTITY_KIND.pod;
  cols.owner[row] = colonyId;
  cols.tier[row] = 1;
  placeSpawnedEntity(state.entities, row, q, r, tick);
  cols.rot[row] = 0;
  const podHp = Math.fround(rowNum(resolveStartingKitRow(data), 'podHp'));
  cols.hp[row] = podHp;
  cols.hpMax[row] = podHp;
  cols.state[row] = ENTITY_STATE.descending;
  cols.progress[row] = 0;
  cols.createdAt[row] = tick;
  cols.changedAt[row] = tick;

  revealVision(state, colonyId, q, r, hqViewRadius(data), tick);

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
  recordAtlasColonyFounding(state, colonyId, q, r, tick);
  syncAtlasColonySectorState(state, tick);

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
  colonyId?: string;
  colonyIndex?: number;
  playerId?: string;
  handle?: string;
  name?: string;
  colonyName?: string;
  color?: number;
  unlockStage?: number;
  slotIndex?: number;
  sectorId?: string;
  landingSlotId?: string;
  q?: number;
  r?: number;
}

/**
 * The colony a `system.spawnColony` lands (system commands name it explicitly, GP-18): `cmd.colonyIndex`, else
 * `args.colonyIndex`, else an existing record with id `args.colonyId`, else `col_<n>`, else the next free index.
 */
function resolveCommandColonyIndex(state: PlanetState, cmd: SimCommand, args: SpawnColonyCommandArgs): number {
  if (typeof cmd.colonyIndex === 'number' && cmd.colonyIndex >= 0) return cmd.colonyIndex;
  if (typeof args.colonyIndex === 'number' && args.colonyIndex >= 0) return args.colonyIndex;
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
        unlockStage: args.unlockStage,
        slotIndex: args.slotIndex,
        sectorId: args.sectorId,
        landingSlotId: args.landingSlotId,
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

/**
 * `landPod` (player, FA-08): the caller asks its descending pod to open as soon as it has descended
 * `hq.startingKit.podLandMinS` (the client's touchdown animation) instead of the full `podDescentS`. Asked earlier, the
 * pod opens when that minimum is reached; asked later, at once. `already_landed` once open, `unknown_entity` without a pod.
 */
export const landPod = defineCommandHandler({
  kind: 'landPod',
  wave: 'W01',
  handle(state, cmd, ctx) {
    const colony = commandColony(cmd);
    if (typeof colony === 'string') return colony;
    if (!parseArgs('landPod', cmd.args)) return 'invalid_args';
    const pods = getLandingPods(state);
    const pod = pods.find((p) => p.colonyId === colony);
    if (!pod) return 'unknown_entity';
    if (pod.deployed) return 'already_landed';
    const minTicks = Math.max(0, Math.round(rowNum(resolveStartingKitRow(ctx.data), 'podLandMinS')));
    pod.ticksRemaining = Math.min(pod.ticksRemaining, Math.max(0, minTicks - (pod.totalTicks - pod.ticksRemaining)));
    if (pod.ticksRemaining <= 0) deployPod(state, pod, ctx);
    setBlob(state, 'landingPods', pods, ctx.tick);
  },
});

export const landing = defineSystem({
  id: 'landing',
  slot: 2,
  wave: 'W01',
  run(state, ctx) {
    const pods = getLandingPods(state);
    if (pods.length > 0) {
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
    }
    stepHqRespawns(state, ctx);
  },
});

export default defineSimModule({
  id: 'landing',
  wave: 'W01',
  systems: [landing],
  handlers: [spawnColony, landPod],
});
