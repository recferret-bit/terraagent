import type * as THREE from 'three';
import { getWindParams, isWindOn } from '../../../core/windConfig';
import { getWaterParams } from '../waterConfig';
import { swellTroughDepth } from '../waveModel';
import { FAUNA_SINK_MARGIN, FAUNA_SINK_MAX } from './faunaPlacement';

/**
 * Fauna depth follows the waves: every fish and jelly swims `uFaunaSink` metres deeper than its placed depth, where
 * the sink is the deepest trough the current swell can reach (gusty peak wind × `waveHeight`, `waveScale`) plus a
 * margin. It eases toward its target so a slider move glides the fauna down instead of snapping. Placement budgets
 * `FAUNA_SINK_MAX` against the bed, so the deepest sink never touches it.
 *
 * Ease rate (1/s): ~63 % of the way in 1 / rate seconds.
 */
const SINK_EASE = 1.2;
const MAX_DT = 0.1;

/** Target sink (m) for the current WIND and WATER settings. */
export function targetFaunaSink(): number {
  const w = getWindParams();
  const p = getWaterParams();
  const gusty = isWindOn() ? w.strength * (1 + w.gust) : 0;
  return Math.min(FAUNA_SINK_MAX, swellTroughDepth(gusty, p.waveHeight, p.waveScale) * FAUNA_SINK_MARGIN);
}

/** A shared `uFaunaSink` IUniform plus the per-frame ease (call from a mesh's `onBeforeRender`; dt is measured). */
export function createFaunaSink(): { uniform: THREE.IUniform<number>; step(nowMs?: number): void } {
  const uniform: THREE.IUniform<number> = { value: targetFaunaSink() };
  let last = -1;
  return {
    uniform,
    step(nowMs = performance.now()) {
      const dt = last < 0 ? 0 : Math.min(MAX_DT, Math.max(0, (nowMs - last) / 1000));
      last = nowMs;
      const target = targetFaunaSink();
      uniform.value += (target - uniform.value) * (1 - Math.exp(-SINK_EASE * dt));
    },
  };
}
