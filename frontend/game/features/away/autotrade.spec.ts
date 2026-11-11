// @vitest-environment jsdom
import type { DirectorKeyStatusPayload } from '@terra/contracts';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { FeatureContext } from '../../core/registry/types';
import type { CommandResult } from '../../net/commandBus';
import { AwayPanel, type AwayPanelOptions } from './AwayPanel';
import awayFeature from './index';
import { AUTOTRADE_STORAGE_KEY } from './storage';

type Send = (kind: string, args?: unknown) => Promise<CommandResult>;

const METALS = {
  maxPerTrade: 300,
  maxPerSession: 600,
  minStock: 200,
  partners: 'guild',
  sellAboveStoragePct: 80,
};

function fakeSend(result: CommandResult = { ok: true, appliedAtTick: 1 }): Send {
  return vi.fn(async () => result);
}

function keyPayload(spent: string, state: DirectorKeyStatusPayload['state'] = 'active'): DirectorKeyStatusPayload {
  return {
    colonyId: 'co_demo',
    state,
    tokens:
      state === 'active'
        ? [{ token: 'metals.t1', allowance: '600', reserved: '0', spent, available: String(600 - Number(spent)) }]
        : [],
  };
}

function json(body: unknown, ok = true, status = 200) {
  return { ok, status, json: async () => body };
}

function tradePanel(send: Send, extra: Partial<AwayPanelOptions> = {}): { host: HTMLElement; panel: AwayPanel } {
  const host = document.createElement('div');
  const panel = new AwayPanel(host, {
    sendCommand: send,
    flags: new Set(['W09', 'W15']),
    colonyId: () => 'co_demo',
    accessToken: () => 'dev:w15',
    ...extra,
  });
  return { host, panel };
}

function field(host: HTMLElement, id: string): HTMLInputElement {
  const el = host.querySelector<HTMLInputElement>(`[data-testid="${id}"]`);
  if (!el) throw new Error(`missing ${id}`);
  return el;
}

function click(host: HTMLElement, id: string): void {
  host.querySelector<HTMLButtonElement>(`[data-testid="${id}"]`)!.click();
}

beforeEach(() => {
  localStorage.clear();
});

describe('away autoTrade', () => {
  it('renders demo limits, saves metals.t1, and shows Allowance 600 · spent 0', async () => {
    const send = fakeSend({ ok: true, appliedAtTick: 4 });
    const seen: { method?: string; authorization?: string; body?: string }[] = [];
    const fetchImpl = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      const headers = init?.headers as Record<string, string> | undefined;
      seen.push({ method: init?.method, authorization: headers?.authorization, body: init?.body as string });
      return json(keyPayload('0'));
    });
    const { host, panel } = tradePanel(send, { fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(field(host, 'away-autotrade-resource').value).toBe('metals.t1');
    expect([...field(host, 'away-autotrade-resource').querySelectorAll('option')].map((o) => o.value)).toEqual([
      'metals.t1',
      'minerals.t1',
      'bio.water',
      'bio.biomass',
    ]);
    expect([...field(host, 'away-autotrade-partners').querySelectorAll('option')].map((o) => o.value)).toEqual([
      'guild',
      'anyone',
    ]);
    expect(field(host, 'away-autotrade-sell').value).toBe('80');
    expect(field(host, 'away-autotrade-max-trade').value).toBe('300');
    expect(field(host, 'away-autotrade-max-session').value).toBe('600');
    expect(field(host, 'away-autotrade-min-stock').value).toBe('200');
    click(host, 'away-autotrade-save');
    await vi.waitFor(() =>
      expect(host.querySelector('[data-testid="away-autotrade-status"]')?.textContent).toBe('saved'),
    );
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith('setAutoTrade', { limits: { 'metals.t1': METALS } });
    expect(JSON.parse(localStorage.getItem(AUTOTRADE_STORAGE_KEY) ?? 'null')).toEqual({
      resource: 'metals.t1',
      limits: { 'metals.t1': METALS },
    });
    click(host, 'away-director-toggle');
    await vi.waitFor(() =>
      expect(host.querySelector('[data-testid="away-director-status"]')?.textContent).toBe('Allowance 600 · spent 0'),
    );
    expect(seen).toEqual([
      {
        method: 'POST',
        authorization: 'Bearer dev:w15',
        body: JSON.stringify({ colonyId: 'co_demo', limits: { 'metals.t1': METALS } }),
      },
    ]);
    panel.dispose();
  });
});

describe('away autoTrade guards', () => {
  it('renders no autoTrade section when W15 is off', () => {
    const host = document.createElement('div');
    const panel = new AwayPanel(host, { sendCommand: fakeSend(), flags: new Set(['W09']) });
    expect(host.querySelector('[data-testid="away-autotrade"]')).toBeNull();
    expect(host.textContent).not.toMatch(/t2|t3|AUTOTRADE/);
    panel.dispose();
    const mounted = document.createElement('div');
    const ctx = {
      flags: new Set(['W09']),
      host: 'server',
      services: { track: () => {}, sendCommand: fakeSend() },
    } as FeatureContext;
    const live = awayFeature.hud?.[0]?.mount(mounted, ctx);
    expect(mounted.querySelector('[data-testid="away-autotrade"]')).toBeNull();
    live?.dispose();
  });

  it('does not send setAutoTrade when the sell percent is 101', async () => {
    const send = fakeSend();
    const fetchImpl = vi.fn();
    const { host } = tradePanel(send, { fetchImpl: fetchImpl as unknown as typeof fetch });
    field(host, 'away-autotrade-sell').value = '101';
    click(host, 'away-autotrade-save');
    await Promise.resolve();
    expect(send).not.toHaveBeenCalled();
    expect(localStorage.getItem(AUTOTRADE_STORAGE_KEY)).toBeNull();
    expect(host.querySelector('[data-testid="away-autotrade-status"]')?.textContent).toMatch(/rejected/i);
    click(host, 'away-director-toggle');
    await Promise.resolve();
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(host.querySelector('[data-testid="away-director-status"]')?.textContent ?? '').not.toContain('Allowance');
  });
});

describe('away autoTrade director key', () => {
  it('shows Allowance 600 · spent 600, then Revoked, and a reload reads the stored limits', async () => {
    const send = fakeSend({ ok: true, appliedAtTick: 2 });
    const answers = [keyPayload('600'), keyPayload('600', 'revoked')];
    const fetchImpl = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) =>
      json(answers.shift(), true, init?.method === 'DELETE' ? 200 : 200),
    );
    const { host, panel } = tradePanel(send, { fetchImpl: fetchImpl as unknown as typeof fetch });
    field(host, 'away-autotrade-max-trade').value = '300';
    field(host, 'away-autotrade-min-stock').value = '250';
    click(host, 'away-autotrade-save');
    await vi.waitFor(() =>
      expect(host.querySelector('[data-testid="away-autotrade-status"]')?.textContent).toBe('saved'),
    );
    expect(send).toHaveBeenCalledWith('setAutoTrade', {
      limits: { 'metals.t1': { ...METALS, minStock: 250 } },
    });
    click(host, 'away-director-toggle');
    await vi.waitFor(() =>
      expect(host.querySelector('[data-testid="away-director-status"]')?.textContent).toBe('Allowance 600 · spent 600'),
    );
    const revoke = host.querySelector<HTMLButtonElement>('[data-testid="away-director-revoke"]')!;
    expect(revoke.hidden).toBe(false);
    revoke.click();
    await vi.waitFor(() =>
      expect(host.querySelector('[data-testid="away-director-status"]')?.textContent).toBe('Revoked'),
    );
    expect(revoke.hidden || revoke.disabled).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect((fetchImpl.mock.calls[1]?.[1] as RequestInit | undefined)?.method).toBe('DELETE');
    panel.dispose();
    const again = tradePanel(fakeSend());
    expect(JSON.parse(localStorage.getItem(AUTOTRADE_STORAGE_KEY) ?? 'null')).toMatchObject({
      limits: { 'metals.t1': { maxPerTrade: 300, maxPerSession: 600, minStock: 250, sellAboveStoragePct: 80 } },
    });
    expect(field(again.host, 'away-autotrade-resource').value).toBe('metals.t1');
    expect(field(again.host, 'away-autotrade-sell').value).toBe('80');
    expect(field(again.host, 'away-autotrade-max-trade').value).toBe('300');
    expect(field(again.host, 'away-autotrade-max-session').value).toBe('600');
    expect(field(again.host, 'away-autotrade-min-stock').value).toBe('250');
    expect(field(again.host, 'away-autotrade-partners').value).toBe('guild');
    again.panel.dispose();
  });
});

describe('away autoTrade push', () => {
  it('paints a director.status push for the selected resource and ignores another colony', () => {
    let push: ((payload: DirectorKeyStatusPayload) => void) | undefined;
    const { host, panel } = tradePanel(fakeSend(), {
      subscribeDirector: (fn) => {
        push = fn;
        return () => {
          push = undefined;
        };
      },
    });
    push?.(keyPayload('600'));
    expect(host.querySelector('[data-testid="away-director-status"]')?.textContent).toBe('Allowance 600 · spent 600');
    expect(host.querySelector<HTMLButtonElement>('[data-testid="away-director-revoke"]')?.hidden).toBe(false);
    push?.({ ...keyPayload('1'), colonyId: 'co_other' });
    expect(host.querySelector('[data-testid="away-director-status"]')?.textContent).toBe('Allowance 600 · spent 600');
    panel.dispose();
  });

  it('offers truce only when W18 is on, and does not persist a rejected save', async () => {
    const open = tradePanel(fakeSend(), { flags: new Set(['W09', 'W15', 'W18']) });
    expect([...field(open.host, 'away-autotrade-partners').querySelectorAll('option')].map((o) => o.value)).toEqual([
      'guild',
      'truce',
      'anyone',
    ]);
    open.panel.dispose();
    const send = fakeSend({ ok: false, code: 'invalid_args', detail: 'truce partners are unavailable' });
    const { host } = tradePanel(send);
    click(host, 'away-autotrade-save');
    await vi.waitFor(() =>
      expect(host.querySelector('[data-testid="away-autotrade-status"]')?.textContent).toContain('invalid_args'),
    );
    expect(localStorage.getItem(AUTOTRADE_STORAGE_KEY)).toBeNull();
    expect(host.querySelector('[data-testid="away-director-status"]')?.textContent ?? '').not.toContain('Allowance');
  });
});
