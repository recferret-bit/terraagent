// .agents/skills/shader-texture-tuning/examples/UnifiedColonyMaterial.ts
import * as THREE from 'three';
import { BiomeMaterialRegistry, ShaderPluginRegistry, type ShaderModifierPlugin } from './unified/registries';
import {
  VERT_COMMON, vertBeginVertex, FRAG_COMMON, fragColor, FRAG_ROUGHNESS, FRAG_METALNESS, FRAG_RIM,
} from './unified/shaderChunks';

export { BiomeMaterialRegistry, ShaderPluginRegistry };
export type { BiomeWeatheringPreset, ShaderModifierPlugin } from './unified/registries';

export interface UnifiedColonyMaterialOptions {
  biome?: string;
  triplanarScale?: number;
  rimStrength?: number;
  plugins?: string[];
}

export interface UnifiedColonyMaterialUniforms {
  uTime: THREE.IUniform<number>;
  uWalkWeight: THREE.IUniform<number>;
  uBiomeDustColor: THREE.IUniform<THREE.Color>;
  uRimTint: THREE.IUniform<THREE.Color>;
  uWeatheringHeight: THREE.IUniform<number>;
  uWeatheringIntensity: THREE.IUniform<number>;
  uTriplanarScale: THREE.IUniform<number>;
  uRimStrength: THREE.IUniform<number>;
  [key: string]: THREE.IUniform<any>;
}

/**
 * Creates the Unified Colony PBR Material that harmonizes both procedural
 * kitbashed geometries and external AI-generated .glb models.
 */
export function createUnifiedColonyMaterial(
  options: UnifiedColonyMaterialOptions = {}
): { material: THREE.MeshStandardMaterial; uniforms: UnifiedColonyMaterialUniforms } {
  const biome = BiomeMaterialRegistry.getBiome(options.biome ?? 'desert');

  const uniforms: UnifiedColonyMaterialUniforms = {
    uTime: { value: 0 },
    uWalkWeight: { value: 1.0 },
    uBiomeDustColor: { value: new THREE.Color(biome.dustColor) },
    uRimTint: { value: new THREE.Color(biome.rimTint) },
    uWeatheringHeight: { value: biome.weatheringHeight },
    uWeatheringIntensity: { value: biome.weatheringIntensity },
    uTriplanarScale: { value: options.triplanarScale ?? 2.0 },
    uRimStrength: { value: options.rimStrength ?? 0.28 },
  };

  const activePlugins = (options.plugins ?? [])
    .map((n) => ShaderPluginRegistry.getModifier(n))
    .filter((p): p is ShaderModifierPlugin => Boolean(p));

  for (const plugin of activePlugins) {
    if (plugin.uniforms) {
      Object.assign(uniforms, plugin.uniforms);
    }
  }

  const material = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.48,
    metalness: 0.25,
  });

  const joinPlugins = (pick: (p: ShaderModifierPlugin) => string | undefined) => activePlugins.map((p) => pick(p) ?? '').join('\n');

  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', VERT_COMMON)
      .replace('#include <begin_vertex>', vertBeginVertex(joinPlugins((p) => p.vertexTransformChunk)));
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', FRAG_COMMON)
      .replace('#include <color_fragment>', fragColor(joinPlugins((p) => p.fragmentColorChunk)))
      .replace('#include <roughnessmap_fragment>', FRAG_ROUGHNESS)
      .replace('#include <metalnessmap_fragment>', FRAG_METALNESS)
      .replace('#include <opaque_fragment>', FRAG_RIM);
  };

  return { material, uniforms };
}
