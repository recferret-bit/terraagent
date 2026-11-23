// Post-main 3D/canvas preloader and HTTP/2 multiplexed scheduler for landing.html.
// Ensures above-the-fold copy, stats, interactive tabs, and sections paint first, then preloads all WebGL chunks
// in parallel over HTTP/2 and mounts #hero-stage first followed by below-the-fold 3D viewports.

export type StageState = 'queued' | 'loading' | 'live' | 'fallback';

export interface VisualFlagModule {
  setCrt(enabled: boolean): unknown;
  setPixelArt(enabled: boolean, syncUrl?: boolean): unknown;
  setShadow(enabled: boolean): unknown;
}

export interface Landing3DLoaders {
  loadVisualFlags(): Promise<VisualFlagModule>;
  loadHero(): Promise<() => unknown>;
  loadColony(): Promise<() => unknown>;
  loadResourceViewer(): Promise<() => Promise<unknown> | unknown>;
  loadPlanetCards(): Promise<() => unknown>;
  loadCrtEntry(): Promise<unknown>;
}

export interface StageLoaderOptions {
  readonly loaders?: Partial<Landing3DLoaders>;
  readonly skipPaintWait?: boolean;
  readonly staggerMs?: number;
}

interface ParallelPreloads {
  readonly visualP: Promise<VisualFlagModule | null>;
  readonly heroP: Promise<(() => unknown) | null>;
  readonly colonyP: Promise<(() => unknown) | null>;
  readonly resourceP: Promise<(() => Promise<unknown> | unknown) | null>;
  readonly planetsP: Promise<(() => unknown) | null>;
}

const DEFAULT_LOADERS: Landing3DLoaders = {
  async loadVisualFlags() {
    const [crt, pixelArt] = await Promise.all([
      import('@terra/render/ui/crt'),
      import('@terra/render/ui/pixelArt'),
    ]);
    return { setCrt: crt.setCrt, setPixelArt: pixelArt.setPixelArt, setShadow: pixelArt.setShadow };
  },
  loadHero: () => import('./hero/HeroStage').then((m) => m.initHeroStage),
  loadColony: () => import('./sections/colonyCanvas').then((m) => m.initColonyCanvas),
  loadResourceViewer: () => import('./resources').then((m) => m.mountResourceViewer3D),
  loadPlanetCards: () => import('./sections/planetCards').then((m) => m.initPlanetCards),
  loadCrtEntry: () => import('@terra/render/ui/crtEntry'),
};

function findStageContainers(root: ParentNode): HTMLElement[] {
  const result: HTMLElement[] = [];
  for (const id of ['hero-stage', 'colony-stage', 'rv-stage']) {
    const el = root.querySelector<HTMLElement>(`#${id}`);
    if (el) result.push(el);
  }
  for (const art of root.querySelectorAll<HTMLElement>('.planet-art')) {
    if (art.querySelector('canvas[data-planet]')) result.push(art);
  }
  return result;
}

function setStageState(el: HTMLElement | null, state: StageState): void {
  if (!el || el.dataset.stageState === 'live' || el.dataset.stageState === 'fallback') return;
  el.dataset.stageState = state;
}

export function markQueuedStages(root: ParentNode = document): HTMLElement[] {
  const stages = findStageContainers(root);
  for (const el of stages) {
    if (!el.dataset.stageState) el.dataset.stageState = 'queued';
  }
  return stages;
}

/** Resolves after the browser finishes initial layout and commits the first main-content paint. */
export function waitForMainContentPaint(): Promise<void> {
  return new Promise((resolve) => {
    const finish = () => setTimeout(resolve, 0);
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(finish);
    else finish();
  });
}

function scheduleNextFrameTask(task: () => void, delayMs: number): void {
  const win = typeof window !== 'undefined' ? (window as Window & {
    requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number;
  }) : null;
  if (win && typeof win.requestIdleCallback === 'function') {
    win.requestIdleCallback(() => task(), { timeout: Math.max(80, delayMs * 4) });
    return;
  }
  if (typeof requestAnimationFrame === 'function') {
    requestAnimationFrame(() => setTimeout(task, delayMs));
    return;
  }
  setTimeout(task, delayMs);
}

/** Prefetches /play.html in the background when the user hovers or focuses any landing Play CTA. */
export function bindSpeculativePlayPrefetch(root: ParentNode = document): void {
  if (typeof document === 'undefined' || !document.head) return;
  let prefetched = false;
  const prefetch = () => {
    if (prefetched) return;
    prefetched = true;
    if (document.head.querySelector('link[rel="prefetch"][href="/play.html"]')) return;
    const link = document.createElement('link');
    link.rel = 'prefetch';
    link.href = '/play.html';
    link.as = 'document';
    document.head.appendChild(link);
  };
  for (const anchor of root.querySelectorAll<HTMLAnchorElement>('a[href*="/play.html"]')) {
    anchor.addEventListener('pointerenter', prefetch, { once: true, passive: true });
    anchor.addEventListener('focus', prefetch, { once: true, passive: true });
  }
}

function startParallelPreloads(root: ParentNode, loaders: Landing3DLoaders): ParallelPreloads {
  return {
    visualP: loaders.loadVisualFlags().catch(() => null),
    heroP: loaders.loadHero().catch((e) => {
      console.warn('landing hero 3D preload failed', e);
      setStageState(root.querySelector<HTMLElement>('#hero-stage'), 'fallback');
      return null;
    }),
    colonyP: loaders.loadColony().catch((e) => {
      console.warn('landing colony 3D preload failed', e);
      setStageState(root.querySelector<HTMLElement>('#colony-stage'), 'fallback');
      return null;
    }),
    resourceP: loaders.loadResourceViewer().catch((e) => {
      console.warn('landing resource 3D preload failed', e);
      setStageState(root.querySelector<HTMLElement>('#rv-stage'), 'fallback');
      return null;
    }),
    planetsP: loaders.loadPlanetCards().catch((e) => {
      console.warn('landing planet cards 3D preload failed', e);
      for (const art of root.querySelectorAll<HTMLElement>('.planet-art')) setStageState(art, 'fallback');
      return null;
    }),
  };
}

async function mountBelowFoldStages(
  root: ParentNode,
  preloads: ParallelPreloads,
  staggerMs: number,
): Promise<void> {
  type StageKey = 'colony' | 'resources' | 'planets';
  const mounted = new Set<StageKey>();
  const mountStage = async (key: StageKey): Promise<void> => {
    if (mounted.has(key)) return;
    mounted.add(key);
    if (key === 'colony') {
      const initColony = await preloads.colonyP;
      if (initColony) try { initColony(); } catch (e) { console.warn('landing colony stage failed', e); }
    } else if (key === 'resources') {
      const mountRv = await preloads.resourceP;
      if (mountRv) try { await mountRv(); } catch (e) { console.warn('landing resource viewer failed', e); }
    } else {
      const initPlanets = await preloads.planetsP;
      if (initPlanets) try { initPlanets(); } catch (e) { console.warn('landing planet cards failed', e); }
    }
  };

  let io: IntersectionObserver | null = null;
  const targetToKey = new Map<Element, StageKey>();
  if (typeof IntersectionObserver !== 'undefined') {
    io = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        const key = targetToKey.get(entry.target);
        io?.unobserve(entry.target);
        if (key) void mountStage(key);
      }
    }, { rootMargin: '320px 0px' });
    const entries: Array<readonly [Element | null, StageKey]> = [
      [root.querySelector('#colony-stage'), 'colony'],
      [root.querySelector('#rv-stage'), 'resources'],
      [root.querySelector('#planets'), 'planets'],
    ];
    for (const [el, key] of entries) {
      if (el) { targetToKey.set(el, key); io.observe(el); }
    }
  }

  for (const key of ['colony', 'resources', 'planets'] as const) {
    await new Promise<void>((resolve) => {
      if (mounted.has(key)) { resolve(); return; }
      scheduleNextFrameTask(() => { void mountStage(key).finally(resolve); }, staggerMs);
    });
  }
  io?.disconnect();
}

/**
 * Concurrently preloads all 3D stage modules over HTTP/2 after main paint, configures global visual flags,
 * mounts the above-the-fold Hero orbit stage first, and staggers below-the-fold 3D stages + CRT overlays.
 */
export async function preloadAndMountLanding3D(
  root: ParentNode = document,
  opts: StageLoaderOptions = {},
): Promise<void> {
  const loaders: Landing3DLoaders = { ...DEFAULT_LOADERS, ...(opts.loaders ?? {}) };
  for (const el of markQueuedStages(root)) setStageState(el, 'loading');

  const preloads = startParallelPreloads(root, loaders);
  const flags = await preloads.visualP;
  if (flags) {
    try {
      flags.setShadow(true);
      flags.setPixelArt(true, false);
      flags.setCrt(true);
    } catch (e) {
      console.warn('landing visual flag init failed', e);
    }
  }

  const initHero = await preloads.heroP;
  if (initHero) {
    try { initHero(); } catch (e) { console.warn('landing hero stage failed', e); }
  }

  await mountBelowFoldStages(root, preloads, opts.staggerMs ?? 24);
  await loaders.loadCrtEntry().catch((e) => {
    console.warn('landing CRT overlay preload failed', e);
    return null;
  });
}

export function scheduleLanding3DStages(
  root: ParentNode = document,
  opts: StageLoaderOptions = {},
): Promise<void> {
  markQueuedStages(root);
  bindSpeculativePlayPrefetch(root);
  const start = () => preloadAndMountLanding3D(root, opts);
  return opts.skipPaintWait ? start() : waitForMainContentPaint().then(start);
}
