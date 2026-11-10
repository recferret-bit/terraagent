// @vitest-environment jsdom
import type { GuildArrivedPayload, GuildDepartedPayload } from '@terra/contracts';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadFeatures, type FeatureContext } from '../../core/registry';
import { Emitter } from '../../net/emitter';
import guildToast from './index';

const DOCKED_6 = 'Guild trader Kestrel has docked — 6 offers';
const DOCKED_0 = 'Guild trader Kestrel has docked — 0 offers';
const DEPARTED = 'Guild trader Kestrel has departed';

function arrived(offers: number, departAt = 1_700_000_000_000): GuildArrivedPayload {
  return {
    shipId: 'kestrel',
    planetId: 'pl_1',
    npcId: 'kestrel',
    name: 'Kestrel',
    departAt,
    offers: Array.from({ length: offers }, (_, i) => ({ offerId: `offer-${i}` })),
  } as GuildArrivedPayload;
}

const departed = (): GuildDepartedPayload => ({ shipId: 'kestrel', planetId: 'pl_1', npcId: 'kestrel' });

class GuildBus {
  private readonly arrivals = new Emitter<GuildArrivedPayload>();
  private readonly departures = new Emitter<GuildDepartedPayload>();
  onGuildArrived(fn: (p: GuildArrivedPayload) => void): () => void {
    return this.arrivals.on(fn);
  }
  onGuildDeparted(fn: (p: GuildDepartedPayload) => void): () => void {
    return this.departures.on(fn);
  }
  emitArrived(p: GuildArrivedPayload): void {
    this.arrivals.emit(p);
  }
  emitDeparted(p: GuildDepartedPayload): void {
    this.departures.emit(p);
  }
}

function mount(flags: string[]): { ctx: FeatureContext; bus: GuildBus } {
  document.body.replaceChildren();
  const el = document.createElement('div');
  const overlay = document.createElement('div');
  document.body.append(el, overlay);
  const bus = new GuildBus();
  const ctx: FeatureContext = {
    flags: new Set(flags),
    host: 'server',
    services: {
      hudOverlay: overlay,
      store: bus,
      openTradeHubPanel: vi.fn(),
      track: () => undefined,
    },
  };
  guildToast.hud![0]!.mount(el, ctx);
  return { ctx, bus };
}

const texts = (): string[] =>
  [...document.querySelectorAll('[data-testid="guild-toast"]')].map((el) => el.textContent ?? '');

afterEach(() => {
  document.body.replaceChildren();
});

describe('guild arrival and departure toasts', () => {
  it('shows the docked line for Kestrel and 6 offers, and a tap opens the Trade Hub', () => {
    const { ctx, bus } = mount(['W15']);
    bus.emitArrived(arrived(6));
    expect(texts()).toEqual([DOCKED_6]);
    (document.querySelector('[data-testid="guild-toast"]') as HTMLButtonElement).click();
    expect(ctx.services.openTradeHubPanel).toHaveBeenCalledWith(true);
    expect(ctx.services.guildTab).toBe(true);
    expect(texts()).toEqual([]);
  });

  it('does not emit a second toast for the same shipId and departAt', () => {
    const { bus } = mount(['W15']);
    const first = arrived(6, 100);
    bus.emitArrived(first);
    bus.emitArrived(first);
    expect(texts()).toEqual([DOCKED_6]);
    bus.emitArrived(arrived(6, 200));
    expect(texts()).toEqual([DOCKED_6, DOCKED_6]);
  });

  it('counts zero offers, names the ship on departure, and stays quiet when W15 is off', () => {
    const on = mount(['W15']);
    on.bus.emitArrived(arrived(0));
    expect(texts()).toEqual([DOCKED_0]);
    on.bus.emitDeparted(departed());
    expect(texts()).toEqual([DOCKED_0, DEPARTED]);
    expect(texts()[1]).toContain('Kestrel');

    expect(loadFeatures({ flags: new Set(['W00']), host: 'server' }).some((f) => f.id === 'guild-toast')).toBe(false);
    const off = mount(['W00']);
    off.bus.emitArrived(arrived(6));
    off.bus.emitDeparted(departed());
    expect(texts()).toEqual([]);
    expect(off.ctx.services.guildTab).toBeUndefined();
  });
});
