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
): HTMLAnchorElement {
  const link = document.createElement('a');
  link.className = 'wp-nav-link';
  link.href = `#${hrefId}`;
  link.dataset.targetSec = targetSec;
  if (filterGroup) link.dataset.filterGroup = filterGroup;

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
      ...CHAPTER_ITEMS.map((c) => createRailLink(c.id, c.id, c.num, c.label, c.tag)),
    );
  }
  if (stackEl) {
    stackEl.replaceChildren(
      ...STACK_NAV_ITEMS.map((s) =>
        createRailLink(s.anchorId ?? s.targetId, s.targetId, s.layer, s.title, s.status),
      ),
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

function bindRailTabsAndSearch(rail: HTMLElement): void {
  const tabs = Array.from(rail.querySelectorAll<HTMLButtonElement>('[data-rail-tab]'));
  const panels = Array.from(rail.querySelectorAll<HTMLElement>('.wp-rail-panel'));

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
  });
}

export function initRailShowHideAndTabs(): void {
  const shell = document.getElementById('wpShell') ?? document.querySelector<HTMLElement>('.wp-shell');
  const rail = document.getElementById('wpRail');
  const backdrop = document.getElementById('wpRailBackdrop');
  const btnHide = document.getElementById('wpRailHide');
  const btnToggle = document.getElementById('wpRailToggle');
  const btnShowFloat = document.getElementById('wpRailShowFloat');
  if (!shell || !rail) return;

  const isMobile = () => window.innerWidth <= MOBILE_BREAKPOINT_PX;

  const applyCollapsed = (collapsed: boolean, persist: boolean) => {
    shell.classList.toggle('is-rail-hidden', collapsed);
    rail.setAttribute('aria-hidden', collapsed ? 'true' : 'false');
    if (btnShowFloat) btnShowFloat.hidden = !collapsed;
    if (btnToggle) {
      btnToggle.textContent = collapsed ? 'Show Menu' : 'Hide Menu';
      btnToggle.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
    }
    btnHide?.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
    btnShowFloat?.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
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
  const initialCollapsed = isMobile() ? true : saved === '1';
  applyCollapsed(initialCollapsed, false);

  btnHide?.addEventListener('click', () => applyCollapsed(true, true));
  btnShowFloat?.addEventListener('click', () => applyCollapsed(false, true));
  backdrop?.addEventListener('click', () => applyCollapsed(true, false));
  btnToggle?.addEventListener('click', () => {
    applyCollapsed(!shell.classList.contains('is-rail-hidden'), true);
  });

  bindRailTabsAndSearch(rail);

  rail.addEventListener('click', (ev) => {
    const target = ev.target as HTMLElement | null;
    const link = target?.closest<HTMLAnchorElement>('.wp-rail-panel a');
    if (!link) return;
    const secId = link.dataset.targetSec;
    const filterGroup = link.dataset.filterGroup;
    if (secId) {
      const secEl = document.getElementById(secId);
      secEl?.classList.add('is-visible');
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
    if (el.getBoundingClientRect().top <= cutoff) {
      revealElement(el, stagger++);
    }
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
    if (activeChapterEl && ch) {
      activeChapterEl.textContent = `CH ${ch.num} // ${ch.tag}`;
    }
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
