import { fileURLToPath } from 'node:url';
import type { INestApplication } from '@nestjs/common';
import { afterEach, describe, expect, expectTypeOf, it } from 'vitest';
import { createApp } from '../../src/app';
import { EventBus, type PlanetEventOf, type PlanetEventV1 } from '../../src/bus/bus.module';
import { Emitter } from './fixtures/modules/emitter/emitter.module';
import { Listener } from './fixtures/modules/listener/listener.module';

const srcDir = fileURLToPath(new URL('../../src/', import.meta.url));
const fixtures = fileURLToPath(new URL('./fixtures/modules/', import.meta.url));

let current: INestApplication | undefined;
async function boot() {
  const { app } = await createApp({ source: { NODE_ENV: 'test' }, modulesDirs: [srcDir, fixtures] });
  await app.init();
  current = app;
  return app;
}
afterEach(async () => {
  await current?.close();
  current = undefined;
});

const ev = (note?: string): PlanetEventV1 => ({ planetId: 'p1', tick: 1, kind: 'dev.pong', severity: 'info', colonyIds: [], data: { note } });

describe('event bus', () => {
  it('delivers a typed planet.event from the emitter module to the listener module', async () => {
    const app = await boot();
    app.get(Emitter).pong('hi');
    const got = app.get(Listener).received;
    expect(got).toHaveLength(1);
    expect(got[0]).toMatchObject({ planetId: 'p1', tick: 7, kind: 'dev.pong', severity: 'info', colonyIds: ['c1'], data: { note: 'hi' } });
    expectTypeOf(got[0]!.data.note).toEqualTypeOf<string | undefined>();
    expectTypeOf<PlanetEventOf<'dev.pong'>['kind']>().toEqualTypeOf<'dev.pong'>();
  });

  it('unsubscribe stops delivery', async () => {
    const bus = (await boot()).get(EventBus);
    const seen: string[] = [];
    const off = bus.on('planet.event', (e) => seen.push(e.kind), { module: 't' });
    bus.emit('planet.event', ev());
    off();
    bus.emit('planet.event', ev());
    expect(seen).toEqual(['dev.pong']);
  });

  it('a throwing subscriber does not stop delivery to others; order is subscription order', async () => {
    const bus = (await boot()).get(EventBus);
    const seen: string[] = [];
    bus.on('planet.event', () => seen.push('a'), { module: 'a' });
    bus.on('planet.event', () => { throw new Error('boom'); }, { module: 'bad' });
    bus.on('planet.event', async () => { throw new Error('async boom'); }, { module: 'bad2' });
    bus.on('planet.event', () => seen.push('c'), { module: 'c' });
    expect(() => bus.emit('planet.event', ev())).not.toThrow();
    expect(seen).toEqual(['a', 'c']);
  });

  it('filter and onPlanetEvent only match their kind', async () => {
    const bus = (await boot()).get(EventBus);
    const seen: unknown[] = [];
    bus.on('planet.event', (e) => seen.push(e), { module: 't', filter: (e) => e.tick === 2 });
    bus.emit('planet.event', ev());
    bus.emit('planet.event', { ...ev(), tick: 2 });
    expect(seen).toHaveLength(1);
  });

  it('rejects invalid data for the kind in test mode', async () => {
    const bus = (await boot()).get(EventBus);
    const seen: unknown[] = [];
    bus.on('planet.event', (e) => seen.push(e), { module: 't' });
    const bad = { ...ev(), data: { note: 5 } } as unknown as PlanetEventV1;
    expect(() => bus.emit('planet.event', bad)).toThrow(/invalid data/);
    expect(() => bus.emit('planet.event', { ...ev(), kind: 'nope' } as unknown as PlanetEventV1)).toThrow(/unknown event kind/);
    expect(seen).toHaveLength(0);
  });
});
