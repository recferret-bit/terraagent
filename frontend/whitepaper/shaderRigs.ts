import * as THREE from 'three';
import type { ColonyViewport } from '@terra/render/core/createColonyViewport';
import {
  getWeatherParams,
  isWeatherOn,
  setWeather,
  setWeatherParams,
  tickWeatherClock,
} from '@terra/render/core/weatherConfig';
import { createArchetypeMesh, tickArchetypeMesh } from '@terra/render/kitbash';
import { PlanetaryLightingSystem } from '@terra/render/lighting/PlanetaryLightingSystem';
import { PLANET_SPECS, type PlanetKind } from '@terra/render/planets/PlanetSpec';
import { createUnifiedColonyMaterial } from '@terra/render/visuals/UnifiedColonyMaterial';
import {
  bakeShoreField,
  createShoreField,
  createShoreFieldTexture,
  writeShoreFieldTexture,
} from '@terra/render/visuals/water/shoreField';
import { createWaterMaterial } from '@terra/render/visuals/water/WaterMaterial';
import { createRainAndStormPass } from '@terra/render/weather/RainAndStormPass';
import type { CustomShaderKind } from './data/entitiesCatalog';
import {
  buildPedestal,
  disposeGroupGeometries,
  frameCameraForBox,
  getArchetypeGeometryBox,
  type RigHandle,
} from './stageRigs';

function stampUnifiedSlabAttributes(geo: THREE.BufferGeometry): void {
  const count = geo.getAttribute('position').count;
  const color = new Float32Array(count * 3);
  const pbr = new Float32Array(count * 2);
  const anim = new Float32Array(count * 4);
  const organic = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    color[i * 3] = 0.22;
    color[i * 3 + 1] = 0.26;
    color[i * 3 + 2] = 0.32;
    pbr[i * 2] = 0.82;
    pbr[i * 2 + 1] = 0.25;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(color, 3));
  geo.setAttribute('aSurfacePBR', new THREE.BufferAttribute(pbr, 2));
  geo.setAttribute('aPartAnim', new THREE.BufferAttribute(anim, 4));
  geo.setAttribute('aOrganic', new THREE.BufferAttribute(organic, 1));
}

export function createRainWeatherRig(biome: PlanetKind, vp: ColonyViewport): RigHandle {
  const group = new THREE.Group();
  group.add(buildPedestal(3.6));
  const turbine = createArchetypeMesh('building.wind', biome, 'full');
  turbine.position.set(-0.95, 0, -0.4);
  const pylon = createArchetypeMesh('building.pylon', biome, 'full');
  pylon.position.set(1.05, 0, 0.5);
  group.add(turbine, pylon);
  vp.scene.add(group);

  const prevOn = isWeatherOn();
  const prevParams = { ...getWeatherParams() };
  setWeather(true, 'sync');
  setWeatherParams({ rainIntensity: 0.88, stormActive: true, stormDarkness: 0.58 }, 'sync');
  tickWeatherClock(performance.now());
  const rainPass = createRainAndStormPass(vp.scene, vp.camera);
  const box = new THREE.Box3(new THREE.Vector3(-2.4, 0, -2.4), new THREE.Vector3(2.4, 3.4, 2.4))
    .union(getArchetypeGeometryBox(turbine))
    .union(getArchetypeGeometryBox(pylon));
  box.max.y += 0.2;
  frameCameraForBox(vp, box, 0.25);

  let t = 0;
  return {
    group,
    elapsed: 0,
    step: (dt) => {
      t += dt;
      tickArchetypeMesh(turbine, t, 0, 1);
      tickWeatherClock(performance.now());
      frameCameraForBox(vp, box, 0.25 + Math.sin(t * 0.3) * 0.12);
      rainPass.update(dt, vp.scene, vp.camera, {
        sun: vp.sun,
        hemi: vp.hemi,
        renderer: vp.renderer,
      });
    },
    dispose: () => {
      rainPass.dispose();
      vp.scene.remove(group);
      disposeGroupGeometries(group);
      setWeather(prevOn, 'sync');
      setWeatherParams(prevParams, 'sync');
      tickWeatherClock(performance.now());
      vp.applySky(PLANET_SPECS[biome]);
    },
  };
}

function createWaterShaderRig(biome: PlanetKind, vp: ColonyViewport): RigHandle {
  const group = new THREE.Group();
  const span = 8.4;
  const field = createShoreField(span, 64);
  bakeShoreField((x, z) => {
    const r = Math.hypot(x, z);
    if (r > 3.25) return 0;
    return r > 2.1 ? 1 : 2;
  }, field);
  const shoreTex = createShoreFieldTexture(64);
  writeShoreFieldTexture(shoreTex, field);

  const bedGeo = new THREE.PlaneGeometry(span, span, 28, 28);
  bedGeo.rotateX(-Math.PI * 0.5);
  const pos = bedGeo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const r = Math.hypot(pos.getX(i), pos.getZ(i));
    pos.setY(i, r > 3.35 ? 0.34 : r > 2.0 ? -0.45 : -1.25);
  }
  bedGeo.computeVertexNormals();
  const bedMat = new THREE.MeshStandardMaterial({
    color: biome === 'dune' ? 0xb98d52 : 0x3b4d3f,
    roughness: 0.92,
  });
  const bed = new THREE.Mesh(bedGeo, bedMat);
  bed.receiveShadow = true;

  const palette = biome === 'dune'
    ? { shallow: 0x2bb3c0, deep: 0x0a4258, sky: 0xf4c28a }
    : biome === 'oceanForest'
      ? { shallow: 0x1ea8c6, deep: 0x083052, sky: 0x8ad0f5 }
      : { shallow: 0x267a96, deep: 0x0b2b3d, sky: 0x9fc2db };

  const waterRes = createWaterMaterial({ ...palette, foam: 0xe6f8ff, heightTex: shoreTex, span, level: 0, shoreField: true });
  const waterGeo = new THREE.PlaneGeometry(span * 0.96, span * 0.96, 40, 40);
  waterGeo.rotateX(-Math.PI * 0.5);
  const waterMesh = new THREE.Mesh(waterGeo, waterRes.material);
  waterMesh.renderOrder = 1.5;

  const beacon = createArchetypeMesh('building.pylon', biome, 'full');
  beacon.position.set(-2.55, 0.25, -2.45);
  group.add(bed, waterMesh, beacon);
  vp.scene.add(group);

  const box = new THREE.Box3(new THREE.Vector3(-3.8, -1.0, -3.8), new THREE.Vector3(3.8, 2.2, 3.8))
    .union(getArchetypeGeometryBox(beacon));
  box.max.y += 0.35;
  frameCameraForBox(vp, box, 0.2);

  let t = 0;
  return {
    group,
    elapsed: 0,
    step: (dt) => {
      t += dt;
      waterRes.uniforms.uTime.value = t;
      frameCameraForBox(vp, box, 0.2 + t * 0.2);
    },
    dispose: () => {
      waterRes.dispose();
      shoreTex.dispose();
      bedMat.dispose();
      vp.scene.remove(group);
      disposeGroupGeometries(group);
    },
  };
}

function createUnifierShaderRig(biome: PlanetKind, vp: ColonyViewport): RigHandle {
  const group = new THREE.Group();
  const unified = createUnifiedColonyMaterial({ biome, triplanarScale: 0.55, rimStrength: 0.72 });
  const slabGeo = new THREE.CylinderGeometry(1.55, 1.7, 0.3, 6);
  stampUnifiedSlabAttributes(slabGeo);
  const slab = new THREE.Mesh(slabGeo, unified.material);
  slab.position.y = -0.15;
  slab.receiveShadow = true;

  const depot = createArchetypeMesh('building.supplyDepot', biome, 'full');
  depot.position.set(-0.22, 0, -0.1);
  const miner = createArchetypeMesh('robot.miner', biome, 'full');
  miner.position.set(0.68, 0, 0.38);
  miner.rotation.y = -0.65;
  group.add(slab, depot, miner);
  vp.scene.add(group);

  const box = getArchetypeGeometryBox(depot).union(getArchetypeGeometryBox(miner));
  box.expandByScalar(0.18);
  frameCameraForBox(vp, box, 0.12, 0.45);

  let t = 0;
  return {
    group,
    elapsed: 0,
    step: (dt) => {
      t += dt;
      unified.uniforms.uTime.value = t;
      tickArchetypeMesh(miner, t, 0, 1);
      frameCameraForBox(vp, box, 0.12 + t * 0.28, 0.45);
    },
    dispose: () => {
      unified.material.dispose();
      vp.scene.remove(group);
      disposeGroupGeometries(group);
    },
  };
}

function createDayNightShaderRig(biome: PlanetKind, vp: ColonyViewport): RigHandle {
  const dayScene = new THREE.Scene();
  dayScene.environment = vp.scene.environment;
  const group = new THREE.Group();
  group.add(buildPedestal(2.1));
  const solar = createArchetypeMesh('building.solar', biome, 'full');
  solar.position.set(-0.68, 0, -0.28);
  const cap = createArchetypeMesh('building.capacitor', biome, 'full');
  cap.position.set(0.66, 0, -0.18);
  const scout = createArchetypeMesh('robot.recon', biome, 'full');
  scout.position.set(0.05, 0, 0.72);
  group.add(solar, cap, scout);
  dayScene.add(group);

  const lighting = new PlanetaryLightingSystem(dayScene);
  const target = new THREE.Vector3(0, 0.5, 0);
  const box = getArchetypeGeometryBox(solar)
    .union(getArchetypeGeometryBox(cap))
    .union(getArchetypeGeometryBox(scout));
  box.expandByScalar(0.16);
  vp.setView(dayScene, vp.camera);
  let phase = 0.72;
  lighting.update(0.05, target, phase);
  frameCameraForBox(vp, box, 0.2, 0.48);

  let t = 0;
  return {
    group,
    elapsed: 0,
    step: (dt) => {
      t += dt;
      phase = (phase + dt * 0.14) % 1;
      lighting.update(dt, target, phase);
      tickArchetypeMesh(scout, t, 1, 0);
      frameCameraForBox(vp, box, 0.2 + t * 0.24, 0.48);
    },
    dispose: () => {
      vp.setView(vp.scene, vp.camera);
      (lighting as { dispose?: () => void }).dispose?.();
      dayScene.remove(group);
      disposeGroupGeometries(group);
    },
  };
}

export function createCustomShaderRig(
  shaderKind: CustomShaderKind,
  biome: PlanetKind,
  vp: ColonyViewport,
): RigHandle {
  if (shaderKind === 'water') return createWaterShaderRig(biome, vp);
  if (shaderKind === 'unifier') return createUnifierShaderRig(biome, vp);
  return createDayNightShaderRig(biome, vp);
}
