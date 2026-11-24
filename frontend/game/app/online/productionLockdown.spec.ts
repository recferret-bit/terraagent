// @vitest-environment jsdom
import * as THREE from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { setProductionBuildOverride } from '../../core/buildEnv';
import { ActivePilotTracker, readActivePilot } from '../../features/achievements/activePilot';
import { withDevLag } from '../../net/LagTransport';
import type { Transport } from '../../net/types';
import { buildForwardedOnlineSearch } from '../colonyEntryBridge';
import { buildWavesQuerySuffix, resolveMeBearerToken } from '../../pages/me/api';
import { isBrowserLocalHost } from '../../pages/me/localModeSim';
import { TradeClient } from '../../../trade/api/client';
import { consumeMockToken, resolveIdentity } from '../../../trade/api/identity';
import { initialState } from '../../../trade/model/state';
import { KeysPanel } from '../../../trade/view/keysView';
import { OrderTicket } from '../../../trade/view/ticketView';
import { DEVICE_SECRET_KEY, bootAuthAndHome, deviceSecretKey, type FetchLike, type StorageLike } from './bootOnline';
import { GuestBootTarget } from './guestBoot';
import { activeHome } from './homeFixture';
import { pendingJoinStorageKey } from './joinQueueFlow';
import { localHostOptions } from './localHost';
import { onlineMode } from './onlineMode';
import { OnlineSession } from './OnlineSession';
import { resolveSeatIndexFromSearch } from './parts/sessionViewSync';

const TEST_PLAYER_ID = 'pr_01ARZ3NDEKTSV4RRFFQ69G5FAV';

function createMemoryStorage(): StorageLike {
  const map = new Map<string, string>();
  return {
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => { map.set(k, v); },
  };
}

function createMockAuthFetch(token = 'jwt_prod_token'): {
  fetch: FetchLike;
  calls: Array<{ url: string; method: string }>;
} {
  const calls: Array<{ url: string; method: string }> = [];
  const fetchFn: FetchLike = async (input, init) => {
    const method = (init?.method ?? 'GET').toUpperCase();
    calls.push({ url: input, method });
    if (input === '/v1/auth/guest' && method === 'POST') {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          accessToken: token,
          expiresIn: 900,
          player: { id: TEST_PLAYER_ID, handle: 'Colonist', isGuest: true },
        }),
      };
    }
    if (input.startsWith('/v1/me/home') && method === 'GET') {
      return {
        ok: true,
        status: 200,
        json: async () => activeHome({ colonyIndex: 0 }),
      };
    }
    return { ok: false, status: 404, json: async () => ({}) };
  };
  return { fetch: fetchFn, calls };
}

afterEach(() => {
  setProductionBuildOverride(null);
});

describe('Production build URL lockdown & offline local-host guardrails', () => {
  it('locks down ?host=local, legacy QA query params (?autodeploy=, ?qat=, ?t=, ?seed=&skip=1, ?waves=, ?scenario=, ?join=), and local fallback in production builds across play, me, and trade', async () => {
    setProductionBuildOverride(true);

    expect(onlineMode('')).toBeNull();
    expect(onlineMode('?host=local')).toBeNull();
    expect(onlineMode('?host=local&scenario=w00')).toBeNull();
    expect(onlineMode('?host=local&scenario=w01')).toBeNull();
    expect(onlineMode('?autodeploy=1500')).toBeNull();
    expect(onlineMode('?menutime=10')).toBeNull();
    expect(onlineMode('?qat=5')).toBeNull();
    expect(onlineMode('?t=5')).toBeNull();
    expect(onlineMode('?seed=123&skip=1')).toBeNull();
    expect(onlineMode('?waves=..00')).toBeNull();
    expect(onlineMode('?scenario=w00&as=e2e')).toBeNull();
    expect(onlineMode('?join=pl_1')).toBeNull();
    expect(onlineMode('?spectator=1')).toBeNull();
    expect(onlineMode('?planet=dune')).toBeNull();
    expect(onlineMode('?planet=dune&host=local&t=5&autodeploy=100&qat=3')).toBeNull();

    expect(localHostOptions('?host=local')).toBeNull();
    expect(localHostOptions('?host=local&scenario=w00')).toBeNull();
    expect(localHostOptions('?spectator=1')).toBeNull();

    expect(buildForwardedOnlineSearch('?planet=dune&host=local&waves=..03&lag=150&predict=0&as=bob&seed=abc&colonyId=co_1'))
      .toBe('?seed=abc&colonyId=co_1');
    expect(deviceSecretKey('?as=bob')).toBe(DEVICE_SECRET_KEY);
    expect(pendingJoinStorageKey('?as=bob')).toBe('ta_pending_join_ticket');

    const storage = createMemoryStorage();
    const { fetch: mockFetch, calls } = createMockAuthFetch('jwt_prod_token');
    const prodBoot = await bootAuthAndHome({ storage, fetch: mockFetch, search: '?host=local&as=bob' });
    expect(prodBoot.mode).toBe('online');
    expect(prodBoot.localHost).toBeUndefined();
    expect(calls.some((c) => c.url === '/v1/auth/guest')).toBe(true);
    expect(calls.some((c) => c.url.startsWith('/v1/me/home'))).toBe(true);

    await expect(
      bootAuthAndHome({
        storage,
        search: '?host=local',
        allowLocalFallback: true,
        fetch: async () => { throw new Error('ECONNREFUSED'); },
      }),
    ).rejects.toThrow(/ECONNREFUSED/);

    expect(isBrowserLocalHost('?host=local')).toBe(false);
    expect(resolveMeBearerToken('?host=local')).toBe('');
    expect(resolveMeBearerToken('?as=bob')).toBe('');
    expect(resolveMeBearerToken('?playerId=pr_123')).toBe('');
    expect(buildWavesQuerySuffix('?waves=..11')).toBe('');
    expect(resolveIdentity('?as=bob', '')).toBeNull();
    expect(resolveIdentity('?playerId=pr_123', '')).toBeNull();
    expect(await consumeMockToken('#mock_token=fake')).toBeNull();
  });

  it('ignores ?as=, ?lag=, and ?scenario=w12 in GuestBootTarget, resolveSeatIndexFromSearch, withDevLag, and ActivePilotTracker in production', async () => {
    setProductionBuildOverride(true);
    const storage = createMemoryStorage();
    const { fetch: mockFetch } = createMockAuthFetch('jwt_prod_token');
    const refreshCalls: string[] = [];
    const guestTarget = new GuestBootTarget('ws://localhost/ws', {
      search: '?as=bob',
      storage,
      fetch: async (url, init) => {
        refreshCalls.push(url);
        return mockFetch(url, init);
      },
      onBooted: () => {},
    });
    await guestTarget.boot();
    expect(refreshCalls[0]).toBe('/v1/auth/refresh');

    expect(resolveSeatIndexFromSearch('?as=b', { colonies: [{ index: 0 }, { index: 1 }] } as never)).toBeNull();
    const dummyTransport: Transport = {
      state: { phase: 'idle', attempt: 0, downSinceMs: null },
      start() {}, stop() {}, send() {},
      onMessage: () => () => {}, onState: () => () => {},
    };
    expect(withDevLag(dummyTransport, '?lag=500')).toBe(dummyTransport);

    localStorage.removeItem('ta_active_pilot');
    const prevUrl = location.href;
    history.replaceState(null, '', '/play.html?as=alice&scenario=w12');
    const devServerSpy = vi.fn(async () => ({}));
    const prodTracker = new ActivePilotTracker({
      flags: new Set(['W12']),
      host: 'server',
      services: { devServer: devServerSpy } as never,
    });
    expect(prodTracker.playerId).toBe('');
    expect(prodTracker.accessToken).toBe('');
    expect(readActivePilot()).toBeNull();
    expect(devServerSpy).not.toHaveBeenCalled();
    prodTracker.dispose();
    history.replaceState(null, '', prevUrl);
  });
});

describe('Offline LocalHost HUD isolation & signed-out Trade guards', () => {
  it('sets FeatureHud host to local and disables prestige when OnlineSession runs on ?host=local in dev mode', async () => {
    setProductionBuildOverride(false);
    const root = document.createElement('div');
    document.body.appendChild(root);
    const session = new OnlineSession(root, 'boot', {
      uiParent: document.body,
      storage: createMemoryStorage(),
      search: '?host=local&skip=1',
      makeMesh: () => new THREE.Group(),
    });
    const hud = (session as unknown as { hud: { getHost(): string } }).hud;
    expect(hud.getHost()).toBe('local');
    expect(session.entities.prestige.isEnabled()).toBe(false);
    await session.whenBooted;
    expect(hud.getHost()).toBe('local');
    expect(session.entities.prestige.isEnabled()).toBe(false);
    session.dispose();
    root.remove();
  });

  it('blocks unauthenticated KeysPanel.create and OrderTicket.suggest / submit on /trade.html without calling the network', async () => {
    const fetchSpy = vi.fn(async () => new Response('{}', { status: 200 }));
    const signedOutClient = new TradeClient('', fetchSpy as never);
    const st = initialState('pl_1', 'metals.t1/USDC');

    const keysHost = document.createElement('div');
    const keysPanel = new KeysPanel(keysHost, {
      client: signedOutClient,
      state: () => ({ ...st, panels: { ...st.panels, keys: { status: 'ready' } } }),
      reload: () => {},
    });
    keysPanel.render();
    const form = keysHost.querySelector<HTMLFormElement>('#key-form')!;
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(keysHost.textContent).toContain('Sign in to create an API key.');

    const ticket = new OrderTicket({ client: signedOutClient, state: () => st, onSent: () => {} });
    ticket.root.querySelector<HTMLButtonElement>('[data-testid="ticket-suggest"]')!.click();
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(ticket.root.querySelector('[data-testid="ticket-suggest-msg"]')?.textContent).toContain('Sign in');
  });
});
