import { extractRaidTargets, type RaidTargetOption } from './raidTargets';
import './raid.css';

export interface RaidTargetPickerActions {
  onDispatchRaid?: (target: RaidTargetOption) => void;
  onQueueRaidGoal?: (target: RaidTargetOption) => void;
  onSelectTarget?: (target: RaidTargetOption) => void;
  sendCommand?: (kind: string, args: unknown) => Promise<unknown> | void;
}

export interface RaidTargetPickerOptions {
  actions?: RaidTargetPickerActions;
  sendCommand?: (kind: string, args: unknown) => Promise<unknown> | void;
  ownColonyIndex?: number;
  getOwnColonyIndex?: () => number;
  initialView?: unknown;
  initiallyOpen?: boolean;
}

export type RaidPickerMode = 'direct' | 'goal';

export class RaidTargetPicker {
  readonly root: HTMLElement;
  readonly toggleBtn: HTMLButtonElement;
  readonly panelEl: HTMLElement;
  readonly pathIndicator: HTMLElement;
  readonly listEl: HTMLElement;
  readonly directModeBtn: HTMLButtonElement;
  readonly goalModeBtn: HTMLButtonElement;

  private mode: RaidPickerMode = 'direct';
  private selectedTarget: RaidTargetOption | null = null;
  private lastTargetsSig: string | null = null;
  private readonly ownColonyIndex: number;
  private readonly opts: RaidTargetPickerOptions;

  constructor(host: HTMLElement, options: RaidTargetPickerOptions = {}) {
    this.opts = options;
    this.ownColonyIndex = options.ownColonyIndex ?? 0;

    this.root = document.createElement('div');
    this.root.className = 'ta-raid-picker-container';

    this.toggleBtn = document.createElement('button');
    this.toggleBtn.type = 'button';
    this.toggleBtn.className = 'ta-raid-toggle plate-sm';
    this.toggleBtn.setAttribute('data-testid', 'raid-picker-toggle');
    this.toggleBtn.textContent = 'Raid Colony';
    this.toggleBtn.onclick = () => this.togglePanel();

    this.panelEl = document.createElement('section');
    this.panelEl.className = 'ta-raid-picker plate';
    this.panelEl.setAttribute('data-testid', 'raid-target-picker');
    this.panelEl.hidden = options.initiallyOpen === false;

    const header = document.createElement('div');
    header.className = 'ta-raid-picker__header';

    const title = document.createElement('h3');
    title.className = 'ta-raid-picker__title';
    title.textContent = 'RAID TARGETS';

    const modesWrap = document.createElement('div');
    modesWrap.className = 'ta-raid-modes';

    this.directModeBtn = document.createElement('button');
    this.directModeBtn.type = 'button';
    this.directModeBtn.className = 'ta-raid-mode-btn is-active';
    this.directModeBtn.setAttribute('data-testid', 'raid-mode-direct');
    this.directModeBtn.setAttribute('aria-pressed', 'true');
    this.directModeBtn.textContent = 'Direct Raid';
    this.directModeBtn.onclick = () => this.setMode('direct');

    this.goalModeBtn = document.createElement('button');
    this.goalModeBtn.type = 'button';
    this.goalModeBtn.className = 'ta-raid-mode-btn';
    this.goalModeBtn.setAttribute('data-testid', 'raid-mode-goal');
    this.goalModeBtn.setAttribute('aria-pressed', 'false');
    this.goalModeBtn.textContent = 'HQ Goal';
    this.goalModeBtn.onclick = () => this.setMode('goal');

    modesWrap.append(this.directModeBtn, this.goalModeBtn);
    header.append(title, modesWrap);

    this.pathIndicator = document.createElement('div');
    this.pathIndicator.className = 'ta-raid-path-line plate-sm';
    this.pathIndicator.setAttribute('data-testid', 'raid-path-indicator');
    this.pathIndicator.textContent = 'No active raid path';
    this.pathIndicator.hidden = true;

    this.listEl = document.createElement('div');
    this.listEl.className = 'ta-raid-targets-list';
    this.listEl.setAttribute('data-testid', 'raid-targets-list');

    this.panelEl.append(header, this.pathIndicator, this.listEl);
    this.root.append(this.toggleBtn, this.panelEl);
    host.appendChild(this.root);

    if (options.initialView) {
      this.update(options.initialView);
    } else {
      this.renderTargets([]);
    }
  }

  togglePanel(): void {
    this.panelEl.hidden = !this.panelEl.hidden;
    this.toggleBtn.setAttribute('aria-expanded', String(!this.panelEl.hidden));
  }

  setMode(mode: RaidPickerMode): void {
    this.mode = mode;
    const isDirect = mode === 'direct';
    this.directModeBtn.classList.toggle('is-active', isDirect);
    this.directModeBtn.setAttribute('aria-pressed', String(isDirect));
    this.goalModeBtn.classList.toggle('is-active', !isDirect);
    this.goalModeBtn.setAttribute('aria-pressed', String(!isDirect));
  }

  update(rawView: unknown): void {
    const ownIdx = this.opts.getOwnColonyIndex ? this.opts.getOwnColonyIndex() : this.ownColonyIndex;
    const targets = extractRaidTargets(rawView, ownIdx);
    this.renderTargets(targets);
  }

  dispose(): void {
    this.root.remove();
  }

  private send(kind: string, args: unknown): void {
    const sendFn = this.opts.actions?.sendCommand ?? this.opts.sendCommand;
    if (sendFn) void sendFn(kind, args);
  }

  private updatePathIndicator(target: RaidTargetOption): void {
    this.pathIndicator.hidden = false;
    this.pathIndicator.textContent = `Target: ${target.name} (${target.q}, ${target.r})`;
    this.pathIndicator.setAttribute('data-q', String(target.q));
    this.pathIndicator.setAttribute('data-r', String(target.r));
    this.pathIndicator.setAttribute('data-target-colony-id', target.colonyId);
    this.pathIndicator.setAttribute('data-colony-index', String(target.colonyIndex));
  }

  private dispatchTarget(target: RaidTargetOption, forceGoal = false): void {
    if (target.disabled) return;
    this.selectedTarget = target;
    this.updatePathIndicator(target);

    const useGoal = forceGoal || this.mode === 'goal';
    if (useGoal) {
      this.send('queueGoal', {
        goal: 'raid_target',
        params: { targetColonyId: target.colonyId },
      });
      this.opts.actions?.onQueueRaidGoal?.(target);
    } else {
      this.send('raid', {
        targetColonyId: target.colonyId,
        targetColonyIndex: target.colonyIndex,
      });
      this.opts.actions?.onDispatchRaid?.(target);
    }
    this.opts.actions?.onSelectTarget?.(target);
  }

  private formatReasonText(target: RaidTargetOption): {
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

  private renderReasonBadge(target: RaidTargetOption): HTMLElement {
    const badge = document.createElement('span');
    badge.className = 'ta-raid-target-reason';
    badge.setAttribute('data-testid', 'raid-target-reason');
    const { text, title, stateClass } = this.formatReasonText(target);
    if (stateClass) badge.classList.add(stateClass);
    badge.textContent = text;
    badge.title = title;
    return badge;
  }

  private renderTargetRow(target: RaidTargetOption): HTMLElement {
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
    const badge = this.renderReasonBadge(target);
    info.append(nameWrap, badge);

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
      this.dispatchTarget(target, false);
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
      this.dispatchTarget(target, true);
    };

    actions.append(dispatchBtn, goalBtn);
    row.append(info, actions);

    row.onclick = () => {
      this.dispatchTarget(target, this.mode === 'goal');
    };

    return row;
  }

  private renderTargets(targets: RaidTargetOption[]): void {
    const structSig = targets
      .map(
        (t) =>
          `${t.colonyIndex}:${t.colonyId}:${t.name}:${t.q}:${t.r}:${t.disabled}:${t.shieldActive}:${t.truceActive}:${t.crossSectorDisabled}`,
      )
      .join('|');
    if (this.lastTargetsSig === structSig) {
      for (const target of targets) {
        const row = this.listEl.querySelector<HTMLElement>(`[data-colony-id="${target.colonyId}"]`);
        const badge = row?.querySelector<HTMLElement>('[data-testid="raid-target-reason"]');
        if (badge) {
          const { text, title } = this.formatReasonText(target);
          if (badge.textContent !== text) badge.textContent = text;
          if (badge.title !== title) badge.title = title;
        }
      }
      return;
    }
    this.lastTargetsSig = structSig;

    while (this.listEl.firstChild) {
      this.listEl.removeChild(this.listEl.firstChild);
    }

    if (targets.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'ta-raid-empty';
      empty.setAttribute('data-testid', 'raid-no-targets');
      empty.textContent = 'No discovered neighbor colonies';
      this.listEl.appendChild(empty);
      return;
    }

    for (const target of targets) {
      this.listEl.appendChild(this.renderTargetRow(target));
    }
  }
}

export function createRaidTargetPicker(
  host: HTMLElement,
  options?: RaidTargetPickerOptions,
): RaidTargetPicker {
  return new RaidTargetPicker(host, options);
}
