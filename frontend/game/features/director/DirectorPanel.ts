import type { DirectorActionState, SetDirectorPolicyArgs } from '@terra/contracts';
import type { ColonyDirectorRecord } from '@terra/sim';
import { patchSharedAutopilotState, subscribeSharedAutopilotState } from '../shared/aiAutopilotState';
import { DirectorControls } from './DirectorControls';

/** One director action as the HUD may show it. Only `applied` means the sim accepted it. */
export interface DirectorActionRow {
  actionId: string;
  state: DirectorActionState;
  reason?: string;
  rationale?: string;
}

export interface DirectorPanelOptions {
  readonly onPolicyChange?: (patch: SetDirectorPolicyArgs) => void;
  readonly onToggleAutopilot?: (enabled: boolean) => void;
  readonly onToggleWarDiplomacy?: (enabled: boolean) => void;
  readonly onOpenHq?: () => void;
}

export interface DirectorAutopilotState {
  readonly aiEnabled: boolean;
  readonly warDiplomacy: boolean;
}

/** Status plate for director policy & actions. Rationale and reason are untrusted text, never HTML. */
export class DirectorPanel {
  private readonly autopilotBar: HTMLElement | null;
  private readonly autopilotBtn: HTMLButtonElement | null;
  private readonly aiStatusPill: HTMLElement;
  private readonly warToggleInput: HTMLInputElement | null;
  private readonly summaryEl: HTMLElement;
  private readonly controlsHost: HTMLElement;
  private readonly controls: DirectorControls | null;
  private readonly list: HTMLElement;
  private readonly offShared: () => void;
  private aiEnabled = false;
  private currentRows: DirectorActionRow[] = [];
  private planIntentRevision: number | null = null;

  constructor(private readonly host: HTMLElement, opts?: DirectorPanelOptions) {
    this.host.classList.add('ta-director', 'plate-sm');
    const head = buildDirectorHeader(opts?.onOpenHq);
    this.aiStatusPill = head.aiStatusPill;

    const autoParts = buildAutopilotBar(opts, () => this.aiEnabled, (next) => {
      this.aiEnabled = next;
      this.renderAutopilotBtn();
      patchSharedAutopilotState({ aiEnabled: next });
      opts?.onToggleAutopilot?.(next);
    });
    this.autopilotBar = autoParts?.bar ?? null;
    this.autopilotBtn = autoParts?.btn ?? null;
    this.warToggleInput = autoParts?.warInput ?? null;
    this.renderAutopilotBtn();

    this.summaryEl = document.createElement('div');
    this.summaryEl.className = 'ta-director__summary';
    this.summaryEl.dataset.testid = 'director-policy-summary';
    this.summaryEl.hidden = true;

    this.controlsHost = document.createElement('div');
    this.controlsHost.className = 'ta-director__controls-wrap';
    this.controlsHost.hidden = !opts?.onPolicyChange;
    this.controls = opts?.onPolicyChange ? new DirectorControls(this.controlsHost, opts.onPolicyChange) : null;

    const planKicker = document.createElement('div');
    planKicker.className = 'ta-director__section-label';
    planKicker.textContent = 'ACTION FEED';

    this.list = document.createElement('div');
    this.list.className = 'ta-director__list';
    if (this.autopilotBar) {
      this.host.append(head.el, this.autopilotBar, this.summaryEl, this.controlsHost, planKicker, this.list);
    } else {
      this.host.append(head.el, this.summaryEl, this.controlsHost, planKicker, this.list);
    }

    this.offShared = subscribeSharedAutopilotState((st) => {
      this.aiEnabled = st.aiEnabled;
      this.renderAutopilotBtn();
      if (this.warToggleInput) this.warToggleInput.checked = st.awayRaids;
    });
  }

  /** Mirrors replica `aiEnabled` (`setAiEnabled`) and `awayRaids` (`setAutopilot`) onto the plate. */
  syncAutopilot(state: DirectorAutopilotState): void {
    this.aiEnabled = state.aiEnabled;
    this.renderAutopilotBtn();
    if (this.warToggleInput) {
      this.warToggleInput.checked = state.warDiplomacy;
    }
    patchSharedAutopilotState({
      aiEnabled: state.aiEnabled,
      awayRaids: state.warDiplomacy,
    });
  }

  private renderAutopilotBtn(): void {
    this.aiStatusPill.textContent = this.aiEnabled ? 'COLONY AI: ON' : 'COLONY AI: OFF';
    this.aiStatusPill.dataset.enabled = String(this.aiEnabled);
    if (!this.autopilotBtn) return;
    this.autopilotBtn.textContent = this.aiEnabled ? 'AI AUTOPILOT: ON' : 'AI AUTOPILOT: OFF';
    this.autopilotBtn.className = this.aiEnabled ? 'btn btn-sm btn-primary' : 'btn btn-sm btn-ghost';
    this.autopilotBtn.setAttribute('aria-pressed', String(this.aiEnabled));
  }

  /** Syncs the live colony director policy onto the plate and marks older open plans as superseded. */
  syncPolicy(record: ColonyDirectorRecord | undefined): void {
    if (!record) return;
    const { policy, intentRevision } = record;
    const budget = policy.risk === 'risky' ? '35% commit / 15% reserve' : '15% commit / 40% reserve';
    this.summaryEl.hidden = false;
    this.summaryEl.dataset.risk = policy.risk;
    this.summaryEl.dataset.preset = policy.preset;
    this.summaryEl.dataset.revision = String(policy.revision);
    this.summaryEl.dataset.intentRevision = String(intentRevision);
    this.summaryEl.textContent = `${policy.risk} · ${policy.preset} · ${budget}${policy.pause ? ' · paused' : ''}`;
    this.controls?.sync(policy);

    if (this.planIntentRevision !== null && intentRevision > this.planIntentRevision && this.currentRows.length > 0) {
      this.planIntentRevision = intentRevision;
      this.render(
        this.currentRows.map((row) =>
          row.state === 'proposed' || row.state === 'applied' ? { ...row, state: 'superseded' } : row,
        ),
      );
    }
  }

  /** Renders a plan's action rows bound to the colony's current `intentRevision`. */
  renderPlan(rows: readonly DirectorActionRow[], intentRevision = 0): void {
    this.planIntentRevision = intentRevision;
    this.render(rows);
  }

  /** Rebuilds the list. A `rejected` row is labelled rejected, never applied. */
  render(rows: readonly DirectorActionRow[]): void {
    this.currentRows = rows.map((r) => ({ ...r }));
    this.list.replaceChildren();
    for (const row of rows) this.list.appendChild(actionRow(row));
  }

  dispose(): void {
    this.offShared();
    this.controls?.dispose();
    this.host.replaceChildren();
    this.host.classList.remove('ta-director', 'plate-sm');
  }
}

function buildDirectorHeader(onOpenHq?: () => void): { el: HTMLElement; aiStatusPill: HTMLElement } {
  const el = document.createElement('div');
  el.className = 'ta-director__head';
  const title = document.createElement('div');
  title.className = 'ta-director__title';
  title.textContent = 'DIRECTOR';
  const right = document.createElement('div');
  right.className = 'ta-director__head-actions';
  const aiStatusPill = document.createElement('span');
  aiStatusPill.className = 'ta-director__ai-pill';
  aiStatusPill.dataset.testid = 'director-ai-status';
  right.appendChild(aiStatusPill);
  if (onOpenHq) {
    const jump = document.createElement('button');
    jump.type = 'button';
    jump.className = 'btn btn-ghost btn-sm ta-director__hq-jump';
    jump.dataset.testid = 'director-open-hq';
    jump.textContent = 'HQ AI →';
    jump.title = 'Open HQ AI to toggle master AI or edit goals & priorities';
    jump.addEventListener('click', () => onOpenHq());
    right.appendChild(jump);
  }
  el.append(title, right);
  return { el, aiStatusPill };
}

function buildAutopilotBar(
  opts: DirectorPanelOptions | undefined,
  readEnabled: () => boolean,
  onFlipAutopilot: (next: boolean) => void,
): { bar: HTMLElement; btn: HTMLButtonElement | null; warInput: HTMLInputElement | null } | null {
  if (!opts?.onToggleAutopilot && !opts?.onToggleWarDiplomacy) return null;
  const bar = document.createElement('div');
  bar.className = 'ta-director__autopilot';
  let btn: HTMLButtonElement | null = null;
  let warInput: HTMLInputElement | null = null;
  if (opts.onToggleAutopilot) {
    btn = document.createElement('button');
    btn.type = 'button';
    btn.dataset.testid = 'director-autopilot-toggle';
    btn.addEventListener('click', () => onFlipAutopilot(!readEnabled()));
    bar.appendChild(btn);
  }
  if (opts.onToggleWarDiplomacy) {
    const label = document.createElement('label');
    label.className = 'ta-director__war-opt';
    warInput = document.createElement('input');
    warInput.type = 'checkbox';
    warInput.dataset.testid = 'director-war-diplomacy-toggle';
    warInput.addEventListener('change', () => {
      const checked = Boolean(warInput?.checked);
      patchSharedAutopilotState({ awayRaids: checked });
      opts.onToggleWarDiplomacy?.(checked);
    });
    label.append(warInput, 'Allow War & Diplomacy');
    bar.appendChild(label);
  }
  return { bar, btn, warInput };
}

function actionRow(row: DirectorActionRow): HTMLElement {
  const el = document.createElement('div');
  el.className = 'ta-director__row';
  el.dataset.state = row.state;
  el.dataset.actionId = row.actionId;
  const id = document.createElement('span');
  id.className = 'ta-director__id';
  id.textContent = row.actionId;
  const state = document.createElement('span');
  state.className = 'ta-director__state';
  state.textContent = row.state;
  el.append(id, ' ', state);
  appendText(el, 'ta-director__reason', row.reason);
  appendText(el, 'ta-director__rationale', row.rationale);
  return el;
}

function appendText(parent: HTMLElement, className: string, value: string | undefined): void {
  if (!value) return;
  const span = document.createElement('span');
  span.className = className;
  span.textContent = value;
  parent.append(' ', span);
}
