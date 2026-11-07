import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { createArchetypeMesh } from '../../kitbash';
import { BattlePresentation } from '../../combat/BattlePresentation';
import { getInsectAnimator, InsectAnimationController } from './InsectAnimationController';
import { InsectInertia } from './InsectInertia';

function animator(species = 'blackAnt') {
  const mesh = new THREE.Object3D(); mesh.name = `fauna.${species}`;
  return new InsectAnimationController(mesh);
}

describe('insect attack refinement', () => {
  it('alternates actual sac origins despite even shot cadence and repeated action/event delivery', () => {
    const mesh = createArchetypeMesh('fauna.greenSpitter');
    const battle = new BattlePresentation(id => id === 1 ? mesh : undefined);
    battle.insects.track(1, mesh, 100, false);
    const controller = getInsectAnimator(mesh)!;
    for (const [i, tick] of [10, 20, 30, 40].entries()) {
      battle.insects.sync({ byEntityId: { 1: { state: 'attack', startedTick: tick, durationTicks: 1 } } }, tick);
      const input = { weaponId: 'spitterAcid', firedTick: tick, impactTick: tick + 2,
        from: { x: 0, y: 0 }, to: { x: 5, y: 1, z: 0 } };
      const first = battle.shot(1, input);
      const repeated = battle.shot(1, input);
      expect(controller.emissionSide).toBe(i % 2);
      const expected = controller.socket('projectile', i % 2);
      expect(new THREE.Vector3(first.from.x, first.from.y, first.from.z).distanceTo(expected)).toBeLessThan(1e-6);
      expect(repeated.from).toEqual(first.from);
      expect(controller.pose.sacSide).toBe(i % 2 === 0 ? -1 : 1);
    }
    battle.clear(); (mesh.material as THREE.Material).dispose(); mesh.customDepthMaterial?.dispose();
  });

  it.each(['blackAnt', 'blueBeetle', 'greenSpitter'])('%s preserves momentum across recovery and idle boundaries', species => {
    const c = animator(species);
    c.sync({ state: 'windup', startedTick: 1, durationTicks: 3 }, 1);
    for (let i = 0; i < 36; i++) c.update(1 / 60);
    const charge = c.pose.charge;
    c.sync({ state: 'attack', startedTick: 4, durationTicks: 1 }, 4);
    expect(c.pose.charge).toBe(charge);
    expect(c.pose.strike).toBe(1);
    c.update(0.2);
    const strike = c.pose.strike;
    c.sync({ state: 'recovery', startedTick: 5, durationTicks: 1 }, 5);
    expect(c.pose.strike).toBe(strike);
    c.update(0.2);
    const tail = c.pose.strike;
    expect(tail).toBeGreaterThan(0.1);
    c.sync(undefined, 6);
    expect(c.pose.strike).toBe(tail);
    c.update(0); expect(c.pose.strike).toBe(tail);
    for (let i = 0; i < 60; i++) c.update(1 / 60);
    expect(c.pose.strike).toBeLessThan(0.001);
    expect(c.pose.charge).toBeLessThan(0.001);
  });

  it('uses an exact damped response independent of frame subdivision for a constant target', () => {
    const a = new InsectInertia(), b = new InsectInertia();
    a.snap(1); b.snap(1); a.step(0, 0.2, 9);
    for (let i = 0; i < 12; i++) b.step(0, 1 / 60, 9);
    expect(a.value).toBeCloseTo(b.value, 12);
  });
});
