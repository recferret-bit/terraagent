import type * as THREE from 'three';
import { ShaderPluginRegistry } from './registries';

/** Name of the lit-level shader modifier (`createUnifiedColonyMaterial({ plugins: [BUILDING_LIT] })`). */
export const BUILDING_LIT = 'buildingLit';

/**
 * Per mesh `uLit` (0..1, written only by `applyBuildingLight`, see `lighting/buildingLights.ts`): the HDR emissive
 * zones (windows, status lamps, cores) fade to a dark housing of the same hue as it falls, so an unpowered building
 * shows dead glass instead of glowing. 1 (the default) leaves every pixel untouched.
 */
ShaderPluginRegistry.registerModifier({
  name: BUILDING_LIT,
  fragmentDeclarations: 'uniform float uLit;',
  createUniforms: (): Record<string, THREE.IUniform> => ({ uLit: { value: 1 } }),
  fragmentColorChunk: /* glsl */ `
        if (isEmissive > 0.5 && uLit < 0.999) {
          float litPeak = max(max(diffuseColor.r, diffuseColor.g), max(diffuseColor.b, 1.0));
          vec3 deadGlass = diffuseColor.rgb / litPeak * 0.2;
          diffuseColor.rgb = mix(deadGlass, diffuseColor.rgb, uLit);
        }`,
});
