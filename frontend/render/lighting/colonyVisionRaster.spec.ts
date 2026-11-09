import { afterEach, describe, expect, it } from 'vitest';
import { hexIndex } from '@terra/sim/grid/hex';
import {
  getColonyVisionUniforms, isWorldPointInColonyFov, resetColonyVisionAndLights,
  updateColonyProjectorsAndVision, updateColonyVisionTexture,
} from './ColonyVisionAndLights';

const sample = (x: number, z: number, channel: number) => {
  const u = getColonyVisionUniforms();
  const { data, width, height } = u.uVisionMap.value.image;
  const span = u.uVisionWorldSpan.value;
  return data[(Math.floor((z / span + 0.5) * height) * width + Math.floor((x / span + 0.5) * width)) * 4 + channel];
};

describe('current colony sight and explored memory', () => {
  afterEach(resetColonyVisionAndLights);

  it('rasterizes and CPU-tests sources beyond the 16 analytic shader slots', () => {
    const sources = Array.from({ length: 24 }, (_, i) => ({ x: (i - 12) * 10, z: 0, innerRadius: 5, outerRadius: 6 }));
    updateColonyVisionTexture({ radius: 64, colonyIndex: 0, visionSources: sources });
    updateColonyProjectorsAndVision({ projectors: [], visionSources: sources, fovEnabled: true });
    expect(getColonyVisionUniforms().uVisionSourceCount.value).toBe(16);
    expect(isWorldPointInColonyFov(110, 0)).toBe(true);
    expect(sample(110, 0, 0)).toBeGreaterThan(200);
    expect(isWorldPointInColonyFov(110, 15)).toBe(false);
  });

  it('re-shrouds visited owned ground after a scout leaves, while keeping exploration', () => {
    const index = hexIndex(20);
    const explored = new Uint8Array(index.count).fill(1);
    const owner = new Int8Array(index.count).fill(0);
    const origin = [{ x: 0, z: 0, innerRadius: 8, outerRadius: 10 }];
    updateColonyVisionTexture({ radius: 20, colonyIndex: 0, owner, explored, visionSources: origin });
    updateColonyProjectorsAndVision({ projectors: [], visionSources: origin, fovEnabled: true });
    expect(sample(0, 0, 0)).toBe(255);
    const departed = [{ ...origin[0]!, x: 30 }];
    updateColonyVisionTexture({ radius: 20, colonyIndex: 0, owner, explored, visionSources: departed });
    updateColonyProjectorsAndVision({ projectors: [], visionSources: departed, fovEnabled: true });
    expect(isWorldPointInColonyFov(0, 0)).toBe(false);
    expect(sample(0, 0, 0)).toBe(0);
    expect(sample(0, 0, 1)).toBe(255);
    updateColonyVisionTexture({ radius: 20, colonyIndex: 1, owner, explored, visionSources: [] });
    expect(sample(0, 0, 1)).toBe(0);
  });
});
