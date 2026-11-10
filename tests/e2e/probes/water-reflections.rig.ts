import type { Page } from '@playwright/test';
import { devConsole, expect, loadLocal } from '../harness';

/**
 * Page rig for `water-reflections.spec.ts` (planar water reflections, `frontend/render/visuals/water/reflection/`).
 *
 * Everything runs against the app's own module instances: the URLs of `three`, `waterConfig.ts`, `perfConfig.ts` and
 * `reflectionUniforms.ts` are taken from the page's resource timing entries (a long-lived Vite adds `?t=` / `?v=` to
 * imports, so a bare path could load a second copy). Pixels are read from the WebGL canvas itself (the app renders
 * with `preserveDrawingBuffer: true`), so DOM overlays (HUD, build panel, CRT) never get in the way.
 */

/** The `w05-terrain` shallow lake (`tests/scenarios/w05-terrain.ts`, patch `shallow`: centre + one ring of 7 hexes). */
export const SHALLOW_LAKE = { q: -8, r: 0 } as const;
/** The deep-water patch next to it (centre deep, ring shallow): water far from the test post. */
export const DEEP_LAKE = { q: -8, r: 4 } as const;
/** A dry rock patch on the opposite side of the Hub (no water within ~12 m at the closest zoom). */
export const DRY_TILE = { q: 8, r: -4 } as const;

/** F8 → WATER params the spec uses (subset of `WaterParams`, plus `reflectDebug` once it has landed). */
export type WaterPatch = Partial<Record<
  'waveHeight' | 'waveSpeed' | 'detailNormal' | 'foamAmount' | 'sunGlint' | 'caustics' | 'faunaDensity' | 'quality'
  | 'reflection' | 'reflectDistort' | 'reflectRes' | 'reflectDebug', number>>;

/** Calm, frozen water: no swell, frozen wave clock, no ripples / foam / glint / fish (all of them move or mask the mirror). */
export const CALM_WATER: WaterPatch = {
  waveHeight: 0, waveSpeed: 0, detailNormal: 0, foamAmount: 0, sunGlint: 0, caustics: 0, faunaDensity: 0, quality: 2,
};

export interface Telemetry { reflectOn: boolean; reflectMs: number; reflectW: number; reflectH: number; reflectRect: number }
export interface Rgb { r: number; g: number; b: number }
export interface ScreenPt { x: number; y: number; inView: boolean }

export interface OpenOpts {
  /** Water params saved before the page loads (`terraagent.water.params.v1`). */
  water?: WaterPatch;
  /** Extra URL params (e.g. `shadow: '1'`). */
  params?: Record<string, string>;
  /** Set the solar clock to 12:00 through the dev console (default true). */
  noon?: boolean;
}

/**
 * Opens `/play.html?host=local&scenario=w05-terrain` with post effects off (`crt=0`, `pixel=0`), a fixed render scale
 * (`scale=1`, no adaptive resolution steps between two reads), a static sun (`daynight=0`), no shadows unless asked
 * (a tall test object's shadow would fall on the water), calm wind and the given water params; sets noon; installs the
 * rig (`window.__wr`). Vite HMR is blocked so other people's edits cannot reload the page mid-test.
 *
 * Workaround (unrelated app bug, see `KNOWN_WARNING`): `archetypeThumb.ts` `webglOk()` creates a throwaway WebGL
 * context for every Build-menu thumbnail and never releases it; past Chrome's active-context limit the browser drops
 * the OLDEST context, which is often the colony viewport itself (the canvas then stays black, `isContextLost()`).
 * The init script loses such probe contexts (a detached canvas asking for `webgl`/`webgl2` with no attributes; three
 * always passes attributes) right after the probe has read them. `E2E_KEEP_PROBE_CONTEXTS=1` turns it off.
 */
export async function openReflectionScene(page: Page, opts: OpenOpts = {}): Promise<void> {
  await page.context().routeWebSocket(/./, () => { /* swallow Vite HMR */ });
  const water = { ...CALM_WATER, ...opts.water };
  await page.addInitScript(([w, releaseProbes]: [string, boolean]) => {
    try { performance.setResourceTimingBufferSize(20_000); } catch { /* old browser */ }
    localStorage.setItem('terraagent.water', '1');
    localStorage.setItem('terraagent.water.params.v1', w);
    localStorage.setItem('terraagent.wind.params.v1', JSON.stringify({ strength: 0, gust: 0, turbulence: 0 }));
    if (!releaseProbes) return;
    const get = HTMLCanvasElement.prototype.getContext;
    (window as unknown as { __wrProbes: number }).__wrProbes = 0;
    HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, type: string, attrs?: unknown) {
      const ctx = (get as (this: HTMLCanvasElement, t: string, a?: unknown) => RenderingContext | null).call(this, type, attrs);
      if (ctx && attrs === undefined && /^webgl2?$/.test(type) && !this.isConnected) {
        setTimeout(() => {
          const gl = ctx as WebGLRenderingContext;
          gl.getExtension('WEBGL_lose_context')?.loseContext();
          (window as unknown as { __wrProbes: number }).__wrProbes++;
        }, 0);
      }
      return ctx;
    } as typeof HTMLCanvasElement.prototype.getContext;
  }, [JSON.stringify(water), process.env.E2E_KEEP_PROBE_CONTEXTS !== '1'] as [string, boolean]);
  await loadLocal(page, 'w05-terrain', { crt: '0', pixel: '0', scale: '1', daynight: '0', shadow: '0', skip: '1', ...opts.params }, 90_000);
  if (opts.noon !== false) await devConsole(page, 'time noon', 20_000);
  await installRig(page);
  // The first frames after the first tick can still be empty (boot overlay, shader compile): wait for real pixels.
  // Unrendered = transparent black (reads as 0, 0, 0); the planet always covers the middle of the opening view.
  await expect.poll(async () => {
    const lost = await page.evaluate(() => (window as unknown as { __online: { viewport: { renderer: { getContext(): WebGL2RenderingContext } } } }).__online.viewport.renderer.getContext().isContextLost());
    if (lost) return 'colony WebGL context lost';
    const px = await sample(page, [{ x: 640, y: 360 }, { x: 540, y: 300 }, { x: 740, y: 420 }, { x: 540, y: 420 }, { x: 740, y: 300 }], 2);
    return px.filter((c) => c.r + c.g + c.b > 0).length >= 3 ? 'rendered' : 'black canvas';
  }, { timeout: 60_000, message: 'colony canvas never showed a rendered frame' }).toBe('rendered');
  await frames(page, 3);
}

/** GPU-side warnings worth failing on (shader compile / link logs, GL errors, framebuffer problems). */
const GL_WARNING = /GL_INVALID|GL ERROR|WebGL: |THREE\.WebGL(Program|Renderer|Shader)|Shader Error|framebuffer|incomplete/i;
/** Pre-existing and unrelated: `archetypeThumb.ts` `webglOk()` opens a throwaway context per Build-menu thumbnail. */
const KNOWN_WARNING = /Too many active WebGL contexts/;

/** Starts collecting GL / shader console warnings of this page (call before `openReflectionScene`). */
export function collectGlWarnings(page: Page): string[] {
  const out: string[] = [];
  page.on('console', (m) => {
    if (m.type() !== 'warning' && m.type() !== 'error') return;
    const t = m.text();
    if (GL_WARNING.test(t) && !KNOWN_WARNING.test(t)) out.push(`${m.type()}: ${t.slice(0, 400)}`);
  });
  return out;
}

/** `gl.getError()` of the colony renderer, drained (0 = NO_ERROR); also whether the context is lost. */
export const glState = (page: Page): Promise<{ errors: number[]; lost: boolean }> =>
  page.evaluate(() => {
    const gl = (window as unknown as { __online: { viewport: { renderer: { getContext(): WebGL2RenderingContext } } } }).__online.viewport.renderer.getContext();
    const errors: number[] = [];
    for (let e = gl.getError(), n = 0; e !== gl.NO_ERROR && n < 16; e = gl.getError(), n++) errors.push(e);
    return { errors, lost: gl.isContextLost() };
  });

/** `DEFAULT_WATER_PARAMS` of the live build (so a changed default strength is followed, not hard-coded). */
export const waterDefaults = (page: Page): Promise<Record<string, number>> =>
  page.evaluate(() => ({ ...(window as unknown as { __wr: { water: { DEFAULT_WATER_PARAMS: Record<string, number> } } }).__wr.water.DEFAULT_WATER_PARAMS }));

/** Loads the app's module instances into `window.__wr` and checks they are the live ones. */
async function installRig(page: Page): Promise<void> {
  const err = await page.evaluate(async () => {
    const imp = new Function('u', 'return import(u)') as (u: string) => Promise<Record<string, unknown>>;
    const urls = performance.getEntriesByType('resource').map((e) => e.name);
    const find = (re: RegExp): string | undefined => urls.filter((u) => re.test(new URL(u).pathname)).pop();
    const want = {
      three: find(/\/\.vite\/deps\/three\.js$/),
      water: find(/\/render\/visuals\/water\/waterConfig\.ts$/),
      perf: find(/\/render\/core\/perfConfig\.ts$/),
      refl: find(/\/render\/visuals\/water\/reflection\/reflectionUniforms\.ts$/),
    };
    for (const [k, u] of Object.entries(want)) if (!u) return `module not found in resource timing: ${k}`;
    const [THREE, water, perf, refl] = await Promise.all([imp(want.three!), imp(want.water!), imp(want.perf!), imp(want.refl!)]);
    const w = window as unknown as { __online: { viewport: { scene: object } }; __wr: unknown };
    if (!(w.__online.viewport.scene instanceof (THREE.Object3D as new () => object))) return 'second three instance (scene is not an Object3D of the loaded module)';
    w.__wr = { THREE, water, perf, refl, added: [] as unknown[] };
    return null;
  });
  expect(err, 'reflection rig').toBeNull();
}

/** Waits `n` animation frames (each one is a full app frame: mirror pass + composer). */
export const frames = (page: Page, n = 4): Promise<void> =>
  page.evaluate((k) => new Promise<void>((done) => {
    let left = k;
    const step = () => (--left <= 0 ? done() : requestAnimationFrame(step));
    requestAnimationFrame(step);
  }), n);

/** Applies water params at runtime (the F8 store; persisted like a slider edit) and waits a few frames. */
export async function setWater(page: Page, patch: WaterPatch): Promise<void> {
  await page.evaluate((p) => {
    const wr = (window as unknown as { __wr: { water: { setWaterParams(p: object): void } } }).__wr;
    wr.water.setWaterParams(p);
  }, patch);
  await frames(page, 4);
}

/** Whether the build has the `reflectDebug` (MIRROR ONLY) water param yet. */
export const hasReflectDebug = (page: Page): Promise<boolean> =>
  page.evaluate(() => 'reflectDebug' in (window as unknown as { __wr: { water: { DEFAULT_WATER_PARAMS: object } } }).__wr.water.DEFAULT_WATER_PARAMS);

export const telemetry = (page: Page): Promise<Telemetry> =>
  page.evaluate(() => {
    const t = (window as unknown as { __wr: { perf: { perfTelemetry: Telemetry } } }).__wr.perf.perfTelemetry;
    return { reflectOn: t.reflectOn, reflectMs: t.reflectMs, reflectW: t.reflectW, reflectH: t.reflectH, reflectRect: t.reflectRect };
  });

/** `uReflOn` as the water shader sees it (0 = the pass skipped this frame). */
export const uReflOn = (page: Page): Promise<number> =>
  page.evaluate(() => (window as unknown as { __wr: { refl: { getReflectionUniforms(): { uReflOn: { value: number } } } } }).__wr.refl.getReflectionUniforms().uReflOn.value);

/**
 * Points the RTS camera at a tile from a fixed yaw (45°, the default diorama view from +x +z) and distance, and turns
 * bloom off (a bright object's glow would bleed into the samples). Waits until the camera has settled.
 */
export async function frameCamera(page: Page, tile: { q: number; r: number }, dist: number): Promise<void> {
  await page.evaluate(([q, r, d]) => {
    type Cam = { dist: number; distGoal: number; yaw: number; yawGoal: number; enabled: boolean };
    const o = (window as unknown as { __online: { cam: Cam; focusTile(q: number, r: number, i: boolean): void; viewport: { bloom: { enabled: boolean } } } }).__online;
    o.cam.enabled = false; // no edge scroll / keys while the test reads pixels
    o.cam.dist = o.cam.distGoal = d;
    o.cam.yaw = o.cam.yawGoal = Math.PI / 4;
    o.focusTile(q, r, true);
    o.viewport.bloom.enabled = false;
  }, [tile.q, tile.r, dist] as const);
  await frames(page, 6);
}

/** World position of a tile centre at the water level (y = 0) and the unit ground vector pointing to the camera. */
export const tileWorld = (page: Page, tile: { q: number; r: number }): Promise<{ x: number; z: number; toCam: { x: number; z: number } }> =>
  page.evaluate(([q, r]) => {
    const o = (window as unknown as { __online: { viewport: { camera: { position: { x: number; z: number } } } } }).__online;
    const x = (q + r / 2) * 2, z = (r * Math.sqrt(3) / 2) * 2; // hexMath.tileXZ, TILE_M = 2
    const c = o.viewport.camera.position;
    const dx = c.x - x, dz = c.z - z, l = Math.hypot(dx, dz) || 1;
    return { x, z, toCam: { x: dx / l, z: dz / l } };
  }, [tile.q, tile.r] as const);

/**
 * Adds a vertical post standing on the water at (x, z): stacked unlit (`MeshBasicMaterial`, no fog) segments, each
 * `[height, hex colour]` from the bottom up. Returns nothing; `removePosts` takes them out again.
 */
export async function addPost(page: Page, at: { x: number; z: number }, width: number, segments: ReadonlyArray<readonly [number, number]>): Promise<void> {
  await page.evaluate(([x, z, w, segs]) => {
    type V = new (...a: number[]) => unknown;
    const wr = (window as unknown as { __wr: { THREE: Record<string, V>; added: unknown[] } }).__wr;
    const T = wr.THREE as unknown as {
      Group: new () => { add(o: unknown): void; position: { set(a: number, b: number, c: number): void }; name: string };
      Mesh: new (g: unknown, m: unknown) => { position: { y: number }; frustumCulled: boolean };
      BoxGeometry: new (a: number, b: number, c: number) => unknown;
      MeshBasicMaterial: new (o: object) => unknown;
    };
    const g = new T.Group();
    g.name = 'e2eReflectionPost';
    let y = 0;
    for (const [h, col] of segs) {
      const m = new T.Mesh(new T.BoxGeometry(w, h, w), new T.MeshBasicMaterial({ color: col, fog: false }));
      m.position.y = y + h / 2;
      g.add(m);
      y += h;
    }
    g.position.set(x, 0, z);
    const o = (window as unknown as { __online: { viewport: { scene: { add(o: unknown): void } } } }).__online;
    o.viewport.scene.add(g);
    wr.added.push(g);
  }, [at.x, at.z, width, segments.map((s) => [s[0], s[1]])] as const);
  await frames(page, 4);
}

/** Projects world points with the live camera to drawing-buffer pixels (what `sample` reads). */
export const project = (page: Page, pts: ReadonlyArray<readonly [number, number, number]>): Promise<ScreenPt[]> =>
  page.evaluate((list) => {
    type V3 = { x: number; y: number; z: number; project(c: unknown): V3 };
    const wr = (window as unknown as { __wr: { THREE: { Vector3: new (x: number, y: number, z: number) => V3 } } }).__wr;
    const vp = (window as unknown as { __online: { viewport: { camera: { updateMatrixWorld(): void }; renderer: { domElement: HTMLCanvasElement } } } }).__online.viewport;
    vp.camera.updateMatrixWorld();
    const { width: W, height: H } = vp.renderer.domElement;
    return list.map(([x, y, z]) => {
      const p = new wr.THREE.Vector3(x, y, z).project(vp.camera);
      return { x: ((p.x + 1) / 2) * W, y: ((1 - p.y) / 2) * H, inView: Math.abs(p.x) < 1 && Math.abs(p.y) < 1 && p.z < 1 };
    });
  }, pts as Array<readonly [number, number, number]>);

/** Mean sRGB 0..255 of a (2·half+1)² pixel block around each point of the last presented frame. */
export const sample = (page: Page, pts: ReadonlyArray<{ x: number; y: number }>, half = 3): Promise<Rgb[]> =>
  page.evaluate(([list, hh]) => {
    const gl = (window as unknown as { __online: { viewport: { renderer: { domElement: HTMLCanvasElement } } } }).__online.viewport.renderer.domElement;
    const c = document.createElement('canvas');
    c.width = gl.width; c.height = gl.height;
    const ctx = c.getContext('2d', { willReadFrequently: true })!;
    ctx.drawImage(gl, 0, 0);
    return list.map(({ x, y }) => {
      const x0 = Math.max(0, Math.round(x) - hh), y0 = Math.max(0, Math.round(y) - hh);
      const d = ctx.getImageData(x0, y0, 2 * hh + 1, 2 * hh + 1).data;
      let r = 0, g = 0, b = 0;
      const n = d.length / 4;
      for (let i = 0; i < d.length; i += 4) { r += d[i]!; g += d[i + 1]!; b += d[i + 2]!; }
      return { r: r / n, g: g / n, b: b / n };
    });
  }, [pts.map((p) => ({ x: p.x, y: p.y })), half] as const);

/** Saves the WebGL canvas as a PNG attachment of the running test (for eyeballing a failure). */
export async function canvasPng(page: Page): Promise<Buffer> {
  const url = await page.evaluate(() => (window as unknown as { __online: { viewport: { renderer: { domElement: HTMLCanvasElement } } } }).__online.viewport.renderer.domElement.toDataURL('image/png'));
  return Buffer.from(url.split(',')[1]!, 'base64');
}

export const sub = (a: Rgb, b: Rgb): Rgb => ({ r: a.r - b.r, g: a.g - b.g, b: a.b - b.b });
export const maxAbs = (d: Rgb): number => Math.max(Math.abs(d.r), Math.abs(d.g), Math.abs(d.b));
export const fmt = (c: Rgb): string => `(${c.r.toFixed(1)}, ${c.g.toFixed(1)}, ${c.b.toFixed(1)})`;
