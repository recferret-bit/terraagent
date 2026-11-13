import { pushNotification } from '../notifications/notificationStore';

export const DEFAULT_XP_TOAST_DURATION_MS = 6000;

export interface XpLevelUpToastPayload {
  readonly level: number;
  readonly previousLevel?: number;
  readonly xp: number;
  readonly title?: string;
}

interface EventSourceLike {
  onServerEvents?(fn: (events: ReadonlyArray<{ kind: string; data?: Record<string, unknown> }>) => void): () => void;
  onOpenPlayer?: () => void;
}

/**
 * In-game toast for `xp.levelUp` events (W12-27).
 * Uses `createElement` + `textContent` only (PA-03: never `innerHTML`) without profile navigation.
 */
export class XpToastHost {
  private current: HTMLElement | null = null;
  private offEvents: (() => void) | null = null;
  private autoDismissTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly host: HTMLElement,
    private readonly store?: EventSourceLike,
    private readonly durationMs = DEFAULT_XP_TOAST_DURATION_MS,
  ) {
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
    closeBtn.dataset.testid = 'xp-toast-close';
    closeBtn.setAttribute('aria-label', 'Dismiss level up notification');
    closeBtn.textContent = '×';
    closeBtn.onclick = () => this.dismiss();

    head.appendChild(eyebrow);
    head.appendChild(closeBtn);

    const title = document.createElement('p');
    title.className = 'ta-xp-toast-title';
    const titlePart = payload.title ? ` · ${payload.title}` : '';
    const message = `Level ${payload.level}${titlePart} (${payload.xp} XP)`;
    title.textContent = message;

    card.appendChild(head);
    card.appendChild(title);

    this.host.appendChild(card);
    this.host.hidden = false;
    this.current = card;
    pushNotification({
      category: 'achievement',
      title: 'Level Up',
      message,
      dedupeKey: `xp-level:${payload.level}`,
      onSelect: () => this.store?.onOpenPlayer?.(),
    });
    if (this.durationMs > 0) {
      this.autoDismissTimer = setTimeout(() => this.dismiss(), this.durationMs);
    }
  }

  dismiss(): void {
    if (this.autoDismissTimer !== null) {
      clearTimeout(this.autoDismissTimer);
      this.autoDismissTimer = null;
    }
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
