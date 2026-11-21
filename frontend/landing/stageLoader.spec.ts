// @vitest-environment jsdom
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { StageHost } from '@terra/render/core/StageHost';
import { initResourceSheet, mountResourceViewer3D } from './resources';
import {
  bindSpeculativePlayPrefetch,
  markQueuedStages,
  preloadAndMountLanding3D,
  scheduleLanding3DStages,
  type Landing3DLoaders,
} from './stageLoader';

const here = path.dirname(fileURLToPath(import.meta.url));
const landingHtmlPath = path.resolve(here, '../landing.html');
const landingCssPath = path.resolve(here, './landing.css');
const distLandingPath = path.resolve(here, '../dist/landing.html');

function loadLandingDom(): void {
  const rawHtml = fs.readFileSync(landingHtmlPath, 'utf8');
  const headMatch = /<head>([\s\S]*?)<\/head>/i.exec(rawHtml);
  const bodyMatch = /<body>([\s\S]*?)<\/body>/i.exec(rawHtml);
  document.head.innerHTML = (headMatch?.[1] ?? '').replace(/<script[\s\S]*?<\/script>/gi, '');
  document.body.innerHTML = (bodyMatch?.[1] ?? '').replace(/<script[\s\S]*?<\/script>/gi, '');
}

function resetDom(): void {
  document.head.innerHTML = '';
  document.body.innerHTML = '';
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
}

describe('Landing preloaders, priority hints & below-fold CSS deferral', () => {
  beforeEach(loadLandingDom);
  afterEach(resetDom);

  it('ships Faction-Plate preloaders on all 3D/canvas viewports, font link, fetchpriority, and content-visibility', () => {
    const rawHtml = fs.readFileSync(landingHtmlPath, 'utf8');
    const rawCss = fs.readFileSync(landingCssPath, 'utf8');

    expect(rawHtml).toContain('https://fonts.googleapis.com/css2?family=Chakra+Petch');
    expect(rawHtml).toMatch(/<script\s+type="module"\s+src="\/landing\/main\.ts"\s+fetchpriority="high">/);

    const preloaders = document.querySelectorAll('[data-stage-preloader]');
    expect(preloaders).toHaveLength(6);
    for (const el of preloaders) expect(el.textContent?.trim()).toBe('');

    expect(document.getElementById('hero-stage')?.dataset.stageState).toBe('queued');
    expect(document.getElementById('colony-stage')?.dataset.stageState).toBe('queued');
    expect(document.getElementById('rv-stage')?.dataset.stageState).toBe('queued');
    const planetArts = [...document.querySelectorAll<HTMLElement>('.planet-art')];
    expect(planetArts).toHaveLength(3);
    for (const art of planetArts) {
      expect(art.dataset.stageState).toBe('queued');
      expect(art.querySelector('[data-stage-preloader]')).not.toBeNull();
    }

    for (const sec of ['colony', 'economy', 'planets', 'director', 'economics', 'protocol', 'chain', 'roadmap', 'faq']) {
      expect(rawCss).toMatch(new RegExp(`#${sec}\\s*\\{[^}]*content-visibility:\\s*auto;[^}]*contain-intrinsic-size:`));
    }
    expect(rawCss).not.toMatch(/#top\s*\{[^}]*content-visibility:/);
  });

  it('hydrates the resource sheet synchronously without WebGL and falls back cleanly on mount', async () => {
    initResourceSheet();

    const info = document.getElementById('rv-info')!;
    const tag = document.getElementById('rv-tag')!;
    expect(info.textContent).toContain('Metals');
    expect(tag.textContent).toContain('resource.metalDeposit · FULL');

    document.querySelector<HTMLButtonElement>('[data-res="minerals"]')!.click();
    expect(info.textContent).toContain('Minerals');
    expect(tag.textContent).toContain('resource.crystalDeposit · FULL');

    document.querySelector<HTMLButtonElement>('[data-stage="depleted"]')!.click();
    expect(tag.textContent).toContain('resource.crystalDeposit · DEPLETED');

    await mountResourceViewer3D();
    const rvStage = document.getElementById('rv-stage')!;
    expect(rvStage.dataset.stageState).toBe('fallback');
    expect(rvStage.classList.contains('is-fallback')).toBe(true);
  });
});

describe('Landing post-main 3D scheduler', () => {
  beforeEach(loadLandingDom);
  afterEach(resetDom);

  it('preloads 3D modules in parallel, mounts Hero first, staggers below-fold stages, and handles failures', async () => {
    const events: string[] = [];
    const setShadow = vi.fn(() => { events.push('flag:shadow'); });
    const setPixelArt = vi.fn(() => { events.push('flag:pixel'); });
    const setCrt = vi.fn(() => { events.push('flag:crt'); });

    const loaders: Landing3DLoaders = {
      loadVisualFlags: vi.fn(async () => ({ setShadow, setPixelArt, setCrt })),
      loadHero: vi.fn(async () => () => {
        events.push('mount:hero');
        const el = document.getElementById('hero-stage')!;
        el.classList.add('is-live');
        el.dataset.stageState = 'live';
      }),
      loadColony: vi.fn(async () => { throw new Error('simulated chunk failure'); }),
      loadResourceViewer: vi.fn(async () => async () => {
        events.push('mount:resources');
        const el = document.getElementById('rv-stage')!;
        el.classList.add('is-live');
        el.dataset.stageState = 'live';
      }),
      loadPlanetCards: vi.fn(async () => () => {
        events.push('mount:planets');
        for (const art of document.querySelectorAll<HTMLElement>('.planet-art')) {
          art.classList.add('is-live');
          art.dataset.stageState = 'live';
        }
      }),
      loadCrtEntry: vi.fn(async () => { events.push('mount:crtEntry'); }),
    };

    expect(markQueuedStages(document)).toHaveLength(6);
    await scheduleLanding3DStages(document, { loaders, skipPaintWait: true, staggerMs: 0 });

    expect(loaders.loadVisualFlags).toHaveBeenCalledTimes(1);
    expect(loaders.loadHero).toHaveBeenCalledTimes(1);
    expect(loaders.loadColony).toHaveBeenCalledTimes(1);
    expect(loaders.loadResourceViewer).toHaveBeenCalledTimes(1);
    expect(loaders.loadPlanetCards).toHaveBeenCalledTimes(1);
    expect(loaders.loadCrtEntry).toHaveBeenCalledTimes(1);
    expect(setShadow).toHaveBeenCalledWith(true);
    expect(setPixelArt).toHaveBeenCalledWith(true, false);
    expect(setCrt).toHaveBeenCalledWith(true);

    expect(events.indexOf('mount:hero')).toBeLessThan(events.indexOf('mount:resources'));
    expect(events.indexOf('mount:resources')).toBeLessThan(events.indexOf('mount:planets'));
    expect(events.indexOf('mount:planets')).toBeLessThan(events.indexOf('mount:crtEntry'));

    expect(document.getElementById('hero-stage')?.dataset.stageState).toBe('live');
    expect(document.getElementById('colony-stage')?.dataset.stageState).toBe('fallback');
    expect(document.getElementById('rv-stage')?.dataset.stageState).toBe('live');
    for (const art of document.querySelectorAll<HTMLElement>('.planet-art')) {
      expect(art.dataset.stageState).toBe('live');
    }
  });

  it('mounts IntersectionObserver-visible below-fold stages once without duplicating work', async () => {
    const mountPlanets = vi.fn();
    const mountColony = vi.fn();
    const mountResources = vi.fn();
    let observerCb: ((entries: Array<{ target: Element; isIntersecting: boolean }>) => void) | null = null;
    class MockIO {
      constructor(cb: (entries: Array<{ target: Element; isIntersecting: boolean }>) => void) { observerCb = cb; }
      observe(target: Element) { if (target.id === 'planets') observerCb?.([{ target, isIntersecting: true }]); }
      unobserve() {}
      disconnect() {}
    }
    vi.stubGlobal('IntersectionObserver', MockIO);

    await preloadAndMountLanding3D(document, {
      staggerMs: 0,
      loaders: {
        loadVisualFlags: async () => ({ setShadow: vi.fn(), setPixelArt: vi.fn(), setCrt: vi.fn() }),
        loadHero: async () => vi.fn<() => void>(),
        loadColony: async () => mountColony,
        loadResourceViewer: async () => mountResources,
        loadPlanetCards: async () => mountPlanets,
        loadCrtEntry: async () => {},
      },
    });

    expect(mountColony).toHaveBeenCalledTimes(1);
    expect(mountResources).toHaveBeenCalledTimes(1);
    expect(mountPlanets).toHaveBeenCalledTimes(1);
  });
});

describe('StageHost content-visibility & speculative prefetch', () => {
  beforeEach(loadLandingDom);
  afterEach(resetDom);

  it('prefetches /play.html once on CTA hover or focus', () => {
    bindSpeculativePlayPrefetch(document);
    const playLink = document.querySelector<HTMLAnchorElement>('a[href*="/play.html"]')!;
    playLink.dispatchEvent(new Event('pointerenter'));
    playLink.dispatchEvent(new Event('focus'));
    expect(document.head.querySelectorAll('link[rel="prefetch"][href="/play.html"]')).toHaveLength(1);
  });

  it('pauses StageHost on contentvisibilityautostatechange skipped and resumes cleanly', () => {
    const section = document.getElementById('colony')!;
    const stageEl = document.getElementById('colony-stage')!;
    const host = new StageHost({ elements: [stageEl], onFrame: vi.fn(), reduced: true }).start();

    expect(host.visible).toBe(true);
    const skipEvt = new Event('contentvisibilityautostatechange', { bubbles: false });
    Object.defineProperty(skipEvt, 'skipped', { value: true });
    section.dispatchEvent(skipEvt);
    expect(host.visible).toBe(false);

    const resumeEvt = new Event('contentvisibilityautostatechange', { bubbles: false });
    Object.defineProperty(resumeEvt, 'skipped', { value: false });
    section.dispatchEvent(resumeEvt);
    expect(host.visible).toBe(true);
    host.dispose();
  });

  it('keeps heavy 3D and wallet chunks out of initial dist/landing.html modulepreloads when built', () => {
    if (!fs.existsSync(distLandingPath)) return;
    const built = fs.readFileSync(distLandingPath, 'utf8');
    const head = built.slice(0, built.indexOf('</head>'));
    for (const deferred of ['three-vendor', 'checkpoints', 'WorkParticleEmitter', 'createHexTerrain', 'nearWalletModal']) {
      expect(head).not.toContain(deferred);
    }
  });
});
