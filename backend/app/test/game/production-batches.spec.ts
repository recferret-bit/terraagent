import 'reflect-metadata';
import { createPlanet, ensureColonyLedger, snapshot, type SimEvent } from '@terra/sim';
import { describe, expect, it } from 'vitest';
import type { PlanetEventOf } from '../../src/bus/channels';
import { EventBus } from '../../src/bus/event-bus';
import { bridgePlanetEvents } from '../../src/game/bus-bridge';
import type { GamePlanets } from '../../src/game/game-planets.service';
import { PlanetHost } from '../../src/game/thread/planet-host';
import { PRODUCTION_WINDOW_TICKS } from '../../src/game/thread/production-batches';
import { W00_PLANET_TYPE, type FromThread } from '../../src/game/thread/protocol';

// W02-28 Stockpile: the sim thread turns the colony ledger's `production.produced` counters into one `resourceProduced`
// batch per colony and resource every 60 s; the bus bridge puts them on the bus as `planet.event`.

const W02_ON = ['W00', 'W01', 'W02'];
const W02_OFF = ['W00', 'W01'];
const PLANET = 'pl_stockpile';
/** Per-step production the test credits (what extractors/workers do through `creditResource`). */
const PER_STEP = { 'metals.t1': 0.25, 'bio.water': 0.1 } as const;

function hostWith(flags: readonly string[]) {
  const events: SimEvent[] = [];
  const host = new PlanetHost(0, flags, (m: FromThread) => {
    if (m.t === 'event' || m.t === 'delta') events.push(...m.events);
  });
  return { host, events };
}

function addColony(host: PlanetHost, id = 'col_a') {
  const state = host.planets.get(PLANET)!.state;
  const colony = ensureColonyLedger({ index: state.colonies.length, id, name: id, color: 0xff6b00, status: 'active', changedAt: state.meta.tick });
  state.colonies.push(colony);
  return colony;
}

/** Steps `n` ticks, crediting {@link PER_STEP} to the colony's produced counters before each step. */
function produce(host: PlanetHost, colony: ReturnType<typeof addColony>, n: number): void {
  for (let i = 0; i < n; i++) {
    for (const [res, amount] of Object.entries(PER_STEP)) colony.production.produced[res as keyof typeof PER_STEP] += amount;
    host.stepPlanet(PLANET, 1);
  }
}

const batches = (events: readonly SimEvent[]) => events.filter((e) => e.kind === 'resourceProduced');
const sumOf = (events: readonly SimEvent[], res: string) =>
  batches(events).filter((e) => e.data.res === res).reduce((s, e) => s + (e.data.amount as number), 0);

describe('W02-28 Stockpile: resourceProduced batches from the sim thread', () => {
  it('2 min of production -> two 60 s batches per resource, summing the ledger produced counters', () => {
    const { host, events } = hostWith(W02_ON);
    host.handle({ t: 'load', planetId: PLANET, params: { type: W00_PLANET_TYPE } });
    const colony = addColony(host);

    produce(host, colony, PRODUCTION_WINDOW_TICKS - 1);
    expect(batches(events)).toEqual([]); // nothing mid-window
    produce(host, colony, PRODUCTION_WINDOW_TICKS + 1);

    const got = batches(events);
    expect(got.map((e) => [e.atTick, e.data.res])).toEqual([
      [PRODUCTION_WINDOW_TICKS, 'metals.t1'], [PRODUCTION_WINDOW_TICKS, 'bio.water'],
      [2 * PRODUCTION_WINDOW_TICKS, 'metals.t1'], [2 * PRODUCTION_WINDOW_TICKS, 'bio.water'],
    ]);
    for (const e of got) expect(e).toMatchObject({ severity: 'info', colonyIds: ['col_a'], data: { colonyId: 'col_a' } });
    for (const res of Object.keys(PER_STEP) as (keyof typeof PER_STEP)[]) {
      expect(sumOf(got, res)).toBeCloseTo(colony.production.produced[res], 9);
      expect(colony.production.produced[res]).toBeCloseTo(PER_STEP[res] * 2 * PRODUCTION_WINDOW_TICKS, 9);
    }
  });

  it('a restored planet reports only what is produced after the load', () => {
    const state = createPlanet({ type: W00_PLANET_TYPE, seed: PLANET, planetId: PLANET });
    const before = ensureColonyLedger({ index: 0, id: 'col_a', name: 'A', color: 0, status: 'active', changedAt: 0 });
    before.production.produced['metals.t1'] = 500;
    state.colonies.push(before);
    const { host, events } = hostWith(W02_ON);
    host.handle({ t: 'load', planetId: PLANET, snapshot: snapshot(state) });
    const colony = host.planets.get(PLANET)!.state.colonies[0] as ReturnType<typeof addColony>;

    produce(host, colony, PRODUCTION_WINDOW_TICKS);
    expect(batches(events).map((e) => e.data)).toEqual([
      { colonyId: 'col_a', res: 'metals.t1', amount: expect.closeTo(PER_STEP['metals.t1'] * PRODUCTION_WINDOW_TICKS, 9) },
      { colonyId: 'col_a', res: 'bio.water', amount: expect.closeTo(PER_STEP['bio.water'] * PRODUCTION_WINDOW_TICKS, 9) },
    ]);
  });

  it('several colonies: one batch per colony and resource; a colony founded mid-window reports its whole production', () => {
    const { host, events } = hostWith(W02_ON);
    host.handle({ t: 'load', planetId: PLANET, params: { type: W00_PLANET_TYPE } });
    const a = addColony(host, 'col_a');
    const half = PRODUCTION_WINDOW_TICKS / 2;
    let b: ReturnType<typeof addColony> | undefined;
    for (let i = 0; i < PRODUCTION_WINDOW_TICKS; i++) {
      if (i === half) b = addColony(host, 'col_b'); // not known at load: baseline zero
      a.production.produced['metals.t1'] += 0.25;
      if (b) b.production.produced['metals.t1'] += 1;
      host.stepPlanet(PLANET, 1);
    }
    expect(batches(events).map((e) => [e.colonyIds, e.data.colonyId, e.data.res, e.data.amount])).toEqual([
      [['col_a'], 'col_a', 'metals.t1', expect.closeTo(0.25 * PRODUCTION_WINDOW_TICKS, 9)],
      [['col_b'], 'col_b', 'metals.t1', expect.closeTo(half, 9)],
    ]);
  });

  it('flushes whole units before a checkpoint and preserves fractional carry after restart', () => {
    const messages: FromThread[] = [];
    const host = new PlanetHost(0, W02_ON, m => messages.push(m));
    host.handle({ t: 'load', planetId: PLANET, params: { type: W00_PLANET_TYPE } });
    const colony = addColony(host);
    colony.production.produced['metals.t1'] = 1.75;
    host.handle({ t: 'snapshotNow', planetId: PLANET });
    const checkpoint = messages.find(m => m.t === 'snapshot');
    if (!checkpoint || checkpoint.t !== 'snapshot') throw new Error('No snapshot');
    const events = messages.flatMap(m => m.t === 'event' || m.t === 'delta' ? m.events : []);
    expect(sumOf(events, 'metals.t1')).toBe(1);
    expect(messages.findIndex(m => m.t === 'event')).toBeLessThan(messages.indexOf(checkpoint));
    const restored = hostWith(W02_ON);
    restored.host.handle({ t: 'load', planetId: PLANET, snapshot: checkpoint.bytes });
    const c = restored.host.planets.get(PLANET)!.state.colonies[0] as ReturnType<typeof addColony>;
    c.production.produced['metals.t1'] += 0.5;
    restored.host.handle({ t: 'snapshotNow', planetId: PLANET });
    expect(sumOf(restored.events, 'metals.t1')).toBe(1);
  });

});

describe('Stockpile wave and bridge boundaries', () => {
  it('W02 off (TA_WAVES=..01): no resourceProduced batch', () => {
    const { host, events } = hostWith(W02_OFF);
    host.handle({ t: 'load', planetId: PLANET, params: { type: W00_PLANET_TYPE } });
    produce(host, addColony(host), 2 * PRODUCTION_WINDOW_TICKS);
    expect(batches(events)).toEqual([]);
  });

  it('the bus bridge publishes the batches as contract-valid planet.event resourceProduced (and the buildingCompleted of both sim emitters)', () => {
    const { host, events } = hostWith(W02_ON);
    host.handle({ t: 'load', planetId: PLANET, params: { type: W00_PLANET_TYPE } });
    produce(host, addColony(host), PRODUCTION_WINDOW_TICKS);

    let tap: ((planetId: string, ev: readonly SimEvent[]) => void) | undefined;
    const planets = { onEvents: (l: typeof tap) => { tap = l; return () => undefined; } } as unknown as GamePlanets;
    const bus = new EventBus(); // validates `planet.event` data against the contract outside production
    const seen: PlanetEventOf<'resourceProduced'>[] = [];
    bus.onPlanetEvent('resourceProduced', (e) => { seen.push(e); }, { module: 'test' });
    const built: PlanetEventOf<'buildingCompleted'>[] = [];
    bus.onPlanetEvent('buildingCompleted', (e) => { built.push(e); }, { module: 'test' });
    const errors: unknown[] = [];
    bridgePlanetEvents(planets, bus, undefined, { error: (o: unknown) => { errors.push(o); } });
    // Architect: the two sim emitters' shapes (`construction/build.ts` and `economy/construction.ts`).
    const completed = (colonyIds: SimEvent['colonyIds'], data: SimEvent['data']): SimEvent => ({ kind: 'buildingCompleted', severity: 'info', atTick: 7, colonyIds, data });
    tap!(PLANET, [
      ...events,
      completed(['col_a'], { colonyId: 'col_a', entityId: 11, building: 'solar', tier: 1, q: 1, r: 0 }),
      completed([0], { entityId: 12, building: 'metalsExtractor', kind: 'metalsExtractor', q: 2, r: -1, playerId: 'col_a' }),
    ]);

    expect(errors).toEqual([]);
    expect(built.map((e) => e.data.building)).toEqual(['solar', 'metalsExtractor']);
    expect(seen.map((e) => [e.planetId, e.tick, e.data.res])).toEqual([
      [PLANET, PRODUCTION_WINDOW_TICKS, 'metals.t1'],
      [PLANET, PRODUCTION_WINDOW_TICKS, 'bio.water'],
    ]);
    expect(seen[0]!.data).toEqual({ colonyId: 'col_a', res: 'metals.t1', amount: expect.closeTo(PER_STEP['metals.t1'] * PRODUCTION_WINDOW_TICKS, 9) });
  });
});
