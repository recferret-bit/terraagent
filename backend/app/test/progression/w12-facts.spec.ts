import { describe, expect, it } from 'vitest';
import { EventBus } from '../../src/bus/event-bus.js';
import { FactsStore } from '../../src/progression/facts.store.js';
import { FactsUpdaterService } from '../../src/progression/facts-updater.service.js';

describe('W12-02 Facts table counter and max metrics', () => {
  it('increments counter on 2 events and keeps the higher of 100 then 80 for max', async () => {
    const store = new FactsStore();
    const bus = new EventBus();
    const updater = new FactsUpdaterService(store, bus);
    updater.onModuleInit();

    const playerId = 'pr_test_pilot';
    const colonyId = 'co_test_0';
    const planetId = 'pl_test_0';

    const c1 = await updater.applyProgressEvent({
      playerId,
      colonyId,
      planetId,
      family: 'groundbreaker',
      metric: 'counter',
      value: 40,
      atTick: 10,
    });
    expect(c1.value).toBe(40);

    const c2 = await updater.applyProgressEvent({
      playerId,
      colonyId,
      planetId,
      family: 'groundbreaker',
      metric: 'counter',
      value: 60,
      atTick: 20,
    });
    expect(c2.previousValue).toBe(40);
    expect(c2.value).toBe(100);

    const m1 = await updater.applyProgressEvent({
      playerId,
      colonyId,
      planetId,
      family: 'power-broker',
      metric: 'max',
      value: 100,
      atTick: 30,
    });
    expect(m1.value).toBe(100);

    const m2 = await updater.applyProgressEvent({
      playerId,
      colonyId,
      planetId,
      family: 'power-broker',
      metric: 'max',
      value: 80,
      atTick: 40,
    });
    expect(m2.previousValue).toBe(100);
    expect(m2.value).toBe(100);

    const m3 = await updater.applyProgressEvent({
      playerId,
      colonyId,
      planetId,
      family: 'power-broker',
      metric: 'max',
      value: 250,
      atTick: 50,
    });
    expect(m3.value).toBe(250);

    expect(await store.getAll(playerId)).toEqual({
      groundbreaker: 100,
      'power-broker': 250,
    });

    updater.onModuleDestroy();
  });
});

describe('W12-02 Facts updater on EventBus', () => {
  it('updates facts from planet.event progression events on the EventBus', async () => {
    const store = new FactsStore();
    const bus = new EventBus();
    const updater = new FactsUpdaterService(store, bus);
    updater.onModuleInit();

    bus.emit('planet.event', {
      planetId: 'pl_1',
      tick: 5,
      kind: 'tilePrepared',
      severity: 'info',
      colonyIds: ['co_1'],
      data: { colonyId: 'co_1', playerId: 'pr_bus', count: 15 },
    } as never);

    bus.emit('planet.event', {
      planetId: 'pl_1',
      tick: 6,
      kind: 'tilePrepared',
      severity: 'info',
      colonyIds: ['co_1'],
      data: { colonyId: 'co_1', playerId: 'pr_bus', count: 10 },
    } as never);

    await new Promise((r) => setTimeout(r, 10));
    expect(await store.get('pr_bus', 'groundbreaker')).toBe(25);
    updater.onModuleDestroy();
  });
});
