// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parseWaves, PRIORITY_KEYS } from '@terra/contracts';
import type { FeatureContext } from '../../core/registry/types';
import type { CommandResult } from '../../net/commandBus';
import { mountPrioritiesPanel, PrioritiesPanel, PrioritySliders, type SliderDef } from './index';
import { clearPrioritiesStorage } from './storage';

function makeMockContext(flagsList = '..08'): {
  ctx: FeatureContext;
  commands: Array<{ kind: string; args: unknown }>;
  sendCommand: (kind: string, args?: unknown) => Promise<CommandResult>;
} {
  const commands: Array<{ kind: string; args: unknown }> = [];
  const sendCommand = vi.fn(async (kind: string, args?: unknown): Promise<CommandResult> => {
    commands.push({ kind, args });
    return { ok: true, appliedAtTick: 1 };
  });

  const ctx: FeatureContext = {
    flags: new Set(parseWaves(flagsList).list),
    host: 'server',
    services: {
      track: () => {},
      sendCommand,
      session: { planetId: () => 'test-planet' },
      colonyId: 0,
    },
  };

  return { ctx, commands, sendCommand };
}

describe('W08-27 Priorities Initial Render', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    clearPrioritiesStorage('test-planet', 0);
  });

  afterEach(() => {
    localStorage.clear();
    sessionStorage.clear();
  });

  it('renders the 5 canonical priority sliders at default 50 each with sum 250', () => {
    const { ctx } = makeMockContext();
    const container = document.createElement('div');
    const mounted = mountPrioritiesPanel(container, ctx);
    expect(mounted.panel).toBeInstanceOf(PrioritiesPanel);

    const panel = container.querySelector('[data-testid="priorities-panel"]');
    expect(panel).not.toBeNull();
    expect(panel?.querySelector('.ta-priorities-panel__title')?.textContent).toBe('HQ PRIORITIES');

    for (const key of PRIORITY_KEYS) {
      const slider = panel?.querySelector<HTMLInputElement>(`[data-testid="priority-slider-${key}"]`);
      expect(slider?.value).toBe('50');
      expect(slider?.min).toBe('0');
      expect(slider?.max).toBe('100');
      expect(slider?.step).toBe('10');
      expect(panel?.querySelector(`[data-testid="priority-value-${key}"]`)?.textContent).toBe('50');
    }

    expect(panel?.querySelector('[data-testid="priority-sum"]')?.textContent).toBe('250');
    expect(panel?.querySelector('[data-testid="priority-badge-sum"]')?.textContent).toBe('250');

    mounted.dispose();
  });
});

describe('W08-27 Priorities Updates and Persistence', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    clearPrioritiesStorage('test-planet', 0);
  });

  afterEach(() => {
    localStorage.clear();
    sessionStorage.clear();
  });

  it('changing sliders sends setPriorities, updates sum to 270, and survives reload', () => {
    const { ctx, sendCommand } = makeMockContext();
    const container = document.createElement('div');
    const mounted = mountPrioritiesPanel(container, ctx);

    // 1. Change economy to 100
    const economyInput = container.querySelector<HTMLInputElement>('[data-testid="priority-slider-economy"]')!;
    economyInput.value = '100';
    economyInput.dispatchEvent(new Event('input'));

    expect(container.querySelector('[data-testid="priority-value-economy"]')?.textContent).toBe('100');
    expect(container.querySelector('[data-testid="priority-sum"]')?.textContent).toBe('300');
    expect(sendCommand).toHaveBeenCalledWith('setPriorities', {
      economy: 100,
      expansion: 50,
      defense: 50,
      power: 50,
      terraform: 50,
    });

    // 2. Change defense to 20
    const defenseInput = container.querySelector<HTMLInputElement>('[data-testid="priority-slider-defense"]')!;
    defenseInput.value = '20';
    defenseInput.dispatchEvent(new Event('input'));

    expect(container.querySelector('[data-testid="priority-value-defense"]')?.textContent).toBe('20');
    expect(container.querySelector('[data-testid="priority-sum"]')?.textContent).toBe('270');
    expect(sendCommand).toHaveBeenLastCalledWith('setPriorities', {
      economy: 100,
      expansion: 50,
      defense: 20,
      power: 50,
      terraform: 50,
    });

    mounted.dispose();

    // 3. Simulate reload / re-mount reading from storage
    const reloadContainer = document.createElement('div');
    const reloaded = mountPrioritiesPanel(reloadContainer, ctx);

    expect(reloadContainer.querySelector<HTMLInputElement>('[data-testid="priority-slider-economy"]')?.value).toBe('100');
    expect(reloadContainer.querySelector<HTMLInputElement>('[data-testid="priority-slider-defense"]')?.value).toBe('20');
    expect(reloadContainer.querySelector('[data-testid="priority-sum"]')?.textContent).toBe('270');

    // 4. Update from sim view
    reloaded.update?.({
      colonies: [{
        index: 0,
        priorities: { economy: 80, expansion: 40, defense: 30, power: 60, terraform: 70 },
      }],
    });

    expect(reloadContainer.querySelector<HTMLInputElement>('[data-testid="priority-slider-economy"]')?.value).toBe('80');
    expect(reloadContainer.querySelector<HTMLInputElement>('[data-testid="priority-slider-defense"]')?.value).toBe('30');
    expect(reloadContainer.querySelector('[data-testid="priority-sum"]')?.textContent).toBe('280');

    reloaded.dispose();
  });
});

describe('W08-27 Reusable Sliders and Wave Guard', () => {
  it('reusable PrioritySliders works with custom slider keys for W03-37', () => {
    type HarvestKey = 'wood' | 'minerals' | 'oil';
    const customSliders: readonly SliderDef<HarvestKey>[] = [
      { key: 'wood', label: 'Wood Priority', min: 0, max: 100, step: 5, defaultValue: 30 },
      { key: 'minerals', label: 'Minerals Priority', min: 0, max: 100, step: 5, defaultValue: 50 },
      { key: 'oil', label: 'Oil Priority', min: 0, max: 100, step: 5, defaultValue: 20 },
    ];

    const onChange = vi.fn();
    const sliders = new PrioritySliders<HarvestKey>({
      sliders: customSliders,
      onChange,
    });

    expect(sliders.getSum()).toBe(100);
    const sumEl = sliders.el.querySelector('[data-testid="priority-sum"]');
    expect(sumEl?.textContent).toBe('100');

    const woodInput = sliders.el.querySelector<HTMLInputElement>('[data-testid="priority-slider-wood"]')!;
    expect(woodInput.value).toBe('30');
    expect(sliders.el.querySelector('[data-testid="priority-value-wood"]')?.textContent).toBe('30');

    woodInput.value = '60';
    woodInput.dispatchEvent(new Event('input'));

    expect(sliders.getSum()).toBe(130);
    expect(sumEl?.textContent).toBe('130');
    expect(onChange).toHaveBeenCalledWith({ wood: 60, minerals: 50, oil: 20 }, 'wood', 60);

    sliders.dispose();
  });

  it('hidden when wave W08 is disabled', () => {
    const { ctx } = makeMockContext('..07');
    const container = document.createElement('div');
    const mounted = mountPrioritiesPanel(container, ctx);

    expect(container.hidden).toBe(true);
    expect(container.querySelector('[data-testid="priorities-panel"]')).toBeNull();

    mounted.dispose();
  });

  it('toggles collapse on collapse button click', () => {
    const { ctx } = makeMockContext();
    const container = document.createElement('div');
    const mounted = mountPrioritiesPanel(container, ctx);

    const panel = container.querySelector<HTMLElement>('[data-testid="priorities-panel"]')!;
    const collapseBtn = container.querySelector<HTMLButtonElement>('[data-testid="priority-collapse-btn"]')!;
    const body = container.querySelector<HTMLElement>('.ta-priorities-panel__body')!;

    expect(panel.dataset.collapsed).toBe('false');
    expect(body.hidden).toBe(false);

    collapseBtn.click();
    expect(panel.dataset.collapsed).toBe('true');
    expect(body.hidden).toBe(true);
    expect(collapseBtn.textContent).toBe('EXPAND');

    collapseBtn.click();
    expect(panel.dataset.collapsed).toBe('false');
    expect(body.hidden).toBe(false);
    expect(collapseBtn.textContent).toBe('COLLAPSE');

    mounted.dispose();
  });

  it('clamps slider values at min 0 and max 100 boundaries and rounds to step 10', () => {
    const sliders = new PrioritySliders();
    sliders.setValue('economy', -25, false);
    expect(sliders.getValue('economy')).toBe(0);
    sliders.setValue('economy', 145, false);
    expect(sliders.getValue('economy')).toBe(100);
    sliders.setValue('economy', 46, false);
    expect(sliders.getValue('economy')).toBe(50);
    sliders.dispose();
  });
});
