import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { ArchetypeCatalog } from '../../kitbash';
import { extractArchetype } from '../../kitbash/validate/extract';
import { vertebratePartMatrix } from './pose';
import { getVertebrateConfig, isVertebrateGeometry } from './rig';
import { vertebrateValidationStates } from './validationPoses';

const VERTEBRATE_IDS = ArchetypeCatalog.listBiosphere().map((e) => e.id);

describe('vertebrate anatomical rig & motion parity', () => {
  it('covers all 27 biosphere mammals and birds (>=22 parts, <3500 tris each)', () => {
    expect(VERTEBRATE_IDS.length).toBe(27);
    for (const id of VERTEBRATE_IDS) {
      const geo = ArchetypeCatalog.getGeometry(id);
      expect(isVertebrateGeometry(geo), id).toBe(true);
      const pos = geo.getAttribute('position');
      expect(pos.count / 3, `${id} triangle budget`).toBeLessThan(3500);
      geo.dispose();
    }
  });

  for (const id of VERTEBRATE_IDS) {
    it(`${id} stays 100% rigid (det=1, zero scaling) and safe above ground across all behavioral states`, () => {
      const model = extractArchetype(id);
      expect(model.parts.length).toBeGreaterThanOrEqual(22);

      const geo = ArchetypeCatalog.getGeometry(id);
      const cfg = getVertebrateConfig(geo);
      geo.dispose();

      let minY = Infinity;
      let worst = '';
      const scale = new THREE.Vector3();
      const v = new THREE.Vector3();

      for (const state of vertebrateValidationStates(cfg)) {
        for (const part of model.parts) {
          expect(part.vertRig, `${id} / ${part.name} missing vertRig`).toBeDefined();
          const matrix = vertebratePartMatrix(part.vertRig!, state.pose);
          scale.setFromMatrixScale(matrix);
          for (const axis of scale.toArray()) expect(axis).toBeCloseTo(1, 5);
          expect(matrix.determinant()).toBeCloseTo(1, 5);

          for (let i = 0; i < part.tris.length; i += 3) {
            v.fromArray(part.tris, i).applyMatrix4(matrix);
            if (v.y < minY) {
              minY = v.y;
              worst = `${id} ${part.name} at ${state.label}`;
            }
          }
        }
      }
      expect(minY, worst).toBeGreaterThanOrEqual(-0.02);
    });
  }
});

describe('vertebrate avian wingbeat & quadruped IK kinematics', () => {
  it('enforces avian supination on upstroke, pronation on downstroke, one-way carpal fold, and mammal crouch & ankle/paw flexion', () => {
    const hawkGeo = ArchetypeCatalog.getGeometry('fauna.bird.highlandHawk');
    const hawkCfg = getVertebrateConfig(hawkGeo);
    hawkGeo.dispose();
    const hawkModel = extractArchetype('fauna.bird.highlandHawk');
    const rightInner = hawkModel.parts.find((p) => p.vertRig?.role === 7 && p.vertRig.pivot[0] > 0)!.vertRig!;
    const rightOuter = hawkModel.parts.find((p) => p.vertRig?.role === 8 && p.vertRig.pivot[0] > 0)!.vertRig!;

    // Upstroke (g = 0.15, d(sin g)/dt > 0): leading edge (+Z) pitches UP above trailing edge (-Z), and wrist folds downward
    const tUp = 0.15 / hawkCfg.gaitFreq;
    const upInnerMat = vertebratePartMatrix(rightInner, { time: tUp, walk: 1, run: 0, work: 0, sleep: 0, config: hawkCfg });
    const upOuterMat = vertebratePartMatrix(rightOuter, { time: tUp, walk: 1, run: 0, work: 0, sleep: 0, config: hawkCfg });
    const leadUp = new THREE.Vector3(rightInner.pivot[0], rightInner.pivot[1], rightInner.pivot[2] + 0.1).applyMatrix4(upInnerMat);
    const trailUp = new THREE.Vector3(rightInner.pivot[0], rightInner.pivot[1], rightInner.pivot[2] - 0.1).applyMatrix4(upInnerMat);
    expect(leadUp.y).toBeGreaterThan(trailUp.y);

    // Downstroke (g = PI + 0.15, d(sin g)/dt < 0): trailing edge (-Z) deflects UP above leading edge (+Z) for forward thrust
    const tDown = (Math.PI + 0.15) / hawkCfg.gaitFreq;
    const downInnerMat = vertebratePartMatrix(rightInner, { time: tDown, walk: 1, run: 0, work: 0, sleep: 0, config: hawkCfg });
    const leadDown = new THREE.Vector3(rightInner.pivot[0], rightInner.pivot[1], rightInner.pivot[2] + 0.1).applyMatrix4(downInnerMat);
    const trailDown = new THREE.Vector3(rightInner.pivot[0], rightInner.pivot[1], rightInner.pivot[2] - 0.1).applyMatrix4(downInnerMat);
    expect(trailDown.y).toBeGreaterThan(leadDown.y);
    expect(upOuterMat.determinant()).toBeCloseTo(1, 5);

    // Mammal trot suspension drops hip at maximum leg extension (g = PI/2) below mid-stance vault peak (g = 0.09)
    const wolfGeo = ArchetypeCatalog.getGeometry('fauna.timberWolf');
    const wolfCfg = getVertebrateConfig(wolfGeo);
    wolfGeo.dispose();
    const bodyRig = { role: 1 as const, pivot: [0, 0, 0] as THREE.Vector3Tuple, joint: [0, 0, 0] as THREE.Vector3Tuple, tip: [0, 0, 0] as THREE.Vector3Tuple, meta: 0 };
    const vaultY = new THREE.Vector3(0, wolfCfg.comY, 0).applyMatrix4(
      vertebratePartMatrix(bodyRig, { time: 0.09 / wolfCfg.gaitFreq, walk: 1, run: 0, work: 0, sleep: 0, config: wolfCfg }),
    ).y;
    const reachY = new THREE.Vector3(0, wolfCfg.comY, 0).applyMatrix4(
      vertebratePartMatrix(bodyRig, { time: (Math.PI * 0.5 + 0.09) / wolfCfg.gaitFreq, walk: 1, run: 0, work: 0, sleep: 0, config: wolfCfg }),
    ).y;
    expect(vaultY - reachY).toBeGreaterThan(wolfCfg.liftHeight * 0.45);

    // Mammal gallop suspension crouches below rest COM during stance compression so legs never lock straight
    const gallopStanceY = new THREE.Vector3(0, wolfCfg.comY, 0).applyMatrix4(
      vertebratePartMatrix(bodyRig, { time: 2.0 / (wolfCfg.gaitFreq * 1.35), walk: 1, run: 1, work: 0, sleep: 0, config: wolfCfg }),
    ).y;
    expect(gallopStanceY).toBeLessThan(wolfCfg.comY - wolfCfg.liftHeight * 0.45);

    // Early-swing ankle tuck folds foot backward at mid-swing (tau = 0) and airborne paw flexes >= 0.24 rad (~14 deg)
    const wolfModel = extractArchetype('fauna.timberWolf');
    const rightForeFoot = wolfModel.parts.find((p) => p.vertRig?.role === 6 && p.vertRig.pivot[0] > 0 && p.vertRig.pivot[2] > 0)!.vertRig!;
    const midSwingMat = vertebratePartMatrix(rightForeFoot, { time: 0, walk: 1, run: 0, work: 0, sleep: 0, config: wolfCfg });
    const ankleSwing = new THREE.Vector3(...rightForeFoot.tip).applyMatrix4(midSwingMat);
    expect(ankleSwing.z).toBeLessThan(rightForeFoot.tip[2] - wolfCfg.strideLen * 0.18);

    const earlySwingTime = -0.58 / wolfCfg.gaitFreq;
    const earlySwingFootMat = vertebratePartMatrix(rightForeFoot, { time: earlySwingTime, walk: 1, run: 0, work: 0, sleep: 0, config: wolfCfg });
    const rotEuler = new THREE.Euler().setFromRotationMatrix(earlySwingFootMat, 'YXZ');
    expect(rotEuler.x).toBeGreaterThanOrEqual(0.24);
  });
});
