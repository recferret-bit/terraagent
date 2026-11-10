// @vitest-environment jsdom
import type { GuildArrivedPayload, GuildOffer, TradeBookOrderView } from '@terra/contracts';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadFeatures, type FeatureContext, type TradeHubTabDef } from '../../core/registry';
import { Emitter } from '../../net/emitter';
import { TabExtensions } from '../trade-hub/tabExtensions';
import { initialState, setPanel, type TradeState } from '../../../trade/model/state';
import { renderMarketOrders } from '../../../trade/view/marketView';
import { formatDepartCountdown } from './countdown';
import guildTab from './index';

const PAIR = 'metals.t1/USDC';

function offer(i: number): GuildOffer {
  return {
    offerId: `gof-${i}`,
    shipId: 'kestrel',
    npcId: 'kestrel',
    npcAccountId: 'kestrel.guild',
    action: i % 2 === 0 ? 'buy' : 'sell',
    resource: 'metals.t1',
    amount: 10 + i,
    price: { token: 'USDC', amount: '1500000' },
    quoteSeq: 0,
  };
}

function arrived(n: number, departAt: number): GuildArrivedPayload {
  return {
    shipId: 'kestrel', planetId: 'pl_1', npcId: 'kestrel', name: 'Kestrel', departAt,
    offers: Array.from({ length: n }, (_, i) => offer(i)),
  };
}

interface Harness {
  parent: HTMLElement;
  services: FeatureContext['services'];
  send: ReturnType<typeof vi.fn>;
  emit: (p: GuildArrivedPayload) => void;
  dispose: () => void;
}

type SendImpl = (kind: string, args?: unknown) => Promise<{ ok: true; appliedAtTick: number } | { ok: false; code: string; detail?: string }>;

function harness(flags: string[], sendImpl?: SendImpl): Harness {
  const tabsRow = document.createElement('div');
  const form = document.createElement('div');
  const parent = document.createElement('div');
  parent.append(tabsRow, form);
  document.body.append(parent);
  const arrivals = new Emitter<GuildArrivedPayload>();
  const departed = new Emitter<{ shipId: string; planetId: string; npcId: string }>();
  const send = vi.fn(sendImpl ?? (async () => ({ ok: true as const, appliedAtTick: 1 })));
  const services: FeatureContext['services'] = {
    store: {
      onGuildArrived: (fn) => arrivals.on(fn),
      onGuildDeparted: (fn) => departed.on(fn),
    },
    sendCommand: send,
    track: () => undefined,
  };
  const ctx: FeatureContext = { flags: new Set(flags), host: 'server', services };
  const ext = new TabExtensions(tabsRow, form, ctx, () => undefined);
  services.registerTradeHubTab = (d: TradeHubTabDef) => ext.register(d);
  services.showTradeHubTab = (id) => ext.show(id);
  const inst = guildTab.hud![0]!.mount(document.createElement('div'), ctx);
  inst.update?.({});
  return { parent, services, send, emit: (p) => arrivals.emit(p), dispose: () => inst.dispose() };
}

function book(actorKind: TradeBookOrderView['actorKind']): TradeState {
  const base = setPanel(initialState('pl', PAIR), 'bookOrders', { status: 'ready' });
  const row: TradeBookOrderView = {
    orderId: 'o1', side: 'sell', price: { num: '5000000', den: 100 }, amount: 10, remaining: 10,
    actorKind, stallFeeBp: 0, expiresAtMs: 9, fillPolicy: 'partial', colonyRef: 'c',
  };
  return { ...base, bookOrders: { planetId: 'pl', pair: PAIR, seq: 1, orders: [row], truncated: false } };
}

const badgeText = (kind: TradeBookOrderView['actorKind']): string => {
  const body = document.createElement('div');
  renderMarketOrders(body, book(kind), 1, null, { setSide() {} });
  return body.querySelector('[data-testid=book-order] .tr-badge')?.textContent ?? '';
};

afterEach(() => {
  document.body.replaceChildren();
});

describe('Guild tab', () => {
  it('renders 6 offers, a minute and second countdown, and Accept sends the offer once', async () => {
    const now = Date.now();
    expect(formatDepartCountdown(now + 90_000, now)).toBe('01m 30s');
    expect(formatDepartCountdown(now + 3_600_000, now)).toBe('1h 00m 00s');
    const h = harness(['W15']);
    h.services.guildTab = true;
    expect(h.services.guildTab).toBe(false);
    expect((h.parent.querySelector('[data-testid=trade-hub-ext-guild]') as HTMLElement).hidden).toBe(false);
    h.emit(arrived(6, now + 90_000));
    expect(h.parent.querySelectorAll('[data-testid=guild-accept]')).toHaveLength(6);
    expect(h.parent.querySelector('[data-testid=guild-countdown]')?.textContent).toMatch(/\d{2}m \d{2}s/);
    const btn = h.parent.querySelector('[data-testid=guild-accept]') as HTMLButtonElement;
    btn.click();
    btn.click();
    await vi.waitFor(() => expect(h.send).toHaveBeenCalledTimes(1));
    expect(h.send).toHaveBeenCalledWith('market.acceptGuildOffer', { offerId: 'gof-0' });
    h.dispose();
  });

  it('renders no tab when W15 is off, and disables Accept after departure', () => {
    expect(loadFeatures({ flags: new Set(['W00', 'W13', 'W14']), host: 'server' }).some((f) => f.id === 'guild-tab')).toBe(false);
    const off = harness(['W14']);
    off.emit(arrived(6, Date.now() + 60_000));
    expect(off.parent.querySelector('[data-testid=trade-hub-tab-guild]')).toBeNull();
    off.services.guildTab = true;
    expect(off.services.guildTab).toBe(true);
    off.dispose();

    const on = harness(['W15']);
    on.emit(arrived(2, Date.now() - 5));
    (on.parent.querySelector('[data-testid=trade-hub-tab-guild]') as HTMLButtonElement).click();
    const buttons = [...on.parent.querySelectorAll('[data-testid=guild-accept]')] as HTMLButtonElement[];
    expect(buttons.length).toBeGreaterThan(0);
    expect(buttons.every((b) => b.disabled)).toBe(true);
    expect(on.parent.querySelector('[data-testid=guild-countdown]')?.textContent).toContain('Departed');
    buttons[0]!.click();
    expect(on.send).not.toHaveBeenCalled();
    on.dispose();
  });

  it('shows the existing reject text when the offer has expired', async () => {
    const h = harness(['W15'], async () => ({ ok: false, code: 'offer_expired', detail: 'new price USDC 10' }));
    (h.parent.querySelector('[data-testid=trade-hub-tab-guild]') as HTMLButtonElement).click();
    h.emit(arrived(1, Date.now() + 60_000));
    (h.parent.querySelector('[data-testid=guild-accept]') as HTMLButtonElement).click();
    await vi.waitFor(() => expect(h.parent.querySelector('[data-testid=guild-reject]')?.textContent).toBe('Rejected: That Guild offer has expired'));
    h.dispose();
  });

  it('shows No offers for an empty visit and does not render a 7th offer', () => {
    const h = harness(['W15']);
    (h.parent.querySelector('[data-testid=trade-hub-tab-guild]') as HTMLButtonElement).click();
    h.emit(arrived(0, Date.now() + 60_000));
    expect(h.parent.querySelector('[data-testid=guild-empty]')?.textContent).toBe('No offers');
    expect(h.parent.querySelector('[data-testid=guild-accept]')).toBeNull();
    h.emit(arrived(7, Date.now() + 60_000));
    const ids = [...h.parent.querySelectorAll('[data-testid=guild-offer]')].map((el) => (el as HTMLElement).dataset.offerId);
    expect(ids).toEqual(['gof-0', 'gof-1', 'gof-2', 'gof-3', 'gof-4', 'gof-5']);
    h.dispose();
  });
});

describe('W13 book Guild badge', () => {
  it('labels npc and guild rows Guild and leaves other actors alone', () => {
    expect(badgeText('npc')).toBe('Guild');
    expect(badgeText('guild')).toBe('Guild');
    expect(badgeText('player')).toBe('player');
    expect(badgeText('bot')).toBe('bot');
    const body = document.createElement('div');
    renderMarketOrders(body, book('npc'), 1, null, { setSide() {} });
    expect(body.querySelector('[data-actor=npc]')?.classList.contains('tr-guild')).toBe(true);
  });
});
