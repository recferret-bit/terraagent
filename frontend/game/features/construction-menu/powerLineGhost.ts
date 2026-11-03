import type { FlagSet } from '@terra/contracts';
import { hexDistance } from '@terra/sim';
import type { GameView } from '../../core/registry/types';
import type { GhostContext } from './ghostContext';
import type { EvaluatePlacementGhostOptions, PlacementGhostState, PlacementGhostTile } from './PlacementGhost';

export const POWER_LINE_MAX_SPAN = 6;
export const PYLON_METALS_COST = 15;
export const PYLON_MINERALS_COST = 5;

/** Axial hex line from `(q0, r0)` to `(q1, r1)` inclusive (`hexDistance + 1` tiles). */
export function hexLine(q0: number, r0: number, q1: number, r1: number): Array<{ q: number; r: number }> {
  const dist = hexDistance(q0, r0, q1, r1);
  if (dist <= 0) return [{ q: q0, r: r0 }];
  const out: Array<{ q: number; r: number }> = [];
  for (let i = 0; i <= dist; i++) {
    const t = i / dist;
    const x = q0 + (q1 - q0) * t + 1e-6;
    const z = r0 + (r1 - r0) * t + 2e-6;
    const y = -x - z;
    let rx = Math.round(x);
    const ry = Math.round(y);
    let rz = Math.round(z);
    const dx = Math.abs(rx - x);
    const dy = Math.abs(ry - y);
    const dz = Math.abs(rz - z);
    if (dx > dy && dx > dz) rx = -ry - rz;
    else if (dz >= dy) rz = -rx - ry;
    out.push({ q: rx, r: rz });
  }
  return out;
}

/**
 * Computes auto-spaced Pylon T1 sites along the hex line from `from` to `to` with maximum span `maxSpan` (default `6`).
 * For a drag of distance `D > 0`, places `ceil(D / maxSpan)` pylons spaced evenly at step indices `round(i * D / count)`
 * (`i = 1..count`), so e.g. dragging across 15 tiles previews 3 pylons at distances 5, 10, 15.
 */
export function planPowerLinePylonSites(
  from: { q: number; r: number },
  to: { q: number; r: number },
  maxSpan = POWER_LINE_MAX_SPAN,
): Array<{ q: number; r: number }> {
  const line = hexLine(from.q, from.r, to.q, to.r);
  const totalDist = line.length - 1;
  if (totalDist <= 0) return [{ q: from.q, r: from.r }];
  const span = Math.max(1, maxSpan);
  const count = Math.ceil(totalDist / span);
  const sites: Array<{ q: number; r: number }> = [];
  for (let i = 1; i <= count; i++) {
    const idx = Math.min(totalDist, Math.round((i * totalDist) / count));
    const pt = line[idx];
    if (!sites.some((s) => s.q === pt.q && s.r === pt.r)) {
      sites.push({ q: pt.q, r: pt.r });
    }
  }
  return sites;
}

export function evaluatePowerLineGhost(
  opts: {
    from: { q: number; r: number };
    to: { q: number; r: number };
    flags: ReadonlySet<string> | FlagSet;
    view?: GameView;
    colonyId?: number;
  },
  ctx: GhostContext,
  evaluateSingle: (opts: EvaluatePlacementGhostOptions, ctx: GhostContext) => PlacementGhostState,
  formatPrepBillText: (bill: Record<string, number>) => string,
): PlacementGhostState {
  const pylonSites = planPowerLinePylonSites(opts.from, opts.to, POWER_LINE_MAX_SPAN);
  const tiles: PlacementGhostTile[] = [];
  const prepBill: Record<string, number> = {};
  let valid = pylonSites.length > 0;
  let reason = 'valid site';

  for (const site of pylonSites) {
    const st = evaluateSingle(
      {
        building: 'pylon',
        q: site.q,
        r: site.r,
        rotation: 0,
        flags: opts.flags,
        view: opts.view,
        colonyId: opts.colonyId,
      },
      ctx,
    );
    for (const t of st.tiles) tiles.push(t);
    for (const [op, cnt] of Object.entries(st.prepBill)) {
      prepBill[op] = (prepBill[op] ?? 0) + cnt;
    }
    if (!st.valid && valid) {
      valid = false;
      reason = st.reason;
    }
  }

  const count = pylonSites.length;
  const totalCost: Record<string, number> = {
    'metals.t1': PYLON_METALS_COST * count,
    'minerals.t1': PYLON_MINERALS_COST * count,
  };
  const costText = `Cost: ${totalCost['metals.t1']} Metals, ${totalCost['minerals.t1']} Minerals (${count}× Pylon)`;
  const basePrepText = formatPrepBillText(prepBill);

  return {
    building: 'powerLine',
    label: 'Power Line',
    q: opts.to.q,
    r: opts.to.r,
    rotation: 0,
    footprintW: 1,
    footprintD: count,
    footprintText: `${count}× Pylon (≤6 span)`,
    tiles,
    prepBill,
    prepBillText: `${basePrepText} · ${costText}`,
    valid,
    statusColor: valid ? 'green' : 'red',
    reason,
    depositCovered: false,
    depositTileIndices: [],
    pylonSites,
    totalCost,
    costText,
  };
}
