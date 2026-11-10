import type * as THREE from 'three';
import { ShaderPluginRegistry } from './registries';

/** Name of the W18 ruin shader modifier (`createUnifiedColonyMaterial({ plugins: [RUIN_VARIANT] })`). */
export const RUIN_VARIANT = 'ruinVariant';

/**
 * Per-mesh `uRuin` (0..1, toggled via `setArchetypeRuin` or `createUnifiedColonyMaterial({ ruin: true })`, W18-22):
 * - Extinguishes all HDR emissives (`isEmissive > 0.5`) to cold soot-blackened dead glass (no bloom).
 * - Desaturates and chars the hull/frame into scorched dark ash with procedural triplanar crack fissures and soot streaks.
 * - Raises surface roughness (`0.92`) and lowers metalness (`0.08`) so charred ruins read matte under directional light.
 * - Applies a subtle structural buckle/sag above `Y = 0.15m` while keeping `minY` ground contact (`Y = 0` / `-0.1m` skirt) exact.
 */
ShaderPluginRegistry.registerModifier({
  name: RUIN_VARIANT,
  vertexDeclarations: 'uniform float uRuin;',
  fragmentDeclarations: 'uniform float uRuin;',
  createUniforms: (): Record<string, THREE.IUniform> => ({ uRuin: { value: 0 } }),
  vertexTransformChunk: /* glsl */ `
        if (uRuin > 0.001) {
          float ruinH = clamp((transformed.y - 0.15) * 0.45, 0.0, 1.0);
          float buckle = sin(transformed.x * 3.7 + transformed.z * 2.9) * 0.055;
          transformed.y -= uRuin * ruinH * (0.065 + abs(buckle));
          transformed.x += uRuin * ruinH * buckle * 0.55;
        }`,
  fragmentColorChunk: /* glsl */ `
        if (uRuin > 0.001) {
          if (isEmissive > 0.5) {
            vec3 deadRuinGlass = vec3(0.038, 0.042, 0.046);
            diffuseColor.rgb = mix(diffuseColor.rgb, deadRuinGlass, uRuin);
          } else {
            float ruinLuma = dot(diffuseColor.rgb, vec3(0.299, 0.587, 0.114));
            vec3 ashBase = mix(vec3(ruinLuma) * 0.26, vec3(0.105, 0.098, 0.092), 0.58);
            float sootMacro = hash3(floor(vLocalPos * 6.5));
            float crackCell = hash3(floor(vLocalPos * 16.0));
            float crackWave = abs(fract(vLocalPos.x * 5.2 + vLocalPos.y * 3.7 + vLocalPos.z * 4.1 + crackCell * 0.85) - 0.5);
            float crackMask = 1.0 - smoothstep(0.025, 0.075, crackWave);
            float scorchBand = smoothstep(1.6, 0.0, vLocalPos.y) * 0.55 + smoothstep(0.35, 0.82, sootMacro) * 0.45;
            vec3 charred = mix(ashBase, vec3(0.045, 0.04, 0.038), clamp(scorchBand, 0.0, 1.0));
            charred = mix(charred, vec3(0.018, 0.016, 0.015), crackMask * 0.85);
            diffuseColor.rgb = mix(diffuseColor.rgb, charred, uRuin);
          }
        }`,
  fragmentRoughnessChunk: /* glsl */ `
        if (uRuin > 0.001 && isEmissive < 0.5) {
          roughnessFactor = mix(roughnessFactor, 0.92, uRuin);
          metalnessFactor = mix(metalnessFactor, 0.08, uRuin);
        }`,
});
