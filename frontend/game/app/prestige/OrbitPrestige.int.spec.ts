// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CANONICAL_PLANETS } from '@terra/contracts';
import type { OrbitalLeadPatron, OrbitalStage } from '@terra/render/orbit/types';
import { MenuPrestige } from './OrbitPrestige';
import { PrestigeStore } from './PrestigeStore';

describe('W28-12 OrbitPrestige & MenuPrestige full integration (jsdom)', () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('wires MenuPrestige + PrestigeStore + defaultFetchWalletTier across HTTP endpoints with TTL cache & host=local fence', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/v1/near/staking/perks')) {
        return new Response(JSON.stringify({ perks: { tier: 2 } }), { status: 200 });
      }
      if (url.includes('/v1/near/staking/prestige')) {
        const planetId = new URL(url, 'http://x').searchParams.get('planetId')!;
        return new Response(
          JSON.stringify({
            planetId,
            leadPatron:
              planetId === CANONICAL_PLANETS.desert.id
                ? { planetId, accountId: 'desert-king.near', carrierName: 'ISS desert-king.near', activeStakedNear: '700', sinceMs: 1, protocolFeeShareBp: 1500 }
                : null,
            colonies: [{ colonyId: 'c1', colonyIndex: 0, tier: 3 }],
          }),
          { status: 200 },
        );
      }
      return new Response('{}', { status: 404 });
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const shown: Array<OrbitalLeadPatron | null> = [];
    const stage = { setLeadPatron: (p: OrbitalLeadPatron | null) => shown.push(p) } as unknown as OrbitalStage;

    let clock = 1_000_000;
    const store = new PrestigeStore(undefined, () => clock);
    let local = false;
    let activeColony: { planetId: string; colonyId: string } | null = null;
    const menu = new MenuPrestige(
      {
        isLocalHost: () => local,
        flagOn: () => true,
        activeColony: () => activeColony,
        pilotAccount: () => 'whale.near',
      },
      store,
      '',
      false,
    );

    // Wallet-first Tier 2 staker gets plasmaTrail on desert planet even with zero colonies
    menu.orbit.step(stage, CANONICAL_PLANETS.desert.id);
    menu.descent();
    await vi.waitFor(() => expect(shown.at(-1)).toEqual({ carrierName: 'ISS desert-king.near' }));
    expect(menu.descent()).toEqual({ plasmaTrail: true, flagshipCarrierName: 'ISS desert-king.near' });

    // Re-stepping same planet inside TTL reuses cache without re-fetching
    const callsBefore = fetchMock.mock.calls.length;
    menu.orbit.step(stage, CANONICAL_PLANETS.desert.id);
    await new Promise((r) => setTimeout(r, 0));
    expect(fetchMock.mock.calls.length).toBe(callsBefore);

    // Switching planet clears flagship cleanly
    menu.orbit.step(stage, CANONICAL_PLANETS.ocean.id);
    await vi.waitFor(() => expect(shown.at(-1)).toBeNull());

    // Local host disables prestige cleanly
    local = true;
    expect(menu.descent()).toBeUndefined();
    menu.orbit.step(stage, CANONICAL_PLANETS.desert.id);
    expect(shown.at(-1)).toBeNull();
    menu.orbit.dispose();
  });
});
