import type { SimCommandV1 } from '@terra/contracts';
import { ENTITY_KIND } from '../../ecs/columns';
import { hexIndex } from '../../grid/hex';
import { isGroundPassable } from '../../grid/tileModel';
import type { CompiledDataLike } from '../../kernel/config';
import type { ColonyState, PlanetState } from '../../kernel/state';
import { isTruceReofferCoolingDown } from '../diplomacy/operations';
import { hasActiveTruce, peekDiplomacyBlob } from '../diplomacy/store';
import { checkCostAffordability } from '../economy/ledger';
import { getColonyGoals, isGoalExecutable } from '../goals';
import type { ColonyPowerSummary } from '../power-core/types';
import { getColonyQueue } from '../queue';
import { checkItemUnlockStage } from '../progression/validate';
import { selectDeterministicBuildSite, shouldExpandPowerZoneWithPylon } from '../rule-engine/site';
import {
  findTerritoryObstacleToClear,
  findTerritoryTileToCultivate,
  hasAvailableTerraformBuilder,
} from '../terraform-basic/aiTerritory';
import { getRivalColonyMeta, isRivalAiColony, readRivalAiBlob } from './store';
import {
  actorIdOfBot,
  buildingCostOf,
  crossedCadence,
  findNearestPassableDeposit,
  scanColonyState,
  sectorOfColony,
  stockCount,
  type ColonyScan,
} from './plannerScan';

export interface PlannedBotDecision {
  readonly colonyIndex: number;
  readonly colonyId: string;
  readonly sectorId: string;
  readonly actorId: string;
  readonly actorSource: 'bot_governor';
  readonly decisionKind: string;
  readonly summary: string;
  readonly rationale: string;
  readonly commandId?: string;
  readonly commandKind?: string;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly atTick: number;
}

export interface PlannedBotActionBatch {
  readonly commands: readonly SimCommandV1[];
  readonly decisions: readonly PlannedBotDecision[];
}

const PLAN_CADENCE_TICKS = 10;
const DIPLO_CADENCE_TICKS = 40;
const PATROL_OFFSETS: readonly [number, number][] = [
  [3, -1],
  [2, 2],
  [-2, 3],
  [-3, 0],
  [-1, -3],
  [3, -2],
];

function resolveBotPersona(state: PlanetState, col: ColonyState): string {
  const meta = getRivalColonyMeta(state, col.index);
  if (meta?.persona) return meta.persona;
  const raw = (col as { botPersona?: unknown }).botPersona;
  return typeof raw === 'string' && raw ? raw : 'trader';
}

function makeDecision(
  state: PlanetState,
  col: ColonyState,
  decisionKind: string,
  summary: string,
  rationale: string,
  cmdId: string,
  commandKind: string,
  payload: Readonly<Record<string, unknown>>,
  tick: number,
): PlannedBotDecision {
  return {
    colonyIndex: col.index,
    colonyId: col.id,
    sectorId: sectorOfColony(col),
    actorId: actorIdOfBot(state, col),
    actorSource: 'bot_governor',
    decisionKind,
    summary,
    rationale,
    commandId: cmdId,
    commandKind,
    payload,
    atTick: tick,
  };
}

function pickBuildingOrder(
  state: PlanetState,
  col: ColonyState,
  persona: string,
  scan: ColonyScan,
  data: CompiledDataLike,
  flags: { has(w: string): boolean },
  tick: number,
  nextSeq: () => number,
): { cmd: SimCommandV1; decision: PlannedBotDecision } | null {
  if (!flags.has('W02')) return null;
  const constructionOpen = getColonyQueue(state, col.index).filter((e) => e.lane === 'construction');
  if (constructionOpen.length >= 2) return null;

  const queuedKinds = new Set(constructionOpen.map((e) => (e.task.kind === 'build' ? e.task.building : '')).filter(Boolean));
  const colPower = (col.power as ColonyPowerSummary | undefined) ??
    (state.blobs.power?.value as { byColony?: Record<number, ColonyPowerSummary> } | undefined)?.byColony?.[col.index];
  const netPower = typeof colPower?.net === 'number' ? colPower.net : 0;
  const brownout = Boolean(colPower?.brownout);

  const stage = Math.max(typeof col.stage === 'number' ? col.stage : 1, typeof col.unlockStage === 'number' ? col.unlockStage : 1);
  const targetTurrets = persona === 'warlord' ? 3 : 2;
  const candidates: Array<{ building: string; reason: string }> = [];

  if (brownout || netPower < 4 || scan.powerPlantCount === 0) {
    candidates.push({
      building: flags.has('W03') ? 'wind' : 'solar',
      reason: brownout ? 'Recovering from grid brownout' : `Expanding power supply (net ${netPower.toFixed(1)}/s)`,
    });
  }
  if (scan.extractorCount < 2) candidates.push({ building: 'metalsExtractor', reason: 'Increasing metals extraction capacity' });
  if (scan.turretCount < targetTurrets && stage >= 2 && flags.has('W07')) {
    candidates.push({ building: 'turret', reason: `Fortifying sector perimeter (${scan.turretCount}/${targetTurrets} turrets)` });
  }
  if (scan.factoryCount < 1 && stage >= 3 && flags.has('W07')) {
    candidates.push({ building: 'roboticsFactory', reason: 'Establishing Robotics Factory for combat production' });
  }
  if (stockCount(col, 'metals.t1') > 160 && scan.depotCount < 2) {
    candidates.push({ building: 'supplyDepot', reason: 'Expanding colony resource storage capacity' });
  }

  const pylonExpand =
    flags.has('W03') && !queuedKinds.has('pylon') && checkItemUnlockStage(state, col.index, 'pylon', flags, data).ok
      ? shouldExpandPowerZoneWithPylon(state, col.index, data, flags)
      : { needed: false, site: null };
  if (pylonExpand.needed && pylonExpand.site) {
    candidates.push({ building: 'pylon', reason: 'Extending power zone to keep spacious building corridors' });
  }

  const buildOrderAt = (building: string, q: number, r: number, reason: string) => {
    const cmdId = `bot_${tick}_${col.index}_${nextSeq()}`;
    return {
      cmd: {
        colonyIndex: col.index,
        source: 'bot' as const,
        commandId: cmdId,
        kind: 'enqueueTask',
        args: { build: { building, q, r, tier: 1 } },
      },
      decision: makeDecision(
        state,
        col,
        'build',
        `Queue ${building} at (${q}, ${r})`,
        reason,
        cmdId,
        'enqueueTask',
        { building, q, r, persona },
        tick,
      ),
    };
  };

  for (const cand of candidates) {
    if (queuedKinds.has(cand.building)) continue;
    if (!checkItemUnlockStage(state, col.index, cand.building, flags, data).ok) continue;
    if (!checkCostAffordability(col, buildingCostOf(cand.building, data)).ok) continue;
    const site = selectDeterministicBuildSite(state, col.index, cand.building, { data });
    if (site) return buildOrderAt(cand.building, site.q, site.r, cand.reason);
    if (
      cand.building !== 'pylon' &&
      pylonExpand.site &&
      !queuedKinds.has('pylon') &&
      checkItemUnlockStage(state, col.index, 'pylon', flags, data).ok &&
      checkCostAffordability(col, buildingCostOf('pylon', data)).ok
    ) {
      return buildOrderAt('pylon', pylonExpand.site.q, pylonExpand.site.r, 'Extending power zone for spacious placement');
    }
  }
  return null;
}

function planUnitProductionInput(
  state: PlanetState,
  col: ColonyState,
  persona: string,
  scan: ColonyScan,
  flags: { has(w: string): boolean },
  tick: number,
  nextSeq: () => number,
): { cmd: SimCommandV1; decision: PlannedBotDecision } | null {
  if (getColonyQueue(state, col.index).filter((e) => e.lane === 'units').length >= 2) return null;
  const metals = stockCount(col, 'metals.t1');
  const minerals = stockCount(col, 'minerals.t1');
  const stage = Math.max(typeof col.stage === 'number' ? col.stage : 1, typeof col.unlockStage === 'number' ? col.unlockStage : 1);

  let unit: 'worker' | 'recon' | null = null;
  let reason = '';
  if (flags.has('W07') && scan.factoryCount > 0 && stage >= 3 && scan.reconCount < (persona === 'warlord' ? 4 : 2) && metals >= 40 && minerals >= 15) {
    unit = 'recon';
    reason = `Producing combat recon (${scan.reconCount} active)`;
  } else if (scan.workerCount < 2 && metals >= 30 && flags.has('W02')) {
    unit = 'worker';
    reason = `Expanding worker fleet (${scan.workerCount}/2)`;
  }
  if (!unit) return null;

  const cmdId = `bot_${tick}_${col.index}_${nextSeq()}`;
  return {
    cmd: { colonyIndex: col.index, source: 'bot', commandId: cmdId, kind: 'enqueueTask', args: { buildUnit: { unit, count: 1 } } },
    decision: makeDecision(state, col, 'queue_unit', `Queue 1x ${unit}`, reason, cmdId, 'enqueueTask', { unit, count: 1, persona }, tick),
  };
}

function planWorkerTerritoryTask(
  state: PlanetState,
  col: ColonyState,
  data: CompiledDataLike,
  flags: { has(w: string): boolean },
  reserveHarvest: boolean,
  tick: number,
  nextSeq: () => number,
): { cmd: SimCommandV1; decision: PlannedBotDecision } | null {
  if (!flags.has('W01')) return null;
  const tfBuilder = hasAvailableTerraformBuilder(state, col.index, { reserveHarvestWorker: reserveHarvest });
  if (tfBuilder.ok && tfBuilder.workerId !== null) {
    const obs = findTerritoryObstacleToClear(state, col.index, { data, workerId: tfBuilder.workerId });
    if (obs) {
      const cmdId = `bot_${tick}_${col.index}_${nextSeq()}`;
      return {
        cmd: {
          colonyIndex: col.index,
          source: 'bot',
          commandId: cmdId,
          kind: 'enqueueTask',
          args: { terraform: { op: 'work', tiles: [{ q: obs.q, r: obs.r }], workerId: tfBuilder.workerId, intent: 'terraform' } },
        },
        decision: makeDecision(
          state,
          col,
          'terraform',
          `Clear ${obs.terrainKey} at (${obs.q}, ${obs.r})`,
          'Clearing territory obstacles to expand buildable space and unit corridors',
          cmdId,
          'enqueueTask',
          { op: 'work', q: obs.q, r: obs.r, workerId: tfBuilder.workerId },
          tick,
        ),
      };
    }
  }
  if (!flags.has('W05')) return null;
  const cult = findTerritoryTileToCultivate(state, col.index, { data });
  if (!cult || !checkItemUnlockStage(state, col.index, cult.op, flags, data).ok) return null;
  const cmdId = `bot_${tick}_${col.index}_${nextSeq()}`;
  return {
    cmd: {
      colonyIndex: col.index,
      source: 'bot',
      commandId: cmdId,
      kind: 'enqueueTask',
      args: { terraform: { op: cult.op, tiles: [{ q: cult.q, r: cult.r }] } },
    },
    decision: makeDecision(
      state,
      col,
      'terraform',
      `Cultivate (${cult.op}) at (${cult.q}, ${cult.r})`,
      `Advancing colony territory (${cult.op})`,
      cmdId,
      'enqueueTask',
      { op: cult.op, q: cult.q, r: cult.r },
      tick,
    ),
  };
}

function planTacticalAndWorkerInput(
  state: PlanetState,
  col: ColonyState,
  persona: string,
  scan: ColonyScan,
  data: CompiledDataLike,
  flags: { has(w: string): boolean },
  tick: number,
  nextSeq: () => number,
): Array<{ cmd: SimCommandV1; decision: PlannedBotDecision }> {
  const out: Array<{ cmd: SimCommandV1; decision: PlannedBotDecision }> = [];
  const recon = scan.idleUnits.find((u) => u.kind === ENTITY_KIND.recon);
  if (recon && flags.has('W07')) {
    if (scan.nearestEnemy && (persona === 'warlord' || scan.nearestEnemy.dist <= 14)) {
      const t = scan.nearestEnemy;
      const cmdId = `bot_${tick}_${col.index}_${nextSeq()}`;
      out.push({
        cmd: { colonyIndex: col.index, source: 'bot', commandId: cmdId, kind: 'attackMove', args: { entityId: recon.id, q: t.q, r: t.r } },
        decision: makeDecision(state, col, 'combat', `Attack-move recon #${recon.id} -> (${t.q}, ${t.r})`, `Engaging colony ${t.colonyIndex} at range ${t.dist}`, cmdId, 'attackMove', { entityId: recon.id, q: t.q, r: t.r, targetColonyIndex: t.colonyIndex }, tick),
      });
    } else {
      const hx = hexIndex(state.grid.radius);
      const baseOffset = Math.floor(tick / PLAN_CADENCE_TICKS) + recon.id;
      for (let attempt = 0; attempt < PATROL_OFFSETS.length; attempt++) {
        const slot = PATROL_OFFSETS[(baseOffset + attempt) % PATROL_OFFSETS.length]!;
        const pq = scan.anchorQ + slot[0];
        const pr = scan.anchorR + slot[1];
        const idx = hx.indexOf(pq, pr);
        if (idx < 0 || !isGroundPassable(state, idx, data) || (recon.q === pq && recon.r === pr)) continue;
        const cmdId = `bot_${tick}_${col.index}_${nextSeq()}`;
        out.push({
          cmd: { colonyIndex: col.index, source: 'bot', commandId: cmdId, kind: 'moveUnit', args: { entityId: recon.id, q: pq, r: pr } },
          decision: makeDecision(state, col, 'patrol', `Patrol recon #${recon.id} -> (${pq}, ${pr})`, 'Sweeping walkable sector perimeter around colony anchor', cmdId, 'moveUnit', { entityId: recon.id, q: pq, r: pr }, tick),
        });
        break;
      }
    }
  }

  const worker = scan.idleUnits.find((u) => u.kind === ENTITY_KIND.worker);
  if (worker && flags.has('W02') && scan.damagedBuilding) {
    const b = scan.damagedBuilding;
    const cmdId = `bot_${tick}_${col.index}_${nextSeq()}`;
    out.push({
      cmd: { colonyIndex: col.index, source: 'bot', commandId: cmdId, kind: 'enqueueTask', args: { repair: { entityId: b.id, q: b.q, r: b.r } } },
      decision: makeDecision(state, col, 'repair', `Repair entity #${b.id}`, `Structure integrity at ${Math.round(b.hpRatio * 100)}%`, cmdId, 'enqueueTask', { entityId: b.id }, tick),
    });
    return out;
  }

  const reserveHarvest = scan.harvestingWorkerCount === 0 && stockCount(col, 'metals.t1') < 120;
  if (worker && reserveHarvest) {
    const dep = findNearestPassableDeposit(state, worker.q, worker.r, 6, data);
    if (dep && (dep.q !== worker.q || dep.r !== worker.r)) {
      const cmdId = `bot_${tick}_${col.index}_${nextSeq()}`;
      out.push({
        cmd: { colonyIndex: col.index, source: 'bot', commandId: cmdId, kind: 'moveUnit', args: { entityId: worker.id, q: dep.q, r: dep.r } },
        decision: makeDecision(state, col, 'harvest', `Dispatch worker #${worker.id} -> (${dep.q}, ${dep.r})`, 'Moving idle worker to nearest surface deposit', cmdId, 'moveUnit', { entityId: worker.id, q: dep.q, r: dep.r }, tick),
      });
      return out;
    }
  }

  const tfTask = planWorkerTerritoryTask(state, col, data, flags, reserveHarvest, tick, nextSeq);
  if (tfTask) {
    out.push(tfTask);
    return out;
  }

  if (!worker || !flags.has('W02')) return out;

  const dep = findNearestPassableDeposit(state, worker.q, worker.r, 6, data);
  if (!dep || (dep.q === worker.q && dep.r === worker.r)) return out;
  const cmdId = `bot_${tick}_${col.index}_${nextSeq()}`;
  out.push({
    cmd: { colonyIndex: col.index, source: 'bot', commandId: cmdId, kind: 'moveUnit', args: { entityId: worker.id, q: dep.q, r: dep.r } },
    decision: makeDecision(state, col, 'harvest', `Dispatch worker #${worker.id} -> (${dep.q}, ${dep.r})`, 'Moving idle worker to nearest surface deposit', cmdId, 'moveUnit', { entityId: worker.id, q: dep.q, r: dep.r }, tick),
  });
  return out;
}

function colonyHasAliveHq(state: PlanetState, colonyIndex: number): boolean {
  const { count, cols } = state.entities;
  for (let row = 0; row < count; row++) {
    if (cols.owner[row] !== colonyIndex) continue;
    if (cols.kind[row] === ENTITY_KIND.hq && (cols.hp[row] > 0 || cols.hpMax[row] <= 0)) {
      return true;
    }
  }
  return false;
}

function planGoalAndDiplomacyInputs(
  state: PlanetState,
  col: ColonyState,
  persona: string,
  avgBuildingHpRatio: number,
  flags: { has(w: string): boolean },
  prevTick: number,
  nextTick: number,
  nextSeq: () => number,
): Array<{ cmd: SimCommandV1; decision: PlannedBotDecision }> {
  const out: Array<{ cmd: SimCommandV1; decision: PlannedBotDecision }> = [];
  if (flags.has('W08') && getColonyGoals(state, col.index).length === 0) {
    const goal =
      persona === 'warlord' && isGoalExecutable('defend_colony', flags)
        ? 'defend_colony'
        : isGoalExecutable('grow_economy', flags)
          ? 'grow_economy'
          : null;
    if (goal) {
      const cmdId = `bot_${nextTick}_${col.index}_${nextSeq()}`;
      out.push({
        cmd: { colonyIndex: col.index, source: 'bot', commandId: cmdId, kind: 'queueGoal', args: { goal, ...(goal === 'grow_economy' ? { params: { resource: 'metals.t1', targetRatePerMin: 240 } } : {}) } },
        decision: makeDecision(state, col, 'goal', `Queue colony goal ${goal}`, `${persona} strategic goal bootstrap`, cmdId, 'queueGoal', { goal, persona }, nextTick),
      });
    }
  }

  const diploPhase = col.index % DIPLO_CADENCE_TICKS;
  if (!flags.has('W18') || !crossedCadence(prevTick, nextTick, DIPLO_CADENCE_TICKS, diploPhase)) return out;

  const dip = peekDiplomacyBlob(state);
  const pendingOffer = Object.values(dip.offers).find(
    (o) => o && o.status === 'pending' && o.toColonyIndex === col.index && Boolean(o.offerId) && o.bondToken !== 'NEAR' && (o.expiresAtTick === undefined || o.expiresAtTick > nextTick),
  );
  if (pendingOffer) {
    const accept = persona === 'trader' || avgBuildingHpRatio < 0.7;
    const cmdId = `bot_${nextTick}_${col.index}_${nextSeq()}`;
    out.push({
      cmd: { colonyIndex: col.index, source: 'bot', commandId: cmdId, kind: 'diplomacy.respondTruce', args: { offerId: pendingOffer.offerId, accept } },
      decision: makeDecision(state, col, 'diplomacy', `${accept ? 'Accept' : 'Decline'} truce offer ${pendingOffer.offerId}`, `${persona} diplomacy response`, cmdId, 'diplomacy.respondTruce', { offerId: pendingOffer.offerId, accept }, nextTick),
    });
    return out;
  }

  if ((persona === 'trader' || avgBuildingHpRatio < 0.65) && colonyHasAliveHq(state, col.index)) {
    const other = state.colonies.find((c) => {
      if (!c || c.index === col.index || c.status !== 'active') return false;
      if (!colonyHasAliveHq(state, c.index)) return false;
      if (hasActiveTruce(state, col.index, c.index, nextTick)) return false;
      if (isTruceReofferCoolingDown(state, col.index, c.index, nextTick)) return false;
      return !Object.values(dip.offers).some((o) => o.status === 'pending' && o.fromColonyIndex === col.index && o.toColonyIndex === c.index);
    });
    if (other) {
      const cmdId = `bot_${nextTick}_${col.index}_${nextSeq()}`;
      out.push({
        cmd: { colonyIndex: col.index, source: 'bot', commandId: cmdId, kind: 'diplomacy.proposeTruce', args: { targetColonyIndex: other.index, durationHours: 6 } },
        decision: makeDecision(state, col, 'diplomacy', `Propose 6h truce to ${other.name || `col_${other.index}`}`, `${persona} diplomacy outreach`, cmdId, 'diplomacy.proposeTruce', { targetColonyIndex: other.index, durationHours: 6 }, nextTick),
      });
    }
  }
  return out;
}

/**
 * Computes explicit backend bot `SimCommandV1` inputs + human-readable decisions for every active bot colony.
 * Never mutates `state`; callers submit returned commands into `step()` so players/spectators see every bot input.
 */
export function planBackendBotActions(
  state: PlanetState,
  data: CompiledDataLike,
  flags: { has(w: string): boolean },
  nextTick = state.meta.tick + 1,
  prevTick = state.meta.tick,
): PlannedBotActionBatch {
  const rivalBlob = readRivalAiBlob(state);
  if (!rivalBlob.governorEnabled && state.colonies.every((c) => !c || (!isRivalAiColony(state, c.index) && c.isBot !== true))) {
    return { commands: [], decisions: [] };
  }

  let seq = 0;
  const nextSeq = () => ++seq;
  const commands: SimCommandV1[] = [];
  const decisions: PlannedBotDecision[] = [];

  for (const col of state.colonies) {
    if (!col || col.index < 0 || col.status === 'eliminated') continue;
    const isBotCol = isRivalAiColony(state, col.index) || col.isBot === true;
    if (!isBotCol) continue;
    if (!crossedCadence(prevTick, nextTick, PLAN_CADENCE_TICKS, col.index % PLAN_CADENCE_TICKS)) continue;

    const meta = getRivalColonyMeta(state, col.index);
    const persona = resolveBotPersona(state, col);
    const scan = scanColonyState(state, col.index, meta?.anchorQ ?? 0, meta?.anchorR ?? 0, data);

    const planned: Array<{ cmd: SimCommandV1; decision: PlannedBotDecision }> = [];
    const buildAct = pickBuildingOrder(state, col, persona, scan, data, flags, nextTick, nextSeq);
    if (buildAct) planned.push(buildAct);
    const unitAct = planUnitProductionInput(state, col, persona, scan, flags, nextTick, nextSeq);
    if (unitAct) planned.push(unitAct);
    planned.push(...planTacticalAndWorkerInput(state, col, persona, scan, data, flags, nextTick, nextSeq));
    planned.push(...planGoalAndDiplomacyInputs(state, col, persona, scan.avgBuildingHpRatio, flags, prevTick, nextTick, nextSeq));

    for (const item of planned) {
      commands.push(item.cmd);
      decisions.push(item.decision);
    }
  }
  return { commands, decisions };
}
