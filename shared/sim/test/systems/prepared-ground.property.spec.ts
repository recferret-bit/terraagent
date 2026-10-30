import { describe, expect, it } from 'vitest';
import { parseWaves } from '@terra/contracts';
import {
  createEngineConfig,
  createPipeline,
  createPlanet,
  ENTITY_KIND,
  ENTITY_STATE,
  getBuildingFootprintTiles,
  getColonyTerraformOrders,
  getConstructionOrders,
  hexIndex,
  isBuildablePrepared,
  isValidTileIndex,
  nextInt,
  nextU32,
  PREP,
  seedStream,
  setColonyStock,
  SimHost,
  spawnHqUnit,
  TERRAIN,
  type Pipeline,
  type PlanetState,
  type SimCommand,
} from '../../src';

interface SimpleRng {
  nextU32: () => number;
  nextInt: (lo: number, hi: number) => number;
  pick: <T>(arr: readonly T[] | T[]) => T;
}

interface PropertyRunStats {
  constructingEntityChecks: number;
  inProgressOrderChecks: number;
  totalCommandsSubmitted: number;
}

function createRng(seed: string): SimpleRng {
  const stream = seedStream(seed, 'ac09');
  return {
    nextU32: () => nextU32(stream),
    nextInt: (lo: number, hi: number) => nextInt(stream, lo, hi),
    pick: <T>(arr: readonly T[] | T[]): T => arr[nextInt(stream, 0, arr.length - 1)],
  };
}

const TERRAIN_CLASSES = [
  TERRAIN.flat,
  TERRAIN.forest,
  TERRAIN.rock,
  TERRAIN.slope,
  TERRAIN.hole,
  TERRAIN.shallow,
  TERRAIN.deep,
] as const;

const PREP_STATES = [
  PREP.wild,
  PREP.flat,
  PREP.prepared,
  PREP.living,
  PREP.ridge,
  PREP.moat,
] as const;

const OWNERS = [-1, 0, 1] as const;

function checkHubEntityFootprint(
  state: PlanetState,
  row: number,
  violations: string[],
  ctxStr: string,
): void {
  const hex = hexIndex(state.grid.radius);
  const cols = state.entities.cols;
  const footprint = getBuildingFootprintTiles(cols.q[row], cols.r[row], 3);
  for (const pos of footprint) {
    const tileIdx = hex.indexOf(pos.q, pos.r);
    if (tileIdx < 0 || !isValidTileIndex(state.grid, tileIdx)) {
      violations.push(
        `[${ctxStr}] Hub ${cols.id[row]} at (${cols.q[row]}, ${cols.r[row]}) tile (${pos.q}, ${pos.r}) outside grid`,
      );
    } else if (!isBuildablePrepared(state.grid, tileIdx)) {
      const prep = state.grid.layers.prep[tileIdx];
      const terrain = state.grid.layers.terrain[tileIdx];
      violations.push(
        `[${ctxStr}] Hub ${cols.id[row]} constructing at (${cols.q[row]}, ${cols.r[row]}), tile (${pos.q}, ${pos.r}) not prepared/living (terrain=${terrain}, prep=${prep})`,
      );
    }
  }
}

function checkConstructionOrderFootprint(
  state: PlanetState,
  order: ReturnType<typeof getConstructionOrders>[number],
  violations: string[],
  ctxStr: string,
): void {
  const hex = hexIndex(state.grid.radius);
  const footprint = getBuildingFootprintTiles(order.q, order.r, order.footprint);
  let countPrepared = 0;
  for (const pos of footprint) {
    const tileIdx = hex.indexOf(pos.q, pos.r);
    if (tileIdx < 0 || !isValidTileIndex(state.grid, tileIdx)) {
      violations.push(
        `[${ctxStr}] Order ${order.orderId} at (${order.q}, ${order.r}) tile (${pos.q}, ${pos.r}) outside grid`,
      );
    } else if (!isBuildablePrepared(state.grid, tileIdx)) {
      const prep = state.grid.layers.prep[tileIdx];
      const terrain = state.grid.layers.terrain[tileIdx];
      violations.push(
        `[${ctxStr}] Order ${order.orderId} in_progress at (${order.q}, ${order.r}), tile (${pos.q}, ${pos.r}) not prepared/living (terrain=${terrain}, prep=${prep})`,
      );
    } else {
      countPrepared++;
    }
  }
  if (order.preparedCount !== order.totalTiles) {
    violations.push(
      `[${ctxStr}] Order ${order.orderId} in_progress: preparedCount (${order.preparedCount}) !== totalTiles (${order.totalTiles})`,
    );
  }
  if (countPrepared !== order.totalTiles) {
    violations.push(
      `[${ctxStr}] Order ${order.orderId} in_progress: verified tiles (${countPrepared}) !== totalTiles (${order.totalTiles})`,
    );
  }
}

function checkAc09Invariant(state: PlanetState, violations: string[], ctxStr: string): void {
  const entities = state.entities;
  const cols = entities.cols;
  for (let row = 0; row < entities.count; row++) {
    if (cols.kind[row] === ENTITY_KIND.hub) {
      const isConstructing = cols.state[row] === ENTITY_STATE.constructing || cols.progress[row] > 0;
      if (isConstructing) {
        checkHubEntityFootprint(state, row, violations, ctxStr);
      }
    }
  }

  const orders = getConstructionOrders(state);
  for (const order of orders) {
    if (order.status === 'in_progress' || order.progress > 0) {
      checkConstructionOrderFootprint(state, order, violations, ctxStr);
    }
  }
}

function buildPlaceBuildingCmd(
  commandId: string,
  radius: number,
  rng: SimpleRng,
  pad?: { q: number; r: number } | null,
): SimCommand {
  let q: number;
  let r: number;
  if (pad && rng.nextInt(0, 1) === 0) {
    q = pad.q;
    r = pad.r;
  } else {
    q = rng.nextInt(-radius - 1, radius + 1);
    r = rng.nextInt(-radius - 1, radius + 1);
  }
  return { colonyIndex: 0, source: 'player', commandId, kind: 'placeBuilding', args: { building: 'commandHub', q, r } };
}

function buildEnqueueTaskCmd(commandId: string, radius: number, rng: SimpleRng): SimCommand {
  const op = rng.pick(['grade', 'clear', 'break', 'auto'] as const);
  if (rng.nextInt(0, 1) === 1) {
    const tileCount = rng.nextInt(2, 4);
    const tiles: Array<{ q: number; r: number }> = [];
    for (let t = 0; t < tileCount; t++) {
      tiles.push({ q: rng.nextInt(-radius, radius), r: rng.nextInt(-radius, radius) });
    }
    return { colonyIndex: 0, source: 'player', commandId, kind: 'enqueueTask', args: { op, tiles } };
  }
  const q = rng.nextInt(-radius, radius);
  const r = rng.nextInt(-radius, radius);
  return { colonyIndex: 0, source: 'player', commandId, kind: 'enqueueTask', args: { op, tiles: [{ q, r }] } };
}

function buildCancelTaskCmd(commandId: string, state: PlanetState, rng: SimpleRng): SimCommand {
  const buildOrders = getConstructionOrders(state, 0);
  const tfOrders = getColonyTerraformOrders(state, 0);
  let taskId = `task_${rng.nextInt(1, 100)}`;
  if (buildOrders.length > 0 && rng.nextInt(0, 1) === 0) {
    taskId = rng.pick(buildOrders).orderId;
  } else if (tfOrders.length > 0) {
    taskId = rng.pick(tfOrders).orderId;
  }
  return { colonyIndex: 0, source: 'player', commandId, kind: 'cancelTask', args: { taskId } };
}

function generateRandomCommand(
  run: number,
  stepIdx: number,
  radius: number,
  hqId: number,
  state: PlanetState,
  rng: SimpleRng,
  pad?: { q: number; r: number } | null,
): SimCommand {
  const choice = rng.nextInt(0, 4);
  const commandId = `cmd_${run}_${stepIdx}_${choice}`;
  switch (choice) {
    case 0:
      return buildPlaceBuildingCmd(commandId, radius, rng, pad);
    case 1:
      return buildEnqueueTaskCmd(commandId, radius, rng);
    case 2:
      return buildCancelTaskCmd(commandId, state, rng);
    case 3:
      return {
        colonyIndex: 0,
        source: 'player',
        commandId,
        kind: 'moveUnit',
        args: { unitId: hqId, q: rng.nextInt(-radius, radius), r: rng.nextInt(-radius, radius) },
      };
    case 4:
    default:
      return {
        colonyIndex: 0,
        source: 'player',
        commandId,
        kind: 'dev.cell',
        args: { energy: rng.nextInt(0, 800) },
      };
  }
}

function populateRandomPlanetLayers(
  planet: PlanetState,
  radius: number,
  rng: SimpleRng,
): { q: number; r: number } | null {
  for (let i = 0; i < planet.grid.count; i++) {
    planet.grid.layers.terrain[i] = rng.pick(TERRAIN_CLASSES);
    planet.grid.layers.prep[i] = rng.pick(PREP_STATES);
    planet.grid.layers.owner[i] = rng.pick(OWNERS);
  }

  const hex = hexIndex(radius);
  const hqSlotIdx = hex.indexOf(0, 0);
  if (hqSlotIdx >= 0) {
    planet.grid.layers.terrain[hqSlotIdx] = TERRAIN.flat;
    planet.grid.layers.prep[hqSlotIdx] = PREP.prepared;
    planet.grid.layers.owner[hqSlotIdx] = 0;
  }

  if (rng.nextInt(0, 100) < 40) {
    const padQ = rng.nextInt(-radius + 2, radius - 2);
    const padR = rng.nextInt(-radius + 2, radius - 2);
    const padTiles = getBuildingFootprintTiles(padQ, padR, 3);
    const padPrep = rng.nextInt(0, 1) === 0 ? PREP.prepared : PREP.living;
    for (const pt of padTiles) {
      const idx = hex.indexOf(pt.q, pt.r);
      if (idx >= 0) {
        planet.grid.layers.terrain[idx] = TERRAIN.flat;
        planet.grid.layers.prep[idx] = padPrep;
        planet.grid.layers.owner[idx] = 0;
      }
    }
    return { q: padQ, r: padR };
  }
  return null;
}

function auditState(
  state: PlanetState,
  violations: string[],
  stats: PropertyRunStats,
  ctxStr: string,
): void {
  checkAc09Invariant(state, violations, ctxStr);
  for (let row = 0; row < state.entities.count; row++) {
    if (
      state.entities.cols.kind[row] === ENTITY_KIND.hub &&
      (state.entities.cols.state[row] === ENTITY_STATE.constructing ||
        state.entities.cols.progress[row] > 0)
    ) {
      stats.constructingEntityChecks++;
    }
  }
  for (const o of getConstructionOrders(state)) {
    if (o.status === 'in_progress' || o.progress > 0) {
      stats.inProgressOrderChecks++;
    }
  }
}

function runCommandLogIteration(
  run: number,
  pipeline: Pipeline,
  radius: number,
  violations: string[],
  stats: PropertyRunStats,
): void {
  const rng = createRng(`ac09-${run}`);
  const planet = createPlanet({ type: 'flat', seed: `ac09-${run}`, radius });
  const pad = populateRandomPlanetLayers(planet, radius, rng);

  const host = new SimHost(pipeline);
  host.load(planet);

  const hqId = spawnHqUnit(host.state, { owner: 0, q: 0, r: 0 });
  setColonyStock(host.state, 0, {
    'metals.t1': 1000,
    'minerals.t1': 1000,
    'bio.biomass': 1000,
    'bio.water': 1000,
  });

  auditState(host.state, violations, stats, `run ${run} baseline`);

  const commandCount = rng.nextInt(8, 15);
  for (let cmdIdx = 0; cmdIdx < commandCount; cmdIdx++) {
    const cmd = generateRandomCommand(run, cmdIdx, radius, hqId, host.state, rng, pad);
    host.submit(cmd);
    stats.totalCommandsSubmitted++;
    auditState(host.state, violations, stats, `run ${run} after submit ${cmd.kind}`);

    const stepTicks = rng.nextInt(1, 5);
    host.step(stepTicks);
    auditState(host.state, violations, stats, `run ${run} after step(${stepTicks})`);
  }

  const finalSteps = rng.nextInt(1, 5);
  host.step(finalSteps);
  auditState(host.state, violations, stats, `run ${run} final step(${finalSteps})`);
}

describe('W01-34: AC-09 property test — no structure ever starts construction on unprepared ground (UO-TF-01, UO-TF-02, AC-09)', () => {
  it('500 random command logs maintain AC-09 prepared ground invariant with 0 violations', () => {
    const pipeline = createPipeline(createEngineConfig({ flags: parseWaves('..01') }));
    const radius = 6;
    const violations: string[] = [];
    const stats: PropertyRunStats = {
      constructingEntityChecks: 0,
      inProgressOrderChecks: 0,
      totalCommandsSubmitted: 0,
    };
    const t0 = performance.now();

    for (let run = 0; run < 500; run++) {
      runCommandLogIteration(run, pipeline, radius, violations, stats);
    }

    const elapsedMs = Math.round(performance.now() - t0);
    console.log(
      `Completed 500 random command logs in ${elapsedMs} ms (${stats.totalCommandsSubmitted} commands, ${stats.constructingEntityChecks} constructing checks, ${stats.inProgressOrderChecks} in-progress order checks)`,
    );

    expect(stats.constructingEntityChecks).toBeGreaterThan(500);
    expect(stats.inProgressOrderChecks).toBeGreaterThan(500);
    expect(violations).toEqual([]);
    expect(violations.length).toBe(0);
  });
});
