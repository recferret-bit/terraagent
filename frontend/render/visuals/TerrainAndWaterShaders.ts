// .agents/skills/shader-texture-tuning/examples/TerrainAndWaterShaders.ts
import * as THREE from 'three';

export interface TerrainBiomeColors {
  barrenLow: number;
  barrenHigh: number;
  cliffRock: number;
  terraformedLush: number;
  frontierGlow: number;
}

export const TERRAIN_BIOME_PALETTES: Record<string, TerrainBiomeColors> = {
  temperate: {
    barrenLow: 0x4a5546,
    barrenHigh: 0x6b705c,
    cliffRock: 0x383d3b,
    terraformedLush: 0x2d6a4f,
    frontierGlow: 0x10b981,
  },
  desert: {
    barrenLow: 0xb5654d,
    barrenHigh: 0xd48c6a,
    cliffRock: 0x6d3b2e,
    terraformedLush: 0x40916c,
    frontierGlow: 0x00f0ff,
  },
  ice: {
    barrenLow: 0x779be7,
    barrenHigh: 0xdce8f7,
    cliffRock: 0x3b4d6b,
    terraformedLush: 0x38a3a5,
    frontierGlow: 0x10b981,
  },
  forestRock: {
    barrenLow: 0x3f6a3a,
    barrenHigh: 0x6f8f4a,
    cliffRock: 0x40444c,
    terraformedLush: 0x2c6e49,
    frontierGlow: 0x10b981,
  },
  dune: {
    barrenLow: 0xc98a4b,
    barrenHigh: 0xe8c07a,
    cliffRock: 0x4a3226,
    terraformedLush: 0x2c6e49,
    frontierGlow: 0x00f0ff,
  },
  oceanForest: {
    barrenLow: 0x4f8a3c,
    barrenHigh: 0x86b556,
    cliffRock: 0x3b4048,
    terraformedLush: 0x1e6f4c,
    frontierGlow: 0x00f0ff,
  },
};

export function resolveTerraformPalette(biomeOrKind: string): TerrainBiomeColors {
  return TERRAIN_BIOME_PALETTES[biomeOrKind] ?? TERRAIN_BIOME_PALETTES.temperate!;
}

/** Allocates a dynamic `DataTexture` storing terraforming state (`R`: Living 0..255, `G`: Irrigated 0..255, `B`: Prepared 0..255). */
export function createTerraformMapTexture(tfSize = 128) {
  const tfData = new Uint8Array(tfSize * tfSize * 4);
  const terraformTexture = new THREE.DataTexture(tfData, tfSize, tfSize, THREE.RGBAFormat, THREE.UnsignedByteType);
  terraformTexture.magFilter = THREE.LinearFilter;
  terraformTexture.minFilter = THREE.LinearFilter;
  terraformTexture.generateMipmaps = false;
  terraformTexture.colorSpace = THREE.NoColorSpace;
  terraformTexture.needsUpdate = true;
  return { terraformTexture, tfData, tfSize };
}

export const TERRAFORM_UNIFORMS_GLSL = /* glsl */ `uniform sampler2D uTerraformMap;
uniform vec3 uTerraformedLush;
uniform vec3 uFrontierGlow;`;

/**
 * Shared GLSL evaluator for Irrigated (`irrMask`: wet darkening, moisture sheen, hydro edge) and Living (`tfMask`:
 * `uTerraformedLush` biosphere blend + pulsing HDR `uFrontierGlow` ring at `tfMask ~= 0.5`). The two rings belong to the
 * continuous terrain / globe only: on the hex ground (`TA_HEX_TERRAFORM`) the per-cell mask crosses 0.5 at every hex
 * edge, so they drew a glowing green / blue outline around each tile that read as a selection. Orange is the only
 * selection colour there (`TargetHighlight3D`).
 */
export const TERRAFORM_EVAL_GLSL = /* glsl */ `float tfHash21(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}
void evalTerraformSurface(inout vec3 col, inout float rough, inout vec3 emis, vec2 worldXZ, float tfMask, float irrMask, float time) {
  float grain = tfHash21(floor(worldXZ * 4.0));
  if (irrMask > 0.001) {
    float irrFill = smoothstep(0.18, 0.62, irrMask);
    float moistGrain = tfHash21(floor(worldXZ * 7.5));
    vec3 wetSoil = col * vec3(0.45, 0.54, 0.62) + vec3(0.012, 0.038, 0.062) * (0.85 + 0.3 * moistGrain);
    col = mix(col, wetSoil, irrFill);
    rough = mix(rough, 0.34, irrFill);
#ifndef TA_HEX_TERRAFORM
    float irrRing = smoothstep(0.40, 0.50, irrMask) * (1.0 - smoothstep(0.50, 0.60, irrMask)) * (1.0 - smoothstep(0.35, 0.55, tfMask));
    col += vec3(0.04, 0.32, 0.48) * irrRing * 0.6;
#endif
  }
  if (tfMask > 0.001) {
    float lushFill = smoothstep(0.45, 0.55, tfMask);
    float meadow = tfHash21(floor(worldXZ * 1.4));
    float lumDetail = clamp(dot(col, vec3(0.3333)) * 1.35, 0.72, 1.28);
    vec3 lushBase = uTerraformedLush * (1.05 + 0.16 * grain + 0.08 * meadow);
    vec3 lushCol = mix(lushBase, lushBase * lumDetail, 0.38) + uFrontierGlow * (0.035 * meadow);
    col = mix(col, lushCol, lushFill);
    rough = mix(rough, 0.76, lushFill);
#ifndef TA_HEX_TERRAFORM
    float tfRing = smoothstep(0.42, 0.50, tfMask) * (1.0 - smoothstep(0.50, 0.58, tfMask));
    float pulse = 0.75 + 0.25 * sin(time * 4.0 + worldXZ.x * 2.0);
    vec3 ringGlow = uFrontierGlow * tfRing * 3.8 * pulse;
    col += ringGlow * 0.35;
    emis += ringGlow * 0.65;
#endif
  }
}`;

const TF_VERT_COMMON = /* glsl */ `#include <common>
varying vec3 vWorldPos;
varying vec3 vWorldNorm;`;

const TF_VERT_WORLDPOS = /* glsl */ `#include <worldpos_vertex>
vWorldPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
vWorldNorm = normalize(mat3(modelMatrix) * normal);`;

const TF_FRAG_COMMON = /* glsl */ `#include <common>
varying vec3 vWorldPos;
varying vec3 vWorldNorm;
uniform float uTime;
uniform float uMapExtent;
uniform vec3 uBarrenLow;
uniform vec3 uBarrenHigh;
uniform vec3 uCliffRock;
${TERRAFORM_UNIFORMS_GLSL}
${TERRAFORM_EVAL_GLSL}`;

const TF_FRAG_COLOR = /* glsl */ `#include <color_fragment>
vec2 gridUv = clamp(vWorldPos.xz / uMapExtent + 0.5, 0.0, 1.0);
vec4 tfSample = texture2D(uTerraformMap, gridUv);
float tfMask = tfSample.r;
float irrMask = tfSample.g;
float elevFactor = smoothstep(-0.5, 3.5, vWorldPos.y);
float slopeFactor = 1.0 - smoothstep(0.55, 0.85, vWorldNorm.y);
float grain = tfHash21(floor(vWorldPos.xz * 4.0));
vec3 barrenCol = mix(uBarrenLow, uBarrenHigh, elevFactor);
barrenCol = mix(barrenCol, uCliffRock, slopeFactor) * (0.94 + 0.12 * grain);
float tfRough = 0.88;
vec3 tfEmis = vec3(0.0);
evalTerraformSurface(barrenCol, tfRough, tfEmis, vWorldPos.xz, tfMask, irrMask, uTime);
diffuseColor.rgb = barrenCol + tfEmis;`;

/**
 * Creates a GPU-splatted planetary terrain material that blends elevation,
 * cliff slopes, and a live `uTerraformMap` DataTexture with a glowing HDR emerald frontier ring.
 */
export function createTerraformingTerrainMaterial(
  biomeName: keyof typeof TERRAIN_BIOME_PALETTES = 'desert',
  mapExtentMeters = 120
) {
  const palette = resolveTerraformPalette(String(biomeName));
  const { terraformTexture, tfData, tfSize } = createTerraformMapTexture(128);

  const uniforms = {
    uTime: { value: 0 },
    uMapExtent: { value: mapExtentMeters },
    uTerraformMap: { value: terraformTexture },
    uBarrenLow: { value: new THREE.Color(palette.barrenLow) },
    uBarrenHigh: { value: new THREE.Color(palette.barrenHigh) },
    uCliffRock: { value: new THREE.Color(palette.cliffRock) },
    uTerraformedLush: { value: new THREE.Color(palette.terraformedLush) },
    uFrontierGlow: { value: new THREE.Color(palette.frontierGlow) },
  };

  const material = new THREE.MeshStandardMaterial({
    roughness: 0.88,
    metalness: 0.05,
  });

  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', TF_VERT_COMMON)
      .replace('#include <worldpos_vertex>', TF_VERT_WORLDPOS);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', TF_FRAG_COMMON)
      .replace('#include <color_fragment>', TF_FRAG_COLOR);
  };

  return { material, uniforms, terraformTexture, tfData, tfSize };
}
