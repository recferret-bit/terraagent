import { VIEW_FOCUS_MAX_RADIUS, type ViewFocus } from './viewFocus';

/**
 * Fits a directional light's square ortho shadow box to the visible ground (the view focus) instead of a fixed
 * `frustumSize` around the camera target: the box is centred on the visible footprint and its half-size follows the
 * visible radius (× `SHADOW_FIT_MARGIN`), clamped to [max(`SHADOW_FIT_MIN_HALF`, `frustumSize` / `SHADOW_FIT_MAX_SHRINK`),
 * user `frustumSize`]. A tighter box gives finer shadow texels (crisper edges, less acne) and lets Three's
 * shadow-camera culling drop casters that are off-screen. The caller scales the PCF blur radius by
 * `frustumSize / half`, so the world-space penumbra stays the same.
 *
 * The half-size is quantised to `SHADOW_FIT_STEPS` steps per doubling, so zooming changes the texel size only at a
 * few discrete sizes (no continuous shadow swimming); the light placement stays texel-snapped (`shadowConfig.ts`).
 * When the view is wider than the user's box the box slides back to the camera target (the old behaviour), so the
 * area around the target always keeps its shadows.
 */
export const SHADOW_FIT_MIN_HALF = 12;
export const SHADOW_FIT_MARGIN = 1.25;
/**
 * The box never shrinks below `frustumSize / SHADOW_FIT_MAX_SHRINK`: the blur radius is scaled by the shrink so the
 * penumbra keeps its world size, and the 9-tap soft kernel only smooths ~1 texel between taps, so beyond ~2.5x the
 * taps resolve into visible steps along the shadow edge.
 */
export const SHADOW_FIT_MAX_SHRINK = 2.5;
export const SHADOW_FIT_STEPS = 4;

export interface ShadowFit { x: number; z: number; half: number }

/** Rounds `need` up to the next of `SHADOW_FIT_STEPS` geometric steps per doubling above `min`, capped at `max`. */
export function quantizeShadowHalf(need: number, min: number, max: number): number {
  if (!(need < max)) return max;
  const octaves = Math.log2(Math.max(need, min) / min);
  const q = min * 2 ** (Math.ceil(octaves * SHADOW_FIT_STEPS - 1e-6) / SHADOW_FIT_STEPS);
  return Math.min(max, q);
}

/** Box centre (xz) and half-size for a shadow camera; `focus` null/disabled → the user box around `target`. */
export function fitShadowBox(
  focus: Readonly<ViewFocus> | null,
  targetX: number,
  targetZ: number,
  frustumSize: number,
  out: ShadowFit = { x: 0, z: 0, half: 0 },
): ShadowFit {
  const max = Math.max(SHADOW_FIT_MIN_HALF, frustumSize);
  if (!focus || !focus.enabled || !(focus.visibleRadius <= VIEW_FOCUS_MAX_RADIUS)) { // off / never updated
    out.x = targetX; out.z = targetZ; out.half = max;
    return out;
  }
  const need = focus.visibleRadius * SHADOW_FIT_MARGIN;
  out.half = quantizeShadowHalf(need, Math.max(SHADOW_FIT_MIN_HALF, max / SHADOW_FIT_MAX_SHRINK), max);
  const slide = Math.min(1, Math.max(0, (need - max) / (max * 0.5)));
  out.x = focus.x + (targetX - focus.x) * slide;
  out.z = focus.z + (targetZ - focus.z) * slide;
  return out;
}

/**
 * Night-ness (`1 - daylight`) over which the daytime-skipped secondary shadow fades back in at dawn/dusk
 * (F8 → PERF → DAYTIME SECONDARY SHADOW OFF). Below the start it is 0 and its shadow map is not rendered.
 */
export const DAY_SECONDARY_FADE: readonly [number, number] = [0.02, 0.5];

/**
 * Multiplier on the secondary ("moon") shadow intensity in shadow mode 0: 1 when not skipped, else a smoothstep
 * from 0 by day to 1 toward night. The caller stops refreshing the map while the result is 0 (no `castShadow`
 * toggle, so no shader recompiles; the patched shader skips the taps of a light whose shadow intensity is 0).
 */
export function daySecondaryShadowFade(night: number, skip: boolean): number {
  return skip ? smoothstepRange(night, DAY_SECONDARY_FADE) : 1;
}

/**
 * Night-ness over which the faint night sun shadow fades out at dusk (and back in at dawn) when skipped (F8 → PERF →
 * NIGHT SUN SHADOW OFF): ~18:00 (0.5) still full, gone ~1 h after sunset (≥ 0.95), so at night only the moon casts.
 */
export const NIGHT_SUN_FADE: readonly [number, number] = [0.6, 0.95];

/** Multiplier on the sun shadow intensity in shadow mode 0: 1 when not skipped, else 1 by day → 0 at night. */
export function nightSunShadowFade(night: number, skip: boolean): number {
  return skip ? 1 - smoothstepRange(night, NIGHT_SUN_FADE) : 1;
}

function smoothstepRange(x: number, [a, b]: readonly [number, number]): number {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}
