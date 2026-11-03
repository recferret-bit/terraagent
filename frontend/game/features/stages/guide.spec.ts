// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { StageTrackHud } from './StageTrackHud';
import { makeMockContext } from './stageTestHelpers';
import { GoalForm } from '../goals/GoalForm';
import { HqPanel } from '../goals/HqPanel';

describe('W08 guide and HQ navigation', () => {
  it('shows a 30-second timer, reopens without one, browses history and hides/shows without changing progression', () => {
    vi.useFakeTimers();
    const host = document.createElement('div');
    const hud = new StageTrackHud(host, makeMockContext());
    try {
      hud.update({ stage: 2 });
      hud.showStageToast(2);
      expect(host.querySelector('[data-testid=stage-toast-countdown]')?.textContent).toBe('Closes in 30s');
      vi.advanceTimersByTime(1000);
      expect(host.querySelector('[data-testid=stage-toast-countdown]')?.textContent).toBe('Closes in 29s');
      vi.advanceTimersByTime(29000);
      expect(hud.getActiveToast()).toBeNull();
      (host.querySelector('[data-testid=stage-guide-toggle]') as HTMLElement).click();
      expect(hud.getActiveToast()).not.toBeNull();
      expect(host.querySelector('[data-testid=stage-toast-countdown]')).toBeNull();
      (host.querySelector('[data-testid=stage-guide-previous]') as HTMLElement).click();
      expect(host.querySelector('[data-testid=stage-toast-title]')?.textContent).toBe('S1 First Light');
      expect(hud.getCurrentStage()).toBe(2);
      vi.advanceTimersByTime(60000);
      expect(hud.getActiveToast()).not.toBeNull();
      (host.querySelector('[data-testid=stage-guide-toggle]') as HTMLElement).click();
      expect(hud.getActiveToast()).toBeNull();
      (host.querySelector('[data-testid=stage-guide-toggle]') as HTMLElement).click();
      expect(host.querySelector('[data-testid=stage-toast-title]')?.textContent).toBe('S1 First Light');
      (host.querySelector('[data-testid=stage-segment-S10]') as HTMLElement).click();
      expect(host.querySelector('[data-testid=stage-guide-text]')?.textContent).toContain('Preview');
      expect(hud.getCurrentStage()).toBe(2);
    } finally { hud.dispose(); vi.useRealTimers(); }
  });

  it('keeps an explicit zero night target and zero budget instead of replacing them with defaults', () => {
    const onAdd = vi.fn();
    const form = new GoalForm({ onAdd });
    form.kindSelect.value = 'secure_power';
    form.renderParams();
    (form.el.querySelector('[data-testid=goal-param-energy]') as HTMLInputElement).value = '0';
    form.budgetInput.value = '0';
    form.submit();
    expect(onAdd).toHaveBeenCalledWith({ goal: 'secure_power', params: { targetNetEnergyPerS: 0 }, budgetBp: 0 });
  });

  it('one HQ panel switches tabs while preserving the goal form', () => {
    const host = document.createElement('div');
    const hq = new HqPanel(host, makeMockContext());
    const select = host.querySelector('[data-testid=goal-kind-select]') as HTMLSelectElement;
    select.value = 'grow_economy';
    (host.querySelector('[data-testid=hq-tab-priorities]') as HTMLElement).click();
    expect(hq.goals.root.hidden).toBe(true);
    expect(hq.priorities.root.hidden).toBe(false);
    (host.querySelector('[data-testid=hq-tab-goals]') as HTMLElement).click();
    expect(hq.goals.root.hidden).toBe(false);
    expect(select.value).toBe('grow_economy');
    expect((select.querySelector('[value=defend_colony]') as HTMLOptionElement).disabled).toBe(true);
    hq.dispose();
    expect(host.childElementCount).toBe(0);
  });
});
