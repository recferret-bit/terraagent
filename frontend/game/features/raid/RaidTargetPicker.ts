import { extractRaidTargets, type RaidTargetOption } from './raidTargets';
import { formatRaidReasonText, renderRaidTargetRow } from './parts/raidDom';
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
          const { text, title } = formatRaidReasonText(target);
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
      this.listEl.appendChild(
        renderRaidTargetRow(
          target,
          (t, forceGoal) => this.dispatchTarget(t, forceGoal),
          (t) => this.dispatchTarget(t, this.mode === 'goal'),
        ),
      );
    }
  }
}

export function createRaidTargetPicker(
  host: HTMLElement,
  options?: RaidTargetPickerOptions,
): RaidTargetPicker {
  return new RaidTargetPicker(host, options);
}
