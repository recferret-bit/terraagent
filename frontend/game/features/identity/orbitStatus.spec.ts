// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FeatureContext } from '../../core/registry/types';
import { PilotBridge } from '../../app/online/pilotBridge';
import type { FetchLike } from '../../app/online/bootOnline';
import identity from './index';

const PLAYER = 'pr_01ARZ3NDEKTSV4RRFFQ69G5FAV';
const PILOT = 'test-pilot.terraagent.mock';

const socialBody = {
  accessToken: 'jwt-linked',
  expiresIn: 900,
  player: { id: PLAYER, handle: 'Test Pilot', isGuest: false },
  accountId: PILOT,
};

interface SeenCall {
  url: string;
  method: string;
  authorization?: string;
  credentials?: RequestCredentials;
}

function json(body: unknown) {
  return { ok: true, status: 200, json: async () => body };
}

function scriptedFetch(relay: unknown[], seen: SeenCall[]): FetchLike {
  return async (url, init) => {
    const headers = init?.headers as Record<string, string> | undefined;
    seen.push({
      url,
      method: init?.method ?? 'GET',
      authorization: headers?.Authorization,
      credentials: init?.credentials,
    });
    if (url === '/v1/auth/social') return json(socialBody);
    if (url === '/v1/near/relay/retry') return json({ state: 'pending' });
    if (url === '/v1/near/relay') return json(relay.shift());
    return { ok: false, status: 404, json: async () => ({}) };
  };
}

function mount(relay: unknown[]) {
  document.body.replaceChildren();
  const seen: SeenCall[] = [];
  const el = document.createElement('div');
  document.body.appendChild(el);
  const pilot = new PilotBridge({ fetch: scriptedFetch(relay, seen), target: () => null });
  const ctx = { flags: new Set(['W06']), host: 'server', services: { pilot } } as unknown as FeatureContext;
  const panel = identity.hud![0]!.mount(el, ctx);
  return { el, panel, pilot, seen };
}

afterEach(() => { document.body.replaceChildren(); vi.restoreAllMocks(); });

/** The poll chain is a few microtasks behind `loginSocial` resolving. */
async function flush(): Promise<void> {
  for (let i = 0; i < 8; i += 1) await Promise.resolve();
}

describe('orbit save chip (W06-20)', () => {
  it('shows Saving to orbit… while the poll is pending, then removes it when settled', async () => {
    const { el, panel, pilot, seen } = mount([{ state: 'pending' }, { state: 'settled' }]);
    try {
      expect(el.querySelector('[data-testid="orbit-save"]')).toBeNull();
      await pilot.loginSocial('google', 'tok');
      await flush();
      expect(el.querySelector('[data-testid="pilot-id"]')!.textContent).toBe(`Pilot ID ${PILOT}`);
      expect(el.querySelector('[data-testid="orbit-save"]')?.textContent).toBe('Saving to orbit…');
      expect(seen.filter((call) => call.url === '/v1/near/relay')).toEqual([
        { url: '/v1/near/relay', method: 'GET', authorization: 'Bearer jwt-linked', credentials: 'include' },
      ]);

      await vi.waitFor(() => expect(el.querySelector('[data-testid="orbit-save"]')).toBeNull(), { timeout: 2000 });
      expect(el.querySelector('[data-testid="orbit-toast"]')).toBeNull();
      expect(el.querySelector('[data-testid="pilot-copy"]')!.textContent).toBe('Copy');
    } finally {
      panel.dispose();
    }
  });

  it('shows the retry toast on failure, and Retry posts then clears on the settled poll', async () => {
    const { el, panel, pilot, seen } = mount([{ state: 'failed', opId: 'storage-deposit:co.pilot' }, { state: 'settled' }]);
    try {
      await pilot.loginSocial('x', 'tok');
      await flush();
      const toast = el.querySelector('[data-testid="orbit-toast"]');
      expect(toast?.textContent).toContain("Couldn't save to orbit, retrying");
      expect(el.querySelector('[data-testid="orbit-save"]')).toBeNull();
      const retry = el.querySelector('[data-testid="orbit-retry"]') as HTMLButtonElement;
      expect(retry.textContent).toBe('Retry');

      retry.click();
      await vi.waitFor(() => {
        expect(el.querySelector('[data-testid="orbit-toast"]')).toBeNull();
        expect(el.querySelector('[data-testid="orbit-save"]')).toBeNull();
      });
      expect(seen.filter((call) => call.url === '/v1/near/relay/retry')).toEqual([
        { url: '/v1/near/relay/retry', method: 'POST', authorization: 'Bearer jwt-linked', credentials: 'include' },
      ]);
      expect(seen.filter((call) => call.url === '/v1/near/relay').map((call) => call.method)).toEqual(['GET', 'GET']);
    } finally {
      panel.dispose();
    }
  });
});
