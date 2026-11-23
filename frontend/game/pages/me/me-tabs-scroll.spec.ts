// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createLocalModeFetch } from './localModeSim';
import { MePage } from './MePage';
import { attachMeTabNavigation, parseHashSectionId } from './parts/tabScrollSpy';

const q = (root: ParentNode, id: string): HTMLElement | null => root.querySelector(`[data-testid="${id}"]`);

const flush = async (): Promise<void> => {
  await new Promise((r) => setTimeout(r, 0));
  await new Promise((r) => setTimeout(r, 0));
};

function stubSectionTops(root: HTMLElement, tops: Record<string, number>, headerBottom = 72): void {
  const header = root.querySelector<HTMLElement>('.ta-me-header');
  if (header) {
    header.getBoundingClientRect = () =>
      ({ top: 0, bottom: headerBottom, left: 0, right: 1120, width: 1120, height: headerBottom, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;
  }
  for (const sec of root.querySelectorAll<HTMLElement>('main > section.ta-me-section')) {
    const top = tops[sec.id] ?? 0;
    sec.getBoundingClientRect = () =>
      ({ top, bottom: top + 300, left: 0, right: 1120, width: 1120, height: 300, x: 0, y: top, toJSON: () => ({}) }) as DOMRect;
  }
}

beforeEach(() => {
  vi.unstubAllGlobals();
  window.localStorage.clear();
  document.body.replaceChildren();
  window.history.replaceState(null, '', '/me.html?host=local');
  Object.defineProperty(window, 'innerHeight', { value: 768, configurable: true });
  Object.defineProperty(window, 'scrollY', { value: 0, configurable: true });
  Object.defineProperty(document.documentElement, 'scrollHeight', { value: 0, configurable: true });
});

afterEach(() => {
  vi.useRealTimers();
});

describe('/me sticky tabs: content scroll-spy & smooth click scrolling', () => {
  it('highlights initial section, excludes staking rectangle class from regular tabs, and smoothly scrolls on click', async () => {
    const root = document.createElement('div');
    document.body.appendChild(root);
    const page = new MePage(root, { search: '?host=local', fetch: createLocalModeFetch(() => 1_700_000_000_000) });
    await page.load();
    await flush();

    // Only STAKING carries `.ta-me-tab--staking`; regular tabs remain clean glow + underline
    expect(q(root, 'me-tab-pilot')!.classList.contains('is-active')).toBe(true);
    expect(q(root, 'me-tab-pilot')!.classList.contains('ta-me-tab--staking')).toBe(false);
    expect(q(root, 'me-tab-pilot')!.getAttribute('aria-current')).toBe('true');
    expect(q(root, 'me-tab-staking')!.classList.contains('ta-me-tab--staking')).toBe(true);
    expect(q(root, 'me-tab-staking')!.getAttribute('aria-current')).toBeNull();

    const planetsSection = q(root, 'me-section-planets')!;
    const scrollSpy = vi.fn();
    planetsSection.scrollIntoView = scrollSpy;

    const planetsTab = q(root, 'me-tab-planets') as HTMLAnchorElement;
    const ev = new MouseEvent('click', { bubbles: true, cancelable: true, detail: 1 });
    planetsTab.dispatchEvent(ev);

    expect(ev.defaultPrevented).toBe(true);
    expect(scrollSpy).toHaveBeenCalledWith({ behavior: 'smooth', block: 'start' });
    expect(window.location.hash).toBe('#planets');
    expect(planetsTab.classList.contains('is-active')).toBe(true);
    expect(planetsTab.getAttribute('aria-current')).toBe('true');
    expect(q(root, 'me-tab-pilot')!.classList.contains('is-active')).toBe(false);

    // Reduced-motion / is-still switches scrollIntoView to behavior: 'auto'
    const historySection = q(root, 'me-section-history')!;
    const historyScroll = vi.fn();
    historySection.scrollIntoView = historyScroll;
    document.documentElement.classList.add('is-still');
    try {
      q(root, 'me-tab-history')!.click();
      expect(historyScroll).toHaveBeenCalledWith({ behavior: 'auto', block: 'start' });
      expect(q(root, 'me-tab-history')!.getAttribute('aria-current')).toBe('true');
    } finally {
      document.documentElement.classList.remove('is-still');
    }
  });

  it('holds target tab lock without flicker across long (>1200ms) smooth scrolls and mid-flight re-clicks', async () => {
    const root = document.createElement('div');
    document.body.appendChild(root);
    const page = new MePage(root, { search: '?host=local', fetch: createLocalModeFetch(() => 1_700_000_000_000) });
    await page.load();
    await flush();

    vi.useFakeTimers();
    let fakeNow = 10_000;
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => { cb(fakeNow); return 1; });
    vi.stubGlobal('cancelAnimationFrame', () => undefined);

    const nav = attachMeTabNavigation({ root, initialHash: '', now: () => fakeNow });
    q(root, 'me-section-play')!.scrollIntoView = vi.fn();
    q(root, 'me-section-progress')!.scrollIntoView = vi.fn();

    // Long 1,400ms smooth scroll from PILOT -> PLAY crossing STAKING & ACHIEVEMENTS never flickers past 900ms
    q(root, 'me-tab-play')!.click();
    for (const [elapsed, y, achTop] of [
      [300, 1500, 3200],
      [750, 6000, 120],
      [1100, 11500, -4000],
      [1350, 14900, -9000],
    ] as const) {
      fakeNow = 10_000 + elapsed;
      vi.advanceTimersByTime(60);
      Object.defineProperty(window, 'scrollY', { value: y, configurable: true });
      stubSectionTops(root, { pilot: -y, staking: 500 - y, progress: 3500 - y, planets: 4200 - y, history: 4500 - y, achievements: achTop, play: 15050 - y });
      window.dispatchEvent(new Event('scroll'));
      expect(q(root, 'me-tab-play')!.classList.contains('is-active')).toBe(true);
    }

    // Settle after scroll becomes idle (180ms), keeping PLAY pinned even if another tab was re-targeted mid-flight
    vi.advanceTimersByTime(220);
    expect(q(root, 'me-tab-play')!.classList.contains('is-active')).toBe(true);

    // Mid-flight re-click: start long scroll to PLAY, then immediately re-click PROGRESS mid-scroll
    q(root, 'me-tab-play')!.click();
    fakeNow += 200;
    q(root, 'me-tab-progress')!.click();
    stubSectionTops(root, { pilot: -5000, staking: -3000, progress: -200, planets: 200, history: 600, achievements: 90, play: 5000 });
    window.dispatchEvent(new Event('scroll'));
    expect(q(root, 'me-tab-progress')!.classList.contains('is-active')).toBe(true);
    nav.dispose();
  });
});

describe('/me sticky tabs: manual scroll-spy & signed-out hash states', () => {
  it('releases lock immediately on manual wheel / scrollbar drag and highlights PLAY at bottom of page', async () => {
    const root = document.createElement('div');
    document.body.appendChild(root);
    const page = new MePage(root, { search: '?host=local', fetch: createLocalModeFetch(() => 1_700_000_000_000) });
    await page.load();
    await flush();

    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => { cb(0); return 1; });
    vi.stubGlobal('cancelAnimationFrame', () => undefined);

    // Manual wheel immediately releases any programmatic lock so scroll-spy tracks PROGRESS
    q(root, 'me-section-achievements')!.scrollIntoView = vi.fn();
    q(root, 'me-tab-achievements')!.click();
    window.dispatchEvent(new Event('wheel'));
    stubSectionTops(root, { pilot: -820, staking: -360, progress: 112, planets: 520, history: 920, achievements: 1320, play: 1720 });
    window.dispatchEvent(new Event('scroll'));
    expect(q(root, 'me-tab-progress')!.classList.contains('is-active')).toBe(true);
    expect(q(root, 'me-tab-progress')!.getAttribute('aria-current')).toBe('true');

    // Reaching page bottom highlights PLAY even if PLAY's top is lower in viewport
    Object.defineProperty(window, 'innerHeight', { value: 900, configurable: true });
    Object.defineProperty(window, 'scrollY', { value: 2100, configurable: true });
    Object.defineProperty(document.documentElement, 'scrollHeight', { value: 3000, configurable: true });
    stubSectionTops(root, { pilot: -2400, staking: -1900, progress: -1400, planets: -900, history: -500, achievements: 40, play: 640 });
    window.dispatchEvent(new Event('scroll'));
    expect(q(root, 'me-tab-play')!.classList.contains('is-active')).toBe(true);
    expect(q(root, 'me-tab-play')!.getAttribute('aria-current')).toBe('true');
  });

  it('handles signed-out #staking tab activation and parseHashSectionId query stripping (corner)', async () => {
    expect(parseHashSectionId('#staking?amount=200&tier=3')).toBe('staking');
    expect(parseHashSectionId('')).toBe('');

    const localFetch = createLocalModeFetch(() => 1_700_000_000_000);
    await localFetch('/v1/auth/logout', { method: 'POST' });
    const root = document.createElement('div');
    document.body.appendChild(root);
    const page = new MePage(root, { search: '?host=local', hash: '#staking?amount=50', fetch: localFetch });
    await page.load();
    await flush();

    expect(q(root, 'me-tab-staking')!.classList.contains('is-active')).toBe(true);
    expect(q(root, 'me-tab-staking')!.getAttribute('aria-current')).toBe('true');
  });
});
