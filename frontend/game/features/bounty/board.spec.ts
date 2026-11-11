// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadFeatures } from '../../core/registry';
import type { FeatureContext } from '../../core/registry/types';
import { BountyBoard } from './BountyBoard';
import { mountBountySheet } from './bountyDom';
import { BOUNTY_PHONE, bountyPanelBounds } from './bountyLayout';
import { bountyView, type BountyView } from './bountyModel';

const payload = {
  bounties: [
    {
      id: 'b-open',
      state: 'open',
      target: { kind: 'clear_nest', nestId: 'n-3' },
      reward: { resource: 'metals.t1', amount: 200 },
      escrowTx: '',
    },
    {
      id: 'b-claimed',
      state: 'claimed',
      target: { kind: 'defend_area', q: 1, r: 2, radius: 2, durationH: 2 },
      reward: { resource: 'metals.t1', amount: 50 },
      escrowTx: 'tx_claim',
    },
    {
      id: 'b-done',
      state: 'completed',
      target: { kind: 'clear_nest', nestId: 'n-1' },
      reward: { resource: 'minerals.t1', amount: 10 },
      escrowTx: '',
    },
    {
      id: 'b-paid',
      state: 'paid',
      target: { kind: 'clear_nest', nestId: 'n-9' },
      reward: { resource: 'metals.t1', amount: 200 },
      escrowTx: 'tx_paid',
    },
    {
      id: 'b-expired',
      state: 'expired',
      target: { kind: 'deliver_units', resource: 'bio.water', amount: 100 },
      reward: { resource: 'bio.water', amount: 20 },
      escrowTx: '',
    },
  ],
};

function paint(view: BountyView): HTMLElement {
  const host = document.createElement('div');
  const dom = mountBountySheet(host, { close() {}, post() {}, claim() {} });
  dom.root.hidden = false;
  dom.paint(view);
  return host;
}

function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe('bounty board', () => {
  it('positive: a paid row renders the text Paid', async () => {
    const view = bountyView({ w22: true, payload });
    expect(view.menuItem).toEqual({ id: 'bounties', label: 'Bounties' });
    expect(view.sections.open.map((row) => row.state)).toEqual(['Open']);
    expect(view.sections.claimed.map((row) => row.state)).toEqual(['Claimed']);
    expect(view.sections.completed.map((row) => row.state)).toEqual(['Completed', 'Paid']);
    expect(view.sections.expired.map((row) => row.state)).toEqual(['Expired']);
    const host = paint(view);
    expect(host.querySelector('[data-testid="bounty-state-b-paid"]')?.textContent).toBe('Paid');
    expect(host.querySelector('[data-testid="bounty-receipt-b-paid"]')?.getAttribute('href')).toBe(
      '/dev/chain/tx/tx_paid',
    );
    expect(host.querySelector('[data-testid="bounty-claim-b-open"]')?.textContent).toBe('Claim');
    expect(host.querySelector('[data-testid="bounty-claim-b-paid"]')).toBeNull();
    expect(host.querySelector('[data-testid="bounty-target"]')).not.toBeNull();
    expect(host.querySelector('[data-testid="bounty-reward"]')).not.toBeNull();
    expect(host.querySelector('[data-testid="bounty-expiry"]')).not.toBeNull();
    const progressed = bountyView({
      w22: true,
      payload: {
        bounties: [
          {
            id: 'del',
            state: 'claimed',
            target: { kind: 'deliver_units', resource: 'bio.water', amount: 100 },
            reward: { resource: 'metals.t1', amount: 1 },
            delivered: 40,
            deliverTarget: 100,
          },
        ],
      },
    });
    expect(progressed.sections.claimed[0].progress).toBe('deliver 40/100');
    expect(progressed.sections.claimed[0].state).toBe('Claimed');

    const calls: string[] = [];
    let claimBody = '';
    let postBody = '';
    const fetchImpl = async (url: string, init?: RequestInit) => {
      calls.push(`${init?.method ?? 'GET'} ${url}`);
      if (String(url).includes('/claim')) claimBody = String(init?.body ?? '');
      if ((init?.method ?? 'GET') === 'POST' && !String(url).includes('/claim')) postBody = String(init?.body ?? '');
      return { ok: true, status: 200, json: async () => payload } as Response;
    };
    const registered: { id: string; label: string }[] = [];
    const panelHost = document.createElement('div');
    document.body.appendChild(panelHost);
    const ctx: FeatureContext = {
      flags: new Set(['W22']),
      host: 'server',
      services: {
        track: () => undefined,
        session: { planetId: () => 'pl_dune', colonyId: () => 'co_a' },
        registerPlanetMenuItem: (item) => {
          registered.push(item);
          return () => undefined;
        },
      },
    };
    const panel = new BountyBoard(panelHost, panelHost, ctx, { fetchImpl });
    expect(registered.map((item) => item.label)).toEqual(['Bounties']);
    await panel.open();
    expect(panelHost.querySelector('[data-testid="bounty-state-b-paid"]')?.textContent).toBe('Paid');
    panelHost.querySelector<HTMLButtonElement>('[data-testid="bounty-claim-b-open"]')?.click();
    const nest = panelHost.querySelector<HTMLInputElement>('[data-testid="bounty-nest"]');
    if (nest) nest.value = 'n-3';
    panelHost.querySelector('form')?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await flush();
    expect(calls.some((line) => line.startsWith('POST ') && line.endsWith('/b-open/claim'))).toBe(true);
    expect(claimBody).toContain('co_a');
    expect(JSON.parse(postBody).target).toMatchObject({ kind: 'clear_nest', nestId: 'n-3' });
    expect(JSON.parse(postBody).reward).toEqual({ resource: 'metals.t1', amount: 200 });
    expect(JSON.parse(postBody).expiresAt).toBeGreaterThan(Date.now());
    const on = loadFeatures({ flags: new Set(['W22']), host: 'server' });
    expect(on.flatMap((f) => f.menus ?? []).some((m) => m.id === 'bounties' && m.label === 'Bounties')).toBe(true);
    panel.dispose();
  });
});

describe('bounty board wave off', () => {
  it('negative: W22 off yields no menu item', () => {
    const view = bountyView({ w22: false, payload });
    expect(view.menuItem).toBeNull();
    expect(view.sections.open).toEqual([]);
    expect(view.sections.completed).toEqual([]);
    const features = loadFeatures({ flags: new Set(['W00', 'W21']), host: 'server' });
    expect(features.some((f) => f.id === 'bounty')).toBe(false);
    expect(features.flatMap((f) => f.menus ?? []).some((m) => m.id === 'bounties' || m.label === 'Bounties')).toBe(
      false,
    );
    const registered: string[] = [];
    const host = document.createElement('div');
    const ctx: FeatureContext = {
      flags: new Set(['W00']),
      host: 'server',
      services: {
        track: () => undefined,
        registerPlanetMenuItem: (item) => {
          registered.push(item.id);
          return () => undefined;
        },
      },
    };
    const panel = new BountyBoard(host, host, ctx);
    expect(registered).toEqual([]);
    expect(host.querySelector('[data-testid="planet-menu-bounties"]')).toBeNull();
    panel.dispose();
  });
});

describe('bounty board edges', () => {
  it('corner: empty list renders an empty state and invalid_target is shown as text', async () => {
    const view = bountyView({ w22: true, payload: { bounties: [] }, errorCode: 'invalid_target' });
    expect(view.empty).toBe(true);
    expect(view.error).toBe('invalid_target');
    const host = paint(view);
    expect(host.querySelector('[data-testid="bounty-empty"]')?.textContent).toBe('No bounties');
    expect(host.querySelector('[data-testid="bounty-error"]')?.textContent).toBe('invalid_target');
    expect(host.querySelector('[data-testid="bounty-state-b-paid"]')).toBeNull();
    expect((host.querySelector('[data-testid="bounty-section-open"]') as HTMLElement).hidden).toBe(true);

    const panelHost = document.createElement('div');
    document.body.appendChild(panelHost);
    const ctx: FeatureContext = {
      flags: new Set(['W22']),
      host: 'server',
      services: { track: () => undefined, session: { planetId: () => 'pl_dune' } },
    };
    const fetchImpl = async () =>
      ({
        ok: false,
        status: 400,
        json: async () => ({ errorCode: 'invalid_target', error: { code: 'invalid_target', message: 'unseen nest' } }),
      }) as Response;
    const panel = new BountyBoard(panelHost, panelHost, ctx, { fetchImpl });
    await expect(panel.open()).resolves.toBeUndefined();
    expect(panelHost.querySelector('[data-testid="bounty-error"]')?.textContent).toBe('invalid_target');
    expect(panelHost.querySelector('[data-testid="bounty-empty"]')?.textContent).toBe('No bounties');
    panel.dispose();
  });

  it('fits a 740×360 phone landscape by scrolling inside the gutter', () => {
    const box = bountyPanelBounds(BOUNTY_PHONE.width, BOUNTY_PHONE.height);
    expect(box.maxWidth).toBeLessThanOrEqual(BOUNTY_PHONE.width);
    expect(box.maxHeight).toBeLessThanOrEqual(BOUNTY_PHONE.height);
    expect(box.scroll).toBe(true);
    const css = readFileSync(join(import.meta.dirname, 'bounty.css'), 'utf8');
    expect(css).toContain('overflow: auto');
    expect(css).toContain('min(420px, calc(100vw - 16px))');
    expect(css).toContain('min(320px, calc(100vh - 16px))');
    expect(css).not.toContain('border-radius');
  });
});
