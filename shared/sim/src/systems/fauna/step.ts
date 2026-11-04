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
import { fireLaserOrMelee } from '../combat/lasers';
import { fireProjectile, stepProjectileImpacts } from '../combat/projectiles';
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

const WANDER_INTERVAL_TICKS = 15;

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
  return out;
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
  const bq = cols.q[bugRow]!;
  const br = cols.r[bugRow]!;
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
    const tileDist = hexDistance(bq, br, cols.q[r]!, cols.r[r]!);
    const d = Math.min(contDist, tileDist);
    const fpPad = Math.floor(Math.max(1, cols.footprintW[r] || 1) / 2);
    if (d > maxDist + fpPad + 1e-4) continue;
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
    `hive:${hive.hiveId}:dec:${hive.decisionIndex++}`,
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
    const tileDist = hexDistance(cols.q[bugRow]!, cols.r[bugRow]!, tq, tr);
    const dist = Math.min(contDist, tileDist);
    const fpPad = Math.floor(Math.max(1, cols.footprintW[targetRow] || 1) / 2);
    if (dist > cfg.range + fpPad + 1e-4) {
      const bandMax = (cfg.range >= 2 ? Math.floor(cfg.range) - 1 : 1) + fpPad;
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
  detectAndApplyDamageProvocation(state, ctx.tick, ctx);
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

  fauna = getFaunaHivesState(state);
  const occupied = occupiedGroundTiles(state, ctx.data);
  const bugIds = Object.keys(fauna.bugsById)
    .map(Number)
    .sort((a, b) => a - b);

  for (const bugId of bugIds) {
    const bug = fauna.bugsById[bugId];
    if (!bug) continue;
    const hive = fauna.hivesById[bug.homeHiveId];
    if (bug.mode === 'aggressive' && bug.aggressiveColonies.length > 0) {
      stepAggressiveBugMovement(state, bug, hive, ctx);
    } else {
      stepPassiveBug(state, bug, hive, occupied, ctx);
    }
  }

  saveFaunaHivesState(state, fauna, ctx.tick);
}

/**
 * Combat slot (10): resolves damage provocation from player attacks, fires melee bites (`antBite` /
 * `beetleBite`) or ranged acid (`spitterAcid`) for provoked bugs in range, and steps due projectile impacts.
 */
export function stepFaunaCombat(state: PlanetState, ctx: StepContext): void {
  flushPendingFaunaEvents(state, ctx);
  detectAndApplyDamageProvocation(state, ctx.tick, ctx);
  const fauna = getFaunaHivesState(state);
  syncFaunaLiveness(state, fauna, ctx.tick);
  saveFaunaHivesState(state, fauna, ctx.tick);

  const cols = state.entities.cols;
  const bugIds = Object.keys(fauna.bugsById)
    .map(Number)
    .sort((a, b) => a - b);

  for (const bugId of bugIds) {
    const bug = fauna.bugsById[bugId];
    if (!bug || bug.mode !== 'aggressive' || bug.aggressiveColonies.length === 0) continue;
    const bugRow = rowOf(state.entities, bug.entityId);
    if (bugRow < 0 || cols.hp[bugRow]! <= 0) continue;

    const cfg = resolveSpeciesConfig(bug.species, ctx.data);
    if (ctx.tick - bug.lastAttackTick < cfg.attackIntervalTicks) continue;

    const targetRow = findClosestProvokedColonyTarget(
      state,
      bugRow,
      bug.aggressiveColonies,
      cfg.range,
    );
    if (targetRow < 0) continue;

    const targetId = cols.id[targetRow]!;
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
      const fpPad = Math.floor(Math.max(1, cols.footprintW[targetRow] || 1) / 2);
      fireLaserOrMelee(
        state,
        {
          attackerId: bug.entityId,
          targetId,
          weaponId: cfg.weaponId,
          damage: cfg.damage,
          range: cfg.range + fpPad,
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

  saveFaunaHivesState(state, fauna, ctx.tick);
  stepProjectileImpacts(state, ctx.tick, ctx);
  const afterCombat = getFaunaHivesState(state);
  syncFaunaLiveness(state, afterCombat, ctx.tick);
  saveFaunaHivesState(state, afterCombat, ctx.tick);
  stepActiveCohorts(state, ctx);
}
