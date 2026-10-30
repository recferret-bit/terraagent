import type * as THREE from 'three';

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
