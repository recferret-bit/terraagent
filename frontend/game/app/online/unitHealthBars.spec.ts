import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { ENTITY_KIND } from '@terra/sim';
import { disposeObject3D, UnitHealthBars } from './unitHealthBars';

const rec = (id: number, kind: number, over: Partial<{ hp: number; hpMax: number; progress: number }> = {}) => ({
  id, kind, hp: 100, hpMax: 100, ...over, mesh: new THREE.Object3D(),
});

describe('UnitHealthBars', () => {
  it('a descending drop pod (progress = landing) gets no blue bar; a building under construction does', () => {
    const scene = new THREE.Scene();
    const bars = new UnitHealthBars(scene);
    bars.sync([rec(1, ENTITY_KIND.pod, { progress: 0.4 }), rec(2, ENTITY_KIND.solar, { progress: 0.4 })]);
    expect(bars.group.getObjectByName('unit-hp-1')).toBeUndefined();
    expect(bars.group.getObjectByName('unit-hp-2')?.getObjectByName('progress-bar-group')?.visible).toBe(true);
    bars.sync([]); // removed entities lose their bar
    expect(bars.group.children).toHaveLength(0);
    bars.dispose();
    expect(scene.children).toHaveLength(0);
  });

  it('isEnabled false (W02 off) draws no bar and drops the existing ones', () => {
    const bars = new UnitHealthBars(new THREE.Scene());
    bars.sync([rec(5, ENTITY_KIND.hq, { hp: 50 })]);
    expect(bars.group.children).toHaveLength(1);
    bars.isEnabled = () => false;
    bars.sync([rec(5, ENTITY_KIND.hq, { hp: 50 })]);
    expect(bars.group.children).toHaveLength(0);
    bars.dispose();
  });

  it('bars face the rendering camera at any yaw (billboard before draw), so a Q / E turn never hides them', () => {
    const bars = new UnitHealthBars(new THREE.Scene());
    bars.sync([rec(5, ENTITY_KIND.hq, { hp: 50 })]);
    const root = bars.group.getObjectByName('unit-hp-5')!;
    const hpGroup = root.getObjectByName('hp-bar-group')!;
    const plate = hpGroup.children.find((c) => c.userData.role !== 'hp-above-fill') as THREE.Mesh;
    const camera = new THREE.PerspectiveCamera();
    camera.position.set(-42, 46, -42); // the iso camera turned 180°
    camera.lookAt(0, 0, 0);
    camera.updateMatrixWorld(true);
    plate.onBeforeRender({} as THREE.WebGLRenderer, new THREE.Scene(), camera, plate.geometry, plate.material as THREE.Material, new THREE.Group());
    const q = new THREE.Quaternion();
    hpGroup.parent!.getWorldQuaternion(q);
    expect(q.angleTo(camera.getWorldQuaternion(new THREE.Quaternion()))).toBeLessThan(1e-6);
    bars.dispose();
  });
});

describe('disposeObject3D', () => {
  it('disposes the projector rig kept in userData (its halo Sprite material is not a mesh) and mesh materials', () => {
    const obj = new THREE.Group();
    const mat = new THREE.MeshBasicMaterial();
    const matDispose = vi.spyOn(mat, 'dispose');
    obj.add(new THREE.Mesh(new THREE.PlaneGeometry(1, 1), mat));
    const rigDispose = vi.fn();
    obj.userData.projectorRig = { dispose: rigDispose };
    disposeObject3D(obj);
    expect(rigDispose).toHaveBeenCalledTimes(1);
    expect(matDispose).toHaveBeenCalled();
  });
});
