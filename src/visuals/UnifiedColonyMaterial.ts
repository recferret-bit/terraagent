// .agents/skills/shader-texture-tuning/examples/UnifiedColonyMaterial.ts
import * as THREE from 'three';

export interface BiomeWeatheringPreset {
  dustColor: number;
  rimTint: number;
  weatheringHeight: number;
  weatheringIntensity: number;
}

export class BiomeMaterialRegistry {
  private static presets = new Map<string, BiomeWeatheringPreset>([
    [
      'temperate',
      { dustColor: 0x4a5546, rimTint: 0x8ecae6, weatheringHeight: 0.75, weatheringIntensity: 0.35 },
    ],
    [
      'desert',
      { dustColor: 0xc27155, rimTint: 0xf4a261, weatheringHeight: 1.15, weatheringIntensity: 0.65 },
    ],
    [
      'ice',
      { dustColor: 0xc8ddf2, rimTint: 0xa2d2ff, weatheringHeight: 0.95, weatheringIntensity: 0.55 },
    ],
  ]);

  public static registerBiome(name: string, preset: BiomeWeatheringPreset): void {
    this.presets.set(name, preset);
  }

  public static getBiome(name: string): BiomeWeatheringPreset {
    return this.presets.get(name) ?? this.presets.get('desert')!;
  }
}

export interface ShaderModifierPlugin {
  name: string;
  uniforms?: Record<string, THREE.IUniform>;
  vertexTransformChunk?: string;
  fragmentColorChunk?: string;
}

/**
 * Open Registry allowing agents to attach custom shader effects
 * (e.g., radiation anomaly shimmer, frost crystallization, shield pulse).
 */
export class ShaderPluginRegistry {
  private static plugins = new Map<string, ShaderModifierPlugin>();

  public static registerModifier(plugin: ShaderModifierPlugin): void {
    this.plugins.set(plugin.name, plugin);
  }

  public static getModifier(name: string): ShaderModifierPlugin | undefined {
    return this.plugins.get(name);
  }
}

export interface UnifiedColonyMaterialOptions {
  biome?: string;
  triplanarScale?: number;
  rimStrength?: number;
  plugins?: string[];
}

export interface UnifiedColonyMaterialUniforms {
  uTime: THREE.IUniform<number>;
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

  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);

    // 1. Vertex Shader: Pass local pos/normal & decode GPU part animations
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
        attribute vec2 aSurfacePBR;
        attribute vec4 aPartAnim;
        varying vec3 vLocalPos;
        varying vec3 vObjectNormal;
        varying vec2 vSurfacePBR;
        uniform float uTime;`
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        vLocalPos = position;
        vObjectNormal = normal;
        vSurfacePBR = aSurfacePBR;

        // GPU Part Animation Decoding
        float animType = aPartAnim.x;
        vec3 pivot = aPartAnim.yzw;
        if (animType > 0.5 && animType < 1.5) {
          float angle = uTime * 2.5;
          float s = sin(angle);
          float c = cos(angle);
          vec3 rel = transformed - pivot;
          transformed.x = pivot.x + rel.x * c - rel.z * s;
          transformed.z = pivot.z + rel.x * s + rel.z * c;
        } else if (animType >= 1.5 && animType < 2.5) {
          transformed.y += sin(uTime * 4.0 + pivot.x * 3.1) * 0.05;
        } else if (animType >= 2.5 && animType < 3.5) {
          // Recoil / pulse along local +Z (barrels, thumpers, engine pulse)
          transformed.z -= pow(max(sin(uTime * 5.0 + pivot.x * 2.3), 0.0), 6.0) * 0.06;
        }
        ${activePlugins.map((p) => p.vertexTransformChunk ?? '').join('\n')}
        `
      );

    // 2. Fragment Shader: Triplanar grain, Ground-Up Weathering, Top-Down AO & Rim Light
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        varying vec3 vLocalPos;
        varying vec3 vObjectNormal;
        varying vec2 vSurfacePBR;
        uniform float uTime;
        uniform vec3 uBiomeDustColor;
        uniform vec3 uRimTint;
        uniform float uWeatheringHeight;
        uniform float uWeatheringIntensity;
        uniform float uTriplanarScale;
        uniform float uRimStrength;

        float hash31(vec3 p) {
          p = fract(p * 0.1031);
          p += dot(p, p.yzx + 33.33);
          return fract((p.x + p.y) * p.z);
        }

        float triplanarGrain(vec3 pos, vec3 norm, float scale) {
          vec3 b = pow(abs(normalize(norm)), vec3(4.0));
          b /= max(dot(b, vec3(1.0)), 0.0001);
          float gx = hash31(floor(pos.yzx * scale * 20.0));
          float gy = hash31(floor(pos.xzy * scale * 20.0));
          float gz = hash31(floor(pos.xyz * scale * 20.0));
          return gx * b.x + gy * b.y + gz * b.z;
        }`
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        float grain = triplanarGrain(vLocalPos, vObjectNormal, uTriplanarScale);
        // Subtle micro-surface variation
        diffuseColor.rgb *= (0.96 + 0.08 * grain);

        // Vertical Ground-Up Biome Weathering (skipped on HDR emissive zones)
        float isEmissive = step(1.2, max(diffuseColor.r, max(diffuseColor.g, diffuseColor.b)));
        float heightMask = 1.0 - smoothstep(0.0, uWeatheringHeight, max(vLocalPos.y, 0.0));
        float weatherMix = clamp(heightMask * uWeatheringIntensity * (0.75 + 0.5 * grain), 0.0, 1.0) * (1.0 - isEmissive);
        diffuseColor.rgb = mix(diffuseColor.rgb, uBiomeDustColor, weatherMix);

        // Top-Down Hemisphere Gradient for RTS readability
        float topGrad = mix(0.78, 1.08, clamp(vLocalPos.y * 0.6, 0.0, 1.0));
        diffuseColor.rgb *= mix(topGrad, 1.0, isEmissive);
        ${activePlugins.map((p) => p.fragmentColorChunk ?? '').join('\n')}
        `
      )
      .replace(
        '#include <roughnessmap_fragment>',
        `#include <roughnessmap_fragment>
        if (vSurfacePBR.x > 0.01) {
          roughnessFactor = vSurfacePBR.x;
        }
        roughnessFactor = mix(roughnessFactor, 0.90, clamp(1.0 - smoothstep(0.0, uWeatheringHeight, max(vLocalPos.y, 0.0)), 0.0, 1.0) * uWeatheringIntensity);`
      )
      .replace(
        '#include <metalnessmap_fragment>',
        `#include <metalnessmap_fragment>
        if (vSurfacePBR.x > 0.01) {
          metalnessFactor = vSurfacePBR.y;
        }`
      )
      .replace(
        '#include <opaque_fragment>',
        `// Add subtle Fresnel silhouette rim light before output
        float fresnel = pow(1.0 - abs(dot(normalize(normal), normalize(vViewPosition))), 3.2);
        outgoingLight += uRimTint * fresnel * uRimStrength;
        #include <opaque_fragment>`
      );
  };

  return { material, uniforms };
}
