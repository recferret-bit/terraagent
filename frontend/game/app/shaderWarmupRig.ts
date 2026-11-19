import * as THREE from 'three';
import type { ColonyViewport } from '@terra/render/core/createColonyViewport';
import { prewarmPooledShadowTargets } from '@terra/render/core/shadowQuality';
import { GridCableRenderer } from '@terra/render/lighting/gridCables';
import { createProjectorBeamMaterial } from '@terra/render/lighting/projectorBeamMaterial';
import { WorkParticleSystem } from '@terra/render/particles';
import { INSECT_ANIMATION } from '@terra/render/animation/insects/shader';
import { INSTANCE_ATTRIBUTES, useInsectInstanceAttributes } from '@terra/render/animation/insects/instanceShader';
import { WEAPON_RIG } from '@terra/render/combat/weaponShader';
import { InstancedRangeRings } from '@terra/render/visuals/rings/InstancedRangeRings';
import { createUnifiedColonyMaterial, RUIN_VARIANT } from '@terra/render/visuals/UnifiedColonyMaterial';
import { BUILD_SCAFFOLD } from '@terra/render/visuals/unified/buildScaffold';
import { BUILDING_LIT } from '@terra/render/visuals/unified/buildingLit';
import { SELECTION_PULSE } from '@terra/render/visuals/unified/selectionPulse';

export interface ShaderWarmupRig {
  readonly roots: THREE.Object3D[];
  dispose(): void;
}

const BASE_PLUGINS = [BUILD_SCAFFOLD, SELECTION_PULSE, BUILDING_LIT, RUIN_VARIANT];

function createTinyColonyGeo(extraScalarAttrs: readonly string[] = []): THREE.BufferGeometry {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array([0, 0, 0, 0.1, 0, 0, 0, 0.1, 0]), 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(new Float32Array([0, 1, 0, 0, 1, 0, 0, 1, 0]), 3));
  geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array([1, 1, 1, 1, 1, 1, 1, 1, 1]), 3));
  geo.setAttribute('aOrganic', new THREE.BufferAttribute(new Float32Array(3), 1));
  geo.setAttribute('aSurfacePBR', new THREE.BufferAttribute(new Float32Array(6), 2));
  geo.setAttribute('aPartAnim', new THREE.BufferAttribute(new Float32Array(12), 4));
  for (const attr of extraScalarAttrs) {
    geo.setAttribute(attr, new THREE.BufferAttribute(new Float32Array(3), 1));
  }
  geo.computeBoundingSphere();
  return geo;
}

function addDummyUnifiedMeshes(
  rigGroup: THREE.Group,
  biome: string,
  geometries: THREE.BufferGeometry[],
  materials: THREE.Material[],
): void {
  const combos: Array<{ plugins: string[]; extra: string[]; instanced?: boolean }> = [
    { plugins: BASE_PLUGINS, extra: [] },
    { plugins: [...BASE_PLUGINS, WEAPON_RIG], extra: ['aWeaponPart'] },
    { plugins: [...BASE_PLUGINS, INSECT_ANIMATION], extra: ['aInsectPart'] },
    { plugins: [...BASE_PLUGINS, INSECT_ANIMATION], extra: ['aInsectPart'], instanced: true },
  ];

  for (const combo of combos) {
    const { material, depthMaterial } = createUnifiedColonyMaterial({ biome, plugins: combo.plugins });
    const geo = createTinyColonyGeo(combo.extra);
    geometries.push(geo);
    materials.push(material, depthMaterial);

    if (combo.instanced) {
      for (const [name, size] of Object.entries(INSTANCE_ATTRIBUTES)) {
        geo.setAttribute(name, new THREE.InstancedBufferAttribute(new Float32Array(size), size));
      }
      useInsectInstanceAttributes(material);
      useInsectInstanceAttributes(depthMaterial);
      const inst = new THREE.InstancedMesh(geo, material, 1);
      inst.setMatrixAt(0, new THREE.Matrix4());
      inst.count = 1;
      inst.castShadow = true;
      inst.receiveShadow = true;
      inst.customDepthMaterial = depthMaterial;
      inst.frustumCulled = false;
      rigGroup.add(inst);
    } else {
      const mesh = new THREE.Mesh(geo, material);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.customDepthMaterial = depthMaterial;
      mesh.frustumCulled = false;
      rigGroup.add(mesh);
    }
  }
}

/**
 * Mounts lightweight hidden dummy meshes covering every gameplay shader permutation and prewarms pooled shadow
 * render targets so entering surface view or toggling features later never triggers on-the-fly shader recompiles.
 */
export function prewarmAllGameplayShaders(vp: ColonyViewport, scene: THREE.Scene, biomeKey: string): ShaderWarmupRig {
  prewarmPooledShadowTargets(vp.renderer, vp.sun, [1024, 2048]);
  if (vp.secondaryShadowLight) {
    prewarmPooledShadowTargets(vp.renderer, vp.secondaryShadowLight, [1024]);
  }

  const rigGroup = new THREE.Group();
  rigGroup.name = 'shader-warmup-rig';
  const geometries: THREE.BufferGeometry[] = [];
  const materials: THREE.Material[] = [];

  addDummyUnifiedMeshes(rigGroup, biomeKey, geometries, materials);

  const beamGeo = createTinyColonyGeo();
  const beamMat = createProjectorBeamMaterial();
  geometries.push(beamGeo);
  materials.push(beamMat);
  const beamMesh = new THREE.Mesh(beamGeo, beamMat);
  beamMesh.frustumCulled = false;
  rigGroup.add(beamMesh);

  const cables = new GridCableRenderer(rigGroup);
  cables.setSpans([{ a: [0, 1, 0], b: [4, 1, 0], sag: 0.2, radius: 0.04, state: 'online', seed: 0.1 }]);

  const particles = new WorkParticleSystem(rigGroup);
  particles.syncSites([
    { workerId: 'warmup', targetKind: 'rock', botOrigin: [0, 0, 0], toolOrigins: [[0, 0.5, 0]], targetPos: [2, 0, 0], groundY: 0, intensity: 1 },
  ]);

  const rings = new InstancedRangeRings(null, 4);
  rings.setRings([{ kind: 'weapon', radiusTiles: 3, worldX: 0, worldZ: 0, groundY: 0 }]);
  rigGroup.add(rings.mesh);

  rigGroup.visible = false;
  scene.add(rigGroup);

  let disposed = false;
  return {
    roots: [rigGroup],
    dispose() {
      if (disposed) return;
      disposed = true;
      rings.dispose();
      particles.dispose();
      cables.dispose();
      for (const g of geometries) g.dispose();
      for (const m of materials) m.dispose();
      rigGroup.removeFromParent();
    },
  };
}
