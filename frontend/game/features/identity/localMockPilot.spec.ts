// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { setProductionBuildOverride } from '@terra/render/ui/buildEnv';
import { isLocalMockAuthEnabled } from '../../../design/pilot/localMockPilot';
import { openNearWalletSelectorModal } from '../../../design/pilot/nearWalletModal';
import { PilotAccess } from '../../../design/pilot/PilotAccess';
import type { FeatureContext } from '../../core/registry/types';
import identity from './index';

afterEach(() => {
  setProductionBuildOverride(null);
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  localStorage.clear();
  sessionStorage.clear();
  document.body.replaceChildren();
});

describe('isLocalMockAuthEnabled fail-closed env + localhost checks', () => {
  it('allows only http/https on loopback hosts in non-production builds', () => {
    expect(isLocalMockAuthEnabled({ location: { hostname: 'localhost', protocol: 'http:', search: '' }, mode: 'development', prod: false })).toBe(true);
    expect(isLocalMockAuthEnabled({ location: { hostname: '127.0.0.1', protocol: 'http:', search: '' }, mode: 'test', prod: false })).toBe(true);
    expect(isLocalMockAuthEnabled({ location: { hostname: '[::1]', protocol: 'https:', search: '' }, mode: 'development', prod: false })).toBe(true);

    expect(isLocalMockAuthEnabled({ location: { hostname: 'terraagent.fun', protocol: 'https:', search: '' }, mode: 'development', prod: false })).toBe(false);
    expect(isLocalMockAuthEnabled({ location: { hostname: 'play.terraagent.fun', protocol: 'https:', search: '' }, mode: 'development', prod: false })).toBe(false);
    expect(isLocalMockAuthEnabled({ location: { hostname: 'localhost.evil.com', protocol: 'http:', search: '' }, mode: 'development', prod: false })).toBe(false);
    expect(isLocalMockAuthEnabled({ location: { hostname: '192.168.1.5', protocol: 'http:', search: '' }, mode: 'development', prod: false })).toBe(false);
    expect(isLocalMockAuthEnabled({ location: { hostname: 'localhost', protocol: 'file:', search: '' }, mode: 'development', prod: false })).toBe(false);
    expect(isLocalMockAuthEnabled({ location: { hostname: 'localhost', protocol: 'http:', search: '?host=local' }, mode: 'development', prod: false })).toBe(false);
    expect(isLocalMockAuthEnabled({ location: { hostname: 'localhost', protocol: 'http:', search: '' }, mode: 'production', prod: true })).toBe(false);
    expect(isLocalMockAuthEnabled({ location: { hostname: 'localhost', protocol: 'http:', search: '' }, mode: 'development', prod: false, appEnv: 'production' })).toBe(false);
    expect(isLocalMockAuthEnabled({ location: { hostname: 'localhost', protocol: 'http:', search: '' }, mode: 'development', prod: false, localMockFlag: 'false' })).toBe(false);
    expect(isLocalMockAuthEnabled({ location: { hostname: 'localhost', protocol: 'http:', search: '' }, mode: 'development', prod: false, nearMode: 'mainnet' })).toBe(false);

    setProductionBuildOverride(true);
    expect(isLocalMockAuthEnabled({ location: { hostname: 'localhost', protocol: 'http:', search: '' } })).toBe(false);
  });
});

const VALID_PLAYER_ID = 'pr_01ARZ3NDEKTSV4RRFFQ69G5FAV';

describe('Localhost mock player-name form in PilotAccess, nearWalletModal, and PilotChip', () => {
  it('PilotAccess validates input, syncs mode, submits with guest bearer, updates UI, and hides in prod', async () => {
    localStorage.setItem(
      'ta_active_pilot',
      JSON.stringify({ playerId: VALID_PLAYER_ID, accessToken: 'eyJhbGciOiJIUzI1NiJ9.eyJleHAiOjk5OTk5OTk5OTl9.sig', isGuest: true }),
    );
    const seen: Array<{ url: string; body: unknown; auth?: string }> = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        if (url === '/v1/auth/refresh') return new Response('{}', { status: 401 });
        if (url === '/v1/dev/mock-oauth/login') {
          seen.push({
            url,
            body: JSON.parse(String(init?.body ?? '{}')),
            auth: (init?.headers as Record<string, string> | undefined)?.Authorization,
          });
          return new Response(
            JSON.stringify({
              accessToken: 'jwt-local-mock',
              expiresIn: 900,
              accountId: 'commander-nova.terraagent.mock',
              player: { id: VALID_PLAYER_ID, handle: 'Commander Nova', isGuest: false },
            }),
            { status: 200 },
          );
        }
        return new Response('{}', { status: 404 });
      }),
    );

    const host = document.createElement('div');
    document.body.appendChild(host);
    const onAuthChange = vi.fn();
    const access = new PilotAccess(host, { skipRestore: true, onAuthChange });
    host.querySelector<HTMLButtonElement>('[data-testid="pilot-sign-in"]')!.click();

    const form = host.querySelector<HTMLFormElement>('[data-testid="local-mock-pilot-form"]')!;
    const input = form.querySelector<HTMLInputElement>('[data-testid="local-mock-player-input"]')!;
    const errEl = form.querySelector<HTMLElement>('[data-testid="local-mock-player-error"]')!;
    const submitBtn = form.querySelector<HTMLButtonElement>('[data-testid="local-mock-player-submit"]')!;
    expect(submitBtn.textContent).toBe('Mock Sign In (Localhost)');

    host.querySelector<HTMLButtonElement>('[data-testid="pilot-mode-signup"]')!.click();
    expect(submitBtn.textContent).toBe('Mock Sign Up (Localhost)');

    input.value = 'x';
    submitBtn.click();
    expect(input.getAttribute('aria-invalid')).toBe('true');
    expect(errEl.hidden).toBe(false);
    expect(seen).toHaveLength(0);

    input.value = 'Commander Nova';
    input.dispatchEvent(new Event('input'));
    expect(input.hasAttribute('aria-invalid')).toBe(false);
    submitBtn.click();

    await vi.waitFor(() => expect(host.querySelector('a')?.textContent).toContain('Commander Nova'));
    expect(seen).toHaveLength(1);
    expect(seen[0]?.body).toEqual({ playerName: 'Commander Nova', mode: 'signup' });
    expect(seen[0]?.auth).toMatch(/^Bearer /);
    expect(onAuthChange).toHaveBeenCalledTimes(1);
    access.dispose();

    setProductionBuildOverride(true);
    const prodHost = document.createElement('div');
    const prodAccess = new PilotAccess(prodHost, { skipRestore: true });
    expect(prodHost.querySelector('[data-testid="local-mock-pilot-form"]')).toBeNull();
    prodAccess.dispose();
  });
});

describe('Localhost mock player-name form in nearWalletModal and PilotChip', () => {

  it('nearWalletModal renders localhost mock form without extra fetches and hides on mainnet/prod', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          accessToken: 'jwt-wallet-mock',
          expiresIn: 900,
          accountId: 'wallet-mock.terraagent.mock',
          player: { id: VALID_PLAYER_ID, handle: 'Wallet Mock', isGuest: false },
        }),
        { status: 200 },
      ),
    );
    vi.stubGlobal('fetch', fetchMock);
    const onLocalMockSession = vi.fn();
    const dialog = openNearWalletSelectorModal({ onDirectToken: vi.fn(), onLocalMockSession });
    expect(fetchMock).toHaveBeenCalledTimes(1); // only challenge prewarm
    const submitBtn = dialog.querySelector<HTMLButtonElement>('[data-testid="local-mock-player-submit"]')!;
    expect(submitBtn.textContent).toBe('Mock Sign In (Localhost)');
    dialog.querySelector<HTMLButtonElement>('[data-testid="near-mode-signup"]')!.click();
    expect(submitBtn.textContent).toBe('Mock Sign Up (Localhost)');

    dialog.querySelector<HTMLInputElement>('[data-testid="local-mock-player-input"]')!.value = 'Wallet Mock';
    submitBtn.click();
    await vi.waitFor(() => expect(onLocalMockSession).toHaveBeenCalledTimes(1));
    expect(document.querySelector('[data-testid="near-wallet-modal"]')).toBeNull();

    const mainnetDialog = openNearWalletSelectorModal({ network: 'mainnet', onDirectToken: vi.fn() });
    expect(mainnetDialog.querySelector('[data-testid="local-mock-pilot-form"]')).toBeNull();
    mainnetDialog.remove();
  });

  it('PilotChip renders localhost mock form in mock and testnet modes and applies linked session', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            accessToken: 'jwt-chip-mock',
            expiresIn: 900,
            accountId: 'chip-pilot.terraagent.mock',
            player: { id: VALID_PLAYER_ID, handle: 'Chip Pilot', isGuest: false },
          }),
          { status: 200 },
        ),
      ),
    );
    let state = { isGuest: true, handle: 'Colonist', accountId: null as string | null, accessToken: 'guest-tok' };
    const listeners = new Set<() => void>();
    const pilot = {
      view: () => state,
      subscribe: (fn: () => void) => { listeners.add(fn); return () => listeners.delete(fn); },
      loginSocial: vi.fn(async () => undefined),
      applyLinkedAuth: vi.fn((session: { accountId: string; accessToken: string; player: { handle: string } }) => {
        state = { isGuest: false, handle: session.player.handle, accountId: session.accountId, accessToken: session.accessToken };
        for (const fn of listeners) fn();
      }),
    };

    const el = document.createElement('div');
    document.body.appendChild(el);
    const ctx = { flags: new Set(['W06']), host: 'server', services: { pilot, identityMode: 'testnet' } } as unknown as FeatureContext;
    const panel = identity.hud![0]!.mount(el, ctx);
    el.querySelector<HTMLButtonElement>('[data-testid="save-progress"]')!.click();
    el.querySelector<HTMLInputElement>('[data-testid="local-mock-player-input"]')!.value = 'Chip Pilot';
    el.querySelector<HTMLButtonElement>('[data-testid="local-mock-player-submit"]')!.click();

    await vi.waitFor(() => expect(el.querySelector('[data-testid="pilot-display-name"]')?.textContent).toBe('Chip Pilot'));
    expect(el.querySelector('[data-testid="pilot-id"]')?.textContent).toBe('Pilot ID chip-pilot.terraagent.mock');
    expect(pilot.applyLinkedAuth).toHaveBeenCalledTimes(1);
    panel.dispose();

    setProductionBuildOverride(true);
    state = { isGuest: true, handle: 'Colonist', accountId: null, accessToken: 'guest-tok' };
    const prodEl = document.createElement('div');
    const prodPanel = identity.hud![0]!.mount(prodEl, ctx);
    prodEl.querySelector<HTMLButtonElement>('[data-testid="save-progress"]')!.click();
    expect(prodEl.querySelector('[data-testid="local-mock-pilot-form"]')).toBeNull();
    prodPanel.dispose();
  });
});
