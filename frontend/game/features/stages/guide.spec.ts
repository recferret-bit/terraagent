// @vitest-environment jsdom
import { parseWaves } from '@terra/contracts';
import { describe, expect, it, vi } from 'vitest';
import { StageTrackHud } from './StageTrackHud';
import { stageGuideText } from './guide';
import { makeMockContext } from './stageTestHelpers';
import { GoalForm } from '../goals/GoalForm';
import { HqPanel } from '../goals/HqPanel';
import { renderStageSuggestion } from '../goals/suggestion';

describe('W08 guide and HQ navigation', () => {
  it('shows a 30-second timer, reopens without one, browses clickable stages and closes the whole popup without changing progression', () => {
    vi.useFakeTimers();
    const host = document.createElement('div');
    const hud = new StageTrackHud(host, makeMockContext());
    try {
      expect(hud.root.hidden).toBe(true);
      hud.update({ stage: 2 });
      hud.showStageToast(2);
      expect(host.querySelector('[data-testid=stage-toast-countdown]')?.textContent).toBe('Closes in 30s');
      vi.advanceTimersByTime(1000);
      expect(host.querySelector('[data-testid=stage-toast-countdown]')?.textContent).toBe('Closes in 29s');
      vi.advanceTimersByTime(29000);
      expect(hud.getActiveToast()).toBeNull();
      (host.querySelector('[data-testid=stage-segment-S2]') as HTMLElement).click();
      expect(hud.getActiveToast()).not.toBeNull();
      expect(host.querySelector('[data-testid=stage-toast-countdown]')).toBeNull();
      (host.querySelector('[data-testid=stage-segment-S1]') as HTMLElement).click();
      expect(host.querySelector('[data-testid=stage-toast-title]')?.textContent).toBe('S1 First Light');
      expect(hud.getCurrentStage()).toBe(2);
      vi.advanceTimersByTime(60000);
      expect(hud.getActiveToast()).not.toBeNull();
      (host.querySelector('[data-testid=stage-goals-close]') as HTMLElement).click();
      expect(hud.root.hidden).toBe(true);
      expect(hud.getActiveToast()).toBeNull();
      hud.showStageToast(3);
      expect(hud.root.hidden).toBe(true);
      expect(hud.getActiveToast()).toBeNull();
      (host.querySelector('[data-testid=stage-goals-launcher]') as HTMLElement).click();
      expect(hud.root.hidden).toBe(false);
      expect(host.querySelector('[data-testid=stage-guide-previous]')).toBeNull();
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
    expect((select.querySelector('[value=expand_territory]') as HTMLOptionElement).disabled).toBe(true);
    hq.dispose();
    expect(host.childElementCount).toBe(0);
  });
});

describe('shipped vs wave-gated stage guide and goal HUD copy', () => {
  it('renders clean player-facing lessons in shipped mode (all waves) and preserves wave-gated lessons in ..08 mode', () => {
    const shippedFlags = new Set(parseWaves('all').list);
    const gatedFlags = new Set(parseWaves('..08').list);

    for (let s = 0; s <= 10; s++) {
      const shippedText = stageGuideText(s, s, shippedFlags);
      expect(shippedText, `Stage S${s} shipped guide should contain no WNN wave codes`).not.toMatch(/\bW\d{2}\b/);
      expect(shippedText.toLowerCase()).not.toContain('future wave');
      expect(stageGuideText(s, s)).toBe(shippedText);
    }
    expect(stageGuideText(0, 0, shippedFlags)).toContain('Solar Collector');
    expect(stageGuideText(3, 3, shippedFlags)).toContain('Autocannon Turrets');
    expect(stageGuideText(4, 4, shippedFlags)).toContain('Outpost Beacons');
    expect(stageGuideText(6, 6, shippedFlags)).toContain('Research Lab');
    expect(stageGuideText(7, 7, shippedFlags)).toContain('Heavy Foundry');

    expect(stageGuideText(10, 2, gatedFlags)).toContain('Preview');
    expect(stageGuideText(10, 2, gatedFlags)).toContain('W21');
    expect(stageGuideText(2, 2, gatedFlags)).toContain('W03');

    const host = document.createElement('div');
    const shippedHud = new StageTrackHud(host, makeMockContext('all'));
    try {
      shippedHud.update({ stage: 2 });
      (host.querySelector('[data-testid=stage-goals-launcher]') as HTMLElement).click();
      (host.querySelector('[data-testid=stage-segment-S10]') as HTMLElement).click();
      const guideText = host.querySelector('[data-testid=stage-guide-text]')?.textContent ?? '';
      expect(guideText).toContain('Preview');
      expect(guideText).not.toMatch(/\bW\d{2}\b/);
    } finally {
      shippedHud.dispose();
    }
  });

  it('updates GoalForm suffixes and stage suggestion cards cleanly across shipped and wave-gated flags', () => {
    const shippedFlags = new Set(parseWaves('all').list);
    const w08Flags = new Set(parseWaves('..08').list);
    const w02Flags = new Set(parseWaves('..02').list);

    const shippedForm = new GoalForm({ onAdd: vi.fn(), flags: shippedFlags });
    const expandOpt = shippedForm.kindSelect.querySelector('[value=expand_territory]') as HTMLOptionElement;
    expect(expandOpt.disabled).toBe(true);
    expect(expandOpt.textContent).toBe('Expand Toward — manual / AI Director');
    const raidOptShipped = shippedForm.kindSelect.querySelector('[value=raid_target]') as HTMLOptionElement;
    expect(raidOptShipped.disabled).toBe(false);

    shippedForm.kindSelect.value = 'grow_economy';
    shippedForm.renderParams();
    const waterShipped = shippedForm.el.querySelector('[data-testid=goal-param-resource] [value="bio.water"]') as HTMLOptionElement;
    expect(waterShipped.disabled).toBe(true);
    expect(waterShipped.textContent).toBe('Water — place shoreline Water Pump');

    const w02Form = new GoalForm({ onAdd: vi.fn(), flags: w02Flags });
    w02Form.kindSelect.value = 'grow_economy';
    w02Form.renderParams();
    const waterW02 = w02Form.el.querySelector('[data-testid=goal-param-resource] [value="bio.water"]') as HTMLOptionElement;
    expect(waterW02.textContent).toBe('Water — requires W03 extraction');

    const sugHost = document.createElement('div');
    renderStageSuggestion(sugHost, 2, [], false, vi.fn(), vi.fn(), shippedFlags);
    expect(sugHost.textContent).toContain('Verify +10 E/s during night using capacitors or fuel/fusion generation.');
    expect(sugHost.textContent).not.toContain('W03');

    renderStageSuggestion(sugHost, 4, [], false, vi.fn(), vi.fn(), shippedFlags);
    expect(sugHost.textContent).toContain('Issue orders via Build, Trade, or AI Director — open Stage Guide for milestones.');
    expect(sugHost.querySelector('[data-testid=goal-suggestion-accept]')?.textContent).toBe('MANUAL / DIRECTOR');
    expect((sugHost.querySelector('[data-testid=goal-suggestion-accept]') as HTMLButtonElement).disabled).toBe(true);

    renderStageSuggestion(sugHost, 4, [], false, vi.fn(), vi.fn(), w08Flags);
    expect(sugHost.textContent).toContain('This lesson needs a future wave.');
    expect(sugHost.querySelector('[data-testid=goal-suggestion-accept]')?.textContent).toBe('COMING IN A FUTURE WAVE');

    for (const st of [3, 6, 8]) {
      renderStageSuggestion(sugHost, st, [], false, vi.fn(), vi.fn(), shippedFlags);
      expect(sugHost.querySelector('[data-testid=goal-suggestion-accept]')?.textContent).toBe('ACCEPT');
      expect((sugHost.querySelector('[data-testid=goal-suggestion-accept]') as HTMLButtonElement).disabled).toBe(false);
    }
  });
});
