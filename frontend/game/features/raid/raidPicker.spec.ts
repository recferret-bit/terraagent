// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { GoalForm } from '../goals/GoalForm';
import { extractRaidTargets, formatShieldMmSs } from './raidTargets';
import { RaidTargetPicker } from './RaidTargetPicker';

describe('formatShieldMmSs helper', () => {
  it('formats seconds into mm:ss', () => {
    expect(formatShieldMmSs(0)).toBe('00:00');
    expect(formatShieldMmSs(-5)).toBe('00:00');
    expect(formatShieldMmSs(1)).toBe('00:01');
    expect(formatShieldMmSs(59)).toBe('00:59');
    expect(formatShieldMmSs(60)).toBe('01:00');
    expect(formatShieldMmSs(300)).toBe('05:00');
    expect(formatShieldMmSs(18000)).toBe('300:00');
  });
});

describe('extractRaidTargets positive cases', () => {
  it('returns eligible neighbor colony as enabled', () => {
    const rawView = {
      tick: 100,
      colonies: [
        { index: 0, id: 'col_0', name: 'Own Colony', discovered: true, q: 0, r: 0 },
        { index: 1, id: 'col_1', name: 'Alpha Prime', discovered: true, q: 5, r: -3 },
      ],
    };

    const targets = extractRaidTargets(rawView, 0);
    expect(targets).toHaveLength(1);
    const target = targets[0]!;
    expect(target.colonyIndex).toBe(1);
    expect(target.colonyId).toBe('col_1');
    expect(target.name).toBe('Alpha Prime');
    expect(target.q).toBe(5);
    expect(target.r).toBe(-3);
    expect(target.disabled).toBe(false);
    expect(target.disabledReason).toBeNull();
  });
});

describe('extractRaidTargets negative cases', () => {
  it('marks shielded colony as disabled with Protected mm:ss', () => {
    const rawView = {
      tick: 100,
      colonies: [
        { index: 0, id: 'col_0', discovered: true },
        {
          index: 1,
          id: 'col_1',
          name: 'Shielded Base',
          discovered: true,
          raidProtectedUntil: 1600,
          q: 2,
          r: 2,
        },
      ],
    };

    const targets = extractRaidTargets(rawView, 0);
    expect(targets).toHaveLength(1);
    expect(targets[0]?.disabled).toBe(true);
    expect(targets[0]?.disabledReason).toBe('Protected 05:00');
    expect(targets[0]?.shieldActive).toBe(true);
  });

  it('marks truce colony as disabled with Truce active', () => {
    const rawView = {
      tick: 50,
      colonies: [
        { index: 0, id: 'col_0', discovered: true },
        {
          index: 1,
          id: 'col_1',
          name: 'Partner Base',
          discovered: true,
          truceActive: true,
          q: 3,
          r: 1,
        },
      ],
    };

    const targets = extractRaidTargets(rawView, 0);
    expect(targets).toHaveLength(1);
    expect(targets[0]?.disabled).toBe(true);
    expect(targets[0]?.disabledReason).toBe('Truce active');
    expect(targets[0]?.truceActive).toBe(true);
  });

  it('marks cross-sector disabled colony as disabled', () => {
    const rawView = {
      tick: 10,
      colonies: [
        { index: 0, id: 'col_0', discovered: true },
        {
          index: 1,
          id: 'col_1',
          name: 'Across Seam',
          discovered: true,
          crossSectorDisabled: true,
        },
      ],
    };

    const targets = extractRaidTargets(rawView, 0);
    expect(targets).toHaveLength(1);
    expect(targets[0]?.disabled).toBe(true);
    expect(targets[0]?.disabledReason).toBe('Cross-sector disabled');
  });

  it('excludes undiscovered, eliminated, and own colonies', () => {
    const rawView = {
      tick: 10,
      colonies: [
        { index: 0, id: 'col_0', discovered: true },
        { index: 1, id: 'col_1', discovered: false, name: 'Hidden' },
        { index: 2, id: 'col_2', discovered: true, eliminated: true, name: 'Dead' },
        { index: 3, id: 'col_3', discovered: true, status: 'eliminated', name: 'Destroyed' },
        { index: 4, id: 'col_4', discovered: true, name: 'Active Neighbor' },
      ],
    };

    const targets = extractRaidTargets(rawView, 0);
    expect(targets).toHaveLength(1);
    expect(targets[0]?.colonyIndex).toBe(4);
    expect(targets[0]?.name).toBe('Active Neighbor');
  });
});

describe('extractRaidTargets boundary and corner cases', () => {
  it('shield at exact expiration tick (currentTick) is enabled', () => {
    const rawView = {
      tick: 500,
      colonies: [
        { index: 0, id: 'col_0', discovered: true },
        {
          index: 1,
          id: 'col_1',
          discovered: true,
          raidProtectedUntil: 500,
        },
      ],
    };

    const targets = extractRaidTargets(rawView, 0);
    expect(targets).toHaveLength(1);
    expect(targets[0]?.disabled).toBe(false);
    expect(targets[0]?.disabledReason).toBeNull();
  });

  it('1 tick remaining shows Protected 00:01', () => {
    const rawView = {
      tick: 500,
      colonies: [
        { index: 0, id: 'col_0', discovered: true },
        {
          index: 1,
          id: 'col_1',
          discovered: true,
          raidProtectedUntil: 501,
        },
      ],
    };

    const targets = extractRaidTargets(rawView, 0);
    expect(targets).toHaveLength(1);
    expect(targets[0]?.disabled).toBe(true);
    expect(targets[0]?.disabledReason).toBe('Protected 00:01');
  });

  it('newcomer shield exposes remaining hours and 300:00 mm:ss', () => {
    const rawView = {
      tick: 1000,
      colonies: [
        { index: 0, id: 'col_0', discovered: true },
        {
          index: 1,
          id: 'col_1',
          discovered: true,
          raidProtectedUntil: 91000,
        },
      ],
    };

    const targets = extractRaidTargets(rawView, 0);
    expect(targets).toHaveLength(1);
    expect(targets[0]?.disabled).toBe(true);
    expect(targets[0]?.shieldRemainingHours).toBe(5);
    expect(targets[0]?.disabledReason).toBe('Protected 300:00');
  });
});

describe('RaidTargetPicker UI direct dispatch and indicator', () => {
  it('renders toggle button, panel, and target rows with dispatch and indicator', () => {
    const host = document.createElement('div');
    const sendCommand = vi.fn();

    const initialView = {
      tick: 200,
      colonies: [
        { index: 0, id: 'col_0', discovered: true },
        { index: 1, id: 'col_1', name: 'Alpha', discovered: true, q: 7, r: -2 },
      ],
    };

    const picker = new RaidTargetPicker(host, { sendCommand, initialView, ownColonyIndex: 0 });

    const toggle = host.querySelector<HTMLButtonElement>('[data-testid="raid-picker-toggle"]')!;
    expect(toggle.textContent).toBe('Raid Colony');

    const panel = host.querySelector<HTMLElement>('[data-testid="raid-target-picker"]')!;
    expect(panel.classList.contains('plate')).toBe(true);

    const row = host.querySelector<HTMLElement>('[data-testid="raid-target-row"]')!;
    expect(row.getAttribute('data-colony-id')).toBe('col_1');

    const nameEl = host.querySelector('[data-testid="raid-target-name"]')!;
    expect(nameEl.textContent).toBe('Alpha');

    const reasonEl = host.querySelector('[data-testid="raid-target-reason"]')!;
    expect(reasonEl.textContent).toBe('Ready to raid');

    const dispatchBtn = host.querySelector<HTMLButtonElement>('[data-testid="raid-target-dispatch"]')!;
    dispatchBtn.click();

    expect(sendCommand).toHaveBeenCalledWith('raid', {
      targetColonyId: 'col_1',
      targetColonyIndex: 1,
    });

    const indicator = host.querySelector<HTMLElement>('[data-testid="raid-path-indicator"]')!;
    expect(indicator.hidden).toBe(false);
    expect(indicator.textContent).toContain('Alpha (7, -2)');

    picker.dispose();
  });

  it('clicking enabled target row directly sends raid command in direct mode', () => {
    const host = document.createElement('div');
    const sendCommand = vi.fn();

    const view = {
      tick: 10,
      colonies: [
        { index: 0, id: 'col_0', discovered: true },
        { index: 2, id: 'col_2', name: 'Bravo', discovered: true, q: -4, r: 4 },
      ],
    };

    const picker = new RaidTargetPicker(host, { sendCommand, initialView: view });
    const row = host.querySelector<HTMLElement>('[data-testid="raid-target-row"]')!;
    row.click();

    expect(sendCommand).toHaveBeenCalledWith('raid', {
      targetColonyId: 'col_2',
      targetColonyIndex: 2,
    });

    picker.dispose();
  });
});

describe('RaidTargetPicker HQ goal mode and row button', () => {
  it('queueGoal command sent on dispatch when goal mode is active', () => {
    const host = document.createElement('div');
    const sendCommand = vi.fn();

    const view = {
      tick: 10,
      colonies: [
        { index: 0, id: 'col_0', discovered: true },
        { index: 1, id: 'col_1', name: 'Gamma', discovered: true, q: 3, r: 3 },
      ],
    };

    const picker = new RaidTargetPicker(host, { sendCommand, initialView: view });
    const goalModeBtn = host.querySelector<HTMLButtonElement>('[data-testid="raid-mode-goal"]')!;
    goalModeBtn.click();
    expect(goalModeBtn.getAttribute('aria-pressed')).toBe('true');

    const dispatchBtn = host.querySelector<HTMLButtonElement>('[data-testid="raid-target-dispatch"]')!;
    dispatchBtn.click();

    expect(sendCommand).toHaveBeenCalledWith('queueGoal', {
      goal: 'raid_target',
      params: { targetColonyId: 'col_1' },
    });

    picker.dispose();
  });

  it('HQ goal button on row directly sends queueGoal command', () => {
    const host = document.createElement('div');
    const sendCommand = vi.fn();

    const view = {
      tick: 10,
      colonies: [
        { index: 0, id: 'col_0', discovered: true },
        { index: 1, id: 'col_1', name: 'Delta', discovered: true, q: 1, r: -5 },
      ],
    };

    const picker = new RaidTargetPicker(host, { sendCommand, initialView: view });
    const goalBtn = host.querySelector<HTMLButtonElement>('[data-testid="raid-target-goal-btn"]')!;
    goalBtn.click();

    expect(sendCommand).toHaveBeenCalledWith('queueGoal', {
      goal: 'raid_target',
      params: { targetColonyId: 'col_1' },
    });

    picker.dispose();
  });
});

describe('RaidTargetPicker disabled target and toggle', () => {
  it('disabled target suppresses dispatch and shows reason', () => {
    const host = document.createElement('div');
    const sendCommand = vi.fn();

    const view = {
      tick: 100,
      colonies: [
        { index: 0, id: 'col_0', discovered: true },
        {
          index: 1,
          id: 'col_1',
          name: 'Protected Colony',
          discovered: true,
          raidProtectedUntil: 1600,
        },
      ],
    };

    const picker = new RaidTargetPicker(host, { sendCommand, initialView: view });
    const row = host.querySelector<HTMLElement>('[data-testid="raid-target-row"]')!;
    expect(row.classList.contains('is-disabled')).toBe(true);

    const reasonEl = host.querySelector('[data-testid="raid-target-reason"]')!;
    expect(reasonEl.textContent).toBe('Protected 05:00');

    const dispatchBtn = host.querySelector<HTMLButtonElement>('[data-testid="raid-target-dispatch"]')!;
    expect(dispatchBtn.disabled).toBe(true);

    dispatchBtn.click();
    row.click();
    expect(sendCommand).not.toHaveBeenCalled();

    picker.dispose();
  });

  it('toggle button toggles panel visibility', () => {
    const host = document.createElement('div');
    const picker = new RaidTargetPicker(host, { initiallyOpen: true });
    const panel = host.querySelector<HTMLElement>('[data-testid="raid-target-picker"]')!;
    expect(panel.hidden).toBe(false);

    const toggle = host.querySelector<HTMLButtonElement>('[data-testid="raid-picker-toggle"]')!;
    toggle.click();
    expect(panel.hidden).toBe(true);

    toggle.click();
    expect(panel.hidden).toBe(false);

    picker.dispose();
  });
});

describe('GoalForm raid_target integration', () => {
  it('renders target colony selector and populates params.targetColonyId on submit', () => {
    const onAdd = vi.fn();
    const form = new GoalForm({
      onAdd,
      colonyOptions: [
        { value: '1', label: 'Colony 2 (Alpha)' },
        { value: '2', label: 'Colony 3 (Beta)' },
      ],
    });

    form.kindSelect.value = 'raid_target';
    form.kindSelect.dispatchEvent(new Event('change'));

    const colonySelect = form.el.querySelector<HTMLSelectElement>(
      '[data-testid="goal-param-target-colony"]',
    );
    expect(colonySelect).not.toBeNull();
    expect(colonySelect?.options).toHaveLength(2);
    expect(colonySelect?.value).toBe('1');

    form.budgetInput.value = '40';
    form.addBtn.click();

    expect(onAdd).toHaveBeenCalledWith({
      goal: 'raid_target',
      params: { targetColonyId: 1 },
      budgetBp: 4000,
    });
  });
});
