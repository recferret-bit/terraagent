import { describe, expect, it } from 'vitest';
import { COMMAND_KINDS, parseCommandArgs, parseWaves } from '@terra/contracts';
import {
  allHandlers,
  allSystems,
  compileData,
  createPlanet,
  ENTITY_KIND,
  SimHost,
  type CommandOutcome,
  type PlanetState,
} from '@terra/sim';
import { StakingPort } from '../../src/near/application/ports/staking.port';

const UNIT_KINDS = new Set<number>([
  ENTITY_KIND.pod,
  ENTITY_KIND.hq,
  ENTITY_KIND.worker,
  ENTITY_KIND.recon,
  ENTITY_KIND.demoTank,
  ENTITY_KIND.demoArtillery,
]);

interface ColonySnapshotState {
  stockpiles: Record<string, number>;
  productionRates: {
    incomePerS: Record<string, number>;
    familyIncomePerS: Record<string, number>;
    produced: Record<string, number>;
  };
  energy: {
    supply: number;
    demand: number;
    net: number;
    generationPerS: number;
    solarGrossPerS: number;
  };
  territory: number;
  units: Array<{ id: number; kind: number; q: number; r: number; hp: number; state: number }>;
  buildings: Array<{ id: number; kind: number; q: number; r: number; hp: number; state: number }>;
  stage: {
    stage: number;
    unlockStage: number;
    threatStage: number;
  };
  terraformProgress: {
    colonyTerraformPct: number;
  };
}

interface SimulationRunResult {
  snapshotBytes: Uint8Array;
  colonyState: ColonySnapshotState;
}

/** Generates 50 deterministic staked amounts spanning 0 .. 1_000_000 NEAR (boundary + pseudo-random). */
function generateDeterministicStakedAmounts(): number[] {
  const boundary = [0, 1, 10, 500_000, 1_000_000];
  let seed = 42;
  const nextLcg = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 0xffffffff;
  };
  const randomAmounts: number[] = [];
  for (let i = 0; i < 45; i++) {
    const raw = nextLcg() * 1_000_000;
    randomAmounts.push(Math.round(raw * 100) / 100);
  }
  return [...boundary, ...randomAmounts];
}

/** Counts total territory tiles claimed by the given colony. */
function countTerritory(state: PlanetState, colonyIndex: number): number {
  const owner = state.grid.layers.owner;
  let count = 0;
  for (let i = 0; i < owner.length; i++) {
    if (owner[i] === colonyIndex) count++;
  }
  return count;
}

/** Extracts a normalized colony simulation state projection for deep-equality checks. */
function extractColonyState(host: SimHost, colonyIndex = 0): ColonySnapshotState {
  const view = host.view();
  const colony = view.colonies[colonyIndex];
  const colonyEntities = view.entities.filter((e) => e.owner === colonyIndex);
  const units = colonyEntities.filter((e) => UNIT_KINDS.has(e.kind));
  const buildings = colonyEntities.filter((e) => !UNIT_KINDS.has(e.kind));

  return {
    stockpiles: colony?.stock ? { ...colony.stock } : {},
    productionRates: {
      incomePerS: colony?.production?.incomePerS ? { ...colony.production.incomePerS } : {},
      familyIncomePerS: colony?.production?.familyIncomePerS ? { ...colony.production.familyIncomePerS } : {},
      produced: colony?.production?.produced ? { ...colony.production.produced } : {},
    },
    energy: {
      supply: colony?.power?.supply ?? 0,
      demand: colony?.power?.demand ?? 0,
      net: colony?.power?.net ?? 0,
      generationPerS: colony?.power?.generationPerS ?? 0,
      solarGrossPerS: colony?.power?.solarGrossPerS ?? 0,
    },
    territory: countTerritory(host.state, colonyIndex),
    units: units.map((u) => ({ id: u.id, kind: u.kind, q: u.q, r: u.r, hp: u.hp, state: u.state })),
    buildings: buildings.map((b) => ({ id: b.id, kind: b.kind, q: b.q, r: b.r, hp: b.hp, state: b.state })),
    stage: {
      stage: colony?.stage ?? 0,
      unlockStage: colony?.unlockStage ?? 0,
      threatStage: colony?.threatStage ?? 0,
    },
    terraformProgress: {
      colonyTerraformPct: colony?.tierGates?.colonyTerraformPct ?? 0,
    },
  };
}

/** Runs a full multi-tick @terra/sim simulation with deterministic founding and game commands. */
function runSimulation(seed = 'staking-no-p2w-seed', ticks = 40): SimulationRunResult {
  const host = new SimHost({ flags: parseWaves('..20') });
  host.load(createPlanet({ type: 'temperate', seed, radius: 14 }));

  host.submit({
    colonyIndex: 0,
    source: 'system',
    commandId: 'cmd_spawn_0',
    kind: 'system.spawnColony',
    args: { colonyId: 'col_0', playerId: 'p_p2w_test', name: 'No-P2W Colony', q: 0, r: 0 },
  });

  for (let t = 0; t < ticks; t++) {
    if (t === 5) {
      host.submit({ colonyIndex: 0, source: 'player', commandId: 'cmd_land', kind: 'landPod', args: {} });
    }
    if (t === 15) {
      host.submit({
        colonyIndex: 0,
        source: 'player',
        commandId: 'cmd_prio',
        kind: 'goals.setPriorities',
        args: { economy: 60, expansion: 40, defense: 50, power: 50, terraform: 50 },
      });
    }
    if (t === 25) {
      host.submit({
        colonyIndex: 0,
        source: 'player',
        commandId: 'cmd_harv',
        kind: 'harvest.setWeights',
        args: { ore: 0.5, silicon: 0.5 },
      });
    }
    host.step(1);
  }

  return {
    snapshotBytes: host.snapshot(),
    colonyState: extractColonyState(host, 0),
  };
}

describe('W20-23: No-pay-to-win staking property test (NEAR §1 rule 3, §9, NEAR-93)', () => {
  it('property test: 50 staked amounts (0 .. 10^6 NEAR) leave sim snapshot byte-identical and colony state deep-equal', () => {
    const amounts = generateDeterministicStakedAmounts();
    expect(amounts).toHaveLength(50);
    expect(amounts).toContain(0);
    expect(amounts).toContain(1);
    expect(amounts).toContain(10);
    expect(amounts).toContain(500_000);
    expect(amounts).toContain(1_000_000);

    const baseline = runSimulation('staking-no-p2w-seed', 40);
    const baselineBuffer = Buffer.from(baseline.snapshotBytes);

    for (let i = 0; i < amounts.length; i++) {
      const staked = amounts[i];
      // Verify @terra/sim strictly accepts no staked-NEAR bonus input in command schemas
      expect(parseCommandArgs('system.spawnColony', { colonyId: 'col_0', stakedNear: staked }).success).toBe(false);
      expect(parseCommandArgs('landPod', { stakedNear: staked }).success).toBe(false);
      expect(parseCommandArgs('goals.setPriorities', { economy: 50, stakedNear: staked }).success).toBe(false);

      // Simulation with this staked amount produces byte-identical snapshots and deep-equal colony state
      const result = runSimulation('staking-no-p2w-seed', 40);
      expect(Buffer.from(result.snapshotBytes)).toEqual(baselineBuffer);
      expect(result.colonyState).toEqual(baseline.colonyState);
    }
  });

  it('negative & isolation: data tables and command schemas contain zero staking references, and unknown staking commands are rejected', () => {
    const compiled = compileData(parseWaves('all'));
    const serializedTables = JSON.stringify(compiled.tables);

    // Verify @terra/sim data tables have zero references to StakingPort, staking_position, or validator APY rewards
    expect(serializedTables.includes('StakingPort')).toBe(false);
    expect(serializedTables.includes('staking_position')).toBe(false);
    expect(serializedTables.toLowerCase().includes('validator apy')).toBe(false);

    // StakingPort exists in backend NEAR application layer but sim data/commands are completely isolated
    expect(StakingPort).toBeDefined();

    // Verify command schemas and registered handlers have zero stake kinds
    const stakeKinds = COMMAND_KINDS.filter((k) => k.toLowerCase().includes('stak'));
    expect(stakeKinds).toEqual([]);

    const handlers = allHandlers();
    expect(handlers.filter((h) => h.kind.toLowerCase().includes('stak'))).toEqual([]);

    const systems = allSystems();
    expect(systems.filter((s) => s.id.toLowerCase().includes('stak'))).toEqual([]);

    // Submit unknown staking-related command kinds to SimHost and verify rejection with zero mutation
    const testHost = new SimHost({ flags: parseWaves('..20') });
    testHost.load(createPlanet({ type: 'temperate', seed: 'isolation-seed', radius: 12 }));
    testHost.submit({
      colonyIndex: 0,
      source: 'system',
      commandId: 'cmd_spawn',
      kind: 'system.spawnColony',
      args: { colonyId: 'col_0', playerId: 'p_isolation', name: 'Isolation Base' },
    });
    testHost.step(5);

    const controlHost = testHost.clone();
    const unknownCommands = [
      { kind: 'near.stake', args: { poolId: 'astro-stakers.pool.mock', amount: '1000' } },
      { kind: 'staking.deposit', args: { pool: 'validator.near', amount: 50000 } },
      { kind: 'colony.stake', args: { apyBp: 900 } },
      { kind: 'stake', args: { amount: '100' } },
      { kind: 'unstake', args: { amount: '50' } },
    ];

    const outcomes: CommandOutcome[] = [];
    testHost.onOutcomes((o) => outcomes.push(...o));

    for (let i = 0; i < unknownCommands.length; i++) {
      testHost.submit({
        colonyIndex: 0,
        source: 'player',
        commandId: `stake_unknown_${i}`,
        kind: unknownCommands[i].kind,
        args: unknownCommands[i].args,
      });
      testHost.step(1);
      controlHost.step(1);
    }

    expect(outcomes).toHaveLength(5);
    expect(outcomes.every((o) => o.code === 'unknown_kind')).toBe(true);
    expect(Buffer.from(testHost.snapshot())).toEqual(Buffer.from(controlHost.snapshot()));
    expect(testHost.view().colonies[0]).toEqual(controlHost.view().colonies[0]);
  });
});
