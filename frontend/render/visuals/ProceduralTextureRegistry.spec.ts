import { describe, expect, it } from 'vitest';
import { ProceduralTextureRegistry, type ProceduralPBRBundle } from './ProceduralTextureRegistry';

describe('ProceduralTextureRegistry cache (RN-13)', () => {
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
});
