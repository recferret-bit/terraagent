import { directorDigestLine } from '../../../../backend/app/src/market/director/digest-line';

const MAX_LINES = 20;

export interface DirectorLogEvent {
  readonly kind: string;
  readonly data?: Record<string, unknown>;
}

export interface DirectorLogHooks {
  /** False while W09's digest plate owns the sentence. */
  showLine(): boolean;
}

function lineOf(event: DirectorLogEvent): string | null {
  if (event.kind !== 'directorTrade') return null;
  const data = event.data;
  if (!data) return null;
  const amount = data.amount;
  return directorDigestLine({
    resource: String(data.resource ?? ''),
    side: String(data.side ?? ''),
    amount: typeof amount === 'number' ? amount : 0,
    counterparty: String(data.counterparty ?? ''),
  });
}

/** HUD lines for `directorTrade` when W09 is off. W09 on records nothing here. */
export class DirectorEventLog {
  private readonly root: HTMLElement;
  private readonly rows: string[] = [];

  constructor(
    parent: HTMLElement,
    private readonly hooks: DirectorLogHooks,
  ) {
    this.root = document.createElement('ul');
    this.root.className = 'ta-director-log plate-sm';
    this.root.dataset.testid = 'director-event-log';
    this.root.setAttribute('role', 'log');
    this.root.setAttribute('aria-label', 'Event log');
    this.root.hidden = true;
    parent.appendChild(this.root);
  }

  pushEvents(events: readonly DirectorLogEvent[]): void {
    if (!this.hooks.showLine()) return;
    let added = false;
    for (const event of events) {
      const line = lineOf(event);
      if (!line) continue;
      this.rows.push(line);
      added = true;
    }
    if (this.rows.length > MAX_LINES) this.rows.splice(0, this.rows.length - MAX_LINES);
    if (added) this.paint();
  }

  dispose(): void {
    this.root.remove();
  }

  private paint(): void {
    this.root.replaceChildren();
    for (const line of this.rows) {
      const li = document.createElement('li');
      li.className = 'ta-director-log__line';
      li.dataset.kind = 'digest.directorTrade';
      li.dataset.testid = 'director-event-line';
      li.textContent = line;
      this.root.appendChild(li);
    }
    this.root.hidden = this.rows.length === 0;
  }
}
