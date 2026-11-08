import { writeFileSync } from 'node:fs';
import type { Page } from '@playwright/test';
import { devConsole, expect, expectNoPageErrors, test } from '../harness';
import {
  addPost, canvasPng, collectGlWarnings, DEEP_LAKE, DRY_TILE, fmt, frameCamera, frames, glState, hasReflectDebug, maxAbs,
  openReflectionScene, project, sample, setWater, SHALLOW_LAKE, sub, telemetry, tileWorld, uReflOn, waterDefaults,
  type Rgb, type ScreenPt,
} from './water-reflections.rig';

/**
 * Probe (not a wave suite): planar water reflections (`frontend/render/visuals/water/reflection/`) in a real browser
 * with real WebGL, on the `w05-terrain` scenario with the browser-only engine (`?host=local`: no app, no Postgres).
 *
 * Run (boots its own Vite on the worktree's E2E port, base + 1174):
 *   E2E_HOST=local npx playwright test -c tests/e2e/playwright.config.ts tests/e2e/probes/water-reflections.spec.ts
 * Against a Vite that is already running on port P: add `TA_PORT_BASE=<P - 1174>` (the harness then finds it up).
 * Real GPU instead of the config's SwiftShader: add `E2E_GPU=1` (ANGLE Metal; macOS).
 *
 * Scene: noon, calm frozen water (no swell / ripples / foam / glint / fish, wave clock stopped), wind 0, bloom, CRT,
 * pixel-art and shadows off, camera at a fixed 45° yaw over the shallow lake (-8, 0). A test post stands in the water on
 * the lake's far side: two unlit, unfogged boxes, RED (bottom 1.2 m) under GREEN (top 1.2 m). Every check compares the
 * same frame with the mirror on vs off (`reflection` 0 skips the pass) and reads 7×7 px blocks at positions projected
 * with the live camera, so it holds at any canvas size and under SwiftShader.
 */
test.describe.configure({ timeout: 300_000 });
if (process.env.E2E_GPU === '1') test.use({ launchOptions: { args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] } });

const RED = 0xff0000, GREEN = 0x00ff00;
/** Height of each post segment (m); the whole post is 2 × SEG. */
const SEG = 1.2;
const POST_W = 0.7;
/** Post base: this far from the lake centre on the side away from the camera, so the mirror image (≈ 1.1 × height toward the camera at the 42° pitch) still lands on water. */
const BASE_BACK = 1.7;

/** How much a colour change points toward red / green: the channel's rise over the larger of the other two. */
const redScore = (d: Rgb) => d.r - Math.max(d.g, d.b);
const greenScore = (d: Rgb) => d.g - Math.max(d.r, d.b);
const luma = (d: Rgb) => 0.2126 * d.r + 0.7152 * d.g + 0.0722 * d.b;
const mean = (list: Rgb[]): Rgb => ({
  r: list.reduce((s, c) => s + c.r, 0) / list.length, g: list.reduce((s, c) => s + c.g, 0) / list.length, b: list.reduce((s, c) => s + c.b, 0) / list.length,
});

interface PostScene {
  base: { x: number; z: number };
  /** Screen position of the post's base on the water. */
  basePt: ScreenPt;
  /** Where the mirror images of the RED (lower) and GREEN (upper) segments must appear (3 heights each). */
  redRefl: ScreenPt[];
  greenRefl: ScreenPt[];
  /** Just past the mirror image of the post's top (still water): no post colour may be there. */
  beyondTop: ScreenPt[];
  /** Water 1.3 m beside the mirror image (same lake): no post colour may be there. */
  beside: ScreenPt[];
  /** Water far from any object (the deep patch's centre and around it). */
  farWater: ScreenPt[];
  /** Grass above the post on screen (no water): must not change at all between the two frames. */
  control: ScreenPt[];
}

/** Frames the shallow lake, plants the RED/GREEN post on its far side and projects every sample position. */
async function lakeWithPost(page: Page): Promise<PostScene> {
  await frameCamera(page, SHALLOW_LAKE, 30);
  const lake = await tileWorld(page, SHALLOW_LAKE);
  const deep = await tileWorld(page, DEEP_LAKE);
  const t = lake.toCam, side = { x: -t.z, z: t.x };
  const base = { x: lake.x - t.x * BASE_BACK, z: lake.z - t.z * BASE_BACK };
  await addPost(page, base, POST_W, [[SEG, RED], [SEG, GREEN]]);
  // The box is axis-aligned, so on the screen column through its centre the silhouette (and its mirror image) is the
  // vertical edge nearest the camera: sample along that edge's mirror image.
  const front = { x: base.x + Math.sign(t.x) * POST_W / 2, z: base.z + Math.sign(t.z) * POST_W / 2 };
  const at = (p: { x: number; z: number }, y: number, s = 0, f = 0) => [p.x + side.x * s + t.x * f, y, p.z + side.z * s + t.z * f] as const;
  const fr = [0.3, 0.5, 0.7];
  const pts = await project(page, [
    at(base, 0),
    ...fr.map((k) => at(front, -SEG * k)),
    ...fr.map((k) => at(front, -SEG * (1 + k))),
    at(front, -(2 * SEG + 0.35)), at(front, -(2 * SEG + 0.6)),
    at(base, 0, 1.3, 1.4), at(base, 0, -1.3, 1.4),
    at(deep, 0), at(deep, 0, 0.8), at(deep, 0, -0.8),
    at(base, 2 * SEG + 0.5), at(base, 2 * SEG + 0.9),
  ]);
  for (const p of pts) expect(p.inView, `sample point ${JSON.stringify(p)} on screen`).toBe(true);
  return {
    base, basePt: pts[0]!, redRefl: pts.slice(1, 4), greenRefl: pts.slice(4, 7), beyondTop: pts.slice(7, 9),
    beside: pts.slice(9, 11), farWater: pts.slice(11, 14), control: pts.slice(14, 16),
  };
}

/** Reads every sample group of `s` from the current frame. */
async function readGroups(page: Page, s: PostScene): Promise<Record<'red' | 'green' | 'beyond' | 'beside' | 'far' | 'control', Rgb[]>> {
  const groups = { red: s.redRefl, green: s.greenRefl, beyond: s.beyondTop, beside: s.beside, far: s.farWater, control: s.control };
  const flat = Object.values(groups).flat();
  const px = await sample(page, flat, 3);
  let i = 0;
  const out = {} as Record<keyof typeof groups, Rgb[]>;
  for (const [k, list] of Object.entries(groups)) { out[k as keyof typeof groups] = px.slice(i, i + list.length); i += list.length; }
  return out;
}

/** Per-group mean colour change (on − off) and a printable report line per group. */
function deltas(on: Awaited<ReturnType<typeof readGroups>>, off: Awaited<ReturnType<typeof readGroups>>) {
  const d = {} as Record<keyof typeof on, Rgb>;
  const lines: string[] = [];
  for (const k of Object.keys(on) as (keyof typeof on)[]) {
    d[k] = sub(mean(on[k]), mean(off[k]));
    lines.push(`${k.padEnd(8)} off ${fmt(mean(off[k]))} on ${fmt(mean(on[k]))} Δ ${fmt(d[k])} red ${redScore(d[k]).toFixed(1)} green ${greenScore(d[k]).toFixed(1)}`);
  }
  return { d, report: lines.join('\n') };
}

/** Saves the WebGL canvas next to the test's results (`tests/e2e/.out/results/<test>/<name>`) and attaches it. */
async function attach(page: Page, name: string): Promise<void> {
  const path = test.info().outputPath(name);
  writeFileSync(path, await canvasPng(page));
  await test.info().attach(name, { path, contentType: 'image/png' });
}

test.describe('water reflections: image', () => {
  test('1. a post standing in the lake shows its colours in the water below it; far water stays about the same', async ({ page }) => {
    await openReflectionScene(page);
    const strength = (await waterDefaults(page)).reflection!;
    expect(strength, 'default MIRROR REFLECTION strength').toBeGreaterThan(0);
    const s = await lakeWithPost(page);
    await setWater(page, { reflection: 0 });
    const off = await readGroups(page, s);
    await attach(page, 'reflection-off.png');
    await setWater(page, { reflection: strength });
    expect((await telemetry(page)).reflectOn, 'mirror pass ran with the default strength').toBe(true);
    const on = await readGroups(page, s);
    await attach(page, 'reflection-on.png');
    const { d, report } = deltas(on, off);
    console.log(`[water-reflections] case 1, strength ${strength}\n${report}`);
    test.info().annotations.push({ type: 'pixels', description: report });

    // Same frame otherwise: only the water may change.
    expect(maxAbs(d.control), `grass above the post changed: ${fmt(d.control)}`).toBeLessThanOrEqual(4);
    // The mirror image is there, and in the object's colours (RED nearest the base, GREEN beyond).
    expect(redScore(d.red), `water below the RED segment did not turn red: Δ ${fmt(d.red)}`).toBeGreaterThanOrEqual(12);
    expect(greenScore(d.green), `water below the GREEN segment did not turn green: Δ ${fmt(d.green)}`).toBeGreaterThanOrEqual(12);
    // Far water: the sky in the mirror replaces the old fake sky tint, so it may shift a little, but must not wash out.
    expect(maxAbs(d.far), `far water changed too much (washed out?): Δ ${fmt(d.far)}`).toBeLessThanOrEqual(12);
    expect(Math.abs(luma(d.far)), `far water brightness changed: Δluma ${luma(d.far).toFixed(1)}`).toBeLessThanOrEqual(8);
    // And the post's image is much stronger than whatever the far water does.
    expect(redScore(d.red), 'RED image vs far-water change').toBeGreaterThan(2 * Math.max(0, redScore(d.far)) + 6);
    expect(greenScore(d.green), 'GREEN image vs far-water change').toBeGreaterThan(2 * Math.max(0, greenScore(d.far)) + 6);
    expectNoPageErrors(page);
  });

  test('2. mirror geometry: the image is on the camera side of the base, upside down, as long as the post', async ({ page }) => {
    await openReflectionScene(page);
    const debug = await hasReflectDebug(page);
    // MIRROR ONLY when the build has it (the water draws the bare mirror image); else max strength, no distortion.
    const mirrorOn = debug ? { reflection: 1, reflectDistort: 0, reflectDebug: 1 } : { reflection: 1.5, reflectDistort: 0 };
    test.info().annotations.push({ type: 'mode', description: debug ? 'reflectDebug (MIRROR ONLY)' : 'no reflectDebug in this build: strength 1.5, distortion 0' });
    const s = await lakeWithPost(page);
    await setWater(page, { reflection: 0, reflectDebug: 0, reflectDistort: 0 });
    const off = await readGroups(page, s);
    await setWater(page, mirrorOn);
    const on = await readGroups(page, s);
    await attach(page, 'mirror.png');
    const { d, report } = deltas(on, off);
    console.log(`[water-reflections] case 2 (${debug ? 'reflectDebug' : 'strength 1.5'})\n${report}`);
    test.info().annotations.push({ type: 'pixels', description: report });

    // Camera side, upside down: the samples were projected from the mirrored points (x, -h, z), so they sit below the
    // base on screen, the RED (low) one nearer the base, the GREEN (high) one farther.
    const yR = s.redRefl[1]!.y, yG = s.greenRefl[1]!.y;
    expect(yR, 'mirror image of the low segment is below the base on screen').toBeGreaterThan(s.basePt.y + 4);
    expect(yG, 'mirror image of the high segment is below the low one').toBeGreaterThan(yR + 4);
    // ...and the pixels there carry those colours, in that order (an upright copy would swap them).
    expect(redScore(d.red), `RED expected next to the base: Δ ${fmt(d.red)}`).toBeGreaterThanOrEqual(15);
    expect(greenScore(d.red), `GREEN must not be next to the base: Δ ${fmt(d.red)}`).toBeLessThan(5);
    expect(greenScore(d.green), `GREEN expected farthest from the base: Δ ${fmt(d.green)}`).toBeGreaterThanOrEqual(15);
    expect(redScore(d.green), `RED must not be farthest from the base: Δ ${fmt(d.green)}`).toBeLessThan(5);
    if (debug) {
      const r = mean(on.red), g = mean(on.green);
      expect(redScore(r), `MIRROR ONLY: RED image colour ${fmt(r)}`).toBeGreaterThanOrEqual(40);
      expect(greenScore(g), `MIRROR ONLY: GREEN image colour ${fmt(g)}`).toBeGreaterThanOrEqual(40);
    }
    // The image ends where the mirrored top projects (right plane height and scale), and stays in its column.
    for (const [name, k] of [['past the mirrored top', 'beyond'], ['beside the image', 'beside']] as const) {
      expect(Math.max(redScore(d[k]), greenScore(d[k])), `post colour ${name}: Δ ${fmt(d[k])}`).toBeLessThan(8);
    }
    expectNoPageErrors(page);
  });
});

test.describe('water reflections: when the pass runs', () => {
  let page: Page;
  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    await openReflectionScene(page);
  });
  test.afterAll(async () => { await page?.close(); });

  test('3a. colony view: the pass draws only the screen rect of the visible water', async () => {
    // The opening view (whole planet, both lakes on screen): no camera change yet.
    await expect.poll(async () => (await telemetry(page)).reflectOn, { timeout: 20_000 }).toBe(true);
    const t = await telemetry(page);
    test.info().annotations.push({ type: 'telemetry', description: JSON.stringify(t) });
    expect(t.reflectRect, 'reflectRect').toBeGreaterThan(0);
    expect(t.reflectRect, 'reflectRect').toBeLessThan(1);
    expect(t.reflectW * t.reflectH, 'mirror target allocated').toBeGreaterThan(0);
    expect(await uReflOn(page), 'uReflOn = strength while the pass runs').toBeGreaterThan(0);
  });

  test('3b. strength 0: the pass is skipped', async () => {
    const strength = (await waterDefaults(page)).reflection!;
    await frameCamera(page, SHALLOW_LAKE, 30);
    await setWater(page, { reflection: strength });
    expect((await telemetry(page)).reflectOn, 'precondition: on over the lake').toBe(true);
    await setWater(page, { reflection: 0 });
    const t = await telemetry(page);
    test.info().annotations.push({ type: 'telemetry', description: JSON.stringify(t) });
    expect(t.reflectOn, 'reflectOn').toBe(false);
    expect(t.reflectMs, 'reflectMs').toBe(0);
    expect(t.reflectRect, 'reflectRect').toBe(0);
    expect(await uReflOn(page), 'uReflOn').toBe(0);
    await setWater(page, { reflection: strength });
    expect((await telemetry(page)).reflectOn, 'pass resumes when the strength comes back').toBe(true);
  });

  test('3c. no water on screen: the pass is skipped', async () => {
    await setWater(page, { reflection: (await waterDefaults(page)).reflection! });
    await frameCamera(page, DRY_TILE, 20);
    await frames(page, 6);
    const t = await telemetry(page);
    test.info().annotations.push({ type: 'telemetry', description: JSON.stringify(t) });
    await attach(page, 'dry-view.png');
    expect(t.reflectOn, 'reflectOn').toBe(false);
    expect(t.reflectRect, 'reflectRect').toBe(0);
    expect(await uReflOn(page), 'uReflOn').toBe(0);
    expect(t.reflectW, 'reflectW telemetry 0 while the pass is skipped (no water on screen; the target is kept, freed only at strength 0)').toBe(0);
    await frameCamera(page, SHALLOW_LAKE, 30);
    expect((await telemetry(page)).reflectOn, 'pass resumes over the lake').toBe(true);
  });
});

test.describe('water reflections: tiers', () => {
  for (const [tier, quality] of [['MED', 1], ['HIGH', 2]] as const) {
    test(`4. ${tier} tier: the pass runs, no console / shader / GL errors (noon and midnight, shadows on)`, async ({ page }) => {
      const warnings = collectGlWarnings(page);
      await openReflectionScene(page, { water: { quality }, params: { shadow: '1', daynight: '1' } });
      await frameCamera(page, SHALLOW_LAKE, 30);
      await addPost(page, (await tileWorld(page, SHALLOW_LAKE)), POST_W, [[SEG, RED], [SEG, GREEN]]);
      await expect.poll(async () => (await telemetry(page)).reflectOn, { timeout: 20_000 }).toBe(true);
      expect(await uReflOn(page)).toBeGreaterThan(0);
      const lake = await tileWorld(page, SHALLOW_LAKE);
      const grass = await project(page, [[lake.x - lake.toCam.x * 5, 0.1, lake.z - lake.toCam.z * 5]]);
      const noon = luma((await sample(page, grass))[0]!);
      await devConsole(page, 'time midnight', 20_000);
      // Night must really have fallen (the solar clock syncs to the renderer over a few frames).
      await expect.poll(async () => noon - luma((await sample(page, grass))[0]!), { timeout: 30_000, message: `grass luma at noon ${noon.toFixed(1)}: no night` }).toBeGreaterThan(30);
      await frames(page, 8);
      expect((await telemetry(page)).reflectOn, 'pass runs at night too').toBe(true);
      await attach(page, `${tier}-midnight.png`);
      const gl = await glState(page);
      expect(gl.lost, 'WebGL context lost').toBe(false);
      expect(warnings, 'GL / shader console warnings').toEqual([]);
      expect(gl.errors, 'gl.getError()').toEqual([]);
      expectNoPageErrors(page);
    });
  }

  test('4. LOW tier: the pass does not run, no errors; switching LOW → HIGH → LOW at runtime recompiles cleanly', async ({ page }) => {
    const warnings = collectGlWarnings(page);
    await openReflectionScene(page, { water: { quality: 0 } });
    await frameCamera(page, SHALLOW_LAKE, 30);
    let t = await telemetry(page);
    expect(t.reflectOn, 'reflectOn at LOW').toBe(false);
    expect(t.reflectRect, 'reflectRect at LOW').toBe(0);
    expect(await uReflOn(page), 'uReflOn at LOW').toBe(0);
    await setWater(page, { quality: 2 });
    await expect.poll(async () => (await telemetry(page)).reflectOn, { timeout: 20_000 }).toBe(true);
    await setWater(page, { quality: 0 });
    t = await telemetry(page);
    expect(t.reflectOn, 'reflectOn back at LOW').toBe(false);
    const gl = await glState(page);
    expect(warnings, 'GL / shader console warnings').toEqual([]);
    expect(gl.errors, 'gl.getError()').toEqual([]);
    expectNoPageErrors(page);
  });
});
