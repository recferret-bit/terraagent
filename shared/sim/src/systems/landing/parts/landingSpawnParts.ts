import { systemActor, type AddRequest, type Amounts } from '../../../economy';
import { ENTITY_KIND, ENTITY_STATE } from '../../../ecs/columns';
import { placeSpawnedEntity } from '../../../ecs/placement';
import { insertRow } from '../../../ecs/store';
import { ensureColonyRecord } from '../../../kernel/colonies';
import type { CompiledDataLike } from '../../../kernel/config';
import type { StepContext } from '../../../kernel/context';
import { setBlob, type ColonyState, type SimState } from '../../../kernel/state';
import { minLandingSeparation } from '../../../world/landingPlanner';
import { hqViewRadius, revealVision } from '../../hq';
import { resolveStartingKitRow, rowNum } from '../../rows';
import type { LandingPodState, SpawnColonyLandingOpts } from '../index';

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
export function cargoCredit(colonyId: number, data?: CompiledDataLike): AddRequest {
  return { colony: colonyId, amounts: resolveStartingCargo(data), reason: 'landing.cargo', actor: systemActor('landing'), ref: `colony:${colonyId}` };
}

/** The pod's descent in ticks (`hq.startingKit.podDescentS`, compiled to ticks; at least one tick). */
export function resolveDescentTicks(data?: CompiledDataLike): number {
  return Math.max(1, Math.round(rowNum(resolveStartingKitRow(data), 'podDescentS')));
}

export function ensureColony(
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

/** Minimum hex distance between two landings (`hq.startingKit.minLandingSeparation`); see `world/landingPlanner.ts`. */
export function resolveMinLandingSeparation(data?: CompiledDataLike): number {
  return minLandingSeparation(data);
}

export function initColonyStagesOnLanding(
  col: ColonyState,
  colonyId: number,
  opts: SpawnColonyLandingOpts,
  ctx?: StepContext,
): void {
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
}

export function insertDescendingPodAndVision(
  state: SimState,
  colonyId: number,
  q: number,
  r: number,
  totalTicks: number,
  tick: number,
  data?: CompiledDataLike,
  ctx?: StepContext,
): number {
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
  return podEntityId;
}
