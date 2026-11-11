import 'reflect-metadata';
import { DIGEST_DIRECTOR_TRADE } from '@terra/contracts';
import type { SimEvent } from '@terra/sim';
import { describe, expect, it } from 'vitest';
import type { PlanetEventOf } from '../../src/bus/channels.js';
import { EventBus } from '../../src/bus/event-bus.js';
import { FlagsService } from '../../src/flags/flags.service.js';
import { AwayDigestService } from '../../src/game/digest/service.js';
import { MemoryDigestStore } from '../../src/game/digest/memory-store.js';
import type { GamePlanets } from '../../src/game/game-planets.service.js';
import { DirectorDigestRecorder } from '../../src/market/director/digest-recorder.js';

const COLONY = 'co_01ARZ3NDEKTSV4RRFFQ69G5FAV';
const PLANET = 'pl_01ARZ3NDEKTSV4RRFFQ69G5FAV';
const SOLD = 'Director sold 300 metals to the Guild.';

function flags(waves: string): FlagsService {
  return new FlagsService({ TA_WAVES: waves } as never);
}

function trade(amount = 300): PlanetEventOf<'directorTrade'> {
  return {
    planetId: PLANET,
    tick: 4,
    kind: 'directorTrade',
    severity: 'info',
    colonyIds: [COLONY],
    data: {
      colonyId: COLONY,
      resource: 'metals.t1',
      side: 'sell',
      amount,
      counterparty: 'Guild',
      spent: 300,
      allowance: 600,
    },
  };
}

function harness(waves: string) {
  const store = new MemoryDigestStore();
  const digests = new AwayDigestService({ store, now: () => new Date('2026-11-09T12:00:00.000Z') });
  const fanned: SimEvent[] = [];
  const planets = {
    fanEvent(_planetId: string, event: SimEvent) {
      fanned.push(event);
    },
  } as unknown as GamePlanets;
  const recorder = new DirectorDigestRecorder(new EventBus(), flags(waves), digests, planets);
  return { store, digests, fanned, recorder };
}

describe('director digest recorder', () => {
  it('stores digest.directorTrade on the open W09 row and fans the sentence', async () => {
    const { digests, store, fanned, recorder } = harness('all');
    await digests.onPlanetEvent({
      planetId: PLANET,
      tick: 1,
      kind: 'colonyAway',
      colonyIds: [COLONY],
      data: { colonyId: COLONY, atTick: 1 },
    });
    expect(await recorder.record(trade())).toBe(SOLD);
    await digests.flushPlanet(PLANET);
    const body = (await store.findOpen(COLONY))!.body;
    expect(body.items).toEqual([{ kind: DIGEST_DIRECTOR_TRADE, line: SOLD }]);
    expect(fanned[0]?.data.line).toBe(SOLD);
    expect(fanned[0]?.kind).toBe('directorTrade');
  });

  it('W15 off still returns the sentence and does not write the digest', async () => {
    const { digests, store, fanned, recorder } = harness('..14');
    await digests.onPlanetEvent({
      planetId: PLANET,
      tick: 1,
      kind: 'colonyAway',
      colonyIds: [COLONY],
      data: { colonyId: COLONY, atTick: 1 },
    });
    expect(await recorder.record(trade())).toBe(SOLD);
    await digests.flushPlanet(PLANET);
    expect((await store.findOpen(COLONY))!.body.items).toBeUndefined();
    expect(fanned[0]?.data.line).toBe(SOLD);
  });

  it('still returns the sentence when W09 is off and does not write the digest', async () => {
    const { digests, store, fanned, recorder } = harness('..08');
    await digests.onPlanetEvent({
      planetId: PLANET,
      tick: 1,
      kind: 'colonyAway',
      colonyIds: [COLONY],
      data: { colonyId: COLONY, atTick: 1 },
    });
    expect(await recorder.record(trade())).toBe(SOLD);
    await digests.flushPlanet(PLANET);
    expect((await store.findOpen(COLONY))!.body.items).toBeUndefined();
    expect(fanned[0]?.data.line).toBe(SOLD);
  });

  it('amount 0 is not a line and is not fanned', async () => {
    const { fanned, recorder } = harness('all');
    expect(await recorder.record(trade(0))).toBeNull();
    expect(fanned).toHaveLength(0);
  });

  it('drops the 21st line and keeps the first', async () => {
    const { digests, store } = harness('all');
    await digests.onPlanetEvent({
      planetId: PLANET,
      tick: 1,
      kind: 'colonyAway',
      colonyIds: [COLONY],
      data: { colonyId: COLONY, atTick: 1 },
    });
    for (let n = 1; n <= 21; n++) await digests.noteDirectorTrade(COLONY, `line ${n}`, n);
    await digests.flushPlanet(PLANET);
    const items = (await store.findOpen(COLONY))!.body.items ?? [];
    expect(items).toHaveLength(20);
    expect(items[0]?.line).toBe('line 1');
    expect(items.some((item) => item.line === 'line 21')).toBe(false);
  });
});
