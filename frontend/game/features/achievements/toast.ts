export interface AchievementToastPayload {
  readonly achievementId: string;
  readonly familyId?: string;
  readonly familyName: string;
  readonly tierName: string;
  readonly xp: number;
}

interface EventSourceLike {
  onServerEvents?(fn: (events: ReadonlyArray<{ kind: string; data?: Record<string, unknown> }>) => void): () => void;
}

/**
 * In-game toast for `achievement.earned` events (W12-27).
 * Uses `createElement` + `textContent` only (PA-03: never `innerHTML`) and links to `/me.html#achievements`.
 */
export class AchievementToastHost {
  private current: HTMLElement | null = null;
  private offEvents: (() => void) | null = null;

  constructor(private readonly host: HTMLElement, store?: EventSourceLike) {
    this.host.hidden = true;
    this.host.setAttribute('role', 'status');
    this.host.setAttribute('aria-live', 'polite');
    if (store?.onServerEvents) {
      this.offEvents = store.onServerEvents((events) => {
        for (const e of events) {
          if (e.kind !== 'achievement.earned' || !e.data) continue;
          this.show({
            achievementId: String(e.data.achievementId ?? ''),
            familyId: typeof e.data.familyId === 'string' ? e.data.familyId : undefined,
            familyName: String(e.data.familyName ?? 'Achievement'),
            tierName: String(e.data.tierName ?? 'Bronze'),
            xp: Number(e.data.xp ?? 50),
          });
        }
      });
    }
  }

  show(payload: AchievementToastPayload): void {
    this.dismiss();
    const card = document.createElement('div');
    card.className = 'plate-sm ta-achievement-toast';
    card.dataset.testid = 'achievement-toast';
    card.dataset.achievementId = payload.achievementId;

    const head = document.createElement('div');
    head.className = 'ta-achievement-toast-head';

    const eyebrow = document.createElement('span');
    eyebrow.className = 'label c-orange';
    eyebrow.textContent = 'ACHIEVEMENT UNLOCKED';

    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'ta-toast-close';
    closeBtn.setAttribute('aria-label', 'Dismiss achievement notification');
    closeBtn.textContent = '×';
    closeBtn.onclick = () => this.dismiss();

    head.appendChild(eyebrow);
    head.appendChild(closeBtn);

    const title = document.createElement('p');
    title.className = 'ta-achievement-toast-title';
    title.textContent = `${payload.familyName} · ${payload.tierName} (+${payload.xp} XP)`;

    const link = document.createElement('a');
    link.className = 'btn btn-ghost btn-sm ta-achievement-toast-link';
    link.href = '/me.html#achievements';
    link.textContent = 'VIEW ACHIEVEMENTS →';

    card.appendChild(head);
    card.appendChild(title);
    card.appendChild(link);

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
