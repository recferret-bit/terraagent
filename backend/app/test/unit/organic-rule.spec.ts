import { boardRow, type BoardTrade } from '@terra/sim/systems/trade/market-board';
import { describe, expect, it } from 'vitest';
import { computeMarketAnalytics, type AnalyticsTradeRow } from '../../src/market/analytics/market-analytics.js';
import { isOrganicFill, type OrganicParty } from '../../src/market/settlement/organic.js';

const party = (actorKind: string, colonyId: string, ownerId: string | null): OrganicParty => ({ actorKind, colonyId, ownerId });

function tradeRow(over: Partial<AnalyticsTradeRow>): AnalyticsTradeRow {
  return {
    base: 'bio.water',
    amount: 100n,
    quote: 'USDC',
    buyerColonyId: 'col_1',
    sellerColonyId: 'col_2',
    buyerActorKind: 'player',
    sellerActorKind: 'player',
    organic: true,
    notional: 1_000_000n,
    platformFee: 10_000n,
    stallFee: 5_000n,
    ...over,
  };
}

describe('W13-62 & W13-67 organic-rule & bot intermediary vs consumed volume', () => {
  it('positive: unrelated player/bot pairs feed organic VWAP once trade, volume and counterparty thresholds are met', () => {
    const now = 1_000_000;
    const pairs: Array<[OrganicParty, OrganicParty, bigint, bigint]> = [
      [party('player', 'col_1', 'own_1'), party('bot', 'col_2', 'own_2'), 50n, 500_000n],
      [party('bot', 'col_2', 'own_2'), party('bot', 'col_3', 'own_3'), 50n, 550_000n],
      [party('player', 'col_3', 'own_3'), party('player', 'col_4', 'own_4'), 100n, 1_150_000n],
    ];
    const trades: BoardTrade[] = pairs.map(([b, s, amount, notional], idx) => ({
      pair: 'bio.water/USDC',
      amount,
      notional,
      atMs: now - (10 - idx) * 1000,
      organic: isOrganicFill(b, s, true),
      buyerId: b.colonyId,
      sellerId: s.colonyId,
    }));
    expect(trades.every((t) => t.organic)).toBe(true);
    const row = boardRow('bio.water/USDC', trades, now);
    expect(row.classification).toBe('organic');
    expect(row.vwap).toEqual({ num: '11000', den: 1 });
  });

  it('negative: same-owner bot/player or bot/bot trades, fixture/subsidy/npc/guild, and failClosed null owners never feed VWAP', () => {
    const now = 1_000_000;
    const nonOrganicPairs: Array<[OrganicParty, OrganicParty]> = [
      [party('bot', 'col_1', 'same_owner'), party('bot', 'col_2', 'same_owner')],
      [party('bot', 'col_2', 'same_owner'), party('player', 'col_3', 'same_owner')],
      [party('fixture', 'col_3', 'own_3'), party('player', 'col_4', 'own_4')],
      [party('subsidy', 'col_4', 'own_4'), party('bot', 'col_1', 'own_1')],
      [party('player', 'col_1', null), party('bot', 'col_2', 'own_2')],
    ];
    const trades: BoardTrade[] = nonOrganicPairs.map(([b, s], idx) => ({
      pair: 'bio.water/USDC',
      amount: 100n,
      notional: 1_000_000n,
      atMs: now - (10 - idx) * 1000,
      organic: isOrganicFill(b, s, true),
      buyerId: b.colonyId,
      sellerId: s.colonyId,
    }));
    expect(trades.every((t) => !t.organic)).toBe(true);
    const row = boardRow('bio.water/USDC', trades, now);
    expect(row.vwap).toBeNull();
    expect(row.classification).toBe('fixture');
  });

  it('positive & corner: computeMarketAnalytics separates bot intermediary (re-sold) volume from net consumed/retained volume per resource', () => {
    const rows: AnalyticsTradeRow[] = [
      // bot col_b1 buys 200 water and sells 150 water -> intermediary 150, netConsumed 50
      tradeRow({ base: 'bio.water', amount: 200n, buyerColonyId: 'col_b1', buyerActorKind: 'bot', sellerColonyId: 'col_p1', sellerActorKind: 'player' }),
      tradeRow({ base: 'bio.water', amount: 150n, buyerColonyId: 'col_p2', buyerActorKind: 'player', sellerColonyId: 'col_b1', sellerActorKind: 'bot' }),
      // bot col_b2 only sells 80 water (exporter) -> intermediary 0, netConsumed 0
      tradeRow({ base: 'bio.water', amount: 80n, buyerColonyId: 'col_p1', buyerActorKind: 'player', sellerColonyId: 'col_b2', sellerActorKind: 'bot' }),
      // bot col_b3 only buys 40 metals.t1 (consumer) -> intermediary 0, netConsumed 40
      tradeRow({ base: 'metals.t1', amount: 40n, buyerColonyId: 'col_b3', buyerActorKind: 'bot', sellerColonyId: 'col_p1', sellerActorKind: 'player' }),
    ];
    const report = computeMarketAnalytics(rows, 24, 100);
    expect(report.botVolumeByResource['bio.water']).toEqual({
      bought: '200',
      sold: '230',
      intermediary: '150',
      netConsumed: '50',
    });
    expect(report.botVolumeByResource['metals.t1']).toEqual({
      bought: '40',
      sold: '0',
      intermediary: '0',
      netConsumed: '40',
    });
  });
});
