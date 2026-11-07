import { describe, expect, it } from 'vitest';
import { parseWaves } from '@terra/contracts';
import {
  createRegistryPipeline,
  createState,
  decodeValue,
  encodeValue,
  ensureColonyLedger,
  ensureColonyRecord,
  ENTITY_KIND,
  ENTITY_STATE,
  fireProjectile,
  getAllHives,
  getAllResidentBugs,
  getPendingProjectileImpacts,
  insertRow,
  placeSpawnedEntity,
  PREP,
  provokeHiveAgainstColony,
  SimHost,
  spawnHiveEntity,
  TERRAIN,
  updateColonyVisionCache,
  type FaunaSpeciesId,
  type EngineDiff,
  type PlanetState,
} from '../../src';

function createBenchmarkHost(seed: string, radius = 36) {
  const flags = parseWaves('..07');
  const pipeline = createRegistryPipeline({ flags });
  const host = new SimHost(pipeline);
  const state = createState({ planetId: `pl-${seed}`, planetType: 'temperate', seed, radius });
  state.grid.layers.terrain.fill(TERRAIN.flat);
  state.grid.layers.prep.fill(PREP.wild);

  const col0 = ensureColonyLedger(ensureColonyRecord(state, 0, 0));
  col0.status = 'active';
  col0.powerSupplyOverride = 500;
  col0.stock['metals.t1'] = 5000;
  col0.stock['minerals.t1'] = 5000;

  host.load(state);
  return { host, state, data: pipeline.config.data };
}

function spawnColonyCombatUnit(
  state: PlanetState,
  kind: number,
  owner: number,
  q: number,
  r: number,
  hp: number,
): number {
  const id = state.meta.nextEntityId++;
  const row = insertRow(state.entities, id, state.meta.tick);
  const cols = state.entities.cols;
  cols.kind[row] = kind;
  cols.owner[row] = owner;
  cols.hp[row] = hp;
  cols.hpMax[row] = hp;
  cols.state[row] = ENTITY_STATE.idle;
  placeSpawnedEntity(state.entities, row, q, r, state.meta.tick);
  return id;
}

describe('W07-30 · Fauna performance benchmark (200 units, 50 projectiles, 6 hives)', () => {
  it('runs 200 combat units (including fauna), 50 projectiles in flight, and 6 active hives within the tick budget (vision <= 0.5 ms)', () => {
    const { host, state, data } = createBenchmarkHost('w07-perf-200', 40);

    const hiveSpecs: Array<{ species: FaunaSpeciesId; q: number; r: number }> = [
      { species: 'blackAnt', q: -16, r: 0 },
      { species: 'blackAnt', q: 16, r: 0 },
      { species: 'blueBeetle', q: 0, r: -16 },
      { species: 'blueBeetle', q: 0, r: 16 },
      { species: 'greenSpitter', q: -14, r: 14 },
      { species: 'greenSpitter', q: 14, r: -14 },
    ];

    const hiveIds: number[] = [];
    for (const h of hiveSpecs) {
      const hid = spawnHiveEntity(
        state,
        { species: h.species, q: h.q, r: h.r, popCap: 20, initialResidents: 16 },
        0,
        data,
      );
      hiveIds.push(hid);
    }

    expect(getAllHives(state)).toHaveLength(6);
    const faunaBugs = getAllResidentBugs(state);
    expect(faunaBugs.length).toBe(96);

    const colonyUnitCount = 200 - faunaBugs.length;
    const colonyUnitIds: number[] = [];
    const unitKinds = [ENTITY_KIND.recon, ENTITY_KIND.demoTank, ENTITY_KIND.demoArtillery];
    for (let i = 0; i < colonyUnitCount; i++) {
      const kind = unitKinds[i % unitKinds.length]!;
      const q = (i % 13) - 6;
      const r = Math.floor(i / 13) - 4;
      const hp = kind === ENTITY_KIND.demoTank ? 500 : kind === ENTITY_KIND.demoArtillery ? 220 : 240;
      colonyUnitIds.push(spawnColonyCombatUnit(state, kind, 0, q, r, hp));
    }

    const totalCombatUnits = faunaBugs.length + colonyUnitIds.length;
    expect(totalCombatUnits).toBe(200);

    for (const hid of hiveIds) {
      provokeHiveAgainstColony(state, hid, 0, 0, data);
    }

    for (let p = 0; p < 50; p++) {
      const attackerId = colonyUnitIds[p % colonyUnitIds.length]!;
      const targetBug = faunaBugs[p % faunaBugs.length]!;
      fireProjectile(state, {
        attackerId,
        attackerOwner: 0,
        targetId: targetBug.entityId,
        weaponId: p % 2 === 0 ? 'artilleryShell' : 'tankRocket',
        damage: 15,
        speed: 1.5,
        aoe: p % 2 === 0 ? 1.5 : 0,
        tick: 0,
      });
    }

    expect(getPendingProjectileImpacts(state).length).toBeGreaterThanOrEqual(50);

    // Warmup initial vision cache
    updateColonyVisionCache(state, state.meta.tick, data, true);

    const ticks = 20;
    let totalVisionMs = 0;
    let totalStepMs = 0;
    const stepTimes: number[] = [];

    for (let t = 1; t <= ticks; t++) {
      const v0 = performance.now();
      updateColonyVisionCache(state, state.meta.tick, data, false);
      totalVisionMs += performance.now() - v0;

      const s0 = performance.now();
      host.step(1);
      const dtMs = performance.now() - s0;
      totalStepMs += dtMs;
      stepTimes.push(dtMs);
    }

    const avgVisionMs = totalVisionMs / ticks;
    const avgStepMs = totalStepMs / ticks;
    const sortedSteps = [...stepTimes].sort((a, b) => a - b);
    const p99StepMs = sortedSteps[Math.min(sortedSteps.length - 1, Math.floor(sortedSteps.length * 0.99))]!;

    console.info(
      `[W07-30 Perf] 200 units + 50 projectiles + 6 hives: avgStep=${avgStepMs.toFixed(2)}ms, p99Step=${p99StepMs.toFixed(2)}ms, avgVision=${avgVisionMs.toFixed(3)}ms`,
    );

    expect(avgVisionMs).toBeLessThanOrEqual(0.5);
    expect(avgStepMs).toBeLessThan(50);
  });
});

describe('W07-30 · Fauna wire bandwidth benchmark (50-unit encounter)', () => {
  it('maintains steady-state wire bandwidth <= 15 KB/s per client in a 50-unit encounter (bootstrap snapshot reported separately)', () => {
    const { host, state, data } = createBenchmarkHost('w07-bw-50', 28);

    const h1 = spawnHiveEntity(
      state,
      { species: 'blackAnt', q: 10, r: 0, popCap: 12, initialResidents: 10 },
      0,
      data,
    );
    const h2 = spawnHiveEntity(
      state,
      { species: 'blueBeetle', q: -10, r: 4, popCap: 8, initialResidents: 7 },
      0,
      data,
    );
    const h3 = spawnHiveEntity(
      state,
      { species: 'greenSpitter', q: 0, r: -10, popCap: 8, initialResidents: 8 },
      0,
      data,
    );

    const faunaBugs = getAllResidentBugs(state);
    expect(faunaBugs.length).toBe(25);

    const colonyUnitIds: number[] = [];
    for (let i = 0; i < 25; i++) {
      const q = (i % 5) - 2;
      const r = Math.floor(i / 5) - 2;
      const kind = i % 3 === 0 ? ENTITY_KIND.demoTank : ENTITY_KIND.recon;
      colonyUnitIds.push(spawnColonyCombatUnit(state, kind, 0, q, r, 400));
    }
    expect(faunaBugs.length + colonyUnitIds.length).toBe(50);

    provokeHiveAgainstColony(state, h1, 0, 0, data);
    provokeHiveAgainstColony(state, h2, 0, 0, data);
    provokeHiveAgainstColony(state, h3, 0, 0, data);

    // Step 1 tick so initial setup stamps settle before measuring steady-state encounter traffic
    host.step(1);

    const bootstrapBytes = host.snapshot({ forClient: true }).byteLength;
    void host.diffSince(host.tick, { forClient: true });

    let totalDiffBytes = 0;
    const blobBytesByKey: Record<string, number> = {};
    let entitiesBytes = 0;
    let coloniesBytes = 0;
    let tilesBytes = 0;
    const packedBytes = { projectiles: 0, stances: 0, faunaRoutes: 0 };

    const encounterTicks = 50; // 10 seconds at 5 TPS
    for (let i = 0; i < encounterTicks; i++) {
      const prevTick = host.tick;
      host.step(1);
      const diff = host.diffSince(prevTick, { forClient: true });
      totalDiffBytes += diff.byteLength;

      const decoded = decodeValue(diff) as EngineDiff;
      entitiesBytes += encodeValue(decoded.entities).byteLength;
      coloniesBytes += encodeValue(decoded.colonies).byteLength;
      tilesBytes += encodeValue(decoded.tiles).byteLength;
      if (decoded.projectileQueue) packedBytes.projectiles += encodeValue(decoded.projectileQueue).byteLength;
      if (decoded.stancePatch) packedBytes.stances += encodeValue(decoded.stancePatch).byteLength;
      if (decoded.faunaMotion) packedBytes.faunaRoutes += encodeValue(decoded.faunaMotion).byteLength;
      for (const [k, v] of Object.entries(decoded.blobs)) {
        blobBytesByKey[k] = (blobBytesByKey[k] ?? 0) + encodeValue(v).byteLength;
      }
    }

    const steadyStateBytesPerSec = totalDiffBytes / 10;
    console.info(
      `[W07-30 Bandwidth] bootstrap=${bootstrapBytes} B (${(bootstrapBytes / 1024).toFixed(1)} KB), steadyState=${steadyStateBytesPerSec.toFixed(0)} B/s (${(steadyStateBytesPerSec / 1024).toFixed(2)} KB/s)`,
    );
    console.info(
      `[W07-30 Wire sections over 10s] entities=${entitiesBytes} B, colonies=${coloniesBytes} B, tiles=${tilesBytes} B, packed=${JSON.stringify(packedBytes)}, blobs=${JSON.stringify(blobBytesByKey)}`,
    );

    expect(bootstrapBytes).toBeGreaterThan(0);
    expect(packedBytes.projectiles).toBeGreaterThan(0);
    expect(packedBytes.stances).toBeGreaterThan(0);
    expect(steadyStateBytesPerSec).toBeLessThanOrEqual(15 * 1024);
  });
});
