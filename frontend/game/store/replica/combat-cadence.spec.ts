import { expect, it } from 'vitest';
import { adminRelocateEntity, getUnitStanceRecord, provokeHiveAgainstColony, rowOf, setUnitStance } from '@terra/sim';
import { faunaWireFixture } from './fauna-motion-fixture';
import { Predictor } from '../prediction/Predictor';

it.each(['server', 'local'] as const)('%s streams target and firing cadence before pending-command prediction clones confirmed combat', async mode => {
  const fixture = faunaWireFixture(mode, 0, true);
  try {
    const { host, worker } = fixture;
    const hq = host.view().entities.find(e => e.owner === 0)!;
    const hive = host.view().entities.find(e => e.kind === 63)!;
    adminRelocateEntity(host.state.entities, rowOf(host.state.entities, hq.id), -3, 0, host.tick);
    provokeHiveAgainstColony(host.state, hive.id, 0, host.tick, host.pipeline.config.data);
    setUnitStance(host.state, hq.id, 'hold', undefined, host.tick);
    fixture.welcome();
    let shots = 0;
    let lastShot = -1;
    for (let i = 0; i < 20; i++) {
      fixture.step();
      const expected = getUnitStanceRecord(host.state, hq.id);
      if ((expected?.lastFiredTick ?? -1) > lastShot) { lastShot = expected!.lastFiredTick!; shots++; }
      expect(getUnitStanceRecord(worker.core.state, hq.id), `confirmed cadence tick ${host.tick}`).toEqual(expected);
    }
    expect(shots).toBeGreaterThan(1);
    const predictor = new Predictor(worker.core, { now: () => 0, p95LimitMs: Infinity });
    predictor.submit({ id: 'pending-stance', kind: 'setStance', args: { entityIds: [hq.id], stance: 'hold' }, sentAtMs: 0 });
    const expected = host.clone();
    expected.submit({ commandId: 'pending-stance', colonyIndex: 0, source: 'player', kind: 'setStance', args: { entityIds: [hq.id], stance: 'hold' } });
    expected.step(predictor.targetTick() - host.tick);
    expect(getUnitStanceRecord(predictor.host().state, hq.id)).toEqual(getUnitStanceRecord(expected.state, hq.id));
  } finally { await fixture.close(); }
});
