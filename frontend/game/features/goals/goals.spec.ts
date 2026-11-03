// @vitest-environment jsdom
import { parseWaves } from '@terra/contracts';
import { describe, expect, it, vi } from 'vitest';
import type { FeatureContext } from '../../core/registry/types';
import type { CommandResult } from '../../net/commandBus';
import { formatGoalLabel, GoalsPanel, mountGoalsPanel } from './index';

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

describe('W08-21 HQ Goals - Add and Cancel', () => {
  it('adds Grow Economy (10 metals/min) from UI, shows progress & budget, and cancels', () => {
    const { ctx, sendCommand } = makeMockContext();
    const container = document.createElement('div');
    const mounted = mountGoalsPanel(container, ctx);

    expect(mounted.panel).toBeInstanceOf(GoalsPanel);

    const kindSelect = container.querySelector<HTMLSelectElement>('[data-testid="goal-kind-select"]')!;
    kindSelect.value = 'grow_economy';
    kindSelect.dispatchEvent(new Event('change'));

    const resSelect = container.querySelector<HTMLSelectElement>('[data-testid="goal-param-resource"]')!;
    expect(resSelect.value).toBe('metals.t1');

    const rateInput = container.querySelector<HTMLInputElement>('[data-testid="goal-param-rate"]')!;
    expect(rateInput.value).toBe('10');

    const addBtn = container.querySelector<HTMLButtonElement>('[data-testid="goal-add-btn"]')!;
    addBtn.click();

    expect(sendCommand).toHaveBeenCalledWith('queueGoal', {
      goal: 'grow_economy',
      params: { resource: 'metals.t1', targetRatePerMin: 10 },
      budgetBp: 5000,
    });

    const list = container.querySelector('[data-testid="goals-list"]')!;
    const item = list.querySelector('[data-testid^="goal-item-"]') as HTMLElement;
    expect(item).not.toBeNull();
    expect(item.getAttribute('data-goal-kind')).toBe('grow_economy');
    expect(item.getAttribute('data-goal-status')).toBe('active');
    expect(item.textContent).toContain('Grow Economy (10 metals/min)');

    const goalId = item.getAttribute('data-testid')!.replace('goal-item-', '');
    const progressBar = container.querySelector(`[data-testid="goal-progress-${goalId}"]`)!;
    expect(progressBar).not.toBeNull();
    expect(progressBar.textContent).toContain('0%');

    const budgetEl = container.querySelector(`[data-testid="goal-budget-${goalId}"]`)!;
    expect(budgetEl).not.toBeNull();
    expect(budgetEl.textContent).toBe('Budget: 50%');

    const cancelBtn = container.querySelector<HTMLButtonElement>(`[data-testid="goal-cancel-${goalId}"]`)!;
    cancelBtn.click();

    expect(sendCommand).toHaveBeenCalledWith('cancelGoal', { goalId });
    expect(list.querySelector(`[data-testid="goal-item-${goalId}"]`)).toBeNull();

    mounted.dispose();
  });
});

describe('W08-21 HQ Goals - S0 Suggestion Card', () => {
  it('shows S0 suggestion card for Establish Colony and one-click accept sends acceptSuggestion', () => {
    const { ctx, sendCommand } = makeMockContext();
    const container = document.createElement('div');
    const mounted = mountGoalsPanel(container, ctx);

    const card = container.querySelector('[data-testid="goal-suggestion-card"]');
    expect(card).not.toBeNull();
    expect(card?.textContent).toContain('Establish Colony');

    const acceptBtn = container.querySelector<HTMLButtonElement>('[data-testid="goal-suggestion-accept"]')!;
    acceptBtn.click();

    expect(sendCommand).toHaveBeenCalledWith('acceptSuggestion', { stage: 0, goal: 'establish_colony' });
    expect(container.querySelector('[data-testid="goal-suggestion-card"]')).toBeNull();

    mounted.dispose();
  });

  it('dismisses S0 suggestion card on dismiss button click', () => {
    const { ctx } = makeMockContext();
    const container = document.createElement('div');
    const mounted = mountGoalsPanel(container, ctx);

    const card = container.querySelector('[data-testid="goal-suggestion-card"]');
    expect(card).not.toBeNull();

    const dismissBtn = container.querySelector<HTMLButtonElement>('[data-testid="goal-suggestion-dismiss"]')!;
    dismissBtn.click();

    expect(container.querySelector('[data-testid="goal-suggestion-card"]')).toBeNull();

    mounted.dispose();
  });
});

describe('W08-21 HQ Goals - Reordering', () => {
  it('reorder buttons up/down and drag-and-drop send reorderGoal', () => {
    const { ctx, sendCommand } = makeMockContext();
    const container = document.createElement('div');
    const mounted = mountGoalsPanel(container, ctx);

    mounted.update?.({
      colonies: [
        {
          index: 0,
          goalLimit: 3,
          goals: [
            {
              id: 'g1',
              goal: 'establish_colony',
              status: 'active',
              params: {},
              progress: 0.5,
              stepsCompleted: 2,
              stepsTotal: 4,
              budgetBp: 10000,
              spent: {},
              childTaskIds: [],
              createdAtTick: 0,
            },
            {
              id: 'g2',
              goal: 'grow_economy',
              status: 'queued',
              params: { resource: 'metals.t1', targetRatePerMin: 10 },
              progress: 0,
              stepsCompleted: 0,
              stepsTotal: 1,
              budgetBp: 5000,
              spent: {},
              childTaskIds: [],
              createdAtTick: 0,
            },
          ],
        },
      ],
    });

    const downBtn = container.querySelector<HTMLButtonElement>('[data-testid="goal-down-g1"]')!;
    downBtn.click();
    expect(sendCommand).toHaveBeenCalledWith('reorderGoal', { goalId: 'g1', direction: 'down' });

    const upBtn = container.querySelector<HTMLButtonElement>('[data-testid="goal-up-g1"]')!;
    upBtn.click();
    expect(sendCommand).toHaveBeenCalledWith('reorderGoal', { goalId: 'g1', direction: 'up' });

    const item1 = container.querySelector<HTMLElement>('[data-testid="goal-item-g1"]')!;
    const item2 = container.querySelector<HTMLElement>('[data-testid="goal-item-g2"]')!;

    const dragStartEvent = new Event('dragstart', { bubbles: true });
    Object.defineProperty(dragStartEvent, 'dataTransfer', {
      value: { setData: vi.fn(), getData: () => 'g2', effectAllowed: 'none' },
    });
    item2.dispatchEvent(dragStartEvent);

    const dropEvent = new Event('drop', { bubbles: true });
    Object.defineProperty(dropEvent, 'dataTransfer', {
      value: { getData: () => 'g2', dropEffect: 'none' },
    });
    item1.dispatchEvent(dropEvent);

    expect(sendCommand).toHaveBeenCalledWith('reorderGoal', { goalId: 'g2', toIndex: 0 });

    mounted.dispose();
  });
});

describe('W08-21 HQ Goals - Wave Gating and Limits', () => {
  it('hidden and not mounted when wave W08 is off', () => {
    const { ctx } = makeMockContext('..07');
    const container = document.createElement('div');
    const mounted = mountGoalsPanel(container, ctx);

    expect(container.hidden).toBe(true);
    expect(container.querySelector('[data-testid="goals-panel"]')).toBeNull();

    mounted.dispose();
  });

  it('shows header "HQ GOALS" and capacity badge <openCount> / <goalLimit>', () => {
    const { ctx } = makeMockContext();
    const container = document.createElement('div');
    const mounted = mountGoalsPanel(container, ctx);

    const panel = container.querySelector('[data-testid="goals-panel"]')!;
    expect(panel.querySelector('.ta-goals-panel__title')?.textContent).toBe('HQ GOALS');
    expect(container.querySelector('[data-testid="goals-limit-badge"]')?.textContent).toBe('0 / 2');

    mounted.update?.({
      colonies: [
        {
          index: 0,
          goalLimit: 2,
          goals: [
            {
              id: 'g1',
              goal: 'establish_colony',
              status: 'active',
              params: {},
              progress: 0.25,
              stepsCompleted: 1,
              stepsTotal: 4,
              budgetBp: 5000,
              spent: {},
              childTaskIds: [],
              createdAtTick: 0,
            },
            {
              id: 'g2',
              goal: 'secure_power',
              status: 'queued',
              params: { targetNetEnergyPerS: 15 },
              progress: 0,
              stepsCompleted: 0,
              stepsTotal: 1,
              budgetBp: 5000,
              spent: {},
              childTaskIds: [],
              createdAtTick: 0,
            },
          ],
        },
      ],
    });

    expect(container.querySelector('[data-testid="goals-limit-badge"]')?.textContent).toBe('2 / 2');
    const addBtn = container.querySelector<HTMLButtonElement>('[data-testid="goal-add-btn"]')!;
    expect(addBtn.disabled).toBe(true);

    mounted.dispose();
  });

  it('toggles collapse on collapse button click', () => {
    const { ctx } = makeMockContext();
    const container = document.createElement('div');
    const mounted = mountGoalsPanel(container, ctx);

    const panel = container.querySelector<HTMLElement>('[data-testid="goals-panel"]')!;
    const collapseBtn = container.querySelector<HTMLButtonElement>('[data-testid="goals-collapse-btn"]')!;
    const body = container.querySelector<HTMLElement>('.ta-goals-panel__body')!;

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
});

describe('W08-21 HQ Goals - Labels', () => {
  it('formats goal labels for various goals', () => {
    expect(formatGoalLabel('grow_economy', { resource: 'metals.t1', targetRatePerMin: 20 })).toBe(
      'Grow Economy (20 metals/min)',
    );
    expect(formatGoalLabel('grow_economy', { resource: 'bio.water', targetRatePerMin: 15 })).toBe(
      'Grow Economy (15 water/min)',
    );
    expect(formatGoalLabel('secure_power', { targetNetEnergyPerS: 30 })).toBe(
      'Secure Power (+30 E/s night)',
    );
    expect(formatGoalLabel('establish_colony')).toBe('Establish Colony');
  });
});
