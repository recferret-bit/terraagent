import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { InsectAnimationController } from './InsectAnimationController';
import { insectPartMatrix } from './pose';
import { classifyInsectPart } from './rig';
import { insectValidationStates } from './validationPoses';
import { extractArchetype } from '../../kitbash/validate/extract';
import '../../kitbash/index';

const controller = () => {
  const mesh = new THREE.Object3D(); mesh.name = 'fauna.blackAnt';
  return new InsectAnimationController(mesh);
};
describe('insect presentation state machine', () => {
  it('follows authoritative timing, retains progress on repeated snapshots, then resumes locomotion', () => {
    const c = controller();
    c.setMoving(true); expect(c.state).toBe('moving');
    c.sync({ state: 'windup', startedTick: 10, durationTicks: 2 }, 10);
    c.update(0.2); const charge = c.pose.charge;
    c.sync({ state: 'windup', startedTick: 10, durationTicks: 2 }, 10);
    expect(c.pose.charge).toBe(charge);
    c.sync({ state: 'attack', startedTick: 12, durationTicks: 1 }, 12);
    expect(c.pose.strike).toBe(1);
    c.hit(); expect(c.state).toBe('hurt'); expect(c.pose.strike).toBe(1);
    c.update(0.23); expect(c.state).toBe('attack');
    const settling = c.pose.strike;
    c.sync(undefined, 14); expect(c.state).toBe('moving'); expect(c.pose.strike).toBe(settling);
    c.update(1); expect(c.pose.strike).toBeLessThan(0.001);
    c.setMoving(false); expect(c.state).toBe('idle');
  });
  it('death overrides incoming actions and movement until corpse retirement', () => {
    const c = controller(); c.die(); c.update(0.45); expect(c.state).toBe('dying');
    c.sync({ state: 'attack', startedTick: 10, durationTicks: 1 }, 10); c.setMoving(true); c.hit();
    expect(c.pose.walk).toBe(0); c.update(0.46); expect(c.state).toBe('dead');
    expect(c.corpseDone).toBe(false); c.update(1.5); expect(c.corpseDone).toBe(true);
  });
});
describe('insect articulated poses', () => {
  for (const [species, id] of ['fauna.blackAnt', 'fauna.blueBeetle', 'fauna.greenSpitter'].entries()) {
    it(`${id} keeps anatomy rigid and above the ground in every authored state`, () => {
      const model = extractArchetype(id); let minimum = 0; let worst = '';
      for (const part of model.parts) for (const state of insectValidationStates(species)) {
        const rig = classifyInsectPart(part.name, part.animType, part.pivot);
        const matrix = insectPartMatrix(rig, state.pose);
        const scale = new THREE.Vector3().setFromMatrixScale(matrix);
        if (rig.group === 6) expect(Math.abs(scale.x - 1)).toBeLessThanOrEqual(0.2051);
        else { for (const axis of scale.toArray()) expect(axis).toBeCloseTo(1, 6); expect(matrix.determinant()).toBeCloseTo(1, 6); }
        for (let i = 0; i < part.tris.length; i += 3) {
          const v = new THREE.Vector3().fromArray(part.tris, i).applyMatrix4(matrix);
          if (v.y < minimum) { minimum = v.y; worst = `${part.name}: ${state.label}`; }
        }
      }
      expect(minimum, worst).toBeGreaterThanOrEqual(-0.02);
    });
  }
});
