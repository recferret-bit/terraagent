// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { FeatureContext } from '../../core/registry/types';
import type { CommandResult } from '../../net/commandBus';
import { AwayPanel } from './AwayPanel';
import awayFeature, { AWAY_STORAGE_KEY } from './index';

type Send = (kind: string, args?: unknown) => Promise<CommandResult>;

function fakeSend(result: CommandResult = { ok: true, appliedAtTick: 1 }): Send {
  return vi.fn(async (_kind: string, _args?: unknown) => result);
}

function ctx(sendCommand: Send, waves: readonly string[] = ['W09']): FeatureContext {
  return { flags: new Set(waves), host: 'server', services: { track: () => {}, sendCommand } };
}

function panel(send: Send): { host: HTMLElement; panel: AwayPanel } {
  const host = document.createElement('div');
  return { host, panel: new AwayPanel(host, { sendCommand: send }) };
}

function slider(host: HTMLElement, family: 'metals' | 'minerals' | 'bio'): HTMLInputElement {
  const el = host.querySelector<HTMLInputElement>(`[data-testid="away-session-${family}"]`);
  if (!el) throw new Error(`missing ${family} slider`);
  return el;
}

function setPct(host: HTMLElement, family: 'metals' | 'minerals' | 'bio', pct: number): void {
  const el = slider(host, family);
  el.max = '1000';
  el.value = String(pct);
  el.dispatchEvent(new Event('input'));
}

function save(host: HTMLElement): void {
  host.querySelector<HTMLButtonElement>('[data-testid="away-save"]')!.click();
}

beforeEach(() => {
  localStorage.clear();
});

describe('away settings panel', () => {
  it('sends setAutopilot with metals perSessionPct 30 and keeps it after the ack', async () => {
    const send = fakeSend({ ok: true, appliedAtTick: 4 });
    const { host, panel: view } = panel(send);
    setPct(host, 'metals', 30);
    save(host);
    await vi.waitFor(() => expect(host.querySelector('[data-testid="away-status"]')?.textContent).toBe('saved'));
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith('setAutopilot', { awayBudget: { metals: { perSessionPct: 30 } } });
    expect(slider(host, 'metals').value).toBe('30');
    expect(host.querySelector('[data-testid="away-session-metals-value"]')?.textContent).toBe('30%');
    expect(JSON.parse(localStorage.getItem(AWAY_STORAGE_KEY) ?? '{}')).toMatchObject({
      mode: 'director',
      awayRaids: false,
      session: { metals: 30 },
    });
    expect(host.querySelector('[data-testid="away-status"]')?.textContent).toBe('saved');
    view.dispose();
  });

  it('does not send 101', async () => {
    const send = fakeSend();
    const { host } = panel(send);
    setPct(host, 'metals', 101);
    save(host);
    await Promise.resolve();
    expect(send).not.toHaveBeenCalled();
    expect(localStorage.getItem(AWAY_STORAGE_KEY)).toBeNull();
    expect(host.querySelector('[data-testid="away-status"]')?.textContent).toMatch(/rejected/i);
    expect(host.textContent).not.toContain('101');
  });

  it('sends 0 and 100', async () => {
    const send = fakeSend({ ok: true, appliedAtTick: 2 });
    const { host } = panel(send);
    setPct(host, 'metals', 0);
    setPct(host, 'bio', 100);
    save(host);
    await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(1));
    expect(send).toHaveBeenCalledWith('setAutopilot', {
      awayBudget: { metals: { perSessionPct: 0 }, bio: { perSessionPct: 100 } },
    });
    expect(slider(host, 'metals').value).toBe('0');
    expect(slider(host, 'bio').value).toBe('100');
  });

  it('reads 30 from localStorage on a new panel', () => {
    localStorage.setItem(AWAY_STORAGE_KEY, JSON.stringify({
      mode: 'rules_only',
      awayRaids: false,
      session: { metals: 30, minerals: 60, bio: 60 },
    }));
    const { host } = panel(fakeSend());
    expect(slider(host, 'metals').value).toBe('30');
    expect(host.querySelector<HTMLSelectElement>('[data-testid="away-mode"]')?.value).toBe('rules_only');
    expect(host.querySelector<HTMLInputElement>('[data-testid="away-raids"]')?.checked).toBe(false);
    expect(host.querySelector('[data-testid="away-directive"]')?.textContent).toBe('directive 40%');
  });

  it('shows a reject and does not pretend the budget saved', async () => {
    const send = fakeSend({ ok: false, code: 'away_policy', detail: 'AW-20' });
    const { host } = panel(send);
    setPct(host, 'metals', 30);
    save(host);
    await vi.waitFor(() => expect(host.querySelector('[data-testid="away-status"]')?.textContent).toContain('away_policy'));
    expect(send).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem(AWAY_STORAGE_KEY)).toBeNull();
    expect(slider(host, 'metals').value).toBe('60');
    const status = host.querySelector<HTMLElement>('[data-testid="away-status"]');
    expect(status?.textContent).toContain('away_policy');
    expect(status?.textContent).toContain('AW-20');
    expect(status?.dataset.state).toBe('rejected');
  });

  it('hides the plate when W09 is off and wires the command bus when it is on', async () => {
    expect(awayFeature.id).toBe('away');
    expect(awayFeature.wave).toBe('W09');
    expect(awayFeature.hud?.[0]).toMatchObject({ id: 'away-settings', slot: 'top-left', order: 21 });
    const hidden = document.createElement('div');
    const off = awayFeature.hud?.[0]?.mount(hidden, ctx(fakeSend(), ['W00']));
    expect(hidden.hidden).toBe(true);
    expect(hidden.childElementCount).toBe(0);
    off?.dispose();

    const send = fakeSend({ ok: true, appliedAtTick: 3 });
    const shown = document.createElement('div');
    const live = awayFeature.hud?.[0]?.mount(shown, ctx(send));
    expect(shown.hidden).toBe(false);
    expect(shown.querySelector('[data-testid="away-toggle"]')?.textContent).toContain('AWAY');
    setPct(shown, 'metals', 30);
    save(shown);
    await vi.waitFor(() => expect(send).toHaveBeenCalledWith('setAutopilot', {
      awayBudget: { metals: { perSessionPct: 30 } },
    }));
    live?.dispose();
    expect(shown.childElementCount).toBe(0);
  });
});
