import { expect, it, vi } from 'vitest';
import type { FeatureContext, GameView } from '../../core/registry/types';
import { CargoFlights } from './CargoFlights';

const flight = vi.hoisted(() => ({ create: vi.fn(), dispose: vi.fn() }));
vi.mock('@terra/render/visuals/space/CargoFlight', () => ({
  CargoFlight: class {
    constructor(...args: unknown[]) { flight.create(...args); }
    update() { return true; }
    dispose() { flight.dispose(); }
  },
}));

it('does not replay history, preserves multiple accepted transfers and deduplicates view/event delivery', () => {
  let onEvents: (events: unknown[]) => void = () => {};
  const off = vi.fn();
  const ctx = { services: {
    colonyId: 0,
    scene3d: { scene: {}, biomeKey: () => 'dune', tileToWorld: () => ({ x: 0, y: 0, z: 0 }) },
    store: { onServerEvents: (callback: typeof onEvents) => { onEvents = callback; return off; } },
  } } as unknown as FeatureContext;
  const event = { ref: 'old', kind: 'exported', direction: 'export' };
  const view = { sim: { view: {
    entities: new Float32Array([3, 8, 0, 2, 1, 2, 1, 0, 650, 650, 0, 0]), count: 1,
    colonies: [{ index: 0, cargo: { lastEvent: event } }],
  } } } as unknown as GameView;
  const renderer = new CargoFlights(ctx);
  renderer.update(view, 0);
  expect(flight.create).not.toHaveBeenCalled();
  onEvents([
    { kind: 'cargoExported', data: { colonyIndex: 0, ref: 'one' } },
    { kind: 'cargoExported', data: { colonyIndex: 0, ref: 'two' } },
    { kind: 'cargoImported', data: { colonyIndex: 0, ref: 'three', phase: 'requested' } },
    { kind: 'cargoImported', data: { colonyIndex: 1, ref: 'foreign', phase: 'settled' } },
  ]);
  event.ref = 'two';
  renderer.update(view, 0);
  expect(flight.create).toHaveBeenCalledTimes(2);
  renderer.update(view, 0);
  expect(flight.create).toHaveBeenCalledTimes(2);
  onEvents([{ kind: 'cargoImported', data: { colonyIndex: 0, ref: 'three', phase: 'settled' } }]);
  renderer.update(view, 0);
  expect(flight.create).toHaveBeenCalledTimes(3);
  renderer.dispose();
  expect(off).toHaveBeenCalledOnce();
  expect(flight.dispose).toHaveBeenCalledTimes(3);
});
