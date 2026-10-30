import { describe, expect, it } from 'vitest';
import { RESOURCE_KEYS } from '@terra/contracts';
import {
  applyDiff,
  checkCostAffordability,
  createState,
  creditResource,
  debitCost,
  diffSince,
  ensureColonyLedger,
  familyStock,
  isFamilyAtCap,
  recomputeFamilyCaps,
  refundCost,
  type ColonyState,
} from '../../src';

function makeColony(): ColonyState {
  return {
    index: 0,
    id: 'col-1',
    name: 'Alpha',
    color: 0xff6b00,
    status: 'active',
    changedAt: 0,
  };
}

describe('W02-02 Colony stock & family cap ledger (D-34)', () => {
  it('credit 600 metals.t1 with Metals cap 500 -> stock is 500 and production.capped.metals is 100', () => {
    const colony = ensureColonyLedger(makeColony());
    expect(Object.keys(colony.stock)).toHaveLength(10);
    for (const k of RESOURCE_KEYS) expect(colony.stock[k]).toBe(0);
    expect(colony.caps).toEqual({ metals: 500, minerals: 500, bio: 500 });

    const res = creditResource(colony, 'metals.t1', 600, 5);
    expect(res).toEqual({ credited: 500, capped: 100 });
    expect(colony.stock['metals.t1']).toBe(500);
    expect(colony.production.capped.metals).toBe(100);
    expect(colony.production.produced['metals.t1']).toBe(500);
    expect(isFamilyAtCap(colony, 'metals')).toBe(true);
    expect(colony.changedAt).toBe(5);
  });

  it('shares family cap across T1/T2/T3 tiers and expands by +1000 per Depot', () => {
    const colony = ensureColonyLedger(makeColony());
    creditResource(colony, 'metals.t1', 350, 1);
    const r2 = creditResource(colony, 'metals.t2', 200, 2);
    expect(r2).toEqual({ credited: 150, capped: 50 });
    expect(familyStock(colony, 'metals')).toBe(500);

    // Add 1 Supply Depot -> cap becomes 1500
    recomputeFamilyCaps(colony, true, 1, 3);
    expect(colony.caps.metals).toBe(1500);
    expect(isFamilyAtCap(colony, 'metals')).toBe(false);

    const r3 = creditResource(colony, 'metals.t3', 400, 4);
    expect(r3).toEqual({ credited: 400, capped: 0 });
    expect(familyStock(colony, 'metals')).toBe(900);
  });

  it('supports debitCost, refundCost, storage-cap checks, and delta sync via diffSince/applyDiff', () => {
    const auth = createState({ planetId: 'p1', planetType: 'temperate', seed: 's', radius: 4 });
    const replica = createState({ planetId: 'p1', planetType: 'temperate', seed: 's', radius: 4 });
    const col = ensureColonyLedger(makeColony());
    auth.colonies.push(col);
    replica.colonies.push(ensureColonyLedger(makeColony()));

    auth.meta.tick = 10;
    creditResource(col, 'metals.t1', 200, 10);
    creditResource(col, 'minerals.t1', 100, 10);
    creditResource(col, 'bio.water', 50, 10);

    expect(debitCost(col, { 'metals.t1': 65, 'minerals.t1': 20, 'bio.water': 10 }, 10)).toBe(true);
    expect(col.stock['metals.t1']).toBe(135);
    expect(col.stock['minerals.t1']).toBe(80);
    expect(col.stock['bio.water']).toBe(40);

    // Cancel 75% refund
    refundCost(col, { 'metals.t1': 60, 'minerals.t1': 20 }, 0.75, 10);
    expect(col.stock['metals.t1']).toBe(180);
    expect(col.stock['minerals.t1']).toBe(95);

    // Cost exceeding cap flags exceedsCap
    const capCheck = checkCostAffordability(col, { 'metals.t1': 600 });
    expect(capCheck.ok).toBe(false);
    expect(capCheck.exceedsCap.metals).toBe(100);

    // Sync via diffSince -> applyDiff
    const diff = diffSince(auth, 0);
    applyDiff(replica, diff);
    const repCol = ensureColonyLedger(replica.colonies[0]);
    expect(repCol.stock['metals.t1']).toBe(180);
    expect(repCol.stock['minerals.t1']).toBe(95);
    expect(repCol.caps.metals).toBe(500);
  });
});
