// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { loadFeatures, type FeatureContext } from '../../core/registry';
import { Emitter } from '../../net/emitter';
import type { SimEventWire } from '@terra/contracts';
import directorLog from './index';

const SOLD = 'Director sold 300 metals to the Guild.';

function trade(amount = 300): SimEventWire {
  return {
    kind: 'directorTrade',
    severity: 'info',
    atTick: 4,
    colonyIds: ['co_01ARZ3NDEKTSV4RRFFQ69G5FAV'],
    data: { resource: 'metals.t1', side: 'sell', amount, counterparty: 'Guild' },
  };
}

class Bus {
  private readonly events = new Emitter<readonly SimEventWire[]>();
  onServerEvents(fn: (events: readonly SimEventWire[]) => void): () => void {
    return this.events.on(fn);
  }
  emit(events: readonly SimEventWire[]): void {
    this.events.emit(events);
  }
}

function mount(flags: string[]): Bus {
  document.body.replaceChildren();
  const el = document.createElement('div');
  const overlay = document.createElement('div');
  document.body.append(el, overlay);
  const bus = new Bus();
  const ctx: FeatureContext = {
    flags: new Set(flags),
    host: 'server',
    services: { hudOverlay: overlay, store: bus, track: () => undefined },
  };
  directorLog.hud![0]!.mount(el, ctx);
  return bus;
}

const lines = (): string[] =>
  [...document.querySelectorAll('[data-testid="director-event-line"]')].map((el) => el.textContent ?? '');

afterEach(() => {
  document.body.replaceChildren();
});

describe('director trade HUD log', () => {
  it('shows the sentence when W09 is off', () => {
    const bus = mount(['W15']);
    bus.emit([trade()]);
    expect(lines()).toEqual([SOLD]);
    expect(document.querySelector('[data-kind="digest.directorTrade"]')?.textContent).toBe(SOLD);
  });

  it('does not list amount 0, and stays empty while W09 is on', () => {
    const off = mount(['W15']);
    off.emit([trade(0)]);
    expect(lines()).toEqual([]);
    document.body.replaceChildren();
    const on = mount(['W15', 'W09']);
    on.emit([trade()]);
    expect(lines()).toEqual([]);
    expect(document.querySelector<HTMLElement>('[data-testid="director-event-log"]')?.hidden).toBe(true);
  });

  it('is not mounted when W15 is off', () => {
    const features = loadFeatures({ flags: new Set(['W00', 'W09']), host: 'server' });
    expect(features.some((f) => f.id === 'director-log')).toBe(false);
    expect(loadFeatures({ flags: new Set(['W15']), host: 'server' }).some((f) => f.id === 'director-log')).toBe(true);
  });
});
