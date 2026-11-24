// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { clearMeCachedToken, fetchMeData, resolveMeBearerToken, saveMePilotHandle } from './api';
import { createLocalModeFetch } from './localModeSim';
import { MePage } from './MePage';
import { toMockAccountId } from './parts/localSimPersonas';
import { renderStakingDashboard } from './sections/staking/dashboard/StakingDashboard';
import { makeW12AchievementsFixture, makeW12ProfileFixture } from './testFixtures';

const q = (root: ParentNode, id: string): HTMLElement | null => root.querySelector(`[data-testid="${id}"]`);

const flush = async (): Promise<void> => {
  await new Promise((r) => setTimeout(r, 0));
  await new Promise((r) => setTimeout(r, 0));
};

beforeEach(() => {
  clearMeCachedToken();
  vi.unstubAllGlobals();
  window.localStorage.clear();
  window.sessionStorage.clear();
  document.body.replaceChildren();
  window.history.replaceState(null, '', '/');
});

describe('/me local mode (?host=local) sign-out, sign-in, rename & navigation links', () => {
  it('signs out cleanly on ?host=local without reloading Local Commander and signs back in via local mock form', async () => {
    const root = document.createElement('div');
    document.body.appendChild(root);
    const localFetch = createLocalModeFetch(() => 1_700_000_000_000);
    const page = new MePage(root, { search: '?host=local', fetch: localFetch });
    await page.load();
    await flush();

    expect(q(root, 'me-pilot-handle')!.textContent).toBe('Local Commander');
    const headerLink = root.querySelector<HTMLAnchorElement>('[data-testid="me-header-auth"] a')!;
    expect(headerLink.textContent).toContain('Local Commander · PILOT / ME');
    expect(headerLink.getAttribute('href')).toBe('/me.html?host=local');

    // Local mode links keep ?host=local and point to the planet selection screen
    expect(q(root, 'me-colony-dive-in')!.getAttribute('href')).toBe('/play.html?host=local&planet=forestRock');
    expect(q(root, 'me-play-cta')!.getAttribute('href')).toBe('/play.html?host=local');

    // Sign out transitions cleanly to me-auth-prompt with all internals disabled until signed in
    q(root, 'pilot-sign-out')!.click();
    await flush();
    await flush();
    expect(resolveMeBearerToken('?host=local')).toBe('');
    expect(q(root, 'me-auth-prompt')).not.toBeNull();
    expect(q(root, 'me-main')?.dataset.guestDisabled).toBe('true');
    expect(q(root, 'me-main')?.hasAttribute('inert')).toBe(true);
    expect(q(root, 'me-pilot-handle')?.textContent).toBe('Guest Pilot');

    // Sign back in via prompt's Sign in / Sign up -> local mock player form
    const promptAuth = q(root, 'me-auth-prompt')!;
    q(promptAuth, 'pilot-sign-in')!.click();
    const form = q(promptAuth, 'local-mock-pilot-form')!;
    expect(form).not.toBeNull();
    const input = q(form, 'local-mock-player-input') as HTMLInputElement;
    const submit = q(form, 'local-mock-player-submit') as HTMLButtonElement;

    // Invalid name rejected inline
    input.value = 'x';
    submit.click();
    expect(input.getAttribute('aria-invalid')).toBe('true');

    // Valid name signs in and mounts Staking Wealth Dashboard for commander-nova.terraagent.mock
    input.value = 'Commander Nova';
    input.dispatchEvent(new Event('input'));
    submit.click();
    await flush();
    await flush();

    expect(q(root, 'me-auth-prompt')).toBeNull();
    expect(q(root, 'me-pilot-handle')!.textContent).toBe('Commander Nova');
    expect(q(root, 'me-pilot-id')!.textContent).toBe('commander-nova.terraagent.mock');
    expect(q(root, 'staking-dashboard')!.dataset.account).toBe('commander-nova.terraagent.mock');
  });

  it('keeps /me internals disabled while signed out on /me.html?host=local#staking and unlocks via Sign in / Sign up', async () => {
    const localFetch = createLocalModeFetch(() => 1_700_000_000_000);
    await localFetch('/v1/auth/logout', { method: 'POST' });

    const root = document.createElement('div');
    document.body.appendChild(root);
    const page = new MePage(root, { search: '?host=local', hash: '#staking?amount=50', fetch: localFetch });
    await page.load();
    await flush();

    expect(q(root, 'me-auth-prompt')).not.toBeNull();
    expect(q(root, 'me-main')?.dataset.guestDisabled).toBe('true');
    expect((q(root, 'staking-connect-cta') as HTMLButtonElement).disabled).toBe(true);

    const promptAuth = q(root, 'me-auth-prompt')!;
    q(promptAuth, 'pilot-sign-in')!.click();

    const promptDialog = promptAuth.querySelector<HTMLDialogElement>('[data-testid="pilot-provider-dialog"]')!;
    expect(promptDialog.open || promptDialog.hasAttribute('open')).toBe(true);
    expect(q(promptDialog, 'local-mock-pilot-form')).not.toBeNull();

    // Email sign-in works offline in ?host=local without external popups and unlocks /me internals
    (q(promptDialog, 'pilot-email-input') as HTMLInputElement).value = 'vega@terraagent.fun';
    q(promptDialog, 'continue-email')!.click();
    await flush();
    await flush();

    expect(q(root, 'me-auth-prompt')).toBeNull();
    expect(q(root, 'me-main')?.dataset.guestDisabled).toBeUndefined();
    expect(q(root, 'me-pilot-handle')!.textContent).toBe('vega');
    expect(q(root, 'staking-dashboard')).not.toBeNull();
  });
});

describe('/me inline Pilot Rename control', () => {
  it('renames pilot inline via Rename button, validates bad names, handles 409 errors, and syncs header + avatar', async () => {
    window.localStorage.setItem(
      'ta_active_pilot',
      JSON.stringify({ playerId: 'pr_local_1', accessToken: 'local-mode-token', isGuest: false, handle: 'Local Commander' }),
    );
    const baseFetch = createLocalModeFetch(() => 1_700_000_000_000);
    const wrappedFetch: typeof baseFetch = async (input, init) => {
      if (input.includes('/v1/me/profile/handle') && init?.method === 'PUT') {
        const parsed = JSON.parse(String(init.body ?? '{}')) as { handle?: string };
        if (parsed.handle === 'Taken Name') {
          return { ok: false, status: 409, json: async () => ({ message: 'That pilot name is already taken.' }) };
        }
      }
      return baseFetch(input, init);
    };

    const root = document.createElement('div');
    document.body.appendChild(root);
    const page = new MePage(root, { search: '?host=local', fetch: wrappedFetch });
    await page.load();
    await flush();

    const renameBtn = q(root, 'me-pilot-rename')!;
    const form = q(root, 'me-pilot-rename-form')!;
    const input = q(root, 'me-pilot-rename-input') as HTMLInputElement;
    const saveBtn = q(root, 'me-pilot-rename-save')!;
    expect(form.hidden).toBe(true);

    renameBtn.click();
    expect(form.hidden).toBe(false);
    expect(renameBtn.getAttribute('aria-expanded')).toBe('true');

    // Client-side validation rejects invalid names
    input.value = 'a';
    saveBtn.click();
    expect(input.getAttribute('aria-invalid')).toBe('true');
    expect(q(root, 'me-pilot-rename-status')!.dataset.tone).toBe('error');

    // Escape closes without saving
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(form.hidden).toBe(true);
    expect(q(root, 'me-pilot-handle')!.textContent).toBe('Local Commander');

    // Server 409 error stays open and surfaces message
    renameBtn.click();
    input.value = 'Taken Name';
    saveBtn.click();
    await flush();
    expect(form.hidden).toBe(false);
    expect(q(root, 'me-pilot-rename-status')!.textContent).toBe('That pilot name is already taken.');

    // Valid rename updates handle, avatar glyph, header link, and localStorage
    input.value = 'Admiral Vega';
    input.dispatchEvent(new Event('input'));
    saveBtn.click();
    await flush();

    expect(form.hidden).toBe(true);
    expect(q(root, 'me-pilot-handle')!.textContent).toBe('Admiral Vega');
    expect(q(root, 'me-pilot-avatar')!.textContent).toBe('A');
    expect(root.querySelector('[data-testid="me-header-auth"] a')!.textContent).toContain('Admiral Vega · PILOT / ME');
    expect(JSON.parse(window.localStorage.getItem('ta_active_pilot')!).handle).toBe('Admiral Vega');
  });
});

describe('/me Staking multi-minute live snapshots & preview ? tip persistence', () => {
  it('continues refreshing performance on subsequent minutes (t=60s, 120s, 180s) in local 1-minute mode', async () => {
    let now = 1_700_000_000_000;
    const dash = renderStakingDashboard({
      accountId: 'local-commander.terraagent.mock',
      amount: 100,
      fetch: createLocalModeFetch(() => now),
      search: '?host=local',
      now: () => now,
      tickMs: 10,
    });
    await dash.ready;

    q(dash.el, 'staking-console-stake')!.click();
    await flush();
    q(dash.el, 'help-tip-btn-staking-chart')!.click();
    expect(q(dash.el, 'help-tip-panel-staking-chart')!.hidden).toBe(false);

    const readChartDesc = () => dash.el.querySelector('#staking-chart-desc')!.textContent!;
    const desc0 = readChartDesc();

    // Minute 1: warmup & early-exit mature + snapshot updates
    now += 61_000;
    await new Promise((r) => setTimeout(r, 35));
    await flush();
    const desc1 = readChartDesc();
    expect(desc1).not.toBe(desc0);
    expect(q(dash.el, 'staking-warmup-chip')!.textContent).toBe('Full tier fee active');

    // Minute 2 (timers are now null): periodic 1-minute local refresh still advances chart & snapshot
    now += 61_000;
    await new Promise((r) => setTimeout(r, 35));
    await flush();
    const desc2 = readChartDesc();
    expect(desc2).not.toBe(desc1);

    // Minute 3: advances again and open chart ? tip remains open throughout
    now += 61_000;
    await new Promise((r) => setTimeout(r, 35));
    await flush();
    const desc3 = readChartDesc();
    expect(desc3).not.toBe(desc2);
    expect(q(dash.el, 'help-tip-panel-staking-chart')!.hidden).toBe(false);
    dash.dispose();
  });

  it('preserves open ? tips inside StakingSection (income simulator, ecosystem) when amount changes', async () => {
    const root = document.createElement('div');
    const page = new MePage(root, {
      search: '?host=local',
      hash: '#staking?amount=50',
      fetch: createLocalModeFetch(() => 1_700_000_000_000),
    });
    await page.load();
    await flush();

    const amountInput = q(root, 'staking-amount-input') as HTMLInputElement;
    for (const tipId of ['staking-income', 'staking-ecosystem']) {
      q(root, `help-tip-btn-${tipId}`)!.click();
      expect(q(root, `help-tip-panel-${tipId}`)!.hidden).toBe(false);

      amountInput.value = tipId === 'staking-income' ? '200' : '100';
      amountInput.dispatchEvent(new Event('input', { bubbles: true }));

      const panelAfter = q(root, `help-tip-panel-${tipId}`)!;
      const btnAfter = q(root, `help-tip-btn-${tipId}`)!;
      expect(panelAfter.hidden, `tip ${tipId} snapped shut on amount update`).toBe(false);
      expect(btnAfter.getAttribute('aria-expanded')).toBe('true');
    }
  });
});

describe('/me local mode regressions: storage isolation, offline NEAR wallet tiles, per-persona ledgers & live TVL', () => {
  it('isolates local-mode-token from server localStorage and refreshes expired server JWTs cleanly', async () => {
    const validServerJwt = `eyJhbGciOiJIUzI1NiJ9.${btoa(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 3600 }))}.sig`;
    window.localStorage.setItem(
      'ta_active_pilot',
      JSON.stringify({ playerId: 'pr_real', accessToken: validServerJwt, isGuest: false, handle: 'Server Pilot' }),
    );
    window.localStorage.setItem('ta_trade_token', validServerJwt);

    const root = document.createElement('div');
    document.body.appendChild(root);
    const localFetch = createLocalModeFetch(() => 1_700_000_000_000);
    const page = new MePage(root, { search: '?host=local', fetch: localFetch });
    await page.load();
    await flush();

    // Signing out and signing back in on ?host=local never wipes or overwrites server-mode tokens
    q(root, 'pilot-sign-out')!.click();
    await flush();
    await flush();
    expect(JSON.parse(window.localStorage.getItem('ta_active_pilot')!).accessToken).toBe(validServerJwt);
    expect(window.localStorage.getItem('ta_trade_token')).toBe(validServerJwt);

    const promptAuth = q(root, 'me-auth-prompt')!;
    q(promptAuth, 'pilot-sign-in')!.click();
    (q(promptAuth, 'local-mock-player-input') as HTMLInputElement).value = 'Offline Pilot';
    q(promptAuth, 'local-mock-player-submit')!.click();
    await flush();
    await flush();
    expect(JSON.parse(window.localStorage.getItem('ta_active_pilot')!).accessToken).toBe(validServerJwt);

    // Expired JWT or stray local-mode-token in localStorage is ignored on server mode and refreshed via /v1/auth/refresh
    const expiredJwt = `eyJhbGciOiJIUzI1NiJ9.${btoa(JSON.stringify({ exp: 100 }))}.sig`;
    window.localStorage.setItem(
      'ta_active_pilot',
      JSON.stringify({ playerId: 'pr_real', accessToken: expiredJwt, isGuest: false, handle: 'Server Pilot' }),
    );
    expect(resolveMeBearerToken('')).toBe('');

    const freshJwt = `eyJhbGciOiJIUzI1NiJ9.${btoa(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 7200 }))}.sig`;
    let seenRenameBearer = '';
    const serverFetch = async (url: string, init?: RequestInit) => {
      if (url.includes('/v1/auth/refresh')) {
        return { ok: true, status: 200, json: async () => ({ accessToken: freshJwt }) };
      }
      if (url.includes('/v1/me/profile/handle')) {
        seenRenameBearer = (init?.headers as Record<string, string> | undefined)?.Authorization ?? '';
        return { ok: true, status: 200, json: async () => ({ handle: 'Refreshed Pilot' }) };
      }
      return {
        ok: true,
        status: 200,
        json: async () => (url.includes('/profile') ? makeW12ProfileFixture() : makeW12AchievementsFixture()),
      };
    };
    const loaded = await fetchMeData(serverFetch, '');
    expect(loaded.kind).toBe('ok');
    expect(resolveMeBearerToken('')).toBe(freshJwt);
    const renamed = await saveMePilotHandle('Refreshed Pilot', serverFetch, '');
    expect(renamed).toEqual({ ok: true, handle: 'Refreshed Pilot' });
    expect(seenRenameBearer).toBe(`Bearer ${freshJwt}`);
  });

  it('signs in offline via NEAR Wallet modal tiles (Meteor / CLI) with zero live network fetches', async () => {
    const networkFetch = vi.fn(async () => {
      throw new Error('Unexpected live network fetch in ?host=local');
    });
    vi.stubGlobal('fetch', networkFetch);
    const localFetch = createLocalModeFetch(() => 1_700_000_000_000);
    await localFetch('/v1/auth/logout', { method: 'POST' });

    const root = document.createElement('div');
    document.body.appendChild(root);
    const page = new MePage(root, { search: '?host=local', hash: '#staking?amount=500&tier=3', fetch: localFetch });
    await page.load();
    await flush();

    q(root, 'staking-connect-cta')!.click();
    const providerDialog = root.querySelector<HTMLDialogElement>('[data-testid="pilot-provider-dialog"]')!;
    q(providerDialog, 'continue-near')!.click();

    const nearModal = document.querySelector<HTMLDialogElement>('[data-testid="near-wallet-modal"]')!;
    expect(nearModal).not.toBeNull();
    q(nearModal, 'near-mode-signup')!.click();
    expect(networkFetch).not.toHaveBeenCalled();

    q(nearModal, 'near-wallet-meteor')!.click();
    await flush();
    await flush();
    expect(networkFetch).not.toHaveBeenCalled();
    expect(q(root, 'me-pilot-handle')!.textContent).toBe('Meteor Wallet');
    expect(q(root, 'staking-dashboard')!.dataset.account).toBe('meteor-wallet.terraagent.mock');
  });
});

describe('/me local mode regressions: per-persona ledgers, tricky email handles & live Ecosystem TVL', () => {
  it('partitions simulated balances per persona, sanitizes tricky email handles, and syncs live Ecosystem TVL', async () => {
    const localFetch = createLocalModeFetch(() => 1_700_000_000_000);
    const root = document.createElement('div');
    document.body.appendChild(root);
    const page = new MePage(root, { search: '?host=local', hash: '#staking?amount=500', fetch: localFetch });
    await page.load();
    await flush();

    // Local Commander stakes 500 NEAR -> Ecosystem TVL updates live from 125,000 to 125,500 NEAR
    expect(q(root, 'staking-ecosystem-total')!.textContent).toBe('125,000 NEAR');
    (q(root, 'staking-console-amount') as HTMLInputElement).value = '500';
    q(root, 'staking-console-stake')!.click();
    await flush();
    await flush();
    expect(q(root, 'staking-kpi-total')!.textContent).toContain('500.00 NEAR');
    expect(q(root, 'staking-ecosystem-total')!.textContent).toBe('125,500 NEAR');

    // Sign out and sign in with tricky 1-char / plus-tagged email -> clean fresh ledger (0 staked)
    q(root, 'pilot-sign-out')!.click();
    await flush();
    await flush();
    q(root, 'staking-connect-cta')!.click();
    const dlg1 = root.querySelector<HTMLDialogElement>('[data-testid="pilot-provider-dialog"]')!;
    (q(dlg1, 'pilot-email-input') as HTMLInputElement).value = 'a+tag@terraagent.fun';
    q(dlg1, 'continue-email')!.click();
    await flush();
    await flush();
    expect(q(root, 'me-pilot-handle')!.textContent).toBe('a-tag');
    expect(q(root, 'staking-kpi-total')!.textContent).toContain('0.00 NEAR');

    // Sign back in as Local Commander -> 500 NEAR stake is restored intact
    q(root, 'pilot-sign-out')!.click();
    await flush();
    await flush();
    q(root, 'staking-connect-cta')!.click();
    const dlg2 = root.querySelector<HTMLDialogElement>('[data-testid="pilot-provider-dialog"]')!;
    (q(dlg2, 'local-mock-player-input') as HTMLInputElement).value = 'Local Commander';
    q(dlg2, 'local-mock-player-submit')!.click();
    await flush();
    await flush();
    expect(q(root, 'staking-kpi-total')!.textContent).toContain('500.00 NEAR');

    // Boundary handles (2-char min, 32-char max, punctuation-heavy) + slug fallback
    expect(toMockAccountId('a-------------------------------')).toBe('pilot.terraagent.mock');
    for (const boundary of ['Al', 'A_._._B', 'Commander_Nova-Prime.Sector-0032']) {
      q(root, 'me-pilot-rename')!.click();
      const input = q(root, 'me-pilot-rename-input') as HTMLInputElement;
      input.value = boundary;
      q(root, 'me-pilot-rename-save')!.click();
      await flush();
      expect(q(root, 'me-pilot-handle')!.textContent).toBe(boundary);
    }
  });

  it('transitions #staking?amount=500&tier=3 -> #pilot -> email sign-in -> #staking without stale unauthMessage', async () => {
    const localFetch = createLocalModeFetch(() => 1_700_000_000_000);
    await localFetch('/v1/auth/logout', { method: 'POST' });
    window.history.replaceState(null, '', '/me.html?host=local#staking?amount=500&tier=3');

    const root = document.createElement('div');
    document.body.appendChild(root);
    const page = new MePage(root, { search: '?host=local', fetch: localFetch });
    await page.load();
    await flush();

    expect(q(root, 'staking-connect-cta')!.textContent).toContain('Stake 500 NEAR');

    // Switch hash to #pilot -> renders auth prompt; switch back to #staking?amount=500&tier=3 -> renders preview
    window.history.replaceState(null, '', '/me.html?host=local#pilot');
    window.dispatchEvent(new HashChangeEvent('hashchange'));
    expect(q(root, 'me-auth-prompt')).not.toBeNull();

    // Sign in via email from #pilot prompt while restoring #staking?amount=500&tier=3 hash
    window.history.replaceState(null, '', '/me.html?host=local#staking?amount=500&tier=3');
    const promptAuth = q(root, 'me-auth-prompt')!;
    q(promptAuth, 'pilot-sign-in')!.click();
    (q(promptAuth, 'pilot-email-input') as HTMLInputElement).value = 'orion@terraagent.fun';
    q(promptAuth, 'continue-email')!.click();
    await flush();
    await flush();

    expect(q(root, 'me-auth-prompt')).toBeNull();
    expect(q(root, 'me-pilot-handle')!.textContent).toBe('orion');
    expect(q(root, 'staking-dashboard')!.dataset.account).toBe('orion.terraagent.mock');
    expect((q(root, 'staking-console-amount') as HTMLInputElement).value).toBe('500');
  });
});
