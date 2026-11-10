// @vitest-environment jsdom
import type { DirectorKeyStatusPayload, GuildArrivedPayload, GuildOffer, SimEventWire } from '@terra/contracts';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadFeatures, type FeatureContext, type TradeHubTabDef } from '../../core/registry';
import { Emitter } from '../../net/emitter';
import { AwayPanel } from '../away/AwayPanel';
import guildTab from '../guild-tab';
import { TabExtensions } from '../trade-hub/tabExtensions';
import guildAnalytics, { GUILD_ANALYTICS_EVENTS, GuildAnalytics } from './index';

const SIX = [...GUILD_ANALYTICS_EVENTS];

function offer(): GuildOffer {
  return {
    offerId: 'gof-0', shipId: 'kestrel', npcId: 'kestrel', npcAccountId: 'kestrel.guild',
    action: 'buy', resource: 'metals.t1', amount: 200,
    price: { token: 'USDC', amount: '70000000' }, quoteSeq: 0,
  };
}

function arrived(departAt: number): GuildArrivedPayload {
  return { shipId: 'kestrel', planetId: 'pl_1', npcId: 'kestrel', name: 'Kestrel', departAt, offers: [offer()] };
}

function trade(amount: number, tradeId: string): SimEventWire {
  return {
    kind: 'directorTrade', severity: 'info', atTick: 4, colonyIds: ['co_demo'],
    data: { resource: 'metals.t1', side: 'sell', amount, counterparty: 'Guild', tradeId },
  };
}

function keyBody(state: 'active' | 'revoked'): DirectorKeyStatusPayload {
  return {
    colonyId: 'co_demo', state,
    tokens: state === 'active'
      ? [{ token: 'metals.t1', allowance: '600', reserved: '0', spent: '0', available: '600' }]
      : [],
  };
}

function click(root: ParentNode, id: string): void {
  root.querySelector<HTMLButtonElement>(`[data-testid="${id}"]`)?.click();
}

interface DemoOpts { sendOk?: boolean; httpOk?: boolean; deleteState?: 'active' | 'revoked' }

interface Demo {
  seen: string[];
  arrive: (departAt: number) => void;
  trade: (amount?: number, tradeId?: string) => void;
  other: (kind: string) => void;
  accept: () => void;
  save: () => void;
  enable: () => void;
  revoke: () => void;
  pushKey: (state: 'active' | 'revoked') => void;
  status: (id: string) => string;
  dispose: () => void;
}

function mountGuild(ctx: FeatureContext): { root: HTMLElement; dispose: () => void } {
  const tabs = document.createElement('div');
  const form = document.createElement('div');
  const root = document.createElement('div');
  root.append(tabs, form);
  document.body.append(root);
  const ext = new TabExtensions(tabs, form, ctx, () => undefined);
  ctx.services.registerTradeHubTab = (def: TradeHubTabDef) => ext.register(def);
  ctx.services.showTradeHubTab = (id) => ext.show(id);
  const inst = guildTab.hud![0]!.mount(document.createElement('div'), ctx);
  inst.update?.({});
  root.querySelector<HTMLButtonElement>('[data-testid=trade-hub-tab-guild]')?.click();
  return { root, dispose: () => { inst.dispose(); ext.dispose(); } };
}

function openDemo(flags: string[], opts: DemoOpts = {}): Demo {
  document.body.replaceChildren();
  localStorage.clear();
  const seen: string[] = [];
  const track = (name: string) => { seen.push(name); };
  const arrivals = new Emitter<GuildArrivedPayload>();
  const events = new Emitter<readonly SimEventWire[]>();
  let push: (payload: DirectorKeyStatusPayload) => void = () => {};
  const send = vi.fn(async () => (
    opts.sendOk === false ? { ok: false as const, code: 'offer_expired' } : { ok: true as const, appliedAtTick: 1 }
  ));
  const fetchImpl = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
    if (opts.httpOk === false) return { ok: false, status: 403, json: async () => ({ errorCode: 'wave_disabled' }) };
    const state = init?.method === 'DELETE' ? (opts.deleteState ?? 'revoked') : 'active';
    return { ok: true, status: 200, json: async () => keyBody(state) };
  });
  const ctx = {
    flags: new Set(flags), host: 'server' as const,
    services: {
      track, hudOverlay: document.body, sendCommand: send, openTradeHubPanel: () => undefined,
      store: {
        onGuildArrived: (fn: (p: GuildArrivedPayload) => void) => arrivals.on(fn),
        onGuildDeparted: () => () => undefined,
        onServerEvents: (fn: (e: readonly SimEventWire[]) => void) => events.on(fn),
      },
    },
  } as FeatureContext;
  const toast = document.createElement('div');
  document.body.append(toast);
  const listener = guildAnalytics.hud![0]!.mount(toast, ctx);
  const guild = mountGuild(ctx);
  const awayHost = document.createElement('div');
  document.body.append(awayHost);
  const panel = new AwayPanel(awayHost, {
    sendCommand: send, flags: ctx.flags, colonyId: () => 'co_demo', accessToken: () => 'dev:w15',
    fetchImpl: fetchImpl as unknown as typeof fetch, track,
    subscribeDirector: (fn) => { push = fn; return () => undefined; },
  });
  return {
    seen,
    arrive: (departAt) => arrivals.emit(arrived(departAt)),
    trade: (amount = 300, tradeId = 'tr-1') => events.emit([trade(amount, tradeId)]),
    other: (kind) => events.emit([{ kind, severity: 'info', atTick: 1, colonyIds: [], data: {} }]),
    accept: () => click(guild.root, 'guild-accept'),
    save: () => click(awayHost, 'away-autotrade-save'),
    enable: () => click(awayHost, 'away-director-toggle'),
    revoke: () => click(awayHost, 'away-director-revoke'),
    pushKey: (state) => push(keyBody(state)),
    status: (id) => awayHost.querySelector(`[data-testid="${id}"]`)?.textContent ?? '',
    dispose: () => { listener.dispose(); guild.dispose(); panel.dispose(); document.body.replaceChildren(); },
  };
}

afterEach(() => {
  document.body.replaceChildren();
  localStorage.clear();
});

describe('guild and director analytics (W15-26)', () => {
  it('records each of the six names once and skips a repeated dock', async () => {
    const demo = openDemo(['W09', 'W15']);
    const at = Date.now() + 120_000;
    demo.arrive(at);
    demo.arrive(at);
    demo.accept();
    demo.accept();
    await vi.waitFor(() => expect(demo.seen).toContain('guild_offer_accepted'));
    demo.save();
    await vi.waitFor(() => expect(demo.status('away-autotrade-status')).toBe('saved'));
    demo.enable();
    await vi.waitFor(() => expect(demo.status('away-director-status')).toBe('Allowance 600 · spent 0'));
    demo.revoke();
    await vi.waitFor(() => expect(demo.status('away-director-status')).toBe('Revoked'));
    demo.trade();
    demo.trade(300, 'tr-1');
    expect(demo.seen).toEqual(SIX);
    expect(guildAnalytics.analytics).toEqual(SIX);
    demo.dispose();
  });

  it('records nothing when W15 is off', () => {
    const seen: string[] = [];
    const track = (name: string) => { seen.push(name); };
    const off = new GuildAnalytics(track, () => false);
    off.docked({ shipId: 'kestrel', departAt: 1, offers: [1] });
    off.offerAccepted('gof-0');
    off.configured('metals.t1');
    off.keyEnabled();
    off.keyRevoked();
    off.onServerEvents([trade(300, 'tr-1')]);
    const demo = openDemo(['W09', 'W14']);
    demo.arrive(Date.now() + 120_000);
    demo.arrive(Date.now() + 120_000);
    demo.accept();
    demo.save();
    demo.enable();
    demo.revoke();
    demo.trade();
    expect(seen).toEqual([]);
    expect(demo.seen).toEqual([]);
    expect(demo.status('away-autotrade-status')).toBe('');
    expect(loadFeatures({ flags: new Set(['W09', 'W13', 'W14']), host: 'server' }).some((f) => f.id === 'guild-analytics')).toBe(false);
    expect(loadFeatures({ flags: new Set(['W15']), host: 'server' }).some((f) => f.id === 'guild-analytics')).toBe(true);
    demo.dispose();
  });

  it('records a new departure time once, and ignores a zero fill and other events', () => {
    const demo = openDemo(['W15']);
    const at = Date.now() + 90_000;
    demo.arrive(at);
    demo.arrive(at + 1);
    demo.trade(0, 'none');
    demo.other('goalDone');
    demo.trade(300, 'tr-a');
    demo.trade(300, 'tr-a');
    expect(demo.seen).toEqual(['guild_docked_seen', 'guild_docked_seen', 'director_trade_executed']);
    demo.dispose();
  });

  it('does not record a save, a key, or an accept that did not happen', async () => {
    const rejected = openDemo(['W15'], { sendOk: false, httpOk: false });
    rejected.arrive(Date.now() + 90_000);
    rejected.accept();
    rejected.save();
    await vi.waitFor(() => expect(rejected.status('away-autotrade-status')).toMatch(/rejected/));
    rejected.enable();
    await vi.waitFor(() => expect(rejected.status('away-director-status')).toMatch(/rejected/));
    expect(rejected.seen).toEqual(['guild_docked_seen', 'guild_offer_accepted']);
    rejected.dispose();

    const departed = openDemo(['W15']);
    departed.arrive(Date.now() - 5);
    departed.accept();
    expect(departed.seen).toEqual(['guild_docked_seen']);
    departed.dispose();

    const stuck = openDemo(['W15'], { deleteState: 'active' });
    stuck.enable();
    await vi.waitFor(() => expect(stuck.status('away-director-status')).toBe('Allowance 600 · spent 0'));
    stuck.pushKey('active');
    stuck.revoke();
    await vi.waitFor(() => expect(stuck.status('away-director-status')).toMatch(/key still active/));
    expect(stuck.seen).toEqual(['director_key_enabled']);
    stuck.dispose();
  });
});
