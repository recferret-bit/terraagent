import { el } from '../dom';
import './flip-card.css';

export type FlipDirection = 'to-back' | 'to-front';

export function isFlipped(card: HTMLElement): boolean {
  return card.classList.contains('flip') || card.classList.contains('is-flipped');
}

export function setFlipped(card: HTMLElement, next: boolean): void {
  const dir: FlipDirection = next ? 'to-back' : 'to-front';
  card.dataset.flipDir = dir;
  card.classList.toggle('flip', next);
  card.classList.toggle('is-flipped', next);
  card.setAttribute('aria-expanded', next ? 'true' : 'false');
}

export function toggleFlipCard(card: HTMLElement): boolean {
  const next = !isFlipped(card);
  setFlipped(card, next);
  return next;
}

/**
 * Binds click/tap, hover direction tracking, and keyboard (`Enter` / `Space`) flip toggling
 * and `aria-expanded` sync (W12-21, PA-02).
 * Ignores clicks on nested interactive links/buttons (e.g. Share-to-X) so they don't unflip the card.
 */
export function bindFlipCard(card: HTMLElement): void {
  card.tabIndex = 0;
  if (!card.getAttribute('role')) card.setAttribute('role', 'button');
  if (!card.getAttribute('aria-expanded')) card.setAttribute('aria-expanded', 'false');
  if (!card.dataset.flipDir) card.dataset.flipDir = 'to-front';

  card.addEventListener('mouseenter', () => {
    if (!isFlipped(card)) {
      card.dataset.flipDir = 'to-back';
    }
  });

  card.addEventListener('mouseleave', () => {
    if (!isFlipped(card)) {
      card.dataset.flipDir = 'to-front';
    }
  });

  card.addEventListener('click', (ev: MouseEvent) => {
    const target = ev.target as HTMLElement | null;
    if (target?.closest('a, button')) return;
    toggleFlipCard(card);
  });

  card.addEventListener('keydown', (ev: KeyboardEvent) => {
    const target = ev.target as HTMLElement | null;
    if (target && target !== card && target.closest('a, button')) return;
    if (ev.key === 'Enter' || ev.key === ' ') {
      ev.preventDefault();
      toggleFlipCard(card);
    }
  });
}

export function createFlipCardShell(
  attrs: {
    readonly id: string;
    readonly familyId: string;
    readonly tier: number;
    readonly status: string;
    readonly isNextToEarn: boolean;
    readonly indexInLadder: number;
    readonly label: string;
    readonly tierColor: string;
  },
  frontFace: HTMLElement,
  backFace: HTMLElement,
): HTMLElement {
  frontFace.classList.add('flip-face', 'flip-front');
  backFace.classList.add('flip-face', 'flip-back');

  const frontSheen = el('div', {
    className: 'flip-sheen flip-sheen-front',
    dataset: { testid: 'ach-flip-sheen-front' },
    aria: { hidden: 'true' },
  });
  const backSheen = el('div', {
    className: 'flip-sheen flip-sheen-back',
    dataset: { testid: 'ach-flip-sheen-back' },
    aria: { hidden: 'true' },
  });
  frontFace.appendChild(frontSheen);
  backFace.appendChild(backSheen);

  const inner = el('div', { className: 'flip-inner' }, frontFace, backFace);

  const card = el(
    'article',
    {
      className: `plate-sm ta-ach-card flip-card is-${attrs.status}`,
      tabIndex: 0,
      role: 'button',
      aria: { expanded: 'false', label: attrs.label },
      dataset: {
        testid: `ach-card-${attrs.id}`,
        achievementId: attrs.id,
        familyId: attrs.familyId,
        tier: attrs.tier,
        status: attrs.status,
        next: attrs.isNextToEarn ? 'true' : 'false',
        flipDir: 'to-front',
      },
      style: {
        '--i': String(attrs.indexInLadder),
        '--tier': attrs.tierColor,
      },
    },
    inner,
  );

  bindFlipCard(card);
  return card;
}
