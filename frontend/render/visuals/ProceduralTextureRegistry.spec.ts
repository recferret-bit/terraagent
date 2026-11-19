import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { ProceduralTextureRegistry, type ProceduralPBRBundle } from './ProceduralTextureRegistry';

describe('ProceduralTextureRegistry cache (RN-13) and botanical/organic PBR presets', () => {
  it('re-registering a preset drops every cached size, so the new generator is used', () => {
    const first: ProceduralPBRBundle = {};
    const second: ProceduralPBRBundle = {};
    ProceduralTextureRegistry.register('rn13Preset', () => first);
    expect(ProceduralTextureRegistry.get('rn13Preset', 16)).toBe(first);
    expect(ProceduralTextureRegistry.get('rn13Preset', 32)).toBe(first);
    ProceduralTextureRegistry.register('rn13Preset', () => second);
    expect(ProceduralTextureRegistry.get('rn13Preset', 16)).toBe(second);
    expect(ProceduralTextureRegistry.get('rn13Preset', 32)).toBe(second);
  });

  it('keeps the cache of another preset whose name starts with the same text', () => {
    const other: ProceduralPBRBundle = {};
    ProceduralTextureRegistry.register('rn13Preset_b', () => other);
    expect(ProceduralTextureRegistry.get('rn13Preset_b', 16)).toBe(other);
    ProceduralTextureRegistry.register('rn13Preset', () => ({}));
    expect(ProceduralTextureRegistry.get('rn13Preset_b', 16)).toBe(other);
  });

  it('synthesizes seamless botanical and pelage PBR bundles with correct color spaces', () => {
    for (const preset of ['treeBarkFissures', 'meadowGrassClover', 'desertPebbleCrust', 'warmFurPelage']) {
      const bundle = ProceduralTextureRegistry.get(preset, 32);
      expect(bundle.map).toBeDefined();
      expect(bundle.normalMap).toBeDefined();
      expect(bundle.roughnessMap).toBeDefined();
      expect(bundle.map!.colorSpace).toBe(THREE.SRGBColorSpace);
      expect(bundle.normalMap!.colorSpace).toBe(THREE.NoColorSpace);
      expect(bundle.roughnessMap!.colorSpace).toBe(THREE.NoColorSpace);
      expect(bundle.normalMap!.wrapS).toBe(THREE.RepeatWrapping);
      expect(bundle.normalMap!.wrapT).toBe(THREE.RepeatWrapping);
    }
  });
});
