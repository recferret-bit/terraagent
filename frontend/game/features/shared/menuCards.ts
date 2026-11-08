import { fillArchetypeThumb } from './archetypeThumb';

export const MENU_TIERS = [1, 2, 3] as const;
export type MenuTier = (typeof MENU_TIERS)[number];

export const WORKER_ROLE = 'Harvest, build, and terraform';

export interface MenuCardFace {
  face: HTMLElement;
  overlay: HTMLElement;
  title: HTMLElement;
  tierEl: HTMLElement;
  price: HTMLElement;
  shortTime: HTMLElement;
}

const SHORT_KEYS = ['metals.t1', 'minerals.t1'] as const;
const SHORT_LABELS: Record<(typeof SHORT_KEYS)[number], string> = {
  'metals.t1': 'Metals',
  'minerals.t1': 'Minerals',
};

export function isMenuTier(tier: number): tier is MenuTier {
  return tier === 1 || tier === 2 || tier === 3;
}

export function presentTiers(cards: readonly { tier: number }[]): MenuTier[] {
  const have = new Set(cards.map((card) => card.tier));
  return MENU_TIERS.filter((tier) => have.has(tier));
}

/** Lowest tier that has an enabled card, or the lowest tier that has any card. */
export function defaultMenuTier(cards: readonly { tier: number; disabled: boolean }[]): MenuTier {
  const enabled = cards.filter((card) => !card.disabled);
  const source = enabled.length > 0 ? enabled : cards;
  return presentTiers(source)[0] ?? 1;
}

/** Keeps a remembered tier when that tab still has cards. */
export function rememberTier(
  current: MenuTier | null,
  cards: readonly { tier: number; disabled: boolean }[],
): MenuTier {
  const present = presentTiers(cards);
  if (current != null && present.includes(current)) return current;
  return defaultMenuTier(cards);
}

/** Metals and minerals only. The full cost stays in the hover plate. */
export function shortResourceLine(cost: Record<string, number>): string {
  const parts: string[] = [];
  for (const key of SHORT_KEYS) {
    const amt = cost[key] ?? 0;
    if (amt > 0) parts.push(`${amt} ${SHORT_LABELS[key]}`);
  }
  return parts.join(' · ');
}

export function workerRole(unit: string): string {
  if (unit === 'worker') return WORKER_ROLE;
  return 'Unit';
}

export function renderTierBar(
  root: HTMLElement,
  prefix: 'prod' | 'build',
  present: readonly MenuTier[],
  selected: MenuTier,
  onPick: (tier: MenuTier) => void,
): void {
  const key = `${prefix}:${present.join(',')}:${selected}`;
  if (root.dataset.tierKey === key) return;
  root.dataset.tierKey = key;
  root.className = 'ta-tierbar';
  root.replaceChildren();
  for (const tier of present) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'ta-tierbar__tab';
    btn.setAttribute('data-testid', `${prefix}-tier-t${tier}`);
    btn.setAttribute('aria-selected', tier === selected ? 'true' : 'false');
    btn.textContent = `T${tier}`;
    btn.onclick = () => onPick(tier);
    root.appendChild(btn);
  }
}

export function setTierVisible(el: HTMLElement, on: boolean): void {
  el.setAttribute('data-tier-on', on ? 'true' : 'false');
}

/** Image, truncated name, tier, short price and short time. The same nodes for Build and Production. */
export function createMenuCardFace(titleClass: string, archetypeId: string, middle?: HTMLElement): MenuCardFace {
  const face = document.createElement('span');
  face.className = 'ta-card-face';
  const thumb = document.createElement('span');
  fillArchetypeThumb(thumb, archetypeId);
  const overlay = document.createElement('span');
  overlay.className = 'ta-card-overlay';
  const top = document.createElement('span');
  top.className = 'ta-card-overlay__top';
  const title = document.createElement('span');
  title.className = titleClass;
  const tierEl = document.createElement('span');
  tierEl.className = 'ta-card-tier';
  top.append(title, tierEl);
  const bottom = document.createElement('span');
  bottom.className = 'ta-card-overlay__bottom';
  const price = document.createElement('span');
  price.className = 'ta-card-price';
  const shortTime = document.createElement('span');
  shortTime.className = 'ta-card-time';
  bottom.append(price, shortTime);
  if (middle) overlay.append(top, middle, bottom);
  else overlay.append(top, bottom);
  face.append(thumb, overlay);
  return { face, overlay, title, tierEl, price, shortTime };
}

/**
 * The card is chamfered with `clip-path`, which would clip a `position: fixed` tip.
 * Park the tip on `document.body` while it is open so the details clear the card and the dock scroller.
 */
export function bindCardTip(card: HTMLElement, tip: HTMLElement): void {
  if (typeof card.addEventListener !== 'function') return;
  const place = (): void => {
    const rect = card.getBoundingClientRect();
    const dock = typeof card.closest === 'function' ? card.closest('[data-testid="command-dock"]') : null;
    const anchor = dock instanceof HTMLElement ? dock.getBoundingClientRect() : rect;
    const width = typeof window !== 'undefined' ? window.innerWidth : 800;
    const beside = anchor.right + 8;
    const left = beside + 220 <= width - 8 ? beside : Math.max(8, rect.left);
    tip.style.left = `${left}px`;
    tip.style.top = `${Math.max(8, rect.top)}px`;
  };
  const show = (): void => {
    const body = typeof document !== 'undefined' ? document.body : null;
    if (body && tip.parentElement !== body) body.appendChild(tip);
    tip.style.display = 'flex';
    place();
  };
  const hide = (): void => {
    tip.style.display = '';
    if (card.isConnected && tip.parentElement !== card) card.appendChild(tip);
  };
  card.addEventListener('pointerenter', show);
  card.addEventListener('pointerleave', hide);
  card.addEventListener('focus', show);
  card.addEventListener('blur', hide);
}

/** What a stage-locked card says (both menus' card models carry these). */
export interface StageLockText {
  label: string;
  unlockConditionText?: string;
  disabledReason?: string;
  unlockDetailText?: string;
}

/** Marks a stage-locked card: title / aria text and `data-unlock-detail`. Returns the detail line. */
export function applyStageLockAttrs(el: HTMLElement, card: StageLockText): string {
  el.setAttribute('data-stage-locked', 'true');
  const cond = card.unlockConditionText ?? card.disabledReason ?? '';
  const detail = card.unlockDetailText ?? cond;
  const full = detail && detail !== cond ? `${cond} (${detail})` : cond;
  el.setAttribute('title', full);
  el.setAttribute('aria-label', `${card.label} — ${full}`);
  el.setAttribute('data-unlock-detail', detail);
  return detail;
}

/** Undoes {@link applyStageLockAttrs}. */
export function clearStageLockAttrs(el: HTMLElement): void {
  if (typeof el.removeAttribute !== 'function') return;
  for (const attr of ['data-stage-locked', 'title', 'aria-label', 'data-unlock-detail']) el.removeAttribute(attr);
}

/** Refills `container` with one pill per text when the texts changed since `prevKey`; returns the new key. */
export function syncCostPills(container: HTMLElement, pills: readonly string[], pillClass: string, prevKey: string): string {
  const key = pills.join('|');
  if (key === prevKey) return prevKey;
  container.replaceChildren();
  for (const text of pills) {
    const pill = document.createElement('span');
    pill.className = pillClass;
    pill.textContent = text;
    container.appendChild(pill);
  }
  return key;
}
