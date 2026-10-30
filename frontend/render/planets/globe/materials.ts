import * as THREE from 'three';
import type { PlanetSpec } from '../PlanetSpec';
import { VERT } from './globeVert';
import { GLOBE_FRAG } from './surfaceFrag';
import { CLOUD_FRAG } from './cloudFrag';
import { ATM_FRAG } from './atmFrag';
import { KIND_INDEX, TERRA, colonyPoints, playerColorVecs } from './terraform';

export type SharedUniforms = {
  uSunDir: THREE.IUniform<THREE.Vector3>; uSunI: THREE.IUniform<number>; uOpacity: THREE.IUniform<number>;
  uTime: THREE.IUniform<number>; uSkyBlend: THREE.IUniform<number>; uSkyColor: THREE.IUniform<THREE.Color>; uAtmStrength: THREE.IUniform<number>;
  uCloudNear: THREE.IUniform<THREE.Vector2>; uHazeDist: THREE.IUniform<THREE.Vector2>;
};

const col = (n: number) => new THREE.Color(n);

export const createSharedUniforms = (spec: PlanetSpec): SharedUniforms => ({
  uSunDir: { value: new THREE.Vector3(0.486, 0.763, 0.347).normalize() },
  uSunI: { value: 1.05 }, uOpacity: { value: 1 }, uTime: { value: 0 },
  uSkyBlend: { value: 0 }, uSkyColor: { value: col(spec.sky.horizonColor) }, uAtmStrength: { value: 1 },
  uCloudNear: { value: new THREE.Vector2(0, 0.0001) }, uHazeDist: { value: new THREE.Vector2(100, 6000) },
});

/** The three shader layers of a globe (surface, cloud shell, atmosphere shell) with their shared uniform blocks. */
export function createGlobeMaterials(spec: PlanetSpec, radius: number, atmScale: number | undefined, shared: SharedUniforms) {
  const o = spec.orbital;
  const sunColor = { value: new THREE.Color(1.0, 0.95, 0.86) };
  const atmBase = col(o.atmosphereColor);
  const atm = { value: atmBase.clone() };
  const radiusU = { value: radius };

  const surfMat = new THREE.ShaderMaterial({
    vertexShader: VERT, fragmentShader: GLOBE_FRAG,
    uniforms: {
      ...shared, uKind: { value: KIND_INDEX[spec.kind] }, uSeed: { value: spec.seed % 997 },
      uHasSea: { value: o.sea !== undefined ? 1 : 0 }, uSeaLevel: { value: o.seaLevel },
      uRadius: radiusU, uIce: { value: spec.kind === 'dune' ? 0 : spec.kind === 'oceanForest' ? 0.8 : 0.55 },
      uBump: { value: 0.1 },
      uL0: { value: col(o.land[0]) }, uL1: { value: col(o.land[1]) }, uL2: { value: col(o.land[2]) },
      uSea: { value: col(o.sea ?? 0x000000) }, uAtm: atm, uSunColor: sunColor,
      uAccent: { value: col(spec.palette.accent) }, uAtmDensity: { value: o.atmosphereDensity },
      uTerra: { value: 0 }, uBarren: { value: 0 }, uTerraSmooth: { value: 0 }, uTerraSea: { value: TERRA[spec.kind].sea },
      uSeaT: { value: col(TERRA[spec.kind].seaColor) }, uCol: { value: colonyPoints(spec.seed) }, uPCol: { value: playerColorVecs() },
    },
    // Permanently transparent: toggling `transparent` flips the OPAQUE define in three r174, which
    // swaps the program (shader recompile hitch mid-descent). With alpha = 1 the blend is a no-op.
    transparent: true, depthWrite: true,
  });
  const cloudMat = new THREE.ShaderMaterial({
    vertexShader: VERT, fragmentShader: CLOUD_FRAG, transparent: true, depthWrite: false,
    uniforms: {
      ...shared, uSeed: { value: (spec.seed * 3) % 991 }, uCover: { value: o.cloudCover }, uCloudTween: { value: 1 }, uCloudCol: { value: col(o.cloudColor) }, uAtm: atm, uSunColor: sunColor,
    },
  });
  const atmMat = new THREE.ShaderMaterial({
    vertexShader: VERT, fragmentShader: ATM_FRAG, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.FrontSide,
    uniforms: { ...shared, uAtm: atm, uAtmDensity: { value: o.atmosphereDensity }, uRadius: radiusU, uShell: { value: atmScale ?? 1.07 } },
  });
  return { surfMat, cloudMat, atmMat, atm, atmBase };
}
