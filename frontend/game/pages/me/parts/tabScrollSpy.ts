import { parseStakingHash } from '../sections/staking/stakingRoute';

export interface MeTabNavigationOptions {
  readonly root: HTMLElement;
  readonly initialHash: string;
  readonly now?: () => number;
  readonly onSectionClick?: (sectionId: string) => void;
}

export interface MeTabNavigationHandle {
  syncFromScroll(): void;
  setActive(sectionId: string): void;
  scrollToSection(sectionId: string, behavior?: ScrollBehavior): boolean;
  dispose(): void;
}

const PROGRAMMATIC_SAFETY_CEILING_MS = 4000;
const SCROLL_SETTLE_IDLE_MS = 180;
const PIN_DRIFT_TOLERANCE_PX = 6;
const BOTTOM_THRESHOLD_PX = 24;
const SCROLL_KEYS = new Set(['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' ']);

export function parseHashSectionId(hash: string): string {
  const raw = hash.startsWith('#') ? hash.slice(1) : hash;
  const [id] = raw.split('?');
  return id ?? '';
}

function prefersReducedMotion(): boolean {
  if (typeof document !== 'undefined' && document.documentElement.classList.contains('is-still')) return true;
  if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }
  return false;
}

function currentScrollY(): number {
  return typeof window === 'undefined' ? 0 : window.scrollY || window.pageYOffset || 0;
}

function updateBrowserHash(sectionId: string): void {
  if (typeof window === 'undefined' || typeof history === 'undefined') return;
  const next = `#${sectionId}`;
  if (window.location.hash === next) return;
  try {
    history.pushState(null, '', next);
  } catch {
    /* ignore in constrained history test environments */
  }
}

function hasMeasuredGeometry(sections: readonly HTMLElement[]): boolean {
  return sections.some((s) => {
    const r = s.getBoundingClientRect();
    return r.height > 0 || r.top !== 0 || r.bottom !== 0;
  });
}

function resolveVisibleSection(root: HTMLElement, sections: readonly HTMLElement[], fallbackId: string): string {
  if (sections.length === 0 || !hasMeasuredGeometry(sections)) return fallbackId;

  const docEl = document.documentElement;
  const scrollY = currentScrollY();
  const viewH = window.innerHeight || docEl.clientHeight || 0;
  const maxScroll = (docEl.scrollHeight || 0) - viewH;
  if (scrollY > BOTTOM_THRESHOLD_PX && maxScroll > 0 && scrollY >= maxScroll - BOTTOM_THRESHOLD_PX) {
    for (let i = sections.length - 1; i >= 0; i -= 1) {
      if (sections[i]!.getBoundingClientRect().top < viewH - BOTTOM_THRESHOLD_PX) {
        return sections[i]!.id;
      }
    }
  }

  const headerBottom = root.querySelector<HTMLElement>('.ta-me-header')?.getBoundingClientRect().bottom ?? 0;
  const scrollMarginRaw = typeof getComputedStyle === 'function' ? getComputedStyle(sections[0]!).scrollMarginTop : '';
  const scrollMarginTop = Number.parseFloat(scrollMarginRaw) || 112;
  const triggerY = Math.max((headerBottom > 0 ? headerBottom : 96) + 56, scrollMarginTop + 24);
  let activeId = sections[0]!.id;
  for (const section of sections) {
    if (section.getBoundingClientRect().top <= triggerY) activeId = section.id;
  }
  return activeId;
}

function applyActiveTabClass(tabs: readonly HTMLAnchorElement[], sectionId: string): void {
  for (const tab of tabs) {
    const on = tab.dataset.section === sectionId;
    tab.classList.toggle('is-active', on);
    if (on) tab.setAttribute('aria-current', 'true');
    else tab.removeAttribute('aria-current');
  }
}

function initialSectionFromHash(
  initialHash: string,
  sections: readonly HTMLElement[],
  byId: ReadonlyMap<string, HTMLElement>,
): string {
  if (sections.length === 0) return 'pilot';
  const hashTarget = parseStakingHash(initialHash).active ? 'staking' : parseHashSectionId(initialHash);
  return hashTarget && byId.has(hashTarget) ? hashTarget : sections[0]!.id;
}

function shouldHoldPinnedSection(
  pinnedId: string | null,
  pinnedScrollY: number | null,
  sections: readonly HTMLElement[],
): boolean {
  if (!pinnedId) return false;
  if (!hasMeasuredGeometry(sections) || pinnedScrollY === null) return true;
  return Math.abs(currentScrollY() - pinnedScrollY) <= PIN_DRIFT_TOLERANCE_PX;
}

interface ListenerBinding {
  readonly tabs: readonly HTMLAnchorElement[];
  readonly hasTarget: (sectionId: string) => boolean;
  readonly onSectionClick?: (sectionId: string) => void;
  readonly scrollToSection: (sectionId: string) => void;
  readonly focusSection: (sectionId: string) => void;
  readonly scheduleSync: () => void;
  readonly releaseLock: () => void;
}

function bindTabNavListeners(b: ListenerBinding): () => void {
  const cleanups: Array<() => void> = [];
  for (const tab of b.tabs) {
    const onClick = (e: MouseEvent): void => {
      const sectionId = tab.dataset.section ?? '';
      b.onSectionClick?.(sectionId);
      if (!b.hasTarget(sectionId)) return;
      e.preventDefault();
      updateBrowserHash(sectionId);
      b.scrollToSection(sectionId);
      if (e.detail === 0) b.focusSection(sectionId);
    };
    tab.addEventListener('click', onClick);
    cleanups.push(() => tab.removeEventListener('click', onClick));
  }
  const onKeyDown = (e: KeyboardEvent): void => {
    if (SCROLL_KEYS.has(e.key)) b.releaseLock();
  };
  if (typeof window !== 'undefined') {
    window.addEventListener('scroll', b.scheduleSync, { passive: true });
    window.addEventListener('resize', b.scheduleSync, { passive: true });
    window.addEventListener('wheel', b.releaseLock, { passive: true });
    window.addEventListener('touchstart', b.releaseLock, { passive: true });
    window.addEventListener('touchmove', b.releaseLock, { passive: true });
    window.addEventListener('keydown', onKeyDown, { passive: true });
    cleanups.push(() => {
      window.removeEventListener('scroll', b.scheduleSync);
      window.removeEventListener('resize', b.scheduleSync);
      window.removeEventListener('wheel', b.releaseLock);
      window.removeEventListener('touchstart', b.releaseLock);
      window.removeEventListener('touchmove', b.releaseLock);
      window.removeEventListener('keydown', onKeyDown);
    });
  }
  return () => {
    for (const off of cleanups.splice(0)) off();
  };
}

/**
 * Coordinates sticky header nav highlighting (`.is-active` + `aria-current="true"`) via viewport scroll-spy
 * and smooth section scrolling on tab click without intermediate flicker or hash teleports.
 */
export function attachMeTabNavigation(opts: MeTabNavigationOptions): MeTabNavigationHandle {
  const now = opts.now ?? (() => Date.now());
  const tabs = [...opts.root.querySelectorAll<HTMLAnchorElement>('.ta-me-tab[data-section]')];
  const sections = [...opts.root.querySelectorAll<HTMLElement>('main > section.ta-me-section[id]')];
  const byId = new Map(sections.map((s) => [s.id, s]));

  let activeId = '';
  let inFlightTargetId: string | null = null;
  let inFlightDeadlineMs = 0;
  let pinnedSectionId: string | null = null;
  let pinnedScrollY: number | null = null;
  let settleTimer: ReturnType<typeof setTimeout> | null = null;
  let rafId = 0;
  let rafPending = false;

  const setActive = (sectionId: string): void => { activeId = sectionId; applyActiveTabClass(tabs, sectionId); };
  const armSettleTimer = (): void => {
    if (settleTimer !== null) clearTimeout(settleTimer);
    settleTimer = setTimeout(() => {
      settleTimer = null;
      const target = inFlightTargetId ?? pinnedSectionId;
      inFlightTargetId = null;
      if (!target || !byId.has(target)) return;
      pinnedSectionId = target;
      pinnedScrollY = currentScrollY();
      setActive(target);
    }, SCROLL_SETTLE_IDLE_MS);
  };
  const releaseLock = (): void => {
    inFlightTargetId = null;
    pinnedSectionId = null;
    pinnedScrollY = null;
    if (settleTimer !== null) clearTimeout(settleTimer);
    settleTimer = null;
  };
  const syncFromScroll = (): void => {
    if (inFlightTargetId && byId.has(inFlightTargetId) && now() < inFlightDeadlineMs) {
      armSettleTimer();
      return setActive(inFlightTargetId);
    }
    inFlightTargetId = null;
    if (pinnedSectionId && byId.has(pinnedSectionId) && shouldHoldPinnedSection(pinnedSectionId, pinnedScrollY, sections)) {
      return setActive(pinnedSectionId);
    }
    pinnedSectionId = null;
    pinnedScrollY = null;
    setActive(resolveVisibleSection(opts.root, sections, activeId || initialSectionFromHash(opts.initialHash, sections, byId)));
  };
  const scrollToSection = (sectionId: string, behaviorOverride?: ScrollBehavior): boolean => {
    const target = byId.get(sectionId);
    if (!target) return false;
    inFlightTargetId = sectionId;
    pinnedSectionId = sectionId;
    pinnedScrollY = null;
    inFlightDeadlineMs = now() + PROGRAMMATIC_SAFETY_CEILING_MS;
    armSettleTimer();
    setActive(sectionId);
    target.scrollIntoView?.({ behavior: behaviorOverride ?? (prefersReducedMotion() ? 'auto' : 'smooth'), block: 'start' });
    return true;
  };
  const scheduleSync = (): void => {
    if (inFlightTargetId && byId.has(inFlightTargetId) && now() < inFlightDeadlineMs) armSettleTimer();
    if (typeof window === 'undefined' || typeof requestAnimationFrame !== 'function') return syncFromScroll();
    if (rafPending) return;
    rafPending = true;
    rafId = requestAnimationFrame(() => {
      rafPending = false;
      rafId = 0;
      syncFromScroll();
    });
  };

  const unbind = bindTabNavListeners({
    tabs,
    hasTarget: (id) => byId.has(id),
    onSectionClick: opts.onSectionClick,
    scrollToSection,
    focusSection: (id) => byId.get(id)?.focus?.({ preventScroll: true }),
    scheduleSync,
    releaseLock,
  });
  setActive(initialSectionFromHash(opts.initialHash, sections, byId));

  return {
    syncFromScroll,
    setActive,
    scrollToSection,
    dispose() {
      if (settleTimer !== null) clearTimeout(settleTimer);
      settleTimer = null;
      if (rafPending && rafId !== 0 && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(rafId);
      rafPending = false;
      rafId = 0;
      unbind();
    },
  };
}
