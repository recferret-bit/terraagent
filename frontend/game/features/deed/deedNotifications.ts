import type { DeedUpdatedPayload } from '@terra/contracts';

export interface DeedToastInput {
  readonly colonyId: string;
  readonly tokenId: string;
  readonly version: number;
  readonly change: string;
  readonly settled?: boolean;
}

export interface DeedNotificationSource {
  onDeedUpdated?(fn: (payload: DeedUpdatedPayload) => void): () => void;
  onServerEvents?(
    fn: (events: ReadonlyArray<{ kind: string; data?: Record<string, unknown> }>) => void,
  ): () => void;
}

/**
 * W20-25: In-game HUD toast for `deed.updated` pushes (`"Your Deed was updated: <change>"`).
 * Uses `createElement` + `textContent` only (PA-03: never `innerHTML`) and deduplicates by
 * `(colonyId, version, change)` so a milestone update triggers the toast at most once.
 */
export class DeedToastHost {
  private current: HTMLElement | null = null;
  private readonly offs: Array<() => void> = [];
  private readonly seenKeys = new Set<string>();

  constructor(
    private readonly host: HTMLElement,
    source?: DeedNotificationSource,
  ) {
    this.host.hidden = true;
    this.host.setAttribute('role', 'status');
    this.host.setAttribute('aria-live', 'polite');

    if (source?.onDeedUpdated) {
      this.offs.push(
        source.onDeedUpdated((payload) => {
          this.handleUpdate({
            colonyId: payload.colonyId,
            tokenId: payload.tokenId,
            version: payload.version,
            change: payload.change,
            settled: payload.deed?.settled ?? payload.metadata?.settled,
          });
        }),
      );
    }

    if (source?.onServerEvents) {
      this.offs.push(
        source.onServerEvents((events) => {
          for (const ev of events) {
            if ((ev.kind !== 'deedUpdated' && ev.kind !== 'deed.updated') || !ev.data) continue;
            const change =
              typeof ev.data.change === 'string' && ev.data.change.length > 0
                ? ev.data.change
                : '';
            if (!change) continue;
            this.handleUpdate({
              colonyId: String(ev.data.colonyId ?? 'col_0'),
              tokenId: String(ev.data.tokenId ?? 'deed:col_0'),
              version: Number(ev.data.version ?? 2),
              change,
              settled: Boolean(ev.data.settled),
            });
          }
        }),
      );
    }
  }

  handleUpdate(input: DeedToastInput): boolean {
    const change = input.change.trim();
    if (!change) return false;
    // Initial mint v1 is not a milestone update toast
    if (input.version <= 1 && change === 'Deed minted on NEAR') return false;

    const dedupeKey = `${input.colonyId}:${input.version}:${change}`;
    if (this.seenKeys.has(dedupeKey)) return false;
    this.seenKeys.add(dedupeKey);

    this.show(input);
    return true;
  }

  show(input: DeedToastInput): void {
    this.dismiss();

    const card = document.createElement('div');
    card.className = 'plate-sm ta-deed-toast';
    card.dataset.testid = 'deed-toast';
    card.dataset.tokenId = input.tokenId;
    card.dataset.version = String(input.version);
    card.dataset.settled = input.settled ? 'true' : 'false';

    const head = document.createElement('div');
    head.className = 'ta-deed-toast-head';

    const eyebrow = document.createElement('span');
    eyebrow.className = 'label c-orange';
    eyebrow.textContent = input.settled ? 'COLONY DEED SETTLED' : 'COLONY DEED UPDATED';

    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'ta-deed-toast-close';
    closeBtn.setAttribute('aria-label', 'Dismiss deed notification');
    closeBtn.textContent = '×';
    closeBtn.onclick = () => this.dismiss();

    head.appendChild(eyebrow);
    head.appendChild(closeBtn);

    const msg = document.createElement('p');
    msg.className = 'ta-deed-toast-msg';
    msg.dataset.testid = 'deed-toast-message';
    msg.textContent = `Your Deed was updated: ${input.change.trim()}`;

    card.appendChild(head);
    card.appendChild(msg);

    this.host.appendChild(card);
    this.host.hidden = false;
    this.current = card;
  }

  dismiss(): void {
    this.current?.remove();
    this.current = null;
    this.host.hidden = true;
  }

  dispose(): void {
    for (const off of this.offs.splice(0)) off();
    this.dismiss();
  }
}
