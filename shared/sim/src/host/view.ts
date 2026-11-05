import { getStageSpec, type CompiledRow } from '../data';
import { ENTITY_KIND } from '../ecs/columns';
import type { PlanetState, PlanetType } from '../kernel/state';
import { resolveBuilderRow } from '../systems/factories-hub/unit';
import {
  getColonyGoals,
  getColonyPriorities,
  getHqGoalLimit,
  type ColonyGoalEntry,
  type ColonyPriorities,
} from '../systems/goals';
import { resolveHarvesterRow } from '../systems/harvest/unit';
import { unitSupplyOfKind } from '../systems/supply/sources';
import type { HqJob, HqUnitView } from '../systems/hq';
import type { ColonyPowerSummary } from '../systems/power-core/types';

export interface ViewEntityPower {
  state: 'online' | 'offline';
  reason?: string;
  component: number;
  flow?: number;
  max?: number;
  overloaded?: boolean;
}

export interface ViewPylonLoad {
  flow: number;
  max: number;
  overloaded?: boolean;
}
import { supplyTradeView, type SupplyTradeView } from './supplyTradeView';
import { getColonyProgression } from '../systems/progression';
import { getLastAutopilotDecision, type AutopilotDecision, type AutopilotOrderSuggestion } from '../systems/rule-engine';

/**
 * W00 view: a minimal read-only projection for render/HUD. Tile arrays are shared with the state (no copy; do not
 * mutate); entities and colonies are fresh plain objects. Features extend it by adding fields here.
 */
export interface ViewEntity {
  id: number; kind: number; owner: number; tier: number;
  q: number; r: number; x: number; y: number; rot: number;
  hp: number; hpMax: number; state: number; progress: number;
  cell?: number; cellMax?: number; targetQ?: number; targetR?: number;
  footprintW?: number; footprintD?: number; shedGroup?: number;
  unit?: string;
  label?: string;
  archetype?: string;
  supply?: number;
  powerDrainPerS?: number;
  speedTilesPerS?: number;
  viewRadius?: number;
  radius?: number;
  harvestRatePerS?: number;
  workRate?: number;
  maxBuildTier?: number;
  power?: ViewEntityPower;
  pylon?: ViewPylonLoad;
}

export interface ViewColony {
  index: number; id: string; name: string; color: number; status: string;
  stock?: Record<string, number>;
  caps?: Record<string, number>;
  hq?: HqUnitView;
  currentJob?: HqJob;
  queueCount?: number;
  power?: ColonyPowerSummary | Record<string, unknown>;
  goals?: ColonyGoalEntry[];
  goalLimit?: number;
  priorities?: ColonyPriorities;
  stage?: number;
  unlockStage?: number;
  threatStage?: number;
  stageOverride?: string;
  stageDwellRemainingS?: number | null;
  dwellRemainingS?: number | null;
  dwellRemainingTicks?: number | null;
  nextStageConditionText?: string;
  lastAutopilotDecision?: AutopilotDecision | null;
  /** W13-55: Supply & trade panel data (badges, shopping basket, logistics bill); absent without a region pin / logistics state. */
  supplyTrade?: SupplyTradeView;
  activeSuggestion?: AutopilotOrderSuggestion | null;
  [field: string]: unknown;
}

export interface SimView {
  tick: number;
  planet: { id: string; type: PlanetType; radius: number };
  tiles: {
    count: number;
    terrain: Uint8Array;
    prep: Uint8Array;
    deposit: Uint8Array;
    /** Tier of the visible deposit: 0 = legacy (tier 1), 1..3 explicit (`depositTier` layer). */
    depositTier?: Uint8Array;
    richness?: Float32Array;
    height: Float32Array;
    owner: Int8Array;
    explored: Uint8Array;
  };
  entities: ViewEntity[];
  colonies: ViewColony[];
  blobs?: Record<string, unknown>;
}

function applyPowerToEntity(
  ent: ViewEntity,
  state: PlanetState,
  powerBlob?: { byColony?: Record<number, ColonyPowerSummary> },
): void {
  const colPower = (state.colonies[ent.owner]?.power as ColonyPowerSummary | undefined) ?? powerBlob?.byColony?.[ent.owner];
  const ep = colPower?.entityPower?.[ent.id];
  const pl = colPower?.pylonLoads?.[ent.id];
  if (ep) {
    ent.power = {
      state: ep.state,
      ...(ep.reason ? { reason: ep.reason } : {}),
      component: ep.component,
      ...(pl ? { flow: pl.flow, max: pl.max, ...(pl.overloaded !== undefined ? { overloaded: pl.overloaded } : {}) } : {}),
    };
  }
  if (pl) {
    ent.pylon = {
      flow: pl.flow,
      max: pl.max,
      ...(pl.overloaded !== undefined ? { overloaded: pl.overloaded } : {}),
    };
  }
}

function buildViewColonies(
  state: PlanetState,
  hqBlob?: HqUnitView & { byColony?: Record<number, HqUnitView> },
  powerBlob?: { byColony?: Record<number, ColonyPowerSummary> },
): ViewColony[] {
  return state.colonies.map((k) => {
    const hq = (k.hq as HqUnitView | undefined) ?? hqBlob?.byColony?.[k.index];
    const out: ViewColony = { ...k };
    if (hq) {
      out.hq = hq;
      out.currentJob = (k.currentJob as HqJob | undefined) ?? hq.currentJob;
      out.queueCount = (k.queueCount as number | undefined) ?? hq.queueCount;
    }
    const colPower = (k.power as ColonyPowerSummary | undefined) ?? powerBlob?.byColony?.[k.index];
    if (colPower) {
      out.power = colPower;
    }
    out.goals = getColonyGoals(state, k.index);
    out.goalLimit = getHqGoalLimit(state, k.index);
    out.priorities = getColonyPriorities(state, k.index);
    const prog = getColonyProgression(state, k.index);
    out.stage = typeof k.stage === 'number' ? k.stage : state.blobs.progression ? prog.stage : undefined;
    out.unlockStage = typeof k.unlockStage === 'number' ? k.unlockStage : prog.unlockStage;
    out.threatStage = typeof k.threatStage === 'number' ? k.threatStage : prog.threatStage;
    if (typeof k.stageOverride === 'string') out.stageOverride = k.stageOverride;
    else if (prog.stageOverride) out.stageOverride = prog.stageOverride;
    out.dwellRemainingTicks =
      typeof k.dwellRemainingTicks === 'number' ? k.dwellRemainingTicks : prog.dwellRemainingTicks;
    out.dwellRemainingS =
      typeof k.stageDwellRemainingS === 'number'
        ? k.stageDwellRemainingS
        : typeof k.dwellRemainingS === 'number'
          ? k.dwellRemainingS
          : prog.dwellRemainingS;
    out.stageDwellRemainingS = out.dwellRemainingS;
    out.nextStageConditionText =
      typeof k.nextStageConditionText === 'string'
        ? k.nextStageConditionText
        : prog.nextStageConditionText || (getStageSpec((out.stage ?? 0) + 1)?.unlockConditionText ?? '');
    out.lastAutopilotDecision = getLastAutopilotDecision(state, k.index);
    const supply = supplyTradeView(state, k);
    if (supply) out.supplyTrade = supply;
    return out;
  });
}

export function view(state: PlanetState): SimView {
  const e = state.entities, c = e.cols, L = state.grid.layers;
  const powerBlob = state.blobs.power?.value as { byColony?: Record<number, ColonyPowerSummary> } | undefined;
  const entities: ViewEntity[] = [];
  let harvesterRow: CompiledRow | null = null;
  let builderRow: CompiledRow | null = null;

  for (let i = 0; i < e.count; i++) {
    const kind = c.kind[i];
    const ent: ViewEntity = {
      id: c.id[i], kind, owner: c.owner[i], tier: c.tier[i],
      q: c.q[i], r: c.r[i], x: c.x[i], y: c.y[i], rot: c.rot[i],
      hp: c.hp[i], hpMax: c.hpMax[i], state: c.state[i], progress: c.progress[i],
      cell: c.cell?.[i] ?? 0, cellMax: c.cellMax?.[i] ?? 0,
      targetQ: c.targetQ?.[i] ?? 0, targetR: c.targetR?.[i] ?? 0,
      footprintW: c.footprintW?.[i] ?? 0, footprintD: c.footprintD?.[i] ?? 0,
      shedGroup: c.shedGroup?.[i] ?? 0,
    };
    if (kind === ENTITY_KIND.harvester) {
      if (!harvesterRow) harvesterRow = resolveHarvesterRow();
      ent.unit = 'harvester';
      ent.label = String(harvesterRow.label ?? 'Harvester Drone');
      ent.archetype = String(harvesterRow.archetype ?? 'robot.miner');
      ent.supply = unitSupplyOfKind(kind);
      ent.powerDrainPerS = Number(harvesterRow.powerDrainPerS ?? 1.5);
      ent.speedTilesPerS = Number(harvesterRow.designSpeedTilesPerS ?? 1.5);
      ent.viewRadius = Number(harvesterRow.viewRadius ?? 7);
      ent.radius = Number(harvesterRow.radius ?? 0.4);
      ent.harvestRatePerS = Number(harvesterRow.harvestRatePerS ?? 0.5);
      ent.workRate = c.workRate?.[i] ?? 1.0;
      ent.maxBuildTier = Number(harvesterRow.maxBuildTier ?? 0);
    } else if (kind === ENTITY_KIND.builder) {
      if (!builderRow) builderRow = resolveBuilderRow();
      ent.unit = 'builder';
      ent.label = String(builderRow.label ?? 'Builder Drone');
      ent.archetype = String(builderRow.archetype ?? 'robot.builder');
      ent.supply = unitSupplyOfKind(kind);
      ent.powerDrainPerS = Number(builderRow.powerDrainPerS ?? 2.0);
      ent.speedTilesPerS = Number(builderRow.designSpeedTilesPerS ?? 1.5);
      ent.viewRadius = Number(builderRow.viewRadius ?? 7);
      ent.radius = Number(builderRow.radius ?? 0.4);
      ent.workRate = c.workRate?.[i] || 1.0;
      ent.maxBuildTier = Number(builderRow.maxBuildTier ?? 1);
    }
    applyPowerToEntity(ent, state, powerBlob);
    entities.push(ent);
  }

  const blobs: Record<string, unknown> = {};
  for (const [k, b] of Object.entries(state.blobs)) blobs[k] = b.value;
  const hqBlob = state.blobs.hq?.value as (HqUnitView & { byColony?: Record<number, HqUnitView> }) | undefined;
  const colonies = buildViewColonies(state, hqBlob, powerBlob);

  return {
    tick: state.meta.tick,
    planet: { id: state.meta.planetId, type: state.meta.planetType, radius: state.grid.radius },
    tiles: {
      count: state.grid.count,
      terrain: L.terrain as Uint8Array,
      prep: L.prep as Uint8Array,
      deposit: L.deposit as Uint8Array,
      depositTier: L.depositTier as Uint8Array,
      richness: L.richness as Float32Array,
      height: L.height as Float32Array,
      owner: L.owner as Int8Array,
      explored: L.explored as Uint8Array,
    },
    entities,
    colonies,
    blobs,
  };
}
