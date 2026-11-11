import { describe, expect, it } from 'vitest';
import { commandGate, eventDef, parseCommandArgs, parseWaves } from '@terra/contracts';

/**
 * W15-01 integration: the shared command gate and the event registry agree on flag W15.
 * No database: the rows are pure contracts the sim and the market module both import.
 */
describe('W15-01 guild contracts through the sim import', () => {
  it('accepts the demo limits and rejects an over-long offer id at the boundary', () => {
    const ok = parseCommandArgs('setAutoTrade', {
      limits: { 'metals.t1': { maxPerTrade: 300, maxPerSession: 600, minStock: 200, partners: 'guild' } },
    });
    expect(ok.success).toBe(true);
    expect(parseCommandArgs('market.acceptGuildOffer', { offerId: 'a'.repeat(160) }).success).toBe(true);
    expect(parseCommandArgs('market.acceptGuildOffer', { offerId: 'a'.repeat(161) }).success).toBe(false);
  });

  it('keeps W13 markets when W15 is off, and opens both guild commands when W15 is on', () => {
    const off = parseWaves('..14');
    const on = parseWaves('15');
    expect(commandGate('market.placeOrder', off)).toBeNull();
    expect(commandGate('setAutoTrade', off)).toBe('wave_disabled');
    expect(commandGate('market.acceptGuildOffer', on)).toBeNull();
    expect(eventDef('guildTradeSettled').wave).toBe('W15');
    expect(eventDef('directorAllowanceExhausted').data.safeParse({
      colonyId: 'co_1', resource: 'metals.t1', spent: 600, allowance: 600, reason: 'allowance_exhausted',
    }).success).toBe(true);
    expect(eventDef('directorAllowanceExhausted').data.safeParse({
      colonyId: 'co_1', resource: 'metals.t1', spent: 0, allowance: 600, reason: 'other',
    }).success).toBe(false);
  });
});
