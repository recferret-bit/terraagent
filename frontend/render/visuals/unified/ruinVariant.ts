import type * as THREE from 'three';
import { ProceduralTextureRegistry } from '../ProceduralTextureRegistry';
import { ShaderPluginRegistry } from './registries';

/** Name of the W18 ruin shader modifier (`createUnifiedColonyMaterial({ plugins: [RUIN_VARIANT] })`). */
export const RUIN_VARIANT = 'ruinVariant';

let cachedBurnUniforms: {
  map: THREE.Texture;
  normalMap: THREE.Texture;
  roughMap: THREE.Texture;
} | null = null;

function resolveBurnTextures() {
  if (!cachedBurnUniforms) {
    const bundle = ProceduralTextureRegistry.get('charredBurnedWreck', 256);
    cachedBurnUniforms = {
      map: bundle.map!,
      normalMap: bundle.normalMap!,
      roughMap: bundle.roughnessMap!,
    };
  }
  return cachedBurnUniforms;
}

/**
 * Per-mesh `uRuin` (0..1, toggled via `setArchetypeRuin` or `createUnifiedColonyMaterial({ ruin: true })`, W18-22):
 * - Extinguishes all HDR emissives (`isEmissive > 0.5`) and optics to soot-blackened dead glass (no bloom).
 * - Projects tileable multi-scale fire-burned PBR textures (`charredBurnedWreck`) across the entire mesh (triplanar color, soot/ash grain, crack fissures, blistered normal relief).
 * - Raises surface roughness (`0.92..0.99`) and eliminates metallic/gloss sheen so charred ruins read fire-ravaged and matte.
 */
ShaderPluginRegistry.registerModifier({
  name: RUIN_VARIANT,
  vertexDeclarations: 'uniform float uRuin;',
  fragmentDeclarations: /* glsl */ `
uniform float uRuin;
uniform sampler2D uRuinBurnMap;
uniform sampler2D uRuinBurnNormalMap;
uniform sampler2D uRuinBurnRoughMap;
vec4 sampleRuinTriplanar(sampler2D tex, vec3 lp, vec3 nrm, float sc) {
  vec3 w = pow(abs(normalize(nrm + vec3(0.0001))), vec3(4.0));
  w /= max(dot(w, vec3(1.0)), 0.0001);
  vec4 tx = texture2D(tex, lp.zy * sc);
  vec4 ty = texture2D(tex, lp.xz * sc);
  vec4 tz = texture2D(tex, lp.xy * sc);
  return tx * w.x + ty * w.y + tz * w.z;
}`,
  createUniforms: (): Record<string, THREE.IUniform> => {
    const tex = resolveBurnTextures();
    return {
      uRuin: { value: 0 },
      uRuinBurnMap: { value: tex.map },
      uRuinBurnNormalMap: { value: tex.normalMap },
      uRuinBurnRoughMap: { value: tex.roughMap },
    };
  },
  vertexTransformChunk: /* glsl */ `
        if (uRuin > 0.001) {
          float ruinH = clamp((transformed.y - 0.15) * 0.45, 0.0, 1.0);
          float buckle = sin(transformed.x * 3.7 + transformed.z * 2.9) * 0.055;
          transformed.y -= uRuin * ruinH * (0.065 + abs(buckle));
          transformed.x += uRuin * ruinH * buckle * 0.55;
        }`,
  fragmentColorChunk: /* glsl */ `
        vec3 ruinBurnMacro = sampleRuinTriplanar(uRuinBurnMap, vLocalPos, vObjectNormal, 0.42).rgb;
        vec3 ruinBurnFine = sampleRuinTriplanar(uRuinBurnMap, vLocalPos + vec3(1.13, 0.71, 2.09), vObjectNormal, 1.35).rgb;
        float ruinBurnRough = sampleRuinTriplanar(uRuinBurnRoughMap, vLocalPos, vObjectNormal, 0.55).r;
        float ruinBurnLuma = dot(ruinBurnMacro * 0.65 + ruinBurnFine * 0.35, vec3(0.3333));
        if (uRuin > 0.001) {
          if (isEmissive > 0.5) {
            vec3 deadRuinGlass = vec3(0.048, 0.050, 0.055) + vec3(ruinBurnLuma * 0.22);
            diffuseColor.rgb = mix(diffuseColor.rgb, deadRuinGlass, uRuin);
          } else {
            #if defined(USE_COLOR) || defined(USE_COLOR_ALPHA)
              vec3 ruinSrcRgb = vColor.rgb;
            #else
              vec3 ruinSrcRgb = diffuseColor.rgb;
            #endif
            float rawRuinLuma = clamp(dot(ruinSrcRgb, vec3(0.299, 0.587, 0.114)), 0.0, 1.0);
            float partRank = clamp(smoothstep(0.055, 0.175, rawRuinLuma) * 0.78 + smoothstep(0.175, 0.85, rawRuinLuma) * 0.22, 0.0, 1.0);
            float faceShade = 0.72 + 0.28 * clamp(vObjectNormal.y * 0.5 + 0.5, 0.0, 1.0);
            vec3 partCharTone = mix(vec3(0.068, 0.064, 0.060), vec3(0.268, 0.254, 0.238), partRank);
            vec3 texCharTone = mix(ruinBurnFine * 0.95 + vec3(0.058, 0.054, 0.050), ruinBurnMacro * 1.12 + vec3(0.072, 0.068, 0.064), 0.62);
            float sootMacro = hash31(floor(vLocalPos * 6.5));
            float crackCell = hash31(floor(vLocalPos * 16.0));
            float crackWave = abs(fract(vLocalPos.x * 5.2 + vLocalPos.y * 3.7 + vLocalPos.z * 4.1 + crackCell * 0.85) - 0.5);
            float crackMask = 1.0 - smoothstep(0.020, 0.062, crackWave);
            float scorchBand = smoothstep(2.2, 0.0, vLocalPos.y) * 0.22 + smoothstep(0.32, 0.88, sootMacro) * 0.24;
            vec3 charred = mix(partCharTone, texCharTone, 0.34) * (1.0 - scorchBand * 0.34) * faceShade;
            charred = mix(charred, vec3(0.044, 0.041, 0.038), crackMask * 0.48);
            float baseDust = clamp((1.0 - smoothstep(0.0, 0.42, max(vLocalPos.y, 0.0))) * uWeatheringIntensity * 0.22, 0.0, 0.18);
            charred = mix(charred, uBiomeDustColor * 0.55, baseDust);
            diffuseColor.rgb = mix(diffuseColor.rgb, charred, uRuin);
          }
        }`,
  fragmentRoughnessChunk: /* glsl */ `
        if (uRuin > 0.001 && isEmissive < 0.5) {
          roughnessFactor = mix(roughnessFactor, 0.92, uRuin);
          metalnessFactor = mix(metalnessFactor, 0.08, uRuin);
          roughnessFactor = clamp(roughnessFactor + (ruinBurnRough - 0.5) * 0.14 * uRuin, 0.85, 0.99);
          metalnessFactor *= (1.0 - 0.75 * uRuin);
        } else if (uRuin > 0.001) {
          roughnessFactor = mix(roughnessFactor, 0.96, uRuin);
          metalnessFactor = mix(metalnessFactor, 0.0, uRuin);
        }`,
  fragmentNormalChunk: /* glsl */ `
        vec3 ruinNrmSample = sampleRuinTriplanar(uRuinBurnNormalMap, vLocalPos, vObjectNormal, 0.55).xyz * 2.0 - 1.0;
        if (uRuin > 0.001) {
          float ruinBumpH = ((ruinBurnLuma - 0.04) * 0.28 + (ruinNrmSample.x + ruinNrmSample.y) * 0.030) * uRuin;
          vec3 ruinDx = dFdx(-vViewPosition), ruinDy = dFdy(-vViewPosition);
          vec2 ruinDh = vec2(dFdx(ruinBumpH), dFdy(ruinBumpH));
          vec3 ruinRx = cross(ruinDy, normal), ruinRy = cross(normal, ruinDx);
          float ruinDet = dot(ruinDx, ruinRx);
          vec3 ruinGrad = sign(ruinDet) * (ruinDh.x * ruinRx + ruinDh.y * ruinRy);
          normal = normalize(abs(ruinDet) * normal - ruinGrad + normal * 0.0000001);
        }`,
});
