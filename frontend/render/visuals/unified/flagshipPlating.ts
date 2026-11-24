import { ProceduralTextureRegistry } from '../ProceduralTextureRegistry';
import { ShaderPluginRegistry } from './registries';

/** Name of the sovereign capital-hull texture & anodized panel shader modifier used by `ship.flagshipCarrier`. */
export const FLAGSHIP_PLATING = 'flagshipPlating';

/** Rotates `objectNormal` around `+Y` in lockstep with standalone `SpinY` (`animType = 1`) ship parts. */
export const SHIP_SPIN_NORMALS = 'shipSpinNormals';

let cachedUniforms: ReturnType<typeof buildFlagshipUniforms> | null = null;

function buildFlagshipUniforms() {
  const hull = ProceduralTextureRegistry.get('flagshipSovereignHull', 256);
  const solar = ProceduralTextureRegistry.get('solarHexGrid', 256);
  return {
    uFlagshipHullMap: { value: hull.map! },
    uFlagshipNormalMap: { value: hull.normalMap! },
    uFlagshipRoughMap: { value: hull.roughnessMap! },
    uFlagshipSolarMap: { value: solar.map! },
  };
}

ShaderPluginRegistry.registerModifier({
  name: SHIP_SPIN_NORMALS,
  vertexNormalChunk: /* glsl */ `
        if (abs(floor(aPartAnim.x + 0.5) - 1.0) < 0.1) {
          float snSpinAng = uTime * (2.5 + 10.0 * uWorkWeight);
          float snS = sin(snSpinAng), snC = cos(snSpinAng);
          objectNormal = vec3(
            objectNormal.x * snC - objectNormal.z * snS,
            objectNormal.y,
            objectNormal.x * snS + objectNormal.z * snC
          );
        }`,
});

ShaderPluginRegistry.registerModifier({
  name: FLAGSHIP_PLATING,
  createUniforms: () => {
    cachedUniforms ??= buildFlagshipUniforms();
    return {
      uFlagshipHullMap: { value: cachedUniforms.uFlagshipHullMap.value },
      uFlagshipNormalMap: { value: cachedUniforms.uFlagshipNormalMap.value },
      uFlagshipRoughMap: { value: cachedUniforms.uFlagshipRoughMap.value },
      uFlagshipSolarMap: { value: cachedUniforms.uFlagshipSolarMap.value },
    };
  },
  fragmentDeclarations: /* glsl */ `
uniform sampler2D uFlagshipHullMap;
uniform sampler2D uFlagshipNormalMap;
uniform sampler2D uFlagshipRoughMap;
uniform sampler2D uFlagshipSolarMap;
vec4 sampleFlagshipTriplanar(sampler2D tex, vec3 lp, vec3 nrm, float sc) {
  vec3 w = pow(abs(normalize(nrm)), vec3(4.0));
  w /= max(dot(w, vec3(1.0)), 0.0001);
  vec4 tx = texture2D(tex, lp.zy * sc);
  vec4 ty = texture2D(tex, lp.xz * sc);
  vec4 tz = texture2D(tex, lp.xy * sc);
  return tx * w.x + ty * w.y + tz * w.z;
}`,
  fragmentColorChunk: /* glsl */ `
        // Sample mipmapped DataTextures outside zone-dependent branches (GLSL ES 3.00 §8.8 uniform derivatives).
        float fpFootprint = max(length(dFdx(vLocalPos)), length(dFdy(vLocalPos)));
        float fpMacroFade = 1.0 - smoothstep(0.55, 2.4, fpFootprint);
        float fpMicroFade = 1.0 - smoothstep(0.18, 0.85, fpFootprint);
        vec3 fpTile = sampleFlagshipTriplanar(uFlagshipHullMap, vLocalPos, vObjectNormal, 0.068).rgb;
        vec3 fpFine = sampleFlagshipTriplanar(uFlagshipHullMap, vLocalPos + vec3(1.73, 0.91, 2.41), vObjectNormal, 0.21).rgb;
        vec3 fpSolar = sampleFlagshipTriplanar(uFlagshipSolarMap, vLocalPos, vObjectNormal, 0.55).rgb;
        float fpLuma = dot(fpTile, vec3(0.3333));
        if (isEmissive < 0.5 && vSurfacePBR.x > 0.22) {
          // uFlagshipHullMap is SRGBColorSpace: hardware decode yields ~0.62 linear on plates and ~0.14 in major seams.
          float fpFineLuma = dot(fpFine, vec3(0.3333));
          float fpContrast = ((fpLuma - 0.58) * 0.68 + (fpFineLuma - 0.58) * 0.22 * fpMicroFade) * fpMacroFade;
          diffuseColor.rgb *= clamp(1.0 + fpContrast, 0.62, 1.04);
          if (vSurfacePBR.y > 0.78) {
            float fpFluted = 0.5 + 0.5 * sin(vLocalPos.z * 2.2 + vLocalPos.x * 1.5);
            diffuseColor.rgb *= mix(0.92, 1.03, fpFluted * fpMacroFade);
          } else {
            diffuseColor.rgb += (fpTile - vec3(fpLuma)) * 0.22 * fpMacroFade;
          }
        } else if (isEmissive < 0.5 && vSurfacePBR.x > 0.13 && vSurfacePBR.x <= 0.22) {
          // Sapphire solar cells: crystalline photovoltaic sub-wafer hex grid without hull armor seam bleed.
          float fpSolarBus = step(0.18, dot(fpSolar, vec3(0.3333)));
          diffuseColor.rgb = mix(diffuseColor.rgb * 0.94, diffuseColor.rgb * 1.24 + vec3(0.04, 0.08, 0.12), fpSolarBus * 0.55 * fpMicroFade);
        }`,
  fragmentRoughnessChunk: /* glsl */ `
        float fpRoughTex = sampleFlagshipTriplanar(uFlagshipRoughMap, vLocalPos, vObjectNormal, 0.068).r;
        if (isEmissive < 0.5 && vSurfacePBR.x > 0.22) {
          roughnessFactor = clamp(mix(roughnessFactor * 0.88, fpRoughTex, 0.42), 0.16, 0.90);
          metalnessFactor = clamp(metalnessFactor + 0.08, 0.0, 0.95);
        }`,
  fragmentNormalChunk: /* glsl */ `
        vec3 fpNrmSample = sampleFlagshipTriplanar(uFlagshipNormalMap, vLocalPos, vObjectNormal, 0.068).xyz * 2.0 - 1.0;
        float fpBumpField = (fpLuma - 0.58) * 0.042 + (fpNrmSample.x + fpNrmSample.y) * 0.014;
        float fpBumpMask = (isEmissive < 0.5 && vSurfacePBR.x > 0.22 && vOrganic < 0.5) ? (1.0 - smoothstep(0.45, 1.9, fpFootprint)) : 0.0;
        float fpHeight = fpBumpField * fpBumpMask;
        vec3 fpDx = dFdx(-vViewPosition), fpDy = dFdy(-vViewPosition);
        vec2 fpDh = vec2(dFdx(fpHeight), dFdy(fpHeight));
        if (fpBumpMask > 0.001) {
          vec3 fpRx = cross(fpDy, normal), fpRy = cross(normal, fpDx);
          float fpDet = dot(fpDx, fpRx);
          vec3 fpGrad = sign(fpDet) * (fpDh.x * fpRx + fpDh.y * fpRy);
          normal = normalize(abs(fpDet) * normal - fpGrad + normal * 0.0000001);
        }`,
});
