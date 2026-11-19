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
