import { describe, expect, it } from 'vitest';
import { parseWaves } from '@terra/contracts';
import {
  applyDiff,
  clone,
  createRegistryPipeline,
  createState,
  diffSince,
  ENTITY_KIND,
  ENTITY_STATE,
  insertRow,
  setPlanetTime,
  step,
  view,
  type PlanetState,
} from '../../src';

function spawnBuilding(
  state: PlanetState,
  kind: number,
  q: number,
  r: number,
  w = 2,
  d = 2,
  hp = 500,
): number {
  const row = insertRow(state.entities, state.meta.nextEntityId++, 0);
  const cols = state.entities.cols;
  cols.kind[row] = kind;
  cols.owner[row] = 0;
  cols.q[row] = q;
  cols.r[row] = r;
  cols.footprintW[row] = w;
  cols.footprintD[row] = d;
  cols.hp[row] = hp;
  cols.hpMax[row] = hp;
  cols.state[row] = ENTITY_STATE.active;
  return row;
}

function initSyncTestState(): { state: PlanetState; pipeline: ReturnType<typeof createRegistryPipeline> } {
  const state = createState({ planetId: 'p-sync', planetType: 'temperate', seed: 'w03-sync', radius: 32 });
  state.colonies.push({
    index: 0,
    id: 'col-0',
    name: 'Alpha',
    color: 0xff6b00,
    status: 'active',
    changedAt: 0,
  });
  const pipeline = createRegistryPipeline({ flags: parseWaves('..03') });
  return { state, pipeline };
}

describe('W03-16 Power sync acceptance check', () => {
  it('overload fields ride diff delta and appear in replica view and client view within 1 delta', () => {
    const { state: s, pipeline } = initSyncTestState();

    // Hub at (0, 0)
    spawnBuilding(s, ENTITY_KIND.commandHub, 0, 0, 3, 3, 1500);

    // 5 Solar panels for plenty of supply (+100 E/s)
    for (let i = 0; i < 5; i++) {
      spawnBuilding(s, ENTITY_KIND.solar, 2, i * 2, 2, 2, 400);
    }

    // Pylon at (5, 0)
    const pylonRow = spawnBuilding(s, ENTITY_KIND.pylon, 5, 0, 1, 1, 100);
    const pylonId = s.entities.cols.id[pylonRow];

    // Extractor attached to Pylon at (6, 0)
    const extRow = spawnBuilding(s, ENTITY_KIND.metalsExtractor, 6, 0, 2, 2, 500);
    const extractorId = s.entities.cols.id[extRow];

    // Step 1 tick in midday to reach steady online baseline state s0
    setPlanetTime(s, { timeOfDay: 12 }, 0);
    step(s, [], 1, pipeline);

    expect(s.entities.cols.state[extRow]).toBe(ENTITY_STATE.active);

    // Replica cloned at s0
    const replica = clone(s);
    const v0 = view(replica);
    const ext0 = v0.entities.find((e) => e.id === extractorId);
    expect(ext0?.power?.state).toBe('online');
    expect(ext0?.power?.component).toBe(0);

    // Trigger an overload on the pylon via dev.addload 85 and step 1 tick to s1
    step(
      s,
      [
        {
          commandId: 'cmd-overload',
          colonyIndex: 0,
          source: 'dev',
          kind: 'dev.addload',
          args: { loadPerS: 85, pylonId },
        },
      ],
      1,
      pipeline,
    );

    // Verify authority state s1 transitioned extractor to offlineOverload
    expect(s.entities.cols.state[extRow]).toBe(ENTITY_STATE.offlineOverload);

    // Diff delta produced for client
    const diffBytes = diffSince(s, s0Tick(v0), { forClient: true });

    // Apply diff on replica
    applyDiff(replica, diffBytes);
    expect(replica.meta.tick).toBe(s.meta.tick);

    // Replica view projected
    const v1 = view(replica);

    // 1. Per-building power view
    const ext1 = v1.entities.find((e) => e.id === extractorId);
    expect(ext1?.power).toEqual({
      state: 'offline',
      reason: 'offline: overload',
      component: 0,
    });

    // 2. Per-pylon load and power view
    const pyl1 = v1.entities.find((e) => e.id === pylonId);
    expect(pyl1?.pylon).toBeDefined();
    expect(pyl1?.pylon?.max).toBe(80);
    expect(pyl1?.pylon?.flow).toBeGreaterThan(80);
    expect(pyl1?.pylon?.overloaded).toBe(true);
    expect(pyl1?.power?.overloaded).toBe(true);

    // 3. Colony power summary
    const colPower = v1.colonies[0]?.power as import('../../src').ColonyPowerSummary | undefined;
    expect(colPower).toBeDefined();
    expect(colPower?.supply).toBeGreaterThan(0);
    expect(colPower?.pylonLoads?.[pylonId]?.overloaded).toBe(true);
    expect(colPower?.entityPower?.[extractorId]?.reason).toBe('offline: overload');
  });
});

function s0Tick(v: ReturnType<typeof view>): number {
  return v.tick;
}
