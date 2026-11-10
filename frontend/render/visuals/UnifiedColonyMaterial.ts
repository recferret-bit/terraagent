import { ORGANIC_NORMAL } from './unified/organicSurface';
// .agents/skills/shader-texture-tuning/examples/UnifiedColonyMaterial.ts
import * as THREE from 'three';
import { onColonyShaderTune } from '../core/shadowConfig';
import { getColonyVisionUniforms } from '../lighting/ColonyVisionAndLights';
import { BiomeMaterialRegistry, ShaderPluginRegistry, type ShaderModifierPlugin } from './unified/registries';
import {
  VERT_COMMON, vertBeginVertex, FRAG_COMMON, fragColor, FRAG_ROUGHNESS, FRAG_METALNESS, FRAG_RIM,
} from './unified/shaderChunks';
import { injectAll } from './shaderInject';
import './unified/buildScaffold';
import './unified/ruinVariant';
import { RUIN_VARIANT } from './unified/ruinVariant';

export { BiomeMaterialRegistry, ShaderPluginRegistry, RUIN_VARIANT };
export type { BiomeWeatheringPreset, ShaderModifierPlugin } from './unified/registries';

export interface UnifiedColonyMaterialOptions {
  /** Additional world-space receiver offset for large concave shells; cast geometry stays exact. */
  shadowNormalBias?: number;
  biome?: string;
  triplanarScale?: number;
  rimStrength?: number;
  plugins?: string[];
  /** Optional initial ruin state (`true` or `0..1`, W18-22: charred, cracked, unlit). */
  ruin?: boolean | number;
}

export interface UnifiedColonyMaterialUniforms {
  uTime: THREE.IUniform<number>;
  uWalkWeight: THREE.IUniform<number>;
  uWorkWeight: THREE.IUniform<number>;
  uBiomeDustColor: THREE.IUniform<THREE.Color>;
  uRimTint: THREE.IUniform<THREE.Color>;
  uWeatheringHeight: THREE.IUniform<number>;
  uWeatheringIntensity: THREE.IUniform<number>;
  uTriplanarScale: THREE.IUniform<number>;
  uRimStrength: THREE.IUniform<number>;
  /** Plugin uniforms, e.g. `uBuildStage` / `uBuildHeight` of the `buildScaffold` modifier. */
  [key: string]: THREE.IUniform<any>;
}

const DEPTH_SCAFFOLD_DECL = /* glsl */ `#include <common>
varying vec3 vLocalPos;
uniform float uBuildStage;
uniform float uBuildHeight;`;

const DEPTH_SCAFFOLD_CLIP = /* glsl */ `#include <clipping_planes_fragment>
if (uBuildStage < 0.999) {
  float cutFrac = uBuildStage < 0.16 ? 0.037936 : (uBuildStage < 0.50 ? 0.250379 : 0.584219);
  if (vLocalPos.y > cutFrac * uBuildHeight) discard;
}`;

/**
 * Creates the Unified Colony PBR Material that harmonizes both procedural
 * kitbashed geometries and external AI-generated .glb models, plus a matching
 * GPU-animated `depthMaterial` so walking bots and spinning/building structures
 * cast accurate dynamic shadows at zero CPU cost.
 */
export function createUnifiedColonyMaterial(
  options: UnifiedColonyMaterialOptions = {}
): {
  material: THREE.MeshStandardMaterial;
  depthMaterial: THREE.MeshDepthMaterial;
  uniforms: UnifiedColonyMaterialUniforms;
} {
  const biome = BiomeMaterialRegistry.getBiome(options.biome ?? 'desert');
  const baseWeathering = biome.weatheringIntensity;

  const uniforms: UnifiedColonyMaterialUniforms = {
    uShadowNormalBias: { value: options.shadowNormalBias ?? 0 },
    uTime: { value: 0 },
    uWalkWeight: { value: 1.0 },
    uWorkWeight: { value: 0.0 },
    uBiomeDustColor: { value: new THREE.Color(biome.dustColor) },
    uRimTint: { value: new THREE.Color(biome.rimTint) },
    uWeatheringHeight: { value: biome.weatheringHeight },
    uWeatheringIntensity: { value: baseWeathering },
    uTriplanarScale: { value: options.triplanarScale ?? 2.0 },
    uRimStrength: { value: options.rimStrength ?? 0.28 },
  };

  const pluginNames = [...new Set([...(options.plugins ?? []), ...(options.ruin !== undefined ? [RUIN_VARIANT] : [])])];
  const activePlugins = pluginNames
    .map((n) => ShaderPluginRegistry.getModifier(n))
    .filter((p): p is ShaderModifierPlugin => Boolean(p));

  for (const plugin of activePlugins) {
    if (plugin.uniforms) Object.assign(uniforms, plugin.uniforms);
    if (plugin.createUniforms) Object.assign(uniforms, plugin.createUniforms());
  }
  if (options.ruin !== undefined && uniforms.uRuin) {
    uniforms.uRuin.value = typeof options.ruin === 'number' ? Math.max(0, Math.min(1, options.ruin)) : options.ruin ? 1 : 0;
  }

  const offTune = onColonyShaderTune((weatheringMul, rimStrength) => {
    uniforms.uWeatheringIntensity.value = baseWeathering * weatheringMul;
    if (options.rimStrength === undefined) uniforms.uRimStrength.value = rimStrength;
  });

  const material = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.48,
    metalness: 0.25,
  });

  const joinPlugins = (pick: (p: ShaderModifierPlugin) => string | undefined) => activePlugins.map((p) => pick(p) ?? '').join('\n');
  const vertPluginChunk = joinPlugins((p) => p.vertexTransformChunk);
  const hasScaffold = activePlugins.some((p) => p.name === 'buildScaffold');

  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, getColonyVisionUniforms(), uniforms);
    shader.vertexShader = injectAll(shader.vertexShader, [
      ['#include <common>', VERT_COMMON + '\nuniform float uShadowNormalBias;\n' + joinPlugins((p) => p.vertexDeclarations)],
      ['#include <begin_vertex>', vertBeginVertex(vertPluginChunk)],
      ['#include <shadowmap_vertex>', THREE.ShaderChunk.shadowmap_vertex.replace(/(\w+LightShadows\[ i \]\.shadowNormalBias)/g, '($1 + uShadowNormalBias)')],
    ], 'unified colony vertex');
    shader.vertexShader = shader.vertexShader.replace('#include <beginnormal_vertex>', '#include <beginnormal_vertex>\n' + joinPlugins((p) => p.vertexNormalChunk));
    shader.fragmentShader = injectAll(shader.fragmentShader, [
      ['#include <common>', `${FRAG_COMMON}\n${joinPlugins((p) => p.fragmentDeclarations)}`],
      ['#include <color_fragment>', fragColor(joinPlugins((p) => p.fragmentColorChunk))],
      ['#include <roughnessmap_fragment>', FRAG_ROUGHNESS],
      ['#include <metalnessmap_fragment>', `${FRAG_METALNESS}\n${joinPlugins((p) => p.fragmentRoughnessChunk)}`],
      ['#include <normal_fragment_maps>', '#include <normal_fragment_maps>\n' + ORGANIC_NORMAL],
      ['#include <opaque_fragment>', FRAG_RIM],
    ], 'unified colony fragment');
  };

  material.customProgramCacheKey = () => `unified:${activePlugins.map(p => p.name).join(',')}`;

  const depthMaterial = new THREE.MeshDepthMaterial({
    depthPacking: THREE.RGBADepthPacking,
  });
  depthMaterial.customProgramCacheKey = () => `unified-depth:${activePlugins.map(p => p.name).join(',')}`;
  depthMaterial.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = injectAll(shader.vertexShader, [
      ['#include <common>', VERT_COMMON + joinPlugins((p) => p.vertexDeclarations)],
      ['#include <begin_vertex>', vertBeginVertex(vertPluginChunk)],
    ], 'unified colony depth vertex');
    if (hasScaffold) {
      shader.fragmentShader = injectAll(shader.fragmentShader, [
        ['#include <common>', DEPTH_SCAFFOLD_DECL],
        ['#include <clipping_planes_fragment>', DEPTH_SCAFFOLD_CLIP],
      ], 'unified colony depth fragment');
    }
  };

  const origDispose = material.dispose.bind(material);
  material.dispose = () => {
    offTune();
    depthMaterial.dispose();
    origDispose();
  };

  return { material, depthMaterial, uniforms };
}
