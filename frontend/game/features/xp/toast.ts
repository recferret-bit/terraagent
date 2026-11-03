export interface XpLevelUpToastPayload {
  readonly level: number;
  readonly previousLevel?: number;
  readonly xp: number;
  readonly title?: string;
}

interface EventSourceLike {
  onServerEvents?(fn: (events: ReadonlyArray<{ kind: string; data?: Record<string, unknown> }>) => void): () => void;
}

/**
 * In-game toast for `xp.levelUp` events (W12-27).
 * Uses `createElement` + `textContent` only (PA-03: never `innerHTML`) without profile navigation.
 */
export class XpToastHost {
  private current: HTMLElement | null = null;
  private offEvents: (() => void) | null = null;

  constructor(private readonly host: HTMLElement, store?: EventSourceLike) {
    this.host.hidden = true;
    this.host.setAttribute('role', 'status');
    this.host.setAttribute('aria-live', 'polite');
    if (store?.onServerEvents) {
      this.offEvents = store.onServerEvents((events) => {
        for (const e of events) {
          if (e.kind !== 'xp.levelUp' || !e.data) continue;
          this.show({
            level: Number(e.data.level ?? 1),
            previousLevel: typeof e.data.previousLevel === 'number' ? e.data.previousLevel : undefined,
            xp: Number(e.data.xp ?? 0),
            title: typeof e.data.title === 'string' ? e.data.title : undefined,
          });
        }
      });
    }
  }

  show(payload: XpLevelUpToastPayload): void {
    this.dismiss();
    const card = document.createElement('div');
    card.className = 'plate-sm ta-xp-toast';
    card.dataset.testid = 'xp-level-up-toast';
    card.dataset.level = String(payload.level);

    const head = document.createElement('div');
    head.className = 'ta-xp-toast-head';

    const eyebrow = document.createElement('span');
    eyebrow.className = 'label c-blue';
    eyebrow.textContent = 'LEVEL UP';

    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'ta-toast-close';
    closeBtn.setAttribute('aria-label', 'Dismiss level up notification');
    closeBtn.textContent = '×';
    closeBtn.onclick = () => this.dismiss();

    head.appendChild(eyebrow);
    head.appendChild(closeBtn);

    const title = document.createElement('p');
    title.className = 'ta-xp-toast-title';
    const titlePart = payload.title ? ` · ${payload.title}` : '';
    title.textContent = `Level ${payload.level}${titlePart} (${payload.xp} XP)`;

    card.appendChild(head);
    card.appendChild(title);

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
    this.offEvents?.();
    this.offEvents = null;
    this.dismiss();
  }
}
