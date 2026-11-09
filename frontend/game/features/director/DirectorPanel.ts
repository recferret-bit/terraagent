import type { DirectorActionState, SetDirectorPolicyArgs } from '@terra/contracts';
import type { ColonyDirectorRecord } from '@terra/sim';
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
}

/** Status plate for director policy & actions. Rationale and reason are untrusted text, never HTML. */
export class DirectorPanel {
  private readonly summaryEl: HTMLElement;
  private readonly controlsHost: HTMLElement;
  private readonly controls: DirectorControls | null;
  private readonly list: HTMLElement;
  private currentRows: DirectorActionRow[] = [];
  private planIntentRevision: number | null = null;

  constructor(private readonly host: HTMLElement, opts?: DirectorPanelOptions) {
    this.host.classList.add('ta-director', 'plate-sm');
    const title = document.createElement('div');
    title.className = 'ta-director__title';
    title.textContent = 'DIRECTOR';

    this.summaryEl = document.createElement('div');
    this.summaryEl.className = 'ta-director__summary';
    this.summaryEl.dataset.testid = 'director-policy-summary';
    this.summaryEl.hidden = true;

    this.controlsHost = document.createElement('div');
    this.controlsHost.className = 'ta-director__controls-wrap';
    this.controlsHost.hidden = !opts?.onPolicyChange;
    this.controls = opts?.onPolicyChange ? new DirectorControls(this.controlsHost, opts.onPolicyChange) : null;

    this.list = document.createElement('div');
    this.list.className = 'ta-director__list';
    this.host.append(title, this.summaryEl, this.controlsHost, this.list);
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
    this.controls?.dispose();
    this.host.replaceChildren();
    this.host.classList.remove('ta-director', 'plate-sm');
  }
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
