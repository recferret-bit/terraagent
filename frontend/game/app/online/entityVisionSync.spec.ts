// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { getColonyVisionUniforms, resetColonyVisionAndLights } from '@terra/render/lighting';
import type { HexTerrain } from '@terra/render/planets/hex';
import { COLONY_FADE_IN_S, syncColonyVisionAndProjectors } from './entityVisionSync';

const terrain = { radius: 4 } as unknown as HexTerrain;
const sync = (colonyActive: boolean) =>
  syncColonyVisionAndProjectors({ records: [], ownerColonyIndex: 0, terrain, tiles: null, colonyActive });

describe('colony vision gate during the space phase / descent (RN-41)', () => {
  afterEach(() => { vi.restoreAllMocks(); resetColonyVisionAndLights(); });

  it('holds the FoV shroud and night factor off while the descent renders, then eases them in without a pop', () => {
    let now = 1000;
    vi.spyOn(performance, 'now').mockImplementation(() => now);
    const u = getColonyVisionUniforms();

    sync(false);
    expect(u.uFovEnabled.value).toBe(0);
    expect(u.uNightFactor.value).toBe(0);
    expect(u.uVisionSourceCount.value).toBe(0);

    now += 100; // descent ends: first colony frame starts the fade
    sync(true);
    const first = u.uFovEnabled.value as number;
    expect(first).toBeGreaterThan(0);
    expect(first).toBeLessThan(0.2);

    for (let t = 0; t < COLONY_FADE_IN_S * 1000 + 200; t += 50) { now += 50; sync(true); }
    expect(u.uFovEnabled.value).toBe(1);
  });
});
