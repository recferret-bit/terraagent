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
};

/**
 * Creates a GPU-splatted planetary terrain material that blends elevation,
 * cliff slopes, and a live `uTerraformMap` DataTexture with a glowing HDR emerald frontier ring.
 */
export function createTerraformingTerrainMaterial(
  biomeName: keyof typeof TERRAIN_BIOME_PALETTES = 'desert',
  mapExtentMeters = 120
) {
  const palette = TERRAIN_BIOME_PALETTES[biomeName] ?? TERRAIN_BIOME_PALETTES.desert;

  // Dynamic 128x128 DataTexture storing terraforming progress (R channel: 0..255)
  const tfSize = 128;
  const tfData = new Uint8Array(tfSize * tfSize * 4);
  const terraformTexture = new THREE.DataTexture(tfData, tfSize, tfSize, THREE.RGBAFormat);
  terraformTexture.magFilter = THREE.LinearFilter;
  terraformTexture.minFilter = THREE.LinearFilter;
  terraformTexture.needsUpdate = true;

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
      .replace(
        '#include <common>',
        `#include <common>
        varying vec3 vWorldPos;
        varying vec3 vWorldNorm;`
      )
      .replace(
        '#include <worldpos_vertex>',
        `#include <worldpos_vertex>
        vWorldPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
        vWorldNorm = normalize(mat3(modelMatrix) * normal);`
      );

    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        varying vec3 vWorldPos;
        varying vec3 vWorldNorm;
        uniform float uTime;
        uniform float uMapExtent;
        uniform sampler2D uTerraformMap;
        uniform vec3 uBarrenLow;
        uniform vec3 uBarrenHigh;
        uniform vec3 uCliffRock;
        uniform vec3 uTerraformedLush;
        uniform vec3 uFrontierGlow;

        float hash21(vec2 p) {
          p = fract(p * vec2(123.34, 456.21));
          p += dot(p, p + 45.32);
          return fract(p.x * p.y);
        }`
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        vec2 gridUv = clamp(vWorldPos.xz / uMapExtent + 0.5, 0.0, 1.0);
        float tfMask = texture2D(uTerraformMap, gridUv).r;

        // Elevation & Slope Splatting
        float elevFactor = smoothstep(-0.5, 3.5, vWorldPos.y);
        float slopeFactor = 1.0 - smoothstep(0.55, 0.85, vWorldNorm.y);
        float grain = hash21(floor(vWorldPos.xz * 4.0));

        vec3 barrenCol = mix(uBarrenLow, uBarrenHigh, elevFactor);
        barrenCol = mix(barrenCol, uCliffRock, slopeFactor);

        // Blend Barren -> Terraformed Lush inside mask
        vec3 baseGround = mix(barrenCol, uTerraformedLush, smoothstep(0.45, 0.55, tfMask));
        baseGround *= (0.94 + 0.12 * grain);

        // Glowing HDR Terraforming Frontier Ring at tfMask ~= 0.5
        float ring = smoothstep(0.42, 0.50, tfMask) * (1.0 - smoothstep(0.50, 0.58, tfMask));
        float pulse = 0.75 + 0.25 * sin(uTime * 4.0 + vWorldPos.x * 2.0);
        diffuseColor.rgb = baseGround + uFrontierGlow * ring * 3.8 * pulse;
        `
      );
  };

  return { material, uniforms, terraformTexture, tfData, tfSize };
}

/**
 * Creates an animated Hydro / River / Coolant water material with dual-scrolling
 * procedural wave ripples and shallow shoreline foam.
 */
export function createHydroWaterMaterial() {
  const uniforms = {
    uTime: { value: 0 },
    uShallowColor: { value: new THREE.Color(0x00b4d8) },
    uDeepColor: { value: new THREE.Color(0x03045e) },
    uFoamColor: { value: new THREE.Color(0xe0fbfc) },
  };

  const material = new THREE.MeshStandardMaterial({
    roughness: 0.12,
    metalness: 0.75,
    transparent: true,
    opacity: 0.86,
  });

  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);

    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
        uniform float uTime;
        varying vec3 vWaterWorldPos;`
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        vec3 wp = (modelMatrix * vec4(position, 1.0)).xyz;
        float wave1 = sin(wp.x * 1.8 + uTime * 2.2) * 0.035;
        float wave2 = cos(wp.z * 2.3 - uTime * 1.7) * 0.025;
        transformed.y += wave1 + wave2;
        vWaterWorldPos = wp;`
      );

    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        uniform float uTime;
        uniform vec3 uShallowColor;
        uniform vec3 uDeepColor;
        uniform vec3 uFoamColor;
        varying vec3 vWaterWorldPos;`
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        float ripple = sin(vWaterWorldPos.x * 4.5 + uTime * 3.0) * cos(vWaterWorldPos.z * 4.5 - uTime * 2.5);
        float foamCrest = smoothstep(0.65, 0.92, ripple);
        vec3 waterCol = mix(uDeepColor, uShallowColor, 0.5 + 0.5 * ripple);
        diffuseColor.rgb = mix(waterCol, uFoamColor, foamCrest * 0.45);`
      );
  };

  return { material, uniforms };
}
