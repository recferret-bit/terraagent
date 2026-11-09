import { describe, expect, it } from 'vitest';
import {
  compareRemedies, createPlanet, ensureColonyLedger, evaluateLogistics, logisticsCoefficients, ratio, ratioToDecimal, resolvePlanetRegion, setBlob, shoppingBasket,
  writeRegionPin, type LogisticsBuilding, type LogisticsNode, type PlanetState,
} from '../../src';
import { supplyTradeView } from '../../src/host/supplyTradeView';
import { ensureColonyRecord } from '../../src/kernel/colonies';

describe('shoppingBasket (ECONOMY 2.1)', () => {
  it('desert specialist: metals above jobs and reserve are SELL surplus; crystal needed by a job is a BUY line naming the job', () => {
    const b = shoppingBasket({
      holdings: { 'metals.t1': 900, 'minerals.t3': 2 }, reservedByOrders: { 'metals.t1': 100 }, safety: { 'metals.t1': 150 },
      demands: [
        { reason: 'job', resource: 'metals.t1', qty: 200, jobId: 'q1', label: 'Solar Array' },
        { reason: 'job', resource: 'minerals.t3', qty: 10, jobId: 'q2', label: 'Survey Array' },
      ],
    });
    expect(b.sell).toEqual([{ resource: 'metals.t1', qty: 450, reason: 'surplus' }]); // 900 - 100 orders - 200 job - 150 reserve
    expect(b.buy).toEqual([{ resource: 'minerals.t3', qty: 8, reason: 'job', jobId: 'q2', label: 'Survey Array' }]);
  });

  it('priority order: jobs first, then the logistics bill, then the safety reserve; a resource is never bought and sold', () => {
    const b = shoppingBasket({
      holdings: { 'bio.water': 30 }, reservedByOrders: {}, safety: { 'bio.water': 20 },
      demands: [{ reason: 'job', resource: 'bio.water', qty: 20, jobId: 'j' }, { reason: 'logistics', resource: 'bio.water', qty: 15 }],
    });
    expect(b.buy.map((l) => [l.reason, l.qty])).toEqual([['logistics', 5], ['reserve', 20]]);
    expect(b.sell).toEqual([]);
  });

  it('never invents units from a negative or fractional input', () => {
    const b = shoppingBasket({ holdings: { 'metals.t1': 5.9 }, reservedByOrders: { 'metals.t1': 50 }, safety: {}, demands: [{ reason: 'job', resource: 'metals.t1', qty: 3.7 }] });
    expect(b.buy).toEqual([{ resource: 'metals.t1', qty: 3, reason: 'job' }]);
  });
});

describe('compareRemedies', () => {
  const ask = { num: 400_000n, den: 1n, quote: 'USDC' as const, platformFeeBp: 100, stallFeeBp: 100 };
  it('buy includes both fees (exact), produce uses local minutes, depot reduces utilization, reserve relieves load', () => {
    const r = compareRemedies({
      resource: 'minerals.t3', qty: 10, ask, localMinutesPerUnit: ratio(3n, 2n),
      depot: { cost: { 'metals.t1': 60 }, buildMinutes: 2, throughputAdd: 100 }, logistics: { L: ratio(200n), K: 100 }, reserveLoadRelief: 100,
    });
    const by = Object.fromEntries(r.map((x) => [x.kind, x]));
    expect(by.buy!.quoteCost).toEqual({ token: 'USDC', notional: 4_000_000n, fees: 80_000n, total: 4_080_000n });
    expect(ratioToDecimal(by.produce!.minutes!)).toBe('15');
    expect(by.depot!.utilizationAfter).toEqual(ratio(1n)); // 200 / (100 + 100)
    expect(by.reserve!.utilizationAfter).toEqual(ratio(1n)); // (200 - 100) / 100
  });
  it('unavailable options say why', () => {
    const r = compareRemedies({ resource: 'minerals.t3', qty: 1, ask: null, localMinutesPerUnit: null, depot: null });
    expect(r.map((x) => [x.kind, x.available, x.note])).toEqual([['buy', false, 'no_ask'], ['produce', false, 'not_producible_here'], ['depot', false, 'no_depot_row'], ['reserve', false, 'nothing_to_reserve']]);
  });
});

describe('logistics bill of a larger army (K = 100, load 200)', () => {
  it('the exact recurring basket is the base bill x 1.25; capacity 200 removes it', () => {
    const c = logisticsCoefficients();
    const node = (k: number): LogisticsNode => ({ id: 'n', domainId: 'c', tile: { q: 0, r: 0 }, kind: 'supplyDepot', throughputPerWindow: k, reachTiles: 90, commissioned: true, powered: true, operational: true });
    const army: LogisticsBuilding = { id: 'a', domainId: 'c', tile: { q: 1, r: 0 }, weight: 200, consumption: { 'metals.t1': 40 }, operatingBp: 10000 };
    const run = (k: number) => evaluateLogistics({ buildings: [army], units: [], nodes: [node(k)], coefficients: c, routeTiles: () => 0 }).domains[0]!;
    expect(ratioToDecimal(run(100).M!, 6)).toBe('1.25');
    expect(ratioToDecimal(run(100).supplyCost['metals.t1']!, 6)).toBe('50');
    expect(ratioToDecimal(run(200).supplyCost['metals.t1']!, 6)).toBe('40');
  });
});

describe('supplyTradeView (state adapter)', () => {
  const state = (): PlanetState => {
    const region = resolvePlanetRegion({}, { planetType: 'desert', planetId: 'pl_dune' });
    if (!region.ok) throw new Error('region');
    const s = createPlanet({ id: 'pl_dune', seed: 's', type: 'desert', planetType: 'desert', radius: 20 });
    writeRegionPin(s, region.region);
    const col = ensureColonyRecord(s, 0, 0);
    ensureColonyLedger(col);
    (col.stock as Record<string, number>)['metals.t1'] = 800;
    (col.stock as Record<string, number>)['minerals.t3'] = 1;
    setBlob(s, 'queue', { entries: [{
      taskId: 'q-survey', colonyIndex: 0, lane: 'construction', precedence: 'player', state: 'waiting', task: { kind: 'build', building: 'surveyArray', q: 0, r: 0 },
      cost: { 'minerals.t3': 9 }, paid: false, progress: 0, buildTicks: 10, elapsedTicks: 0, workRate: 1, createdAt: 0, missingResources: { 'minerals.t3': 8 },
    }] }, 0);
    return s;
  };

  it('desert badges: metals abundant, water and crystal scarce; basket buys crystal for the named job and sells metals', () => {
    const s = state();
    const v = supplyTradeView(s, s.colonies[0]!)!;
    const level = (r: string) => v.badges.find((b) => b.resource === r)?.level;
    expect([level('metals.t1'), level('minerals.t1'), level('bio.water'), level('minerals.t3')]).toEqual(['abundant', 'abundant', 'scarce', 'scarce']);
    expect(v.basket.buy).toContainEqual({ resource: 'minerals.t3', qty: 8, reason: 'job', jobId: 'q-survey', label: 'Survey Array' });
    const sell = v.basket.sell.find((l) => l.resource === 'metals.t1')!;
    expect(sell.qty).toBeGreaterThan(0);
    expect(v.logistics).toBeNull();
    expect(v.remedy.depot).toMatchObject({ cost: { 'metals.t1': 60 }, throughputAdd: 60 });
    expect(v.remedy.produce['bio.water']).toBeDefined();
  });

  it('a planet without region pin or logistics still gets the basket (no badges, no bill)', () => {
    const s = createPlanet({ id: 'p', seed: 's', type: 'desert', planetType: 'desert', radius: 20 });
    const col = ensureColonyRecord(s, 0, 0);
    ensureColonyLedger(col);
    (col.stock as Record<string, number>)['metals.t1'] = 10;
    const v = supplyTradeView(s, s.colonies[0]!)!;
    expect(v.badges).toEqual([]);
    expect(v.logistics).toBeNull();
    expect(v.basket.buy.every((l) => l.reason === 'reserve')).toBe(true); // only the safety stock is missing
    expect(v.basket.sell).toEqual([]);
  });
});
