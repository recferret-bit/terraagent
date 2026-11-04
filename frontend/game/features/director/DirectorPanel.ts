import type { DirectorActionState } from '@terra/contracts';

/** One director action as the HUD may show it. Only `applied` means the sim accepted it. */
export interface DirectorActionRow {
  actionId: string;
  state: DirectorActionState;
  reason?: string;
  rationale?: string;
}

/** Status plate for director actions. Rationale and reason are untrusted text, never HTML. */
export class DirectorPanel {
  private readonly list: HTMLElement;

  constructor(private readonly host: HTMLElement) {
    this.host.classList.add('ta-director', 'plate-sm');
    const title = document.createElement('div');
    title.className = 'ta-director__title';
    title.textContent = 'DIRECTOR';
    this.list = document.createElement('div');
    this.list.className = 'ta-director__list';
    this.host.append(title, this.list);
  }

  /** Rebuilds the list. A `rejected` row is labelled rejected, never applied. */
  render(rows: readonly DirectorActionRow[]): void {
    this.list.replaceChildren();
    for (const row of rows) this.list.appendChild(actionRow(row));
  }

  dispose(): void {
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
