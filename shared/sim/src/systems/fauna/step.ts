import { combatApproachBand, footprintAttackRange } from '../combat/approachBand';
import { InsectActionBook } from './insectActions';
import { Combatant } from '../combat/Combatant';
import { ENTITY_STATE } from '../../ecs/columns';
import { rowOf } from '../../ecs/store';
import { hexDistance, hexIndex, inHex } from '../../grid/hex';
import { DEPOSIT, PREP, TERRAIN } from '../../grid/layers';
import { isGroundPassable } from '../../grid/tileModel';
import type { StepContext } from '../../kernel/context';
import { nextInt, seedStream } from '../../kernel/rng';
import type { PlanetState } from '../../kernel/state';
import { getUnitCommand } from '../../units/book';
import { faceTowards } from '../../units/movement/locomotion';
import { applyDamage } from '../combat/damage';
import { firingRangeUnitRowInRange } from '../combat/firingRange';
import {
  firingRangeBugPolicy,
  orderFiringRangeBug,
  releaseFiringRangeBug,
} from '../combat/firingRangeCombat';
import { fireLaserOrMelee } from '../combat/lasers';
import { fireProjectile } from '../combat/projectiles';
import { occupiedGroundTiles } from '../construction/occupancy';
import { issueUnitCommand } from '../units/registry';
import { detectAndApplyDamageProvocation } from './provocation';
import { materializeWorldgenHives, spawnResidentBug } from './spawn';
import { getFaunaHivesState, saveFaunaHivesState } from './state';
import {
  resolveSpeciesConfig,
  WORLDGEN_HIVE_SITES_BLOB,
  type FaunaHivesBlob,
  type HiveRecord,
  type ResidentBugRecord,
} from './types';
import {
  flushPendingFaunaEvents,
  stepActiveCohorts,
  stepProvokedHiveWaveDispatches,
  stepScheduledHiveWaves,
} from './waves';

const WANDER_INTERVAL_TICKS = 18;

function syncFaunaLiveness(state: PlanetState, fauna: FaunaHivesBlob, tick = state.meta.tick): void {
  const cols = state.entities.cols;
  for (const hive of Object.values(fauna.hivesById)) {
    const hRow = rowOf(state.entities, hive.hiveId);
    if (hRow < 0 || cols.hp[hRow]! <= 0) {
      hive.destroyed = true;
      hive.hp = 0;
    } else {
      hive.hp = cols.hp[hRow]!;
    }
    const wasAtCap = hive.residentIds.length >= hive.popCap;
    hive.residentIds = hive.residentIds.filter((id) => {
      const bRow = rowOf(state.entities, id);
      return bRow >= 0 && cols.hp[bRow]! > 0;
    });
    if (wasAtCap && hive.residentIds.length < hive.popCap) {
      hive.lastReplenishTick = tick;
    }
  }

  for (const [idStr, bug] of Object.entries(fauna.bugsById)) {
    const bRow = rowOf(state.entities, bug.entityId);
    if (bRow < 0 || cols.hp[bRow]! <= 0) {
      delete fauna.bugsById[Number(idStr)];
      delete fauna.lastSeenHpByEntityId[Number(idStr)];
    }
  }
}

function collectPatrolCandidates(
  state: PlanetState,
  hive: HiveRecord,
  curQ: number,
  curR: number,
  occupied: ReadonlySet<number>,
  ctx: StepContext,
): Array<{ q: number; r: number }> {
  const hex = hexIndex(state.grid.radius);
  const { terrain, prep, deposit } = state.grid.layers;
  const rMax = Math.max(2, hive.patrolRadius);
  const out: Array<{ q: number; r: number }> = [];

  for (let dr = -rMax; dr <= rMax; dr++) {
    for (let dq = -rMax; dq <= rMax; dq++) {
      const d = hexDistance(0, 0, dq, dr);
      if (d < 1 || d > rMax) continue;
      const q = hive.q + dq;
      const r = hive.r + dr;
      if (q === curQ && r === curR) continue;
      if (!inHex(q, r, state.grid.radius)) continue;
      const ti = hex.indexOf(q, r);
      if (ti < 0 || occupied.has(ti)) continue;
      const t = terrain[ti];
      const p = prep[ti];
      if (t === TERRAIN.deep || t === TERRAIN.shallow || t === TERRAIN.hole) continue;
      if (p === PREP.ridge || p === PREP.moat) continue;
      if (deposit[ti] !== DEPOSIT.none) continue;
      if (!isGroundPassable(state.grid, ti, ctx.data)) continue;
      out.push({ q, r });
    }
  }
  const near = out.filter((c) => hexDistance(curQ, curR, c.q, c.r) <= 1);
  return near.length > 0 ? near : out;
}

function findClosestProvokedColonyTarget(
  state: PlanetState,
  bugRow: number,
  aggressiveColonies: readonly number[],
  maxDist: number,
): number {
  if (aggressiveColonies.length === 0) return -1;
  const cols = state.entities.cols;
  const bx = cols.x[bugRow]!;
  const by = cols.y[bugRow]!;
  let bestRow = -1;
  let bestDist = Infinity;
  let bestId = Infinity;

  for (let r = 0; r < state.entities.count; r++) {
    if (r === bugRow) continue;
    const owner = cols.owner[r]!;
    if (owner < 0 || !aggressiveColonies.includes(owner)) continue;
    if (cols.hp[r]! <= 0) continue;
    const st = cols.state[r]!;
    if (st === ENTITY_STATE.inert || st === ENTITY_STATE.descending) continue;

    const contDist = hexDistance(bx, by, cols.x[r]!, cols.y[r]!);
    const d = contDist;
    if (d > footprintAttackRange(maxDist, cols.footprintW[r]) + 1e-4) continue;
    const id = cols.id[r]!;
    if (contDist < bestDist - 1e-5 || (Math.abs(contDist - bestDist) <= 1e-5 && id < bestId)) {
      bestDist = contDist;
      bestId = id;
      bestRow = r;
    }
  }
  return bestRow;
}

function stepPassiveBug(
  state: PlanetState,
  bug: ResidentBugRecord,
  hive: HiveRecord | undefined,
  occupied: ReadonlySet<number>,
  ctx: StepContext,
): void {
  const bugRow = rowOf(state.entities, bug.entityId);
  if (bugRow < 0 || !hive) return;
  const curCmd = getUnitCommand(state, bug.entityId);
  if (curCmd?.kind === 'attack') {
    issueUnitCommand(state, bugRow, { kind: 'stop', source: 'auto' }, ctx);
  }
  const cols = state.entities.cols;
  if (curCmd?.kind === 'move' || cols.state[bugRow] === ENTITY_STATE.moving) return;
  if (ctx.tick - bug.lastWanderTick < WANDER_INTERVAL_TICKS) return;

  const candidates = collectPatrolCandidates(
    state,
    hive,
    cols.q[bugRow]!,
    cols.r[bugRow]!,
    occupied,
    ctx,
  );
  if (candidates.length === 0) return;

  const rng = seedStream(
    String(state.meta.seed),
    `hive:${hive.hiveId}:bug:${bug.entityId}:wander:${ctx.tick}`,
  );
  const pick = candidates[nextInt(rng, 0, candidates.length - 1)]!;
  issueUnitCommand(
    state,
    bugRow,
    { kind: 'move', source: 'auto', q: pick.q, r: pick.r },
    ctx,
  );
  bug.lastWanderTick = ctx.tick;
}

function stepAggressiveBugMovement(
  state: PlanetState,
  bug: ResidentBugRecord,
  hive: HiveRecord | undefined,
  ctx: StepContext,
): void {
  const bugRow = rowOf(state.entities, bug.entityId);
  if (bugRow < 0) return;
  const existingCmd = getUnitCommand(state, bug.entityId);
  if (existingCmd?.kind === 'move' && existingCmd.source === 'player') {
    state.entities.cols.targetQ[bugRow] = existingCmd.q;
    state.entities.cols.targetR[bugRow] = existingCmd.r;
    return;
  }
  const cfg = resolveSpeciesConfig(bug.species, ctx.data);
  const searchRadius =
    bug.cohortId !== null
      ? Math.max(256, state.grid.radius * 4)
      : Math.max(16, (hive?.patrolRadius ?? 5) * 4);
  const targetRow = findClosestProvokedColonyTarget(
    state,
    bugRow,
    bug.aggressiveColonies,
    searchRadius,
  );
  const cols = state.entities.cols;

  if (targetRow >= 0) {
    const contDist = hexDistance(
      cols.x[bugRow]!,
      cols.y[bugRow]!,
      cols.x[targetRow]!,
      cols.y[targetRow]!,
    );
    const tq = cols.q[targetRow]!;
    const tr = cols.r[targetRow]!;
    const dist = contDist;
    const attackRange = footprintAttackRange(cfg.range, cols.footprintW[targetRow]);
    if (dist > attackRange + 1e-4) {
      const bandMax = combatApproachBand(attackRange, 0,
        hexDistance(cols.q[bugRow], cols.r[bugRow], tq, tr),
        hexDistance(cols.x[targetRow], cols.y[targetRow], tq, tr)).maxDist;
      const curCmd = getUnitCommand(state, bug.entityId);
      const driftAllowance = dist > 3 ? 2 : 1;
      if (
        curCmd?.kind !== 'move' ||
        cols.state[bugRow] !== ENTITY_STATE.moving ||
        hexDistance(curCmd.q, curCmd.r, tq, tr) > driftAllowance ||
        (curCmd.maxDist ?? 0) !== bandMax
      ) {
        issueUnitCommand(
          state,
          bugRow,
          { kind: 'move', source: 'auto', q: tq, r: tr, minDist: 0, maxDist: bandMax },
          ctx,
        );
      }
    } else {
      const curCmd = getUnitCommand(state, bug.entityId);
      if (curCmd?.kind === 'move') {
        issueUnitCommand(state, bugRow, { kind: 'stop', source: 'auto' }, ctx);
      }
      faceTowards(state, bugRow, tq, tr, ctx.tick);
    }
    return;
  }

  if (
    bug.cohortId === null &&
    hive &&
    !hive.destroyed &&
    hexDistance(cols.q[bugRow]!, cols.r[bugRow]!, hive.entranceQ, hive.entranceR) >
      hive.patrolRadius
  ) {
    const curCmd = getUnitCommand(state, bug.entityId);
    if (
      curCmd?.kind !== 'move' ||
      curCmd.q !== hive.entranceQ ||
      curCmd.r !== hive.entranceR
    ) {
      issueUnitCommand(
        state,
        bugRow,
        { kind: 'move', source: 'auto', q: hive.entranceQ, r: hive.entranceR, minDist: 0, maxDist: 2 },
        ctx,
      );
    }
  }
}

/**
 * Fauna slot (3): materializes worldgen hives on first W07 step, syncs liveness & provocation,
 * resolves/schedules bounded wave cohorts, replenishes resident bugs up to `popCap`, and issues
 * movement orders through the units runner (`SIM-M-01`).
 */
export function stepFauna(state: PlanetState, ctx: StepContext): void {
  let fauna = getFaunaHivesState(state);
  if (!fauna.initialized && state.blobs[WORLDGEN_HIVE_SITES_BLOB]) {
    materializeWorldgenHives(state, ctx.tick, ctx.data);
  }

  flushPendingFaunaEvents(state, ctx);
  const bugPolicy = firingRangeBugPolicy(state);
  if (bugPolicy === null) detectAndApplyDamageProvocation(state, ctx.tick, ctx);
  fauna = getFaunaHivesState(state);
  syncFaunaLiveness(state, fauna, ctx.tick);
  saveFaunaHivesState(state, fauna, ctx.tick);

  stepActiveCohorts(state, ctx);
  stepScheduledHiveWaves(state, ctx);
  stepProvokedHiveWaveDispatches(state, ctx);

  fauna = getFaunaHivesState(state);
  const hiveIds = Object.keys(fauna.hivesById)
    .map(Number)
    .sort((a, b) => a - b);
  for (const hiveId of hiveIds) {
    const latest = getFaunaHivesState(state);
    const hive = latest.hivesById[hiveId];
    if (!hive || hive.destroyed || hive.residentIds.length >= hive.popCap) continue;
    if (ctx.tick - hive.lastReplenishTick >= hive.replenishTicks) {
      spawnResidentBug(state, hiveId, ctx.tick, ctx.data);
      const afterSpawn = getFaunaHivesState(state);
      if (afterSpawn.hivesById[hiveId]) {
        afterSpawn.hivesById[hiveId]!.lastReplenishTick = ctx.tick;
        saveFaunaHivesState(state, afterSpawn, ctx.tick);
      }
    }
  }

  stepFaunaMovement(state, ctx);
}

/** Movement decisions shared by authority and sparse client reconstruction; no spawn, economy or damage. */
export function stepFaunaMovement(state: PlanetState, ctx: StepContext): void {
  const bugPolicy = firingRangeBugPolicy(state);
  const fauna = getFaunaHivesState(state);
  const occupied = occupiedGroundTiles(state, ctx.data);
  const bugIds = Object.keys(fauna.bugsById)
    .map(Number)
    .sort((a, b) => a - b);

  for (const bugId of bugIds) {
    const bug = fauna.bugsById[bugId];
    if (!bug) continue;
    const hive = fauna.hivesById[bug.homeHiveId];
    if (bugPolicy === 'attack') {
      const bugRow = rowOf(state.entities, bug.entityId);
      if (bugRow >= 0) orderFiringRangeBug(state, bugRow, ctx, resolveSpeciesConfig(bug.species, ctx.data).range);
    } else if (bugPolicy === 'hold') {
      releaseFiringRangeBug(state, bug.entityId, ctx);
    } else if (bug.mode === 'aggressive' && bug.aggressiveColonies.length > 0) {
      stepAggressiveBugMovement(state, bug, hive, ctx);
    } else {
      stepPassiveBug(state, bug, hive, occupied, ctx);
    }
  }

  saveFaunaHivesState(state, fauna, ctx.tick);
}

/** BattleOrchestrator calls this after due arrivals: provoked bug bites and acid attacks. */
export function stepFaunaCombat(state: PlanetState, ctx: StepContext): void {
  flushPendingFaunaEvents(state, ctx);
  const bugPolicy = firingRangeBugPolicy(state);
  if (bugPolicy === null) detectAndApplyDamageProvocation(state, ctx.tick, ctx);
  const fauna = getFaunaHivesState(state);
  syncFaunaLiveness(state, fauna, ctx.tick);
  saveFaunaHivesState(state, fauna, ctx.tick);

  const cols = state.entities.cols;
  const actions = new InsectActionBook(state);
  const bugIds = Object.keys(fauna.bugsById)
    .map(Number)
    .sort((a, b) => a - b);

  for (const bugId of bugIds) {
    const bug = fauna.bugsById[bugId];
    if (!bug) continue;
    const combatant = new Combatant(state, bug.entityId);
    const bugRow = rowOf(state.entities, bug.entityId);
    if (bugRow < 0 || cols.hp[bugRow]! <= 0) continue;

    const cfg = resolveSpeciesConfig(bug.species, ctx.data);

    const canAttack = bugPolicy === 'attack' || (bugPolicy !== 'hold' && bug.mode === 'aggressive' && bug.aggressiveColonies.length > 0);
    const targetRow = !canAttack ? -1 : bugPolicy === 'attack'
      ? firingRangeUnitRowInRange(state, bugRow, cfg.range)
      : findClosestProvokedColonyTarget(state, bugRow, bug.aggressiveColonies, cfg.range);
    const targetId = targetRow < 0 ? null : cols.id[targetRow]!;
    combatant.target(targetId, ctx.tick);
    const release = actions.advance(bug.entityId, {
      tick: ctx.tick, species: bug.species, intervalTicks: cfg.attackIntervalTicks,
      lastAttackTick: bug.lastAttackTick, moving: cols.state[bugRow] === ENTITY_STATE.moving, targetId,
    });
    if (!release || targetId === null || targetRow < 0) continue;
    bug.lastAttackTick = ctx.tick;
    faceTowards(state, bugRow, cols.q[targetRow]!, cols.r[targetRow]!, ctx.tick);

    if (cfg.attackKind === 'rangedAcid') {
      fireProjectile(
        state,
        {
          attackerId: bug.entityId,
          attackerOwner: -1,
          targetId,
          weaponId: cfg.weaponId,
          weaponKind: 'acid',
          damage: cfg.damage,
          speed: cfg.projSpeed,
          aoe: 0,
          tick: ctx.tick,
        },
        ctx,
      );
    } else {
      const attackRange = footprintAttackRange(cfg.range, cols.footprintW[targetRow]);
      fireLaserOrMelee(
        state,
        {
          attackerId: bug.entityId,
          targetId,
          weaponId: cfg.weaponId,
          damage: cfg.damage,
          range: attackRange,
          tick: ctx.tick,
          applyDmg: (s, tId, amt, aId, aOwner, c) => {
            applyDamage(s, tId, amt, {
              attackerId: aId,
              attackerOwner: aOwner,
              tick: ctx.tick,
              ctx: c,
              data: c?.data,
            });
          },
        },
        ctx,
      );
    }
  }

  actions.flush(ctx.tick);
  saveFaunaHivesState(state, fauna, ctx.tick);
  const afterCombat = getFaunaHivesState(state);
  syncFaunaLiveness(state, afterCombat, ctx.tick);
  saveFaunaHivesState(state, afterCombat, ctx.tick);
  stepActiveCohorts(state, ctx);
}
