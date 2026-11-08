import { describe, expect, it } from 'vitest';
import { parseWaves } from '@terra/contracts';
import { compileData } from '../../src/data';
import { ENTITY_KIND, ENTITY_STATE } from '../../src/ecs/columns';
import { placeSpawnedEntity } from '../../src/ecs/placement';
import { insertRow } from '../../src/ecs/store';
import { hexDistance, hexIndex } from '../../src/grid/hex';
import { PREP, TERRAIN } from '../../src/grid/layers';
import { setTilePrep, setTileTerrain } from '../../src/grid/tileModel';
import type { StepContext } from '../../src/kernel/context';
import { seedStream } from '../../src/kernel/rng';
import { createState, type PlanetState } from '../../src/kernel/state';
import {
  clearEvasiveState,
  COMBAT_EVASIVE_BLOB,
  getEvasiveHeadingIntervalS,
  getEvasiveState,
  isUnitEvasive,
  pickEvasiveDestination,
  stepEvasiveUnit,
  type CombatEvasiveBlob,
} from '../../src/systems/combat/evasive';
import { runMovement } from '../../src/units/movement/orchestrator';

const w07Flags = new Set(['W00', 'W01', 'W02', 'W03', 'W04', 'W05', 'W06', 'W07']);
const w07Data = compileData(parseWaves('..07'), { combatUnits: { recon: { evasive: true } } });

function makeTestState(seed = 'w07-evasive-seed', radius = 12): PlanetState {
  const state = createState({
    planetId: 'pl-w07-evasive',
    planetType: 'temperate',
    seed,
    radius,
  });
  state.grid.layers.terrain.fill(TERRAIN.flat);
  state.grid.layers.prep.fill(PREP.wild);
  return state;
}

function makeStepCtx(state: PlanetState, tick: number): StepContext {
  state.meta.tick = tick;
  return {
    dt: 1,
    tick,
    flags: w07Flags,
    data: w07Data,
    events: [],
    postings: [],
    rng: (stream) => state.rng[stream],
    newEntityId: () => state.meta.nextEntityId++,
    emit: () => undefined,
    record: () => undefined,
  };
}

function spawnEntity(
  state: PlanetState,
  opts: {
    kind: number;
    owner: number;
    q: number;
    r: number;
    hp?: number;
  },
): { id: number; row: number } {
  const id = state.meta.nextEntityId++;
  const row = insertRow(state.entities, id, state.meta.tick);
  const cols = state.entities.cols;
  cols.kind[row] = opts.kind;
  cols.owner[row] = opts.owner;
  cols.hp[row] = opts.hp ?? 160;
  cols.hpMax[row] = opts.hp ?? 160;
  cols.state[row] = ENTITY_STATE.idle;
  placeSpawnedEntity(state.entities, row, opts.q, opts.r, state.meta.tick);
  return { id, row };
}

describe('W07-06: isUnitEvasive and evasive destination selection', () => {
  it('supports opt-in evasion while armored Recon defaults to stationary fire', () => {
    expect(isUnitEvasive(ENTITY_KIND.recon, w07Data)).toBe(true);
    expect(isUnitEvasive(ENTITY_KIND.recon)).toBe(false);
    expect(isUnitEvasive(ENTITY_KIND.recon, compileData(parseWaves('..07')))).toBe(false);
    expect(isUnitEvasive(ENTITY_KIND.hq, w07Data)).toBe(false);
    expect(isUnitEvasive(ENTITY_KIND.worker, w07Data)).toBe(false);
    expect(isUnitEvasive(ENTITY_KIND.blackAnt, w07Data)).toBe(false);
    expect(isUnitEvasive(ENTITY_KIND.blueBeetle, w07Data)).toBe(false);
    expect(isUnitEvasive(ENTITY_KIND.greenSpitter, w07Data)).toBe(false);
    expect(isUnitEvasive(ENTITY_KIND.autocannon, w07Data)).toBe(false);

    expect(getEvasiveHeadingIntervalS(w07Data)).toBe(0.5);
  });

  it('picks passable candidate hexes within weaponRange and excludes blocked terrain', () => {
    const state = makeTestState('dest-filter-seed');
    const target = spawnEntity(state, { kind: ENTITY_KIND.autocannon, owner: 1, q: 0, r: 0, hp: 450 });
    const recon = spawnEntity(state, { kind: ENTITY_KIND.recon, owner: 0, q: 5, r: 0, hp: 160 });

    const idx = hexIndex(state.grid.radius);
    setTileTerrain(state.grid, idx.indexOf(3, 0), TERRAIN.deep);
    setTilePrep(state.grid, idx.indexOf(4, -1), PREP.ridge);

    const stream = seedStream('dest-filter-seed', 'combat');
    for (let i = 0; i < 15; i++) {
      const dest = pickEvasiveDestination(state, recon.row, target.row, 5, stream, w07Data);
      expect(dest).not.toBeNull();
      const dUnit = hexDistance(5, 0, dest!.q, dest!.r);
      const dTarget = hexDistance(0, 0, dest!.q, dest!.r);
      expect(dUnit).toBeGreaterThanOrEqual(1);
      expect(dUnit).toBeLessThanOrEqual(2);
      expect(dTarget).toBeLessThanOrEqual(5);
      expect(dest).not.toEqual({ q: 5, r: 0 });
      expect(dest).not.toEqual({ q: 3, r: 0 });
      expect(dest).not.toEqual({ q: 4, r: -1 });
    }
  });

  it('picks a new deterministic combat PRNG heading every 0.5 s (2 or 3 ticks at 5 Hz) and moves via runMovement', () => {
    const stateA = makeTestState('det-evasive-seed');
    const stateB = makeTestState('det-evasive-seed');

    const tA = spawnEntity(stateA, { kind: ENTITY_KIND.autocannon, owner: 1, q: 0, r: 0, hp: 450 });
    const rA = spawnEntity(stateA, { kind: ENTITY_KIND.recon, owner: 0, q: 5, r: 0, hp: 160 });

    const tB = spawnEntity(stateB, { kind: ENTITY_KIND.autocannon, owner: 1, q: 0, r: 0, hp: 450 });
    const rB = spawnEntity(stateB, { kind: ENTITY_KIND.recon, owner: 0, q: 5, r: 0, hp: 160 });

    const repickTicksA: number[] = [];
    const repickTicksB: number[] = [];

    let prevX = stateA.entities.cols.x[rA.row]!;
    let prevY = stateA.entities.cols.y[rA.row]!;

    for (let tick = 1; tick <= 20; tick++) {
      const ctxA = makeStepCtx(stateA, tick);
      const ctxB = makeStepCtx(stateB, tick);

      const pickedA = stepEvasiveUnit(stateA, rA.row, tA.id, ctxA, 5);
      const pickedB = stepEvasiveUnit(stateB, rB.row, tB.id, ctxB, 5);
      expect(pickedA).toBe(pickedB);

      if (pickedA) repickTicksA.push(tick);
      if (pickedB) repickTicksB.push(tick);

      runMovement(stateA, ctxA);
      runMovement(stateB, ctxB);

      const xA = stateA.entities.cols.x[rA.row]!;
      const yA = stateA.entities.cols.y[rA.row]!;
      const xB = stateB.entities.cols.x[rB.row]!;
      const yB = stateB.entities.cols.y[rB.row]!;

      expect(xA).toBe(xB);
      expect(yA).toBe(yB);

      const stepDist = hexDistance(prevX, prevY, xA, yA);
      expect(stepDist).toBeLessThanOrEqual(0.7 + 1e-4);
      prevX = xA;
      prevY = yA;
    }

    // Over 20 ticks (4.0 s), 0.5 s cadence picks at ticks 1, 3, 5, 8, 10, 13, 15, 18, 20 (every 2 or 3 ticks)
    expect(repickTicksA).toEqual([1, 3, 5, 8, 10, 13, 15, 18, 20]);
    expect(repickTicksB).toEqual(repickTicksA);

    const blob = stateA.blobs[COMBAT_EVASIVE_BLOB]?.value as CombatEvasiveBlob | undefined;
    expect(blob).toBeDefined();
    expect(blob?.lastHeadingTickByEntity[rA.id]).toBe(20);
    expect(typeof blob?.headingQ[rA.id]).toBe('number');
    expect(typeof blob?.headingR[rA.id]).toBe('number');
    expect(getEvasiveState(stateA, rA.id)?.lastHeadingTick).toBe(20);

    clearEvasiveState(stateA, rA.id, 21);
    expect(getEvasiveState(stateA, rA.id)).toBeNull();
  });
});

describe('W07-06 Acceptance: Autocannon misses >= 30% of shots on an engaging Recon', () => {
  interface InFlightShot {
    aimX: number;
    aimY: number;
    impactTick: number;
  }

  function simulateAutocannonShots(opts: { evasive: boolean; seed?: string }): {
    totalShots: number;
    hits: number;
    misses: number;
    missRate: number;
  } {
    const state = makeTestState(opts.seed ?? 'w07-autocannon-vs-recon');
    const autocannon = spawnEntity(state, {
      kind: ENTITY_KIND.autocannon,
      owner: 1,
      q: 0,
      r: 0,
      hp: 450,
    });
    const recon = spawnEntity(state, {
      kind: ENTITY_KIND.recon,
      owner: 0,
      q: 5,
      r: 0,
      hp: 1400,
    });

    const cols = state.entities.cols;
    const projSpeedPerTick = 12 * 0.2; // 12 tiles/s * 0.2 s/tick = 2.4 tiles/tick
    const hitRadius = 0.5;
    const totalShotsToFire = 20;
    const fireIntervalTicks = 2; // 0.4 s at 5 Hz

    const inFlight: InFlightShot[] = [];
    let shotsFired = 0;
    let hits = 0;
    let misses = 0;

    for (let tick = 1; shotsFired < totalShotsToFire || inFlight.length > 0; tick++) {
      const ctx = makeStepCtx(state, tick);

      if (shotsFired < totalShotsToFire && (tick - 1) % fireIntervalTicks === 0) {
        const aimX = cols.x[recon.row]!;
        const aimY = cols.y[recon.row]!;
        const dist = hexDistance(cols.x[autocannon.row]!, cols.y[autocannon.row]!, aimX, aimY);
        expect(dist).toBeLessThanOrEqual(8); // within Autocannon range 8
        const flightTicks = Math.max(1, Math.ceil(dist / projSpeedPerTick));
        inFlight.push({
          aimX,
          aimY,
          impactTick: tick + flightTicks,
        });
        shotsFired++;
      }

      if (opts.evasive) {
        stepEvasiveUnit(state, recon.row, autocannon.id, ctx, 5);
        runMovement(state, ctx);
        expect(hexDistance(cols.q[recon.row]!, cols.r[recon.row]!, 0, 0)).toBeLessThanOrEqual(5);
      }

      for (let i = inFlight.length - 1; i >= 0; i--) {
        const shot = inFlight[i]!;
        if (shot.impactTick > tick) continue;
        inFlight.splice(i, 1);

        const distAtImpact = hexDistance(cols.x[recon.row]!, cols.y[recon.row]!, shot.aimX, shot.aimY);
        if (distAtImpact <= hitRadius) {
          hits++;
        } else {
          misses++;
        }
      }
    }

    const totalResolved = hits + misses;
    return {
      totalShots: totalResolved,
      hits,
      misses,
      missRate: totalResolved > 0 ? misses / totalResolved : 0,
    };
  }

  it('Autocannon hits 100% of shots on a stationary target at (5, 0) and misses >= 30% of shots on an engaging evasive Recon', () => {
    const stationary = simulateAutocannonShots({ evasive: false });
    expect(stationary.totalShots).toBe(20);
    expect(stationary.hits).toBe(20);
    expect(stationary.misses).toBe(0);
    expect(stationary.missRate).toBe(0);

    const evasive = simulateAutocannonShots({ evasive: true, seed: 'w07-evasive-acceptance' });
    expect(evasive.totalShots).toBe(20);
    expect(evasive.missRate).toBeGreaterThanOrEqual(0.3);
    expect(evasive.misses).toBeGreaterThanOrEqual(6);
  });
});
