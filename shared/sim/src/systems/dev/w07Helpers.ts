import type { CompiledRow } from '../../data';
import { ENTITY_KIND } from '../../ecs/columns';
import { rowOf, setField } from '../../ecs/store';
import { hexDistance } from '../../grid/hex';
import type { SimCommand } from '../../kernel/commands';
import type { StepContext } from '../../kernel/context';
import { setBlob, type PlanetState } from '../../kernel/state';
import { isFaunaBugKind, isFaunaHiveKind } from '../combat/damage';
import { commandColony } from '../command';
import { ensureColonyLedger } from '../economy/ledger';
import { syncReconView } from '../factories-hub/robotics';
import { syncBuilderView } from '../factories-hub/unit';
import { emitFaunaDirective } from '../fauna/directives';
import { clearHiveAggression, provokeFaunaBug, provokeHive } from '../fauna/provocation';
import { spawnFaunaBug, spawnHiveSite, spawnResidentBug } from '../fauna/spawn';
import { getFaunaHivesState, saveFaunaHivesState } from '../fauna/state';
import {
  resolveSpeciesConfig,
  speciesOfEntityKind,
  type FaunaBehaviorMode,
  type FaunaSpeciesId,
  type HiveRecord,
} from '../fauna/types';
import { resolveWaveConfig, selectCandidateHiveForRaid } from '../fauna/waves';
import { syncHarvesterView, withoutUnitView } from '../harvest/unit';
import { issueUnitCommand } from '../units/registry';

const VALID_SPECIES = new Set<FaunaSpeciesId>(['blackAnt', 'blueBeetle', 'greenSpitter']);

export function isSpecies(v: unknown): v is FaunaSpeciesId {
  return typeof v === 'string' && VALID_SPECIES.has(v as FaunaSpeciesId);
}

export function ensureDevColony(state: PlanetState, colonyIndex: number, tick: number) {
  let colony = state.colonies.find((c) => c && c.index === colonyIndex);
  if (!colony) {
    colony = {
      index: colonyIndex,
      id: `col-${colonyIndex}`,
      name: `Colony ${colonyIndex + 1}`,
      color: 0x3a7bd5,
      status: 'active',
      changedAt: tick,
    };
    state.colonies[colonyIndex] = colony;
  }
  return ensureColonyLedger(colony);
}

export function resolveColonyIdx(cmd: SimCommand, explicit?: number): number {
  if (typeof explicit === 'number' && Number.isInteger(explicit) && explicit >= 0) return explicit;
  const fromCmd = commandColony(cmd);
  return typeof fromCmd === 'number' && fromCmd >= 0 ? fromCmd : 0;
}

export function findColonyAnchorTile(state: PlanetState, colonyIndex: number): { q: number; r: number } {
  const cols = state.entities.cols;
  let fallback: { q: number; r: number } | null = null;
  for (let r = 0; r < state.entities.count; r++) {
    if (cols.owner[r] !== colonyIndex || cols.hp[r]! <= 0) continue;
    const k = cols.kind[r]!;
    if (k === ENTITY_KIND.hq || k === ENTITY_KIND.commandHub) {
      return { q: cols.q[r]!, r: cols.r[r]! };
    }
    if (!fallback) fallback = { q: cols.q[r]!, r: cols.r[r]! };
  }
  return fallback ?? { q: 0, r: 0 };
}

export function replenishHiveResidentsForDevRaid(
  state: PlanetState,
  hiveId: number,
  colonyIndex: number,
  ctx: StepContext,
): void {
  const fauna = getFaunaHivesState(state);
  const hive = fauna.hivesById[hiveId];
  if (!hive || hive.destroyed) return;

  if (hive.lastWaveTickByColony) delete hive.lastWaveTickByColony[colonyIndex];
  const waveCfg = resolveWaveConfig(ctx.data);
  hive.aggressionByColony[colonyIndex] = {
    colonyIndex,
    triggeredAtTick: ctx.tick,
    wavesSent: 0,
    maxWaves: waveCfg.maxWavesPerEpisode,
    lastWaveTick: -999999,
    activeCohortId: null,
  };
  hive.mode = 'aggressive';
  if (!hive.aggressiveColonies.includes(colonyIndex)) {
    hive.aggressiveColonies = [...hive.aggressiveColonies, colonyIndex].sort((a, b) => a - b);
  }
  for (const bugId of hive.residentIds) {
    const bug = fauna.bugsById[bugId];
    if (bug) bug.cohortId = null;
  }
  saveFaunaHivesState(state, fauna, ctx.tick);

  const needed = Math.max(1, hive.popCap - hive.residentIds.length);
  for (let i = 0; i < needed; i++) {
    const spawned = spawnResidentBug(state, hiveId, ctx.tick, ctx.data);
    if (spawned === null) {
      spawnFaunaBug(
        state,
        { species: hive.species, q: hive.entranceQ, r: hive.entranceR, homeHiveId: hiveId },
        ctx.tick,
        ctx.data,
      );
    }
  }
}

export function selectOrSpawnRaidHive(
  state: PlanetState,
  colonyIndex: number,
  args: { hiveId?: number; species?: string; q?: number; r?: number; count?: number },
  ctx: StepContext,
): { hive: HiveRecord | null; countOverride?: number; error?: string } {
  const species = args.species !== undefined ? (isSpecies(args.species) ? args.species : null) : undefined;
  if (species === null) return { hive: null, error: 'invalid_args' };

  const fauna = getFaunaHivesState(state);
  let countOverride = args.count;

  if (args.hiveId !== undefined) {
    const byId = fauna.hivesById[args.hiveId];
    if (byId && !byId.destroyed) return { hive: byId, countOverride };
    if (args.hiveId > 0 && args.hiveId <= 12) {
      countOverride = args.count ?? args.hiveId;
    } else {
      return { hive: null, error: 'unknown_entity' };
    }
  }

  let candidate = selectCandidateHiveForRaid(state, colonyIndex, { species, data: ctx.data });
  if (!candidate) {
    const anchor = findColonyAnchorTile(state, colonyIndex);
    const live = Object.values(fauna.hivesById)
      .filter((h) => !h.destroyed && (!species || h.species === species))
      .sort((a, b) => hexDistance(a.q, a.r, anchor.q, anchor.r) - hexDistance(b.q, b.r, anchor.q, anchor.r));
    candidate = live[0] ?? null;
  }
  if (candidate) return { hive: candidate, countOverride };

  const anchor = findColonyAnchorTile(state, colonyIndex);
  const spawnQ = args.q ?? Math.min(state.grid.radius - 2, anchor.q + 10);
  const spawnR = args.r ?? anchor.r;
  const newHiveId = spawnHiveSite(
    state,
    { species: species ?? 'blackAnt', q: spawnQ, r: spawnR },
    ctx.tick,
    ctx.data,
  );
  return { hive: getFaunaHivesState(state).hivesById[newHiveId] ?? null, countOverride };
}

export interface ColonyUnitSpawnSpec {
  canonicalUnit: 'recon' | 'demoTank' | 'demoArtillery' | 'harvester' | 'builder';
  kind: number;
  hp: number;
  viewRadius: number;
  label: string;
  archetype: string;
}

export function resolveColonyUnitSpec(unitRaw: string, ctx: StepContext): ColonyUnitSpawnSpec | null {
  const combatTbl = ctx.data?.tables?.combatUnits as Record<string, CompiledRow | undefined> | undefined;
  const workerTbl = ctx.data?.tables?.unitsWorkersBasic as Record<string, CompiledRow | undefined> | undefined;
  const gridTbl = ctx.data?.tables?.grid as Record<string, CompiledRow | undefined> | undefined;

  if (unitRaw === 'recon') {
    const r = combatTbl?.recon;
    return {
      canonicalUnit: 'recon',
      kind: ENTITY_KIND.recon,
      hp: Number(r?.hp ?? 240),
      viewRadius: Number(r?.viewRadius ?? 8),
      label: String(r?.label ?? 'Recon Drone'),
      archetype: String(r?.archetype ?? 'unit.recon'),
    };
  }
  if (unitRaw === 'demoTank' || unitRaw === 'tank') {
    const r = combatTbl?.demoTank;
    return {
      canonicalUnit: 'demoTank',
      kind: ENTITY_KIND.demoTank,
      hp: Number(r?.hp ?? 520),
      viewRadius: Number(r?.viewRadius ?? 6),
      label: 'Assault Tank',
      archetype: 'robot.tank',
    };
  }
  if (unitRaw === 'demoArtillery' || unitRaw === 'artillery') {
    const r = combatTbl?.demoArtillery;
    return {
      canonicalUnit: 'demoArtillery',
      kind: ENTITY_KIND.demoArtillery,
      hp: Number(r?.hp ?? 320),
      viewRadius: Number(r?.viewRadius ?? 6),
      label: 'Mobile Artillery',
      archetype: 'robot.artillery',
    };
  }
  if (unitRaw === 'harvester') {
    const r = workerTbl?.harvester;
    return {
      canonicalUnit: 'harvester',
      kind: ENTITY_KIND.harvester,
      hp: Number(r?.hp ?? 120),
      viewRadius: Number(r?.viewRadius ?? 7),
      label: String(r?.label ?? 'Harvester Drone'),
      archetype: String(r?.archetype ?? 'robot.miner'),
    };
  }
  if (unitRaw === 'builder') {
    const r = gridTbl?.builder ?? workerTbl?.builder;
    return {
      canonicalUnit: 'builder',
      kind: ENTITY_KIND.builder,
      hp: Number(r?.hp ?? 100),
      viewRadius: Number(r?.viewRadius ?? 7),
      label: String(r?.label ?? 'Builder Drone'),
      archetype: String(r?.archetype ?? 'robot.builder'),
    };
  }
  return null;
}

export function syncSpawnedColonyUnitView(
  state: PlanetState,
  row: number,
  spec: ColonyUnitSpawnSpec,
  ctx: StepContext,
): void {
  if (spec.canonicalUnit === 'recon') {
    syncReconView(state, row, ctx.tick, ctx.data);
    return;
  }
  if (spec.canonicalUnit === 'harvester') {
    syncHarvesterView(state, row, ctx.tick, ctx.data);
    return;
  }
  if (spec.canonicalUnit === 'builder') {
    syncBuilderView(state, row, ctx.tick, ctx.data);
    return;
  }
  const cols = state.entities.cols;
  const entityId = cols.id[row]!;
  const owner = cols.owner[row]!;
  const viewEntry = {
    entityId,
    kind: cols.kind[row]!,
    unit: spec.canonicalUnit,
    label: spec.label,
    archetype: spec.archetype,
    owner,
    tier: 1,
    q: cols.q[row]!,
    r: cols.r[row]!,
    x: cols.x[row]!,
    y: cols.y[row]!,
    hp: cols.hp[row]!,
    hpMax: cols.hpMax[row]!,
    supply: 2,
    powerDrainPerS: 2,
    viewRadius: spec.viewRadius,
    targetQ: cols.targetQ[row]!,
    targetR: cols.targetR[row]!,
    state: cols.state[row]!,
    stance: 'defend',
  };
  const prevUnits = (state.blobs.units?.value as Record<string, unknown> | undefined) ?? {};
  setBlob(state, 'units', { ...prevUnits, [entityId]: viewEntry }, ctx.tick);
  if (owner >= 0 && state.colonies[owner]) {
    const col = state.colonies[owner]!;
    col.units = [...withoutUnitView(col.units, entityId), viewEntry];
    col.changedAt = ctx.tick;
  }
}

export function retargetHiveBugs(
  state: PlanetState,
  hive: HiveRecord,
  colonyIndex: number,
  targetId: number | undefined,
  objQ: number,
  objR: number,
  ctx: StepContext,
): void {
  const fauna = getFaunaHivesState(state);
  const liveHive = fauna.hivesById[hive.hiveId];
  if (!liveHive) return;
  const activeCohortId = liveHive.aggressionByColony[colonyIndex]?.activeCohortId ?? undefined;

  emitFaunaDirective(
    state,
    {
      effectiveTick: ctx.tick,
      hiveId: liveHive.hiveId,
      decisionIndex: ++liveHive.decisionIndex,
      kind: 'targetChange',
      payload: {
        ...(activeCohortId ? { cohortId: activeCohortId } : {}),
        targetColony: colonyIndex,
        ...(targetId !== undefined ? { targetEntityId: targetId } : {}),
        objectiveQ: objQ,
        objectiveR: objR,
      },
    },
    ctx,
  );

  const afterDirective = getFaunaHivesState(state);
  const updatedHive = afterDirective.hivesById[hive.hiveId];
  if (!updatedHive) return;
  const cohort = activeCohortId ? afterDirective.cohortsById[activeCohortId] : undefined;
  if (cohort && targetId !== undefined) cohort.targetEntityId = targetId;

  const memberIds = cohort ? cohort.memberIds : updatedHive.residentIds;
  const cfg = resolveSpeciesConfig(updatedHive.species, ctx.data);
  const bandMax = cfg.range >= 2 ? Math.floor(cfg.range) - 1 : 1;

  for (const bugId of memberIds) {
    const bug = afterDirective.bugsById[bugId];
    if (bug) {
      bug.mode = 'aggressive';
      bug.targetColony = colonyIndex;
      if (!bug.aggressiveColonies.includes(colonyIndex)) {
        bug.aggressiveColonies = [...bug.aggressiveColonies, colonyIndex].sort((a, b) => a - b);
      }
    }
    const bRow = rowOf(state.entities, bugId);
    if (bRow >= 0 && state.entities.cols.hp[bRow]! > 0) {
      issueUnitCommand(
        state,
        bRow,
        { kind: 'move', source: 'player', q: objQ, r: objR, minDist: 0, maxDist: bandMax },
        ctx,
      );
      setField(state.entities, bRow, 'targetQ', objQ, ctx.tick);
      setField(state.entities, bRow, 'targetR', objR, ctx.tick);
    }
  }
  saveFaunaHivesState(state, afterDirective, ctx.tick);
}

export function applyHiveFaunaMode(
  state: PlanetState,
  entityId: number,
  nextMode: FaunaBehaviorMode,
  colonyIndex: number,
  hasRetarget: boolean,
  targetId: number | undefined,
  targetQ: number | undefined,
  targetR: number | undefined,
  ctx: StepContext,
): string | undefined {
  const fauna = getFaunaHivesState(state);
  const hive = fauna.hivesById[entityId];
  if (!hive || hive.destroyed) return 'unknown_entity';

  if (nextMode === 'passive') {
    for (const col of [...hive.aggressiveColonies, colonyIndex]) {
      clearHiveAggression(state, entityId, col, ctx.tick);
    }
    emitFaunaDirective(
      state,
      {
        effectiveTick: ctx.tick,
        hiveId: entityId,
        decisionIndex: ++hive.decisionIndex,
        kind: 'mode',
        payload: { mode: 'passive', targetColony: colonyIndex },
      },
      ctx,
    );
    return undefined;
  }

  provokeHive(state, entityId, colonyIndex, ctx.tick, ctx.data, ctx);
  emitFaunaDirective(
    state,
    {
      effectiveTick: ctx.tick,
      hiveId: entityId,
      decisionIndex: ++hive.decisionIndex,
      kind: 'mode',
      payload: { mode: 'aggressive', targetColony: colonyIndex },
    },
    ctx,
  );
  if (hasRetarget && targetQ !== undefined && targetR !== undefined) {
    retargetHiveBugs(state, hive, colonyIndex, targetId, targetQ, targetR, ctx);
  }
  return undefined;
}

export function applyBugFaunaMode(
  state: PlanetState,
  entityId: number,
  row: number,
  nextMode: FaunaBehaviorMode,
  colonyIndex: number,
  hasRetarget: boolean,
  targetId: number | undefined,
  targetQ: number | undefined,
  targetR: number | undefined,
  ctx: StepContext,
): void {
  const fauna = getFaunaHivesState(state);
  if (nextMode === 'passive') {
    const bug = fauna.bugsById[entityId];
    if (bug) {
      bug.mode = 'passive';
      bug.targetColony = null;
      bug.aggressiveColonies = [];
      bug.cohortId = null;
      saveFaunaHivesState(state, fauna, ctx.tick);
    } else {
      setBlob(state, 'faunaMode', { byEntityId: { [entityId]: 'passive' } }, ctx.tick);
    }
    emitFaunaDirective(
      state,
      {
        effectiveTick: ctx.tick,
        hiveId: bug?.homeHiveId ?? 0,
        decisionIndex: 1,
        kind: 'mode',
        payload: { bugId: entityId, mode: 'passive' },
      },
      ctx,
    );
    return;
  }

  const existingBug = fauna.bugsById[entityId];
  emitFaunaDirective(
    state,
    {
      effectiveTick: ctx.tick,
      hiveId: existingBug?.homeHiveId ?? 0,
      decisionIndex: 1,
      kind: hasRetarget ? 'targetChange' : 'mode',
      payload: {
        bugId: entityId,
        species:
          existingBug?.species ??
          (row >= 0 ? (speciesOfEntityKind(state.entities.cols.kind[row]!) ?? 'blackAnt') : 'blackAnt'),
        mode: 'aggressive',
        targetColony: colonyIndex,
        ...(targetId !== undefined ? { targetEntityId: targetId } : {}),
        ...(targetQ !== undefined && targetR !== undefined ? { objectiveQ: targetQ, objectiveR: targetR } : {}),
      },
    },
    ctx,
  );
  provokeFaunaBug(state, entityId, colonyIndex, { targetId, targetQ, targetR, tick: ctx.tick, data: ctx.data }, ctx);
}

export function classifyFaunaEntity(state: PlanetState, entityId: number): { row: number; isHive: boolean; isBug: boolean } {
  const fauna = getFaunaHivesState(state);
  const row = rowOf(state.entities, entityId);
  const isHive = Boolean(fauna.hivesById[entityId]) || (row >= 0 && isFaunaHiveKind(state.entities.cols.kind[row]!));
  const isBug = Boolean(fauna.bugsById[entityId]) || (row >= 0 && isFaunaBugKind(state.entities.cols.kind[row]!));
  return { row, isHive, isBug };
}
