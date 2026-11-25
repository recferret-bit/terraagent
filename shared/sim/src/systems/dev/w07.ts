import { ENTITY_STATE } from '../../ecs/columns';
import { placeSpawnedEntity } from '../../ecs/placement';
import { insertRow, rowOf } from '../../ecs/store';
import { isPreparedGround } from '../../grid/geo';
import { hexDistance, hexIndex, inHex } from '../../grid/hex';
import { PREP, TERRAIN } from '../../grid/layers';
import { defineCommandHandler } from '../../kernel/commands';
import type { StepContext } from '../../kernel/context';
import { setBlob, type PlanetState } from '../../kernel/state';
import { ringCoords } from '../../units/movement/slots';
import { collectUnitOccupancy } from '../../units/movement/unitOccupancy';
import { occupiedGroundTiles } from '../construction/occupancy';
import { isColonyGodMode } from '../combat/damage';
import { getWreckTileSet } from '../combat/wrecks';
import { setUnitStance } from '../combat/stances';
import { emitFaunaDirective } from '../fauna/directives';
import { provokeHive } from '../fauna/provocation';
import {
  collectBlockedHiveTiles,
  findNearestHiveSpawnTile,
  isHiveSitePlaceable,
  spawnFaunaBug,
  spawnHiveSite,
} from '../fauna/spawn';
import { getFaunaHivesState } from '../fauna/state';
import { resolveSpeciesConfig, type FaunaBehaviorMode, type FaunaSpeciesId } from '../fauna/types';
import { getFaunaSpeciesThreatCost, hasAnyAliveColonyEntity, spawnHiveRaidWave } from '../fauna/waves';
import { revealVision, spawnHqUnit } from '../hq';
import { recomputeAllColonyPower } from '../power-core';
import { evaluateColonySupply } from '../supply';
import {
  applyBugFaunaMode,
  applyHiveFaunaMode,
  classifyFaunaEntity,
  ensureDevColony,
  findColonyAnchorTile,
  isSpecies,
  replenishHiveResidentsForDevRaid,
  resolveColonyIdx,
  resolveColonyUnitSpec,
  selectOrSpawnRaidHive,
  syncSpawnedColonyUnitView,
} from './w07Helpers';

function dispatchRaidFromHive(
  state: PlanetState,
  hiveId: number,
  colonyIndex: number,
  budget: number | undefined,
  ctx: StepContext,
): number {
  if (budget !== undefined) {
    const cohort = spawnHiveRaidWave(state, { colonyIndex, hiveId, budget, tick: ctx.tick, data: ctx.data }, ctx);
    return cohort?.memberIds.length ?? 0;
  }
  return spawnHiveRaidWave(state, hiveId, colonyIndex, ctx.tick, ctx);
}

function isCombatTestWorld(state: PlanetState): boolean {
  return Boolean((state.blobs.combatTest?.value as { enabled?: boolean } | undefined)?.enabled);
}

function isCombatTestPassableTile(state: PlanetState, q: number, r: number): boolean {
  const idx = hexIndex(state.grid.radius).indexOf(q, r);
  if (idx < 0) return false;
  if (getWreckTileSet(state).has(idx)) return false;
  const terrain = state.grid.layers.terrain[idx] ?? TERRAIN.flat;
  const prep = state.grid.layers.prep[idx] ?? PREP.wild;
  if (terrain === TERRAIN.rock && !isPreparedGround(prep)) return false;
  return (
    terrain !== TERRAIN.deep &&
    terrain !== TERRAIN.shallow &&
    terrain !== TERRAIN.hole &&
    prep !== PREP.ridge &&
    prep !== PREP.moat
  );
}

function findNearestCombatTestSpawnTile(
  state: PlanetState,
  cq: number,
  cr: number,
  check: (q: number, r: number) => boolean,
): { q: number; r: number } | null {
  for (let dist = 0; dist <= Math.min(20, state.grid.radius); dist++) {
    for (let dq = -dist; dq <= dist; dq++) {
      for (let dr = -dist; dr <= dist; dr++) {
        if (hexDistance(0, 0, dq, dr) !== dist) continue;
        const q = cq + dq;
        const r = cr + dr;
        if (inHex(q, r, state.grid.radius) && check(q, r)) return { q, r };
      }
    }
  }
  return null;
}

export const devSpawnRaid = defineCommandHandler({
  kind: 'dev.spawnraid',
  wave: 'W07',
  handle(state, cmd, ctx) {
    const args = (cmd.args ?? {}) as {
      hiveId?: number;
      species?: string;
      colonyIndex?: number;
      q?: number;
      r?: number;
      count?: number;
      budget?: number;
    };
    const colonyIndex = resolveColonyIdx(cmd, args.colonyIndex);
    ensureDevColony(state, colonyIndex, ctx.tick);
    const combatTestMode = isCombatTestWorld(state);
    if (!hasAnyAliveColonyEntity(state, colonyIndex)) {
      if (combatTestMode) return 'no_target_entities';
      spawnHqUnit(state, { owner: colonyIndex, q: 0, r: 0 });
    }

    const resolved = selectOrSpawnRaidHive(state, colonyIndex, args, ctx);
    if (resolved.error || !resolved.hive) return resolved.error ?? 'unknown_entity';

    const hive = resolved.hive;
    const cost = Math.max(1, getFaunaSpeciesThreatCost(hive.species));
    const budget =
      args.budget ??
      (resolved.countOverride !== undefined ? Math.max(cost, resolved.countOverride * cost) : undefined);

    if (budget === undefined) {
      provokeHive(state, hive.hiveId, colonyIndex, ctx.tick, ctx.data, ctx);
    }
    const afterProvoke = getFaunaHivesState(state).hivesById[hive.hiveId];
    const activeId = afterProvoke?.aggressionByColony[colonyIndex]?.activeCohortId;
    const alreadyDispatchedThisTick =
      Boolean(activeId) && afterProvoke?.aggressionByColony[colonyIndex]?.lastWaveTick === ctx.tick;

    let dispatchedCount = alreadyDispatchedThisTick
      ? (getFaunaHivesState(state).cohortsById[activeId!]?.memberIds.length ?? 0)
      : 0;

    if (dispatchedCount === 0) {
      dispatchedCount = dispatchRaidFromHive(state, hive.hiveId, colonyIndex, budget, ctx);
    }
    if (dispatchedCount === 0) {
      replenishHiveResidentsForDevRaid(state, hive.hiveId, colonyIndex, ctx);
      dispatchRaidFromHive(state, hive.hiveId, colonyIndex, budget, ctx);
    }

    const latestFauna = getFaunaHivesState(state);
    const latestHive = latestFauna.hivesById[hive.hiveId];
    const cohortId = latestHive?.aggressionByColony[colonyIndex]?.activeCohortId;
    const cohort = cohortId ? latestFauna.cohortsById[cohortId] : undefined;
    if (latestHive && cohort) {
      emitFaunaDirective(
        state,
        {
          effectiveTick: ctx.tick,
          hiveId: latestHive.hiveId,
          decisionIndex: ++latestHive.decisionIndex,
          kind: 'cohortDispatch',
          payload: {
            cohortId: cohort.cohortId,
            species: latestHive.species,
            memberIds: [...cohort.memberIds],
            targetColony: colonyIndex,
            ...(cohort.targetEntityId !== null ? { targetEntityId: cohort.targetEntityId } : {}),
          },
        },
        ctx,
      );
    }
  },
});

export const devSpawnHive = defineCommandHandler({
  kind: 'dev.spawnhive',
  wave: 'W07',
  handle(state, cmd, ctx) {
    const args = (cmd.args ?? {}) as {
      species?: string;
      q?: number;
      r?: number;
      mode?: string;
      colonyIndex?: number;
      entranceQ?: number;
      entranceR?: number;
      initialResidents?: number;
    };
    const species = args.species ?? 'blackAnt';
    if (!isSpecies(species)) return 'invalid_args';
    const mode = args.mode ?? 'passive';
    if (mode !== 'passive' && mode !== 'aggressive') return 'invalid_args';

    const colonyIndex = resolveColonyIdx(cmd, args.colonyIndex);
    ensureDevColony(state, colonyIndex, ctx.tick);
    const anchor = findColonyAnchorTile(state, colonyIndex);
    const hasExplicitCoords = args.q !== undefined || args.r !== undefined;
    let q = args.q ?? Math.min(state.grid.radius - 3, anchor.q + 15);
    let r = args.r ?? anchor.r;
    if (hasExplicitCoords) {
      if (!inHex(q, r, state.grid.radius)) return 'invalid_args';
    } else if (!inHex(q, r, state.grid.radius)) {
      q = anchor.q;
      r = anchor.r;
    }

    const combatTest = isCombatTestWorld(state);
    const blocked = collectBlockedHiveTiles(state, ctx.data);
    if (hasExplicitCoords) {
      if (!isHiveSitePlaceable(state, q, r, { data: ctx.data, blocked, disallowAllOwned: combatTest })) {
        return 'site_blocked';
      }
    } else {
      const found = findNearestHiveSpawnTile(state, q, r, { data: ctx.data, blocked, disallowAllOwned: combatTest });
      if (!found) return 'site_blocked';
      q = found.q;
      r = found.r;
    }

    const hiveId = spawnHiveSite(
      state,
      {
        species,
        q,
        r,
        footprintW: 3,
        footprintD: 3,
        ...(args.entranceQ !== undefined ? { entranceQ: args.entranceQ } : {}),
        ...(args.entranceR !== undefined ? { entranceR: args.entranceR } : {}),
        ...(args.initialResidents !== undefined ? { initialResidents: args.initialResidents } : {}),
      },
      ctx.tick,
      ctx.data,
    );

    if (mode === 'aggressive') {
      provokeHive(state, hiveId, colonyIndex, ctx.tick, ctx.data, ctx);
    }
  },
});

function buildOccupiedDevSpawnSet(state: PlanetState, data?: StepContext['data']): Set<number> {
  const occupied = new Set<number>(occupiedGroundTiles(state, data));
  for (const w of getWreckTileSet(state)) occupied.add(w);
  const unitOcc = collectUnitOccupancy(state, -1, undefined, data);
  for (const c of unitOcc.claimedGoals) occupied.add(c);
  for (const t of unitOcc.inTransitGoals) occupied.add(t);
  const idx = hexIndex(state.grid.radius);
  for (let r = 0; r < state.entities.count; r++) {
    if (state.entities.cols.hp[r]! <= 0 || state.entities.cols.state[r] === ENTITY_STATE.inert) continue;
    const ti = idx.indexOf(state.entities.cols.q[r]!, state.entities.cols.r[r]!);
    if (ti >= 0) occupied.add(ti);
  }
  return occupied;
}

function claimFreeDevSpawnHex(state: PlanetState, occupied: Set<number>, prefQ: number, prefR: number): { q: number; r: number } {
  const idx = hexIndex(state.grid.radius);
  for (let ring = 0; ring <= Math.min(14, state.grid.radius); ring++) {
    for (const [cq, cr] of ringCoords(prefQ, prefR, ring)) {
      if (!inHex(cq, cr, state.grid.radius)) continue;
      const ti = idx.indexOf(cq, cr);
      if (ti < 0 || occupied.has(ti) || !isCombatTestPassableTile(state, cq, cr)) continue;
      occupied.add(ti);
      return { q: cq, r: cr };
    }
  }
  return { q: prefQ, r: prefR };
}

export const devSpawnUnit = defineCommandHandler({
  kind: 'dev.spawnunit',
  wave: 'W07',
  handle(state, cmd, ctx) {
    const args = (cmd.args ?? {}) as {
      unit?: string;
      q?: number;
      r?: number;
      count?: number;
      colonyIndex?: number;
      owner?: number;
      mode?: 'passive' | 'aggressive';
      targetColony?: number;
    };
    const unitRaw = typeof args.unit === 'string' ? args.unit.trim() : '';
    const count = args.count ?? 1;
    if (!unitRaw || !Number.isInteger(count) || count <= 0 || count > 100) return 'invalid_args';

    const colonyIndex = resolveColonyIdx(cmd, args.colonyIndex);
    const owner = args.owner !== undefined ? args.owner : colonyIndex;
    if (owner >= 0) ensureDevColony(state, owner, ctx.tick);
    const anchor = findColonyAnchorTile(state, owner >= 0 ? owner : colonyIndex);
    let baseQ = args.q ?? anchor.q + 1;
    let baseR = args.r ?? anchor.r;
    if (!inHex(baseQ, baseR, state.grid.radius)) return 'invalid_args';
    const combatTest = isCombatTestWorld(state);
    if (combatTest && !isCombatTestPassableTile(state, baseQ, baseR)) {
      if (args.q !== undefined || args.r !== undefined) return 'site_blocked';
      const dry = findNearestCombatTestSpawnTile(state, baseQ, baseR, (tq, tr) => isCombatTestPassableTile(state, tq, tr));
      if (!dry) return 'site_blocked';
      baseQ = dry.q;
      baseR = dry.r;
    }

    if (isSpecies(unitRaw)) {
      const fallbackHp: Record<FaunaSpeciesId, number> = { blackAnt: 85, blueBeetle: 320, greenSpitter: 130 };
      const cfg = resolveSpeciesConfig(unitRaw, ctx.data);
      const bugMode = args.mode ?? 'passive';
      const targetColony = bugMode === 'aggressive' ? (args.targetColony ?? colonyIndex) : null;
      const occupiedTiles = buildOccupiedDevSpawnSet(state, ctx.data);
      for (let i = 0; i < count; i++) {
        const free = claimFreeDevSpawnHex(state, occupiedTiles, baseQ, baseR);
        spawnFaunaBug(
          state,
          { species: unitRaw, q: free.q, r: free.r, hp: cfg.hp || fallbackHp[unitRaw], mode: bugMode, targetColony },
          ctx.tick,
          ctx.data,
        );
      }
      return;
    }

    const spec = resolveColonyUnitSpec(unitRaw, ctx);
    if (!spec) return 'invalid_args';

    const spreadRow = (unitRaw === 'builder' || unitRaw === 'harvester') && count > 1 && args.q !== undefined && args.r !== undefined;
    if (spreadRow) {
      for (let i = 0; i < count; i++) {
        if (!inHex(baseQ + (i % 6), baseR + Math.floor(i / 6), state.grid.radius)) return 'invalid_args';
      }
    }

    const occupiedTiles = buildOccupiedDevSpawnSet(state, ctx.data);
    for (let i = 0; i < count; i++) {
      let uQ = spreadRow ? baseQ + (i % 6) : baseQ;
      let uR = spreadRow ? baseR + Math.floor(i / 6) : baseR;
      if (combatTest && spreadRow && !isCombatTestPassableTile(state, uQ, uR)) {
        uQ = baseQ;
        uR = baseR;
      }
      const chosen = claimFreeDevSpawnHex(state, occupiedTiles, uQ, uR);
      uQ = chosen.q;
      uR = chosen.r;
      const entityId = ctx.newEntityId();
      const row = insertRow(state.entities, entityId, ctx.tick);
      const cols = state.entities.cols;
      cols.kind[row] = spec.kind;
      cols.owner[row] = owner;
      cols.tier[row] = spec.tier ?? 1;
      cols.hp[row] = Math.fround(spec.hp);
      cols.hpMax[row] = Math.fround(spec.hp);
      cols.state[row] = ENTITY_STATE.idle;
      cols.workRate[row] = 1.0;
      placeSpawnedEntity(state.entities, row, uQ, uR, ctx.tick);
      if (owner >= 0) {
        revealVision(state, owner, uQ, uR, spec.viewRadius, ctx.tick);
      }
      syncSpawnedColonyUnitView(state, row, spec, ctx);
      setUnitStance(state, entityId, 'defend', { q: uQ, r: uR }, ctx.tick);
    }

    if (owner >= 0) {
      evaluateColonySupply(state, owner, ctx.tick, ctx.data);
      recomputeAllColonyPower(state, ctx.data, ctx.tick);
    }
  },
});

export const devGodMode = defineCommandHandler({
  kind: 'dev.godmode',
  wave: 'W07',
  handle(state, cmd, ctx) {
    const args = (cmd.args ?? {}) as { enabled?: boolean; colonyIndex?: number };
    const colonyIndex = resolveColonyIdx(cmd, args.colonyIndex);
    const colony = ensureDevColony(state, colonyIndex, ctx.tick);
    const current = isColonyGodMode(state, colonyIndex);
    const nextEnabled = typeof args.enabled === 'boolean' ? args.enabled : !current;

    const prevRaw = (state.blobs.godMode?.value ?? state.blobs.godMode) as
      | { byColony?: Record<number, boolean> }
      | undefined;
    const byColony: Record<number, boolean> = { ...(prevRaw?.byColony ?? {}), [colonyIndex]: nextEnabled };
    setBlob(state, 'godMode', { byColony }, ctx.tick);
    (colony as { godMode?: boolean }).godMode = nextEnabled;
    colony.changedAt = ctx.tick;
  },
});

export const devFaunaMode = defineCommandHandler({
  kind: 'dev.faunamode',
  wave: 'W07',
  handle(state, cmd, ctx) {
    const args = (cmd.args ?? {}) as {
      id?: number;
      entityId?: number;
      hiveId?: number;
      mode?: FaunaBehaviorMode;
      targetId?: number;
      targetQ?: number;
      targetR?: number;
      q?: number;
      r?: number;
      colonyIndex?: number;
    };
    const entityId = args.id ?? args.entityId ?? args.hiveId;
    if (typeof entityId !== 'number' || !Number.isInteger(entityId) || entityId <= 0) {
      return 'invalid_args';
    }
    if (args.mode !== undefined && args.mode !== 'passive' && args.mode !== 'aggressive') {
      return 'invalid_args';
    }

    let targetQ = args.targetQ ?? args.q;
    let targetR = args.targetR ?? args.r;
    let targetOwner: number | undefined;
    if (args.targetId !== undefined) {
      const tRow = rowOf(state.entities, args.targetId);
      if (tRow < 0 || state.entities.cols.hp[tRow]! <= 0) return 'unknown_entity';
      targetQ = targetQ ?? state.entities.cols.q[tRow]!;
      targetR = targetR ?? state.entities.cols.r[tRow]!;
      if (state.entities.cols.owner[tRow]! >= 0) targetOwner = state.entities.cols.owner[tRow]!;
    }

    const colonyIndex = targetOwner ?? resolveColonyIdx(cmd, args.colonyIndex);
    const hasRetarget = args.targetId !== undefined || (targetQ !== undefined && targetR !== undefined);
    const nextMode: FaunaBehaviorMode = args.mode ?? (hasRetarget ? 'aggressive' : 'passive');
    const { row, isHive, isBug } = classifyFaunaEntity(state, entityId);
    if (!isHive && !isBug) return 'unknown_entity';

    if (isHive) {
      return applyHiveFaunaMode(
        state,
        entityId,
        nextMode,
        colonyIndex,
        hasRetarget,
        args.targetId,
        targetQ,
        targetR,
        ctx,
      );
    }

    applyBugFaunaMode(state, entityId, row, nextMode, colonyIndex, hasRetarget, args.targetId, targetQ, targetR, ctx);
  },
});
