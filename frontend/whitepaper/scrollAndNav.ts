import { CHAPTER_ITEMS, ENTITY_NAV_ITEMS, STACK_NAV_ITEMS } from './data/chapters';

const RAIL_STORAGE_KEY = 'terra.whitepaper.railCollapsed';
const MOBILE_BREAKPOINT_PX = 1020;

function createRailLink(
  hrefId: string,
  targetSec: string,
  numText: string,
  labelText: string,
  tagText: string,
  filterGroup?: string,
  accent?: 'web3' | 'ai',
): HTMLAnchorElement {
  const link = document.createElement('a');
  link.className = 'wp-nav-link';
  link.href = `#${hrefId}`;
  link.dataset.targetSec = targetSec;
  if (filterGroup) link.dataset.filterGroup = filterGroup;
  if (accent) link.dataset.accent = accent;

  const numSpan = document.createElement('span');
  numSpan.className = 'wp-nav-num';
  numSpan.textContent = numText;

  const labelSpan = document.createElement('span');
  labelSpan.className = 'wp-nav-label';
  labelSpan.textContent = labelText;

  const tagSpan = document.createElement('span');
  tagSpan.className = 'wp-nav-tag';
  tagSpan.textContent = tagText;

  link.append(numSpan, labelSpan, tagSpan);
  return link;
}

export function buildRailTabsContent(): void {
  const chaptersEl = document.getElementById('tabPanel-chapters');
  const stackEl = document.getElementById('tabPanel-stack');
  const entitiesEl = document.getElementById('tabPanel-entities');

  if (chaptersEl) {
    chaptersEl.replaceChildren(
      ...CHAPTER_ITEMS.map((c) => createRailLink(c.id, c.id, c.num, c.label, c.tag, undefined, c.accent)),
    );
  }
  if (stackEl) {
    stackEl.replaceChildren(
      ...STACK_NAV_ITEMS.map((s) => {
        const accent = s.layer === 'WEB3' ? 'web3' : s.layer === 'AI-TEE' ? 'ai' : undefined;
        return createRailLink(s.anchorId ?? s.targetId, s.targetId, s.layer, s.title, s.status, undefined, accent);
      }),
    );
  }
  if (entitiesEl) {
    entitiesEl.replaceChildren(
      ...ENTITY_NAV_ITEMS.map((e) =>
        createRailLink(e.targetId, e.targetId, String(e.count), e.label, e.group, e.filterGroup),
      ),
    );
  }
}

export function activateEntityFilter(secId: string, filterGroup: string): void {
  const sec = document.getElementById(secId);
  if (!sec) return;
  sec.classList.add('is-visible');

  const buttons = Array.from(sec.querySelectorAll<HTMLButtonElement>('.wp-filter-btn'));
  const targetBtn = buttons.find(
    (b) => b.dataset.filterGroup === filterGroup || b.dataset.filterKey === filterGroup,
  );
  if (targetBtn) {
    targetBtn.click();
    return;
  }

  for (const card of Array.from(sec.querySelectorAll<HTMLElement>('.wp-card3d'))) {
    card.hidden = filterGroup !== 'all' && card.dataset.group !== filterGroup;
  }
  window.dispatchEvent(new CustomEvent('wp:cards-changed', { detail: { secId, filterGroup } }));
}

function wireRailScrollIndicator(): () => void {
  const body = document.getElementById('wpRailBody');
  const bar = document.getElementById('wpRailScrollbar');
  const thumb = document.getElementById('wpRailThumb');
  const moreBtn = document.getElementById('wpRailMore') as HTMLButtonElement | null;
  if (!body || !bar || !thumb) return () => undefined;

  const sync = () => {
    const ch = body.clientHeight;
    const sh = body.scrollHeight;
    const scrollable = ch > 0 && sh > ch + 4;
    bar.hidden = !scrollable;
    if (!scrollable) {
      if (moreBtn) moreBtn.hidden = true;
      return;
    }
    const thumbH = Math.max(28, Math.round((ch / sh) * ch));
    const maxTop = Math.max(1, ch - thumbH);
    const maxScroll = Math.max(1, sh - ch);
    const topPx = Math.round((body.scrollTop / maxScroll) * maxTop);
    thumb.style.height = `${thumbH}px`;
    thumb.style.transform = `translateY(${topPx}px)`;
    if (moreBtn) moreBtn.hidden = body.scrollTop + ch >= sh - 6;
  };

  body.addEventListener('scroll', sync, { passive: true });
  window.addEventListener('resize', sync);
  moreBtn?.addEventListener('click', () => {
    body.scrollBy({ top: Math.max(140, Math.round(body.clientHeight * 0.55)), behavior: 'smooth' });
  });
  requestAnimationFrame(sync);
  return sync;
}

function bindRailTabsAndSearch(rail: HTMLElement, syncScroll: () => void): void {
  const tabs = Array.from(rail.querySelectorAll<HTMLButtonElement>('[data-rail-tab]'));
  const panels = Array.from(rail.querySelectorAll<HTMLElement>('.wp-rail-panel'));
  const body = document.getElementById('wpRailBody');

  for (const tab of tabs) {
    tab.addEventListener('click', () => {
      const targetKey = tab.dataset.railTab;
      for (const t of tabs) {
        const active = t === tab;
        t.classList.toggle('is-active', active);
        t.setAttribute('aria-selected', active ? 'true' : 'false');
      }
      for (const panel of panels) {
        const match = panel.id === `tabPanel-${targetKey}`;
        panel.classList.toggle('is-active', match);
        panel.hidden = !match;
      }
      if (body) body.scrollTop = 0;
      requestAnimationFrame(syncScroll);
    });
  }

  const searchInput = document.getElementById('wpRailSearch') as HTMLInputElement | null;
  searchInput?.addEventListener('input', () => {
    const q = searchInput.value.trim().toLowerCase();
    for (const panel of panels) {
      for (const link of Array.from(panel.querySelectorAll<HTMLAnchorElement>('a'))) {
        const text = (link.textContent ?? '').toLowerCase();
        link.hidden = Boolean(q && !text.includes(q));
      }
    }
    requestAnimationFrame(syncScroll);
  });
}

export function initRailShowHideAndTabs(): void {
  const shell = document.getElementById('wpShell') ?? document.querySelector<HTMLElement>('.wp-shell');
  const rail = document.getElementById('wpRail');
  const backdrop = document.getElementById('wpRailBackdrop');
  const btnHide = document.getElementById('wpRailHide');
  const btnShowFloat = document.getElementById('wpRailShowFloat');
  if (!shell || !rail) return;

  const isMobile = () => window.innerWidth <= MOBILE_BREAKPOINT_PX;
  const syncScroll = wireRailScrollIndicator();

  const applyCollapsed = (collapsed: boolean, persist: boolean) => {
    shell.classList.toggle('is-rail-hidden', collapsed);
    rail.setAttribute('aria-hidden', collapsed ? 'true' : 'false');
    if (btnShowFloat) btnShowFloat.hidden = !collapsed;
    btnHide?.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
    btnShowFloat?.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
    if (!collapsed) requestAnimationFrame(syncScroll);
    if (persist) {
      try {
        sessionStorage.setItem(RAIL_STORAGE_KEY, collapsed ? '1' : '0');
      } catch {
        // Ignore storage errors in private browsing.
      }
    }
  };

  let saved: string | null;
  try {
    saved = sessionStorage.getItem(RAIL_STORAGE_KEY);
  } catch {
    saved = null;
  }
  applyCollapsed(isMobile() ? true : saved === '1', false);

  btnHide?.addEventListener('click', () => applyCollapsed(true, true));
  btnShowFloat?.addEventListener('click', () => applyCollapsed(false, true));
  backdrop?.addEventListener('click', () => applyCollapsed(true, false));

  bindRailTabsAndSearch(rail, syncScroll);

  rail.addEventListener('click', (ev) => {
    const target = ev.target as HTMLElement | null;
    const link = target?.closest<HTMLAnchorElement>('.wp-rail-panel a');
    if (!link) return;
    const secId = link.dataset.targetSec;
    const filterGroup = link.dataset.filterGroup;
    if (secId) {
      document.getElementById(secId)?.classList.add('is-visible');
      if (filterGroup) activateEntityFilter(secId, filterGroup);
    }
    if (isMobile()) applyCollapsed(true, false);
  });
}

function revealElement(el: HTMLElement, staggerIdx = 0): void {
  if (el.classList.contains('is-visible')) return;
  el.style.transitionDelay = staggerIdx > 0 ? `${Math.min(staggerIdx * 45, 180)}ms` : '0ms';
  el.classList.add('is-visible');
}

function revealVisibleOrPassedSections(sections: HTMLElement[]): void {
  const cutoff = window.innerHeight * 0.96;
  let stagger = 0;
  for (const el of sections) {
    if (el.classList.contains('is-visible')) continue;
    if (el.getBoundingClientRect().top <= cutoff) revealElement(el, stagger++);
  }
}

export function initScrollAnimationsAndSpy(): void {
  const sections = Array.from(document.querySelectorAll<HTMLElement>('.wp-reveal'));
  const chapterLinks = Array.from(
    document.querySelectorAll<HTMLAnchorElement>('#tabPanel-chapters a'),
  );
  const progressFill = document.getElementById('wpScrollProgress');
  const activeChapterEl = document.getElementById('wpActiveChapter');
  const chapterMap = new Map(CHAPTER_ITEMS.map((c) => [c.id, c]));
  if (sections.length === 0) return;

  const revealHashTarget = () => {
    const hashId = window.location.hash.replace(/^#/, '');
    if (hashId) {
      const target = document.getElementById(hashId);
      const secParent = target?.closest<HTMLElement>('.wp-reveal');
      if (secParent) revealElement(secParent);
      if (target) revealElement(target);
    }
    revealVisibleOrPassedSections(sections);
  };

  revealHashTarget();

  if ('IntersectionObserver' in window) {
    const observer = new IntersectionObserver(
      (entries) => {
        let idx = 0;
        for (const entry of entries) {
          if (entry.isIntersecting) {
            revealElement(entry.target as HTMLElement, idx++);
            observer.unobserve(entry.target);
          }
        }
      },
      { threshold: 0, rootMargin: '0px 0px -4% 0px' },
    );
    for (const sec of sections) {
      if (!sec.classList.contains('is-visible')) observer.observe(sec);
    }
  } else {
    for (const sec of sections) revealElement(sec);
  }

  let scrollPending = false;
  const updateOnScroll = () => {
    scrollPending = false;
    revealVisibleOrPassedSections(sections);

    if (progressFill) {
      const maxScroll = Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
      const pct = maxScroll > 0 ? Math.min(100, Math.max(0, (window.scrollY / maxScroll) * 100)) : 0;
      progressFill.style.width = `${pct.toFixed(2)}%`;
    }

    let activeId = 'sec-00';
    for (const sec of sections) {
      if (sec.id && sec.id.startsWith('sec-') && sec.getBoundingClientRect().top <= 170) {
        activeId = sec.id;
      }
    }
    for (const link of chapterLinks) {
      link.classList.toggle('is-active', link.dataset.targetSec === activeId);
    }
    const ch = chapterMap.get(activeId);
    if (activeChapterEl && ch) activeChapterEl.textContent = `CH ${ch.num} // ${ch.tag}`;
  };

  window.addEventListener(
    'scroll',
    () => {
      if (scrollPending) return;
      scrollPending = true;
      requestAnimationFrame(updateOnScroll);
    },
    { passive: true },
  );
  window.addEventListener('hashchange', () => {
    revealHashTarget();
    updateOnScroll();
  });
  updateOnScroll();
}
