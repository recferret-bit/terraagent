import type { RaidTargetOption } from '../raidTargets';

export function formatRaidReasonText(target: RaidTargetOption): {
  text: string;
  title: string;
  stateClass: string | null;
} {
  if (target.disabled) {
    if (target.shieldActive) {
      const hours = target.shieldRemainingHours;
      if (hours >= 1) {
        return {
          text: `${target.disabledReason} (newcomer shield: ${hours} h left)`,
          title: `newcomer shield: ${hours} h left`,
          stateClass: 'is-shielded',
        };
      }
      return {
        text: target.disabledReason ?? '',
        title: target.disabledReason ?? '',
        stateClass: 'is-shielded',
      };
    }
    if (target.truceActive) {
      return {
        text: target.disabledReason ?? 'Truce active',
        title: 'Truce active',
        stateClass: 'is-truce',
      };
    }
    return {
      text: target.disabledReason ?? 'Disabled',
      title: target.disabledReason ?? 'Disabled',
      stateClass: null,
    };
  }
  return {
    text: 'Ready to raid',
    title: 'Ready to raid',
    stateClass: 'is-ready',
  };
}

export function renderRaidReasonBadge(target: RaidTargetOption): HTMLElement {
  const badge = document.createElement('span');
  badge.className = 'ta-raid-target-reason';
  badge.setAttribute('data-testid', 'raid-target-reason');
  const { text, title, stateClass } = formatRaidReasonText(target);
  if (stateClass) badge.classList.add(stateClass);
  badge.textContent = text;
  badge.title = title;
  return badge;
}

export function renderRaidTargetRow(
  target: RaidTargetOption,
  onDispatch: (target: RaidTargetOption, forceGoal: boolean) => void,
  onRowClick: (target: RaidTargetOption) => void,
): HTMLElement {
  const row = document.createElement('div');
  row.className = 'ta-raid-target-row plate-sm' + (target.disabled ? ' is-disabled' : '');
  row.setAttribute('data-testid', 'raid-target-row');
  row.setAttribute('data-colony-index', String(target.colonyIndex));
  row.setAttribute('data-colony-id', target.colonyId);
  row.setAttribute('data-disabled', String(target.disabled));

  const info = document.createElement('div');
  info.className = 'ta-raid-target-row__info';

  const nameWrap = document.createElement('div');
  nameWrap.className = 'ta-raid-target-row__name-wrap';

  const dot = document.createElement('span');
  dot.className = 'ta-raid-color-dot';
  dot.style.background = target.colorToken;

  const nameEl = document.createElement('span');
  nameEl.className = 'ta-raid-target-name';
  nameEl.setAttribute('data-testid', 'raid-target-name');
  nameEl.textContent = target.name;

  const coordsEl = document.createElement('span');
  coordsEl.className = 'ta-raid-target-coords';
  coordsEl.textContent = `(${target.q}, ${target.r})`;

  nameWrap.append(dot, nameEl, coordsEl);
  info.append(nameWrap, renderRaidReasonBadge(target));

  const actions = document.createElement('div');
  actions.className = 'ta-raid-target-row__actions';

  const dispatchBtn = document.createElement('button');
  dispatchBtn.type = 'button';
  dispatchBtn.className = 'ta-raid-target-btn ta-raid-target-btn--dispatch';
  dispatchBtn.setAttribute('data-testid', 'raid-target-dispatch');
  dispatchBtn.setAttribute('data-action', 'dispatch-raid');
  dispatchBtn.disabled = target.disabled;
  dispatchBtn.textContent = 'Dispatch';
  dispatchBtn.onclick = (e) => {
    e.stopPropagation();
    onDispatch(target, false);
  };

  const goalBtn = document.createElement('button');
  goalBtn.type = 'button';
  goalBtn.className = 'ta-raid-target-btn';
  goalBtn.setAttribute('data-testid', 'raid-target-goal-btn');
  goalBtn.setAttribute('data-action', 'queue-goal');
  goalBtn.disabled = target.disabled;
  goalBtn.textContent = 'HQ Goal';
  goalBtn.onclick = (e) => {
    e.stopPropagation();
    onDispatch(target, true);
  };

  actions.append(dispatchBtn, goalBtn);
  row.append(info, actions);
  row.onclick = () => onRowClick(target);
  return row;
}
