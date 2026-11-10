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

function mercPanel(send: Send): { host: HTMLElement; panel: AwayPanel } {
  const host = document.createElement('div');
  return { host, panel: new AwayPanel(host, { sendCommand: send, mercenary: true }) };
}

function hireBox(host: HTMLElement): HTMLInputElement {
  const el = host.querySelector<HTMLInputElement>('[data-testid="away-mercenaries"]');
  if (!el) throw new Error('missing mercenary switch');
  return el;
}

function maxBox(host: HTMLElement): HTMLInputElement {
  const el = host.querySelector<HTMLInputElement>('[data-testid="away-mercenary-max"]');
  if (!el) throw new Error('missing max spend');
  return el;
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

describe('away mercenary hire switch', () => {
  it('sends hireMercenaries and max 100, then a new panel shows them', async () => {
    const send = fakeSend({ ok: true, appliedAtTick: 5 });
    const { host } = mercPanel(send);
    expect(host.textContent).toContain('Hire mercenaries when attacked while away');
    hireBox(host).checked = true;
    maxBox(host).value = '100';
    save(host);
    await vi.waitFor(() => expect(host.querySelector('[data-testid="away-status"]')?.textContent).toBe('saved'));
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith('setAutopilot', { hireMercenaries: true, mercenaryMaxSpend: 100 });
    expect(JSON.parse(localStorage.getItem(AWAY_STORAGE_KEY) ?? '{}')).toMatchObject({
      hireMercenaries: true,
      mercenaryMaxSpend: 100,
    });
    const again = mercPanel(fakeSend());
    expect(hireBox(again.host).checked).toBe(true);
    expect(maxBox(again.host).value).toBe('100');
    again.panel.dispose();

    const shown = document.createElement('div');
    const live = awayFeature.hud?.[0]?.mount(shown, ctx(fakeSend(), ['W09', 'W22']));
    expect(shown.querySelector('[data-testid="away-mercenaries"]')).not.toBeNull();
    expect(shown.textContent).toContain('Hire mercenaries when attacked while away');
    live?.dispose();
  });

  it('hides the hire switch when W22 is off and does not send hireMercenaries', async () => {
    localStorage.setItem(AWAY_STORAGE_KEY, JSON.stringify({
      mode: 'director',
      awayRaids: false,
      hireMercenaries: true,
      mercenaryMaxSpend: 100,
      session: { metals: 60, minerals: 60, bio: 60 },
    }));
    const send = fakeSend({ ok: true, appliedAtTick: 6 });
    const { host } = panel(send);
    expect(host.querySelector('[data-testid="away-mercenaries"]')).toBeNull();
    expect(host.textContent).not.toContain('Hire mercenaries');
    setPct(host, 'metals', 30);
    save(host);
    await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(1));
    expect(send).toHaveBeenCalledWith('setAutopilot', { awayBudget: { metals: { perSessionPct: 30 } } });

    const mounted = document.createElement('div');
    const live = awayFeature.hud?.[0]?.mount(mounted, ctx(fakeSend(), ['W09']));
    expect(mounted.querySelector('[data-testid="away-mercenaries"]')).toBeNull();
    live?.dispose();

    const hidden = document.createElement('div');
    const off = awayFeature.hud?.[0]?.mount(hidden, ctx(fakeSend(), ['W22']));
    expect(hidden.hidden).toBe(true);
    expect(hidden.querySelector('[data-testid="away-mercenaries"]')).toBeNull();
    off?.dispose();
  });

  it('stores a max of 50 and sends it', async () => {
    const send = fakeSend({ ok: true, appliedAtTick: 7 });
    const { host } = mercPanel(send);
    hireBox(host).checked = true;
    maxBox(host).value = '50';
    save(host);
    await vi.waitFor(() => expect(host.querySelector('[data-testid="away-status"]')?.textContent).toBe('saved'));
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith('setAutopilot', { hireMercenaries: true, mercenaryMaxSpend: 50 });
    expect(JSON.parse(localStorage.getItem(AWAY_STORAGE_KEY) ?? '{}')).toMatchObject({
      hireMercenaries: true,
      mercenaryMaxSpend: 50,
    });
    expect(maxBox(host).value).toBe('50');
  });

  it('does not send an empty or fractional max', async () => {
    const send = fakeSend();
    const { host } = mercPanel(send);
    hireBox(host).checked = true;
    maxBox(host).value = '';
    save(host);
    await Promise.resolve();
    expect(send).not.toHaveBeenCalled();
    expect(host.querySelector('[data-testid="away-status"]')?.textContent).toMatch(/whole number/i);
    expect(localStorage.getItem(AWAY_STORAGE_KEY)).toBeNull();
    expect(maxBox(host).value).toBe('0');

    maxBox(host).value = '50.5';
    save(host);
    await Promise.resolve();
    expect(send).not.toHaveBeenCalled();
    expect(host.textContent).not.toContain('50.5');

    maxBox(host).value = '1000001';
    save(host);
    await Promise.resolve();
    expect(send).not.toHaveBeenCalled();
    expect(maxBox(host).value).toBe('0');
  });
});
