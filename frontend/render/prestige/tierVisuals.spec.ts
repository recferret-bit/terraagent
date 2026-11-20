import { describe, expect, it } from 'vitest';
import {
  baseHubArchetypeId, hubArchetypeForTier, HUB_BASE_ID, HUB_GOLD_ID, HUB_UPLINK_ID, isKnownPrestigeTier, prestigeVisualsForTier,
} from './tierVisuals';

describe('W28-12 tier -> visual mapping (unit)', () => {
  it('tier 0 shows nothing', () => {
    const v = prestigeVisualsForTier(0);
    expect(Object.values({ ...v, tier: undefined }).some(Boolean)).toBe(false);
    expect(hubArchetypeForTier(0)).toBe(HUB_BASE_ID);
  });

  it('tier 1 adds the uplink beam and quantum dish only', () => {
    const v = prestigeVisualsForTier(1);
    expect(v).toMatchObject({ uplinkBeam: true, quantumDish: true, plasmaTrail: false, cyanCutters: false, goldTrim: false, flagshipCarrier: false });
    expect(hubArchetypeForTier(1)).toBe(HUB_UPLINK_ID);
  });

  it('tier 2 adds the plasma trail and cyan cutters', () => {
    expect(prestigeVisualsForTier(2)).toMatchObject({ uplinkBeam: true, plasmaTrail: true, cyanCutters: true, goldTrim: false, flagshipCarrier: false });
    expect(hubArchetypeForTier(2)).toBe(HUB_UPLINK_ID);
  });

  it('tier 3 adds the gold hub and tier 4 everything', () => {
    expect(prestigeVisualsForTier(3)).toMatchObject({ goldTrim: true, flagshipCarrier: false });
    expect(hubArchetypeForTier(3)).toBe(HUB_GOLD_ID);
    expect(prestigeVisualsForTier(4)).toMatchObject({ uplinkBeam: true, quantumDish: true, plasmaTrail: true, cyanCutters: true, goldTrim: true, flagshipCarrier: true });
    expect(hubArchetypeForTier(4)).toBe(HUB_GOLD_ID);
  });

  it('every flag is monotone in the tier', () => {
    const keys = ['uplinkBeam', 'quantumDish', 'plasmaTrail', 'cyanCutters', 'goldTrim', 'flagshipCarrier'] as const;
    for (const k of keys) {
      for (let t = 1; t <= 4; t++) if (prestigeVisualsForTier(t - 1)[k]) expect(prestigeVisualsForTier(t)[k]).toBe(true);
    }
  });

  it('unknown, negative, fractional, non-numeric and out-of-range tiers show nothing', () => {
    for (const bad of [-1, 5, 99, 1.5, Number.NaN, Infinity, -Infinity, '3', null, undefined, {}, true]) {
      expect(isKnownPrestigeTier(bad)).toBe(false);
      const v = prestigeVisualsForTier(bad);
      expect(v.tier).toBe(0);
      expect(v.uplinkBeam || v.goldTrim || v.flagshipCarrier || v.plasmaTrail).toBe(false);
      expect(hubArchetypeForTier(bad)).toBe(HUB_BASE_ID);
    }
  });

  it('hands out frozen shared results', () => {
    expect(prestigeVisualsForTier(2)).toBe(prestigeVisualsForTier(2));
    expect(Object.isFrozen(prestigeVisualsForTier(2))).toBe(true);
  });

  it('resolves hub variants to the base id and leaves other ids alone', () => {
    expect(baseHubArchetypeId(HUB_GOLD_ID)).toBe(HUB_BASE_ID);
    expect(baseHubArchetypeId(HUB_UPLINK_ID)).toBe(HUB_BASE_ID);
    expect(baseHubArchetypeId('building.solar')).toBe('building.solar');
  });
});
