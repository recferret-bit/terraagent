import { describe, expect, it } from 'vitest';
import { MetricsRegistry } from '../../src/core/metrics.registry.js';
import { EconomyTelemetry } from '../../src/economy/telemetry/economy-telemetry.js';

describe('EconomyTelemetry (W13-29)', () => {
  it('turns ledger postings into per-resource flow counters, capped output apart from production', async () => {
    let onLedger: (id: string, tick: number, p: unknown[]) => void = () => undefined;
    const planets = { onPlanetLedger: (f: typeof onLedger) => { onLedger = f; }, onPlanetLoaded: () => undefined, onPlanetUnloaded: () => undefined };
    const metrics = new MetricsRegistry();
    const profiles = { compiledFor: async () => ({ overridesHash: 'ph', dataHash: 'dh' }) };
    new EconomyTelemetry(planets as never, { journalOf: () => null } as never, profiles as never, metrics);
    const posting = (reason: string, legs: Array<{ account: string; asset: string; delta: number }>) => ({ at: 5, reason, actor: 'system:test', legs });
    onLedger('p1', 5, [
      posting('production.tick', [{ account: 'sys:production', asset: 'bio.water', delta: -10 }, { account: 'colony:0', asset: 'bio.water', delta: 10 }]),
      posting('production.tick', [{ account: 'sys:production', asset: 'bio.water', delta: -4 }, { account: 'sys:overflow', asset: 'bio.water', delta: 4 }]),
      posting('construction.spend', [{ account: 'colony:0', asset: 'bio.water', delta: -3 }, { account: 'sys:construction', asset: 'bio.water', delta: 3 }]),
    ]);
    const text = await metrics.render();
    expect(text).toContain('ta_economy_flow_total{planet="p1",resource="bio.water",flow="production"} 10');
    expect(text).toContain('ta_economy_flow_total{planet="p1",resource="bio.water",flow="capped"} 4');
    expect(text).toContain('ta_economy_flow_total{planet="p1",resource="bio.water",flow="consumption"} 3');
    expect(text).toContain('ta_economy_profile_info{profile_hash="ph",data_hash="dh"} 1');
  });
});
