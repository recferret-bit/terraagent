import { expect, it } from 'vitest';
import { getMotion, hexIndex, setTileTerrain, TERRAIN } from '@terra/sim';
import { faunaPoses as poses, faunaWireFixture } from './fauna-motion-fixture';
import { Predictor } from '../prediction/Predictor';

it.each(['server', 'local'] as const)('%s client diffs keep fauna moving with predict=0 and no pending commands', async mode => {
  const fixture = faunaWireFixture(mode);
  try {
    let movingFrames = 0;
    for (let tick = 1; tick <= 49; tick++) {
      const before = poses(fixture.host.view());
      fixture.step();
      const expected = poses(fixture.host.view());
      if (JSON.stringify(expected) !== JSON.stringify(before)) movingFrames++;
      expect(fixture.worker.core.status).toBe('ready');
      expect(poses(fixture.worker.core.view()), `fauna wire motion at tick ${tick}`).toEqual(expected);
    }
    expect(movingFrames).toBeGreaterThan(5);
    expect(fixture.worker.predictor.enabled).toBe(false);
  } finally { await fixture.close(); }
});

it.each(['server', 'local'] as const)('%s mid-walk welcome restores motion before the next five-second correction', async mode => {
  const fixture = faunaWireFixture(mode, 19);
  try {
    for (let i = 0; i < 6; i++) {
      fixture.step(2);
      expect(poses(fixture.worker.core.view()), `mid-walk join at tick ${fixture.host.tick}`).toEqual(poses(fixture.host.view()));
    }
    fixture.welcome();
    fixture.step();
    expect(poses(fixture.worker.core.view())).toEqual(poses(fixture.host.view()));
  } finally { await fixture.close(); }
});

it('honors authoritative terrain changes during a passive patrol', async () => {
  const fixture = faunaWireFixture('server');
  try {
    let waypoint: [number, number] | null = null;
    for (let i = 0; i < 30 && !waypoint; i++) {
      fixture.step();
      for (const bug of fixture.host.view().entities.filter(e => e.kind === 60)) {
        const motion = getMotion(fixture.host.state, bug.id);
        if (motion && motion.path.length > motion.next * 2
          && (motion.path[motion.next * 2] !== bug.q || motion.path[motion.next * 2 + 1] !== bug.r)) {
          waypoint = [motion.path[motion.next * 2], motion.path[motion.next * 2 + 1]];
          break;
        }
      }
    }
    expect(waypoint).not.toBeNull();
    const tile = hexIndex(fixture.host.state.grid.radius).indexOf(...waypoint!);
    setTileTerrain(fixture.host.state.grid, tile, TERRAIN.rock, fixture.host.tick + 1);
    for (let i = 0; i < 15; i++) {
      fixture.step();
      expect(poses(fixture.worker.core.view()), `terrain-change tick ${fixture.host.tick}`).toEqual(poses(fixture.host.view()));
    }
  } finally { await fixture.close(); }
});

it('retains reconstructed fauna routes while a player command is predicted', async () => {
  const fixture = faunaWireFixture('server', 0, true);
  try {
    for (let i = 0; i < 19; i++) fixture.step();
    const predictor = new Predictor(fixture.worker.core, { now: () => 0, p95LimitMs: Number.POSITIVE_INFINITY });
    const hq = fixture.host.view().entities.find(e => e.owner === 0)!;
    predictor.submit({ id: 'pending-stance', kind: 'setStance', args: { entityId: hq.id, stance: 'hold' }, sentAtMs: 0 });
    const expected = fixture.host.clone();
    expected.step(predictor.targetTick() - fixture.host.tick);
    expect(predictor.pending).toHaveLength(1);
    expect(predictor.host().tick).toBeGreaterThan(fixture.host.tick);
    expect(poses(predictor.view())).toEqual(poses(expected.view()));
  } finally { await fixture.close(); }
});
