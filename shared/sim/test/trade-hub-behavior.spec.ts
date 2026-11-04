import { describe, expect, it } from 'vitest';
import { parseWaves } from '@terra/contracts';
import {
  applyEnvironmentState,
  compileData,
  createPlanet,
  createRegistryPipeline,
  createState,
  ENTITY_KIND,
  ENTITY_STATE,
  environmentFromPlanetTime,
  evaluateColonyPower,
  evaluatePlacement,
  executeDismantleAtTile,
  getColonyPower,
  hexIndex,
  insertRow,
  type PlanetState,
  PREP,
  placementWorldFromState,
  resolveEconomyBuildingRow,
  rowOf,
  setField,
  setPlanetTime,
  setTilePrep,
  startBuildingConstruction,
  spawnHqUnit,
  step,
} from '../src';
import { ensureColony, resolveBuildingRow } from '../src/systems/economy/buildingRows';
import { ensureColonyCargoCapState, recordCargoMint } from '../src/systems/cargo/caps';
import {
  getColonyTradeHubStatus,
  isTradeHubEntityOnline,
  isTradeHubOnline,
} from '../src/systems/cargo/trade-hub';

function spawnTestBuilding(
  state: PlanetState,
  opts: { kind: number; owner: number; q: number; r: number; w: number; d: number; hp: number; shedGroup?: number; tier?: number },
): { id: number; row: number } {
  const id = state.meta.nextEntityId++;
  const row = insertRow(state.entities, id, 0);
  const cols = state.entities.cols;
  cols.kind[row] = opts.kind;
  cols.owner[row] = opts.owner;
  cols.tier[row] = opts.tier ?? 1;
  cols.q[row] = opts.q;
  cols.r[row] = opts.r;
  cols.footprintW[row] = opts.w;
  cols.footprintD[row] = opts.d;
  cols.shedGroup[row] = opts.shedGroup ?? 4;
  cols.hp[row] = opts.hp;
  cols.hpMax[row] = opts.hp;
  cols.state[row] = ENTITY_STATE.active;
  return { id, row };
}

describe('W10-04 Trade Hub placement, construction & wave gating', () => {
  it('resolves tradeHub building row when W10 is enabled and returns null when gated off (..09)', () => {
    const w09 = compileData(parseWaves('..09'));
    expect(resolveBuildingRow('tradeHub', w09)).toBeNull();
    expect(resolveEconomyBuildingRow('tradeHub', w09)).toBeNull();

    const w10 = compileData(parseWaves('..10'));
    const resolved = resolveBuildingRow('tradeHub', w10);
    expect(resolved).not.toBeNull();
    expect(resolved?.entityKind).toBe(ENTITY_KIND.tradeHub);
    expect(resolved?.row.hp).toBe(650);
    expect(resolved?.row.shedGroup).toBe(2);
    expect(resolved?.row.powerDrainPerS).toBe(6);

    const aliasResolved = resolveBuildingRow('interColonyTradeHub', w10);
    expect(aliasResolved?.entityKind).toBe(ENTITY_KIND.tradeHub);
  });

  it('evaluates placement on 2x2 footprint (computing Grade prep bill on unprepared tiles) and spawns Trade Hub with shedGroup 2, hp 650, footprint 2x2', () => {
    const state = createPlanet({ type: 'flat', seed: 'th-place', radius: 10 });
    const w10 = compileData(parseWaves('..10'));
    spawnTestBuilding(state, { kind: ENTITY_KIND.commandHub, owner: 0, q: -2, r: 0, w: 3, d: 3, hp: 1500 });
    const idx = hexIndex(state.grid.radius);

    setTilePrep(state.grid, idx.indexOf(2, 0), PREP.prepared);
    const placement = evaluatePlacement(placementWorldFromState(state), {
      colonyId: 0,
      q: 2,
      r: 0,
      building: 'tradeHub',
      data: w10,
    });
    expect(placement.ok).toBe(true);
    expect(placement.preparedCount).toBe(1);
    expect(placement.unpreparedCount).toBe(3);
    expect(placement.bill.tilesToPrepare).toBe(3);
    expect(placement.bill.ops.grade).toBe(3);

    const colony = ensureColony(state, 0, 0);
    const stock = colony.stock as Record<string, number>;
    stock['metals.t1'] = 500;
    stock['minerals.t1'] = 500;
    stock['bio.biomass'] = 500;
    stock['bio.water'] = 500;

    const buildRes = startBuildingConstruction(state, {
      owner: 0,
      building: 'tradeHub',
      q: 2,
      r: 0,
      instant: true,
      tick: 1,
      data: w10,
    });
    expect(buildRes.ok).toBe(true);
    if (!buildRes.ok) return;

    const thRow = rowOf(state.entities, buildRes.entityId);
    const cols = state.entities.cols;
    expect(cols.kind[thRow]).toBe(ENTITY_KIND.tradeHub);
    expect(cols.shedGroup[thRow]).toBe(2);
    expect(cols.hp[thRow]).toBe(650);
    expect(cols.footprintW[thRow]).toBe(2);
    expect(cols.footprintD[thRow]).toBe(2);
    expect(cols.state[thRow]).toBe(ENTITY_STATE.active);
    expect(isTradeHubEntityOnline(state, thRow)).toBe(true);
    expect(isTradeHubOnline(state, thRow)).toBe(true);

    const overlap = evaluatePlacement(placementWorldFromState(state), {
      colonyId: 0,
      q: 2,
      r: 0,
      building: 'solar',
      data: w10,
    });
    expect(overlap.ok).toBe(false);
    expect(overlap.block).toBe('occupied');

    spawnHqUnit(state, { owner: 0, q: 3, r: -1 });
    const dismantle = executeDismantleAtTile(state, 0, 2, 0, 2, w10);
    expect(dismantle.ok).toBe(true);
    if (dismantle.ok) {
      expect(dismantle.jobId).toBeDefined();
      expect(dismantle.refunded).toEqual({}); // W03 pays refunds progressively through the worker job.
    }
    const pipeline = createRegistryPipeline({ flags: parseWaves('..10') });
    for (let i = 0; i < 100 && rowOf(state.entities, buildRes.entityId) >= 0; i++) step(state, [], 5, pipeline);
    expect(rowOf(state.entities, buildRes.entityId)).toBe(-1);
  });
});

describe('W10-04 Trade Hub power, brownout shedding (group 2) & online state', () => {
  it('stays online with daytime Solar, sheds on group 2 at night, and recovers when power returns', () => {
    const state = createState({ planetId: 'p-th', planetType: 'temperate', seed: 'w10-power', radius: 10 });
    const w10 = compileData(parseWaves('..10'));
    const pipeline = createRegistryPipeline({ flags: parseWaves('..10') });

    spawnTestBuilding(state, { kind: ENTITY_KIND.commandHub, owner: 0, q: 0, r: 0, w: 3, d: 3, hp: 1500, shedGroup: 4 });
    spawnTestBuilding(state, { kind: ENTITY_KIND.solar, owner: 0, q: 3, r: 0, w: 2, d: 2, hp: 400 });
    const th = spawnTestBuilding(state, { kind: ENTITY_KIND.tradeHub, owner: 0, q: -3, r: 0, w: 2, d: 2, hp: 650, shedGroup: 2, tier: 1 });

    // 1. Daytime noon (12:00 -> daylight = 1.0): Supply = 8 + 20 = 28 E/s, Demand = 5 + 6 = 11 E/s
    setPlanetTime(state, { timeOfDay: 12 }, 0, w10);
    applyEnvironmentState(state, environmentFromPlanetTime(state, w10, false, 0), 0);
    step(state, [], 1, pipeline);
    const dayPower = getColonyPower(state, 0, w10);
    expect(dayPower.brownout).toBe(false);
    expect(state.entities.cols.state[th.row]).toBe(ENTITY_STATE.active);
    expect(isTradeHubOnline(state, th.row)).toBe(true);

    const dayStatus = getColonyTradeHubStatus(state, 0, w10);
    expect(dayStatus.anyOnline).toBe(true);
    expect(dayStatus.onlineCount).toBe(1);
    expect(dayStatus.throughputCapPerMin).toBe(250);

    // Add a consumer so current founder output cannot cover the Trade Hub at night.
    spawnTestBuilding(state, { kind: ENTITY_KIND.metalsExtractor, owner: 0, q: 0, r: 3, w: 2, d: 2, hp: 500 });
    setPlanetTime(state, { timeOfDay: 0 }, 2, w10);
    applyEnvironmentState(state, environmentFromPlanetTime(state, w10, false, 2), 2);
    const nightSummary = evaluateColonyPower(state, 0, w10, 2);
    expect(nightSummary.brownout).toBe(true);
    expect(nightSummary.shedGroupsActive).toEqual([2]);
    expect(nightSummary.shedEntityIds).toEqual([th.id]);
    expect(state.entities.cols.state[th.row]).toBe(ENTITY_STATE.offlineBrownout);
    expect(isTradeHubOnline(state, th.row)).toBe(false);

    const nightStatus = getColonyTradeHubStatus(state, 0, w10, 2);
    expect(nightStatus.anyOnline).toBe(false);
    expect(nightStatus.throughputCapPerMin).toBe(0);

    // 3. Restore daytime -> Trade Hub returns to ENTITY_STATE.active (online: true)
    setPlanetTime(state, { timeOfDay: 12 }, 3, w10);
    applyEnvironmentState(state, environmentFromPlanetTime(state, w10, false, 3), 3);
    const restoredSummary = evaluateColonyPower(state, 0, w10, 3);
    expect(restoredSummary.brownout).toBe(false);
    expect(state.entities.cols.state[th.row]).toBe(ENTITY_STATE.active);
    expect(isTradeHubOnline(state, th.row)).toBe(true);
  });

  it('sheds group 2 (Trade Hub) before group 3 (Metals Extractor) and group 4 (Command Hub)', () => {
    const state = createState({ planetId: 'p-prio', planetType: 'temperate', seed: 'w10-prio', radius: 10 });
    const w10 = compileData(parseWaves('..10'));

    // Limit supply to cover the Hubs and extractor, but not the lower-priority Trade Hub.
    const hub1 = spawnTestBuilding(state, { kind: ENTITY_KIND.commandHub, owner: 0, q: 0, r: 0, w: 3, d: 3, hp: 1500, shedGroup: 4 });
    spawnTestBuilding(state, { kind: ENTITY_KIND.commandHub, owner: 0, q: 2, r: -2, w: 3, d: 3, hp: 1500, shedGroup: 4 });
    const ext = spawnTestBuilding(state, { kind: ENTITY_KIND.metalsExtractor, owner: 0, q: 0, r: 3, w: 2, d: 2, hp: 500, shedGroup: 3 });
    const th = spawnTestBuilding(state, { kind: ENTITY_KIND.tradeHub, owner: 0, q: -3, r: 0, w: 2, d: 2, hp: 650, shedGroup: 2, tier: 1 });

    ensureColony(state, 0, 0).powerSupplyOverride = 22;
    const summary = evaluateColonyPower(state, 0, w10, 1);
    expect(summary.supply).toBe(22);
    expect(summary.rawDemand).toBe(28);
    expect(summary.shedGroupsActive).toEqual([2]);
    expect(summary.shedEntityIds).toEqual([th.id]);
    expect(state.entities.cols.state[th.row]).toBe(ENTITY_STATE.offlineBrownout);
    expect(state.entities.cols.state[ext.row]).toBe(ENTITY_STATE.active);
    expect(state.entities.cols.state[hub1.row]).toBe(ENTITY_STATE.active);
    expect(isTradeHubOnline(state, th.row)).toBe(false);
  });
});

describe('W10-04 Rolling 60 s throughput meter & multi-tier Trade Hub status', () => {
  it('tracks rolling 60 s throughput used per hub, sums online caps across tiers (T1=250, T2=900, T3=3500), and decays after 300 ticks', () => {
    const state = createState({ planetId: 'p-meter', planetType: 'temperate', seed: 'w10-meter', radius: 10 });
    const w10 = compileData(parseWaves('..10'));
    const colony = ensureColony(state, 0, 0);
    const capState = ensureColonyCargoCapState(colony, 0);

    spawnTestBuilding(state, { kind: ENTITY_KIND.tradeHub, owner: 0, q: 0, r: 0, w: 2, d: 2, hp: 650, tier: 1 });
    const th2 = spawnTestBuilding(state, { kind: ENTITY_KIND.tradeHub, owner: 0, q: 3, r: 0, w: 3, d: 3, hp: 1750, tier: 2 });
    setField(state.entities, th2.row, 'state', ENTITY_STATE.constructing, 0);

    recordCargoMint(capState, 120, 'metals.t1', 10, 0);
    recordCargoMint(capState, 80, 'minerals.t1', 110, 0);

    const statusAt110 = getColonyTradeHubStatus(state, 0, w10, 110);
    expect(statusAt110.hubCount).toBe(2);
    expect(statusAt110.onlineCount).toBe(1);
    expect(statusAt110.anyOnline).toBe(true);
    expect(statusAt110.highestTier).toBe(2);
    expect(statusAt110.onlineHighestTier).toBe(1);
    expect(statusAt110.throughputCapPerMin).toBe(250);
    expect(statusAt110.throughputUsedPerMin).toBe(200);
    expect(statusAt110.hubs[0]?.throughputUsedPerMin).toBe(200);
    expect(statusAt110.hubs[0]?.throughputCapPerMin).toBe(250);
    expect(statusAt110.hubs[1]?.online).toBe(false);
    expect(statusAt110.hubs[1]?.throughputCapPerMin).toBe(0);

    setField(state.entities, th2.row, 'state', ENTITY_STATE.active, 150);
    const statusAt150 = getColonyTradeHubStatus(state, 0, w10, 150);
    expect(statusAt150.onlineCount).toBe(2);
    expect(statusAt150.onlineHighestTier).toBe(2);
    expect(statusAt150.throughputCapPerMin).toBe(1150);

    const statusAt310 = getColonyTradeHubStatus(state, 0, w10, 310);
    expect(statusAt310.throughputUsedPerMin).toBe(80);
    expect(statusAt310.hubs[0]?.throughputUsedPerMin).toBe(80);

    const statusAt410 = getColonyTradeHubStatus(state, 0, w10, 410);
    expect(statusAt410.throughputUsedPerMin).toBe(0);
    expect(statusAt410.hubs[0]?.throughputUsedPerMin).toBe(0);
  });
});
