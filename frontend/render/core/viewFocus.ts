import * as THREE from 'three';

/**
 * The "view focus": the part of the ground the camera can see. Its shape is the camera's ground footprint (the
 * quad where the four screen corners' rays meet the ground: a trapezoid for the tilted RTS camera), scaled about its
 * centre by a margin (default `VIEW_FOCUS_MARGIN` 1.0 = the screen itself; F8 → PERF → FOCUS MARGIN /
 * `setViewFocusMargin`) and grown by `VIEW_FOCUS_EDGE_PAD` metres, so a tree whose base is just below the screen edge
 * but whose crown is on screen still sways. A circle around it (centre xz + radius) bounds it: it is what the
 * coarse users read (shadow box fit, prop compaction, the "camera looks at the horizon" cap). Every per-frame effect
 * that only matters on screen (shadow casters, projector lights, wind sway, water waves and fauna, ambient particles,
 * entity animation, ...) restricts itself to the focus.
 *
 * It used to be only the circle × 1.5: for a tilted camera that circle reaches far past the near and side screen
 * edges, so trees and water kept animating well off-screen (visible with the focus frozen).
 *
 * Updated once per frame from the camera being rendered (`createColonyViewport().render()` calls `updateViewFocus`).
 * Shaders read `uViewFocus` (vec4: x, z, radius, enabled 0/1) + `uViewFocusEdges` (the quad's 4 outward edge lines);
 * CPU code reads `getViewFocus()` / `inViewFocus()`. Turn it off with `?focus=0` (or `setViewFocusEnabled(false)`)
 * to compare: the focus then covers everything.
 */
export const VIEW_FOCUS_MARGIN = 1;
/** Metres the footprint quad (and circle) grow beyond the margin: about a tree's height, plus a projector's spill. */
export const VIEW_FOCUS_EDGE_PAD = 4;
/** Allowed range of the margin setting (F8 → PERF → FOCUS MARGIN, `setViewFocusMargin`). */
export const VIEW_FOCUS_MARGIN_RANGE = [1, 2.5] as const;
/** Upper bound on the radius (m), so a camera looking at the horizon does not make the focus the whole world. */
export const VIEW_FOCUS_MAX_RADIUS = 220;
const UNBOUNDED = 1e6;

export interface ViewFocus {
  readonly x: number;
  readonly z: number;
  /** Inflated radius (m). */
  readonly radius: number;
  /** Radius of the bare visible footprint (m), before the margin. */
  readonly visibleRadius: number;
  readonly enabled: boolean;
}

function readInitialEnabled(): boolean {
  try { return new URLSearchParams(location.search).get('focus') !== '0'; } catch { return true; }
}

let enabled = readInitialEnabled();
let margin = VIEW_FOCUS_MARGIN;
let frozen = false;
const focus = { x: 0, z: 0, radius: UNBOUNDED, visibleRadius: UNBOUNDED, enabled };
const uniform = { value: new THREE.Vector4(0, 0, UNBOUNDED, enabled ? 1 : 0) };
/**
 * The focus quad as 4 edge lines, column i = (nx, nz, c, 0) with n the outward unit normal: the signed distance of
 * a ground point p outside edge i is `nx·px + nz·pz + c` (pad included). All-zero columns with c = -1e6 = no quad.
 */
const edges = new THREE.Matrix4();
const edgesUniform = { value: edges };
const NO_EDGE = -UNBOUNDED;
const clearEdges = () => edges.set(0, 0, 0, 0, 0, 0, 0, 0, NO_EDGE, NO_EDGE, NO_EDGE, NO_EDGE, 0, 0, 0, 0);
clearEdges();
/** The scaled + padded footprint corners (x, z) — the debug ring draws them. */
const quad: Array<[number, number]> = [[0, 0], [0, 0], [0, 0], [0, 0]];

const ndc = [[-1, -1], [1, -1], [1, 1], [-1, 1], [0, 0]] as const;
const tmpNear = new THREE.Vector3();
const tmpFar = new THREE.Vector3();
const hits: Array<[number, number]> = ndc.map(() => [0, 0]);

/** Horizontal reach (m) of a corner hit: rays at / above the horizon and grazing ones just below it end this far out. */
const MAX_HIT_REACH = VIEW_FOCUS_MAX_RADIUS * 2;

/**
 * Where the ray through NDC (nx, ny) meets the plane y = groundY, its horizontal distance from the near point capped
 * at `MAX_HIT_REACH`. The cap is on the horizontal reach (not the ray length) so it is continuous across the horizon:
 * a ray just below it and one just above it both end `MAX_HIT_REACH` out. (Capping the ray length at 4× while rays
 * above the horizon got 2× put a grazing camera's far corners ~880 m out and the capped circle off the screen.)
 */
function groundHit(camera: THREE.Camera, nx: number, ny: number, groundY: number, out: [number, number]): boolean {
  tmpNear.set(nx, ny, -1).unproject(camera);
  tmpFar.set(nx, ny, 1).unproject(camera).sub(tmpNear).normalize();
  const dy = tmpFar.y;
  const horiz = Math.hypot(tmpFar.x, tmpFar.z);
  const full = dy < -1e-3 ? Math.max(0, (groundY - tmpNear.y) / dy) * horiz : Infinity;
  const reach = Math.min(full, MAX_HIT_REACH);
  const s = horiz > 1e-6 ? reach / horiz : 0;
  out[0] = tmpNear.x + tmpFar.x * s;
  out[1] = tmpNear.z + tmpFar.z * s;
  return full > MAX_HIT_REACH;
}

/** Fills `edges` / `quad` from the 4 ground corners (any winding), scaled by `margin` about (cx, cz) and padded. */
function setQuad(cx: number, cz: number): void {
  let area = 0;
  for (let i = 0; i < 4; i++) {
    const [ax, az] = hits[i]!, [bx, bz] = hits[(i + 1) % 4]!;
    area += ax * bz - bx * az;
  }
  const wind = area >= 0 ? 1 : -1; // CCW in (x, z) → the outward normal of edge a→b is (dz, -dx)
  const e = edges.elements;
  for (let i = 0; i < 4; i++) {
    const a = hits[i]!, b = hits[(i + 1) % 4]!;
    const ax = cx + (a[0] - cx) * margin, az = cz + (a[1] - cz) * margin;
    const bx = cx + (b[0] - cx) * margin, bz = cz + (b[1] - cz) * margin;
    let nx = (bz - az) * wind, nz = -(bx - ax) * wind;
    const len = Math.hypot(nx, nz);
    if (len < 1e-6) { e[i * 4] = 0; e[i * 4 + 1] = 0; e[i * 4 + 2] = NO_EDGE; e[i * 4 + 3] = 0; continue; }
    nx /= len; nz /= len;
    e[i * 4] = nx; e[i * 4 + 1] = nz; e[i * 4 + 2] = -(nx * ax + nz * az) - VIEW_FOCUS_EDGE_PAD; e[i * 4 + 3] = 0;
    quad[i]![0] = ax; quad[i]![1] = az;
  }
}

/** Signed distance (m) of (x, z) outside the focus quad (≤ 0 inside); -Infinity-like while there is no quad. */
export function viewFocusQuadDistance(x: number, z: number): number {
  const e = edges.elements;
  let d = NO_EDGE;
  for (let i = 0; i < 16; i += 4) d = Math.max(d, e[i]! * x + e[i + 1]! * z + e[i + 2]!);
  return d;
}

/** Recomputes the focus from `camera` (call once per frame, after the camera moved). */
export function updateViewFocus(camera: THREE.Camera, groundY = 0): Readonly<ViewFocus> {
  focus.enabled = enabled;
  if (enabled && frozen && focus.radius < UNBOUNDED) return focus; // debug freeze: keep the last circle
  if (!enabled) {
    focus.radius = focus.visibleRadius = UNBOUNDED;
    clearEdges();
  } else {
    camera.updateMatrixWorld();
    let capped = false; // a corner at / near the horizon: the footprint is unbounded, report the capped radius
    for (let i = 0; i < ndc.length; i++) capped = groundHit(camera, ndc[i]![0], ndc[i]![1], groundY, hits[i]!) || capped;
    let cx = 0, cz = 0;
    for (let i = 0; i < 4; i++) { cx += hits[i]![0]; cz += hits[i]![1]; }
    cx /= 4; cz /= 4;
    let r = capped ? VIEW_FOCUS_MAX_RADIUS : 0;
    for (const [x, z] of hits) r = Math.max(r, Math.hypot(x - cx, z - cz));
    focus.x = cx; focus.z = cz;
    focus.visibleRadius = Math.min(r, VIEW_FOCUS_MAX_RADIUS);
    focus.radius = Math.min(r * margin + VIEW_FOCUS_EDGE_PAD, VIEW_FOCUS_MAX_RADIUS);
    setQuad(cx, cz);
  }
  uniform.value.set(focus.x, focus.z, focus.radius, enabled ? 1 : 0);
  return focus;
}

export const getViewFocus = (): Readonly<ViewFocus> => focus;

/**
 * True when the circle (x, z, pad) touches the focus (its bounding circle and, conservatively near corners, its
 * quad). Always true while the focus is off.
 */
export function inViewFocus(x: number, z: number, pad = 0): boolean {
  if (!enabled) return true;
  const dx = x - focus.x, dz = z - focus.z, r = focus.radius + pad;
  return dx * dx + dz * dz <= r * r && viewFocusQuadDistance(x, z) <= pad;
}

/** The scaled + padded focus quad corners (x, z), valid while the focus is on (debug ring). */
export const getViewFocusQuad = (): ReadonlyArray<readonly [number, number]> => quad;

/** Shared `uViewFocus` uniform (vec4 x, z, radius, enabled). Assign this object by reference into a material. */
export const getViewFocusUniform = (): { value: THREE.Vector4 } => uniform;
/** Shared `uViewFocusEdges` uniform (mat4, see `edges`). Assign it next to `uViewFocus` in every material using the GLSL. */
export const getViewFocusEdgesUniform = (): { value: THREE.Matrix4 } => edgesUniform;

/** Assigns both focus uniforms (`uViewFocus`, `uViewFocusEdges`) into a shader's uniforms. */
export function bindViewFocusUniforms(uniforms: Record<string, unknown>): void {
  uniforms.uViewFocus = uniform;
  uniforms.uViewFocusEdges = edgesUniform;
}

/**
 * GLSL: `uViewFocus` + `uViewFocusEdges` + `viewFocusWeight(xz, fade)`, 1 inside the focus (circle ∩ quad) and fading
 * to 0 over `fade` metres outside (so an effect switches off smoothly off-screen instead of popping). A shadow-map
 * program defines `TA_FOCUS_SHADOW_PASS`: always 1 there (which casters draw is decided on the CPU, RN-51).
 */
export const VIEW_FOCUS_GLSL = /* glsl */ `
uniform vec4 uViewFocus;
uniform mat4 uViewFocusEdges;
float viewFocusWeight(vec2 p, float fade) {
#ifdef TA_FOCUS_SHADOW_PASS
  return 1.0; // shadow-map program: an off-screen caster's shadow can fall on screen, keep it moving with its tree
#endif
  if (uViewFocus.w < 0.5) return 1.0;
  vec4 ds = vec4(p, 1.0, 0.0) * uViewFocusEdges;
  float dq = max(max(ds.x, ds.y), max(ds.z, ds.w));
  float dc = length(p - uViewFocus.xy) - uViewFocus.z;
  return 1.0 - smoothstep(0.0, fade, max(dq, dc));
}
`;

export function setViewFocusEnabled(on: boolean): void { enabled = on; }
export const isViewFocusEnabled = (): boolean => enabled;

/** Sets the margin (visible footprint × margin = focus radius), clamped to `VIEW_FOCUS_MARGIN_RANGE`. */
export function setViewFocusMargin(m: number): number {
  const [lo, hi] = VIEW_FOCUS_MARGIN_RANGE;
  margin = Number.isFinite(m) ? Math.min(hi, Math.max(lo, m)) : VIEW_FOCUS_MARGIN;
  return margin;
}
export const getViewFocusMargin = (): number => margin;

/**
 * Debug (F8 → PERF → SHOW FOCUS RING = ON + FREEZE): stop moving the focus, so the camera can zoom out / pan away
 * and see where focus-limited effects (sway, water, shadows, lights) stop. The focus circle always encloses the
 * screen, so a following ring is (by design) mostly off-screen.
 */
export function setViewFocusFrozen(on: boolean): void { frozen = on; }
export const isViewFocusFrozen = (): boolean => frozen;
