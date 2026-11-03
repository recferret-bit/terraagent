import { expect, it } from 'vitest';
import { parseWaves } from '@terra/contracts';
import {
  SimHost,
  STAGE_TABLE_ROWS,
  computeColonyThreatStage,
  createState,
  getColonyProgression,
  getColonyUnlockAndThreatSnapshot,
  getColonyUnlockStage,
  isItemUnlockedForColony,
  startBuildingConstruction,
} from '../../src';

it('W08-06: spawning a colony with unlockStage = 4 makes S1-S4 items buildable immediately while threatStage === 0', () => {
  const host = new SimHost({
    flags: parseWaves('..08'),
  });
  host.load(
    createState({
      planetId: 'pl_w08_06_1',
      planetType: 'temperate',
      seed: 'w08-06-unlock-threat-split',
      radius: 14,
    }),
  );

  host.submit({
    commandId: 'cmd_spawn_u4',
    source: 'system',
    kind: 'system.spawnColony',
    colonyIndex: 0,
    args: {
      colonyId: 'col_0',
      name: 'Second Planet Outpost',
      unlockStage: 4,
    },
  });
  const firstStep = host.step(5);
  expect(firstStep.outcomes[0]?.code).toBeUndefined();
  expect(
    firstStep.events.some(
      (e) => e.kind === 'stageUnlocked' && (e.data as { unlockStage?: number })?.unlockStage === 4,
    ),
  ).toBe(true);

  for (let i = 0; i < 6; i++) {
    host.step(5);
  }

  const prog = getColonyProgression(host.state, 0);
  expect(prog.stage).toBe(0);
  expect(prog.unlockStage).toBe(4);
  expect(prog.threatStage).toBe(0);
  expect(getColonyUnlockStage(host.state, 0)).toBe(4);
  expect(computeColonyThreatStage(host.state, 0)).toBe(0);

  for (const s of [0, 1, 2, 3, 4]) {
    const row = STAGE_TABLE_ROWS.find((r) => r.stage === s)!;
    for (const b of row.buildings) expect(isItemUnlockedForColony(host.state, 0, b)).toBe(true);
    for (const u of row.units) expect(isItemUnlockedForColony(host.state, 0, u)).toBe(true);
    for (const o of row.orders) expect(isItemUnlockedForColony(host.state, 0, o)).toBe(true);
  }

  expect(isItemUnlockedForColony(host.state, 0, 'smelter')).toBe(false);
  expect(isItemUnlockedForColony(host.state, 0, 'launchPad')).toBe(false);

  const snapshot = getColonyUnlockAndThreatSnapshot(host.state, 0);
  expect(snapshot.unlockStage).toBe(4);
  expect(snapshot.threatStage).toBe(0);
  expect(snapshot.buildings).toEqual(
    expect.arrayContaining(['commandHub', 'metalsExtractor', 'solar', 'roboticsFactory', 'outpostBeacon', 'tradeHub']),
  );
  expect(snapshot.units).toEqual(
    expect.arrayContaining(['harvester', 'builder', 'scout', 'guard', 'combatEngineer', 'hauler']),
  );

  const v = host.view();
  expect(v.colonies[0].unlockStage).toBe(4);
  expect(v.colonies[0].threatStage).toBe(0);
  expect(v.colonies[0].stage).toBe(0);
});

it('W08-06: raising threatStage locally as gating buildings complete does not lower unlockStage', () => {
  const host = new SimHost({
    flags: parseWaves('..08'),
  });
  host.load(
    createState({
      planetId: 'pl_w08_06_2',
      planetType: 'temperate',
      seed: 'w08-06-local-threat-rise',
      radius: 14,
    }),
  );

  host.submit({
    commandId: 'cmd_spawn_u4_2',
    source: 'system',
    kind: 'system.spawnColony',
    colonyIndex: 0,
    args: { colonyId: 'col_0', unlockStage: 4 },
  });
  for (let i = 0; i < 7; i++) host.step(5);

  expect(getColonyUnlockStage(host.state, 0)).toBe(4);
  expect(computeColonyThreatStage(host.state, 0)).toBe(0);

  const pod = (host.state.blobs.landingPods?.value as Array<{ q: number; r: number }>)[0];
  startBuildingConstruction(host.state, {
    owner: 0,
    building: 'commandHub',
    q: pod.q,
    r: pod.r,
    instant: true,
    costOverride: {},
    tick: host.state.meta.tick,
  });
  host.step(5);

  expect(getColonyUnlockStage(host.state, 0)).toBe(4);
  expect(computeColonyThreatStage(host.state, 0)).toBe(1);
});
