import { getEntitySpottingRadius, isEntityContributingVision, type CombatVisionBlob } from '@terra/sim';
import { hexDistance, hexIndex } from '@terra/sim/grid/hex';
import { forEachEntity } from '../store/replica/viewCodec';
import type { MapLayerDrawView } from './types';

export function isMapTileExplored(view: MapLayerDrawView, index: number): boolean {
  const explored = view.tiles?.explored;
  if (!explored) return true; // Preview maps without fog data.
  const colony = view.ownColonySlot ?? 0;
  return index >= 0 && colony >= 0 && colony < 8 && ((explored[index] ?? 0) & (1 << colony)) !== 0;
}

/** Prefer the authoritative spotting set. Earlier-wave/local previews use the same shared sight rules. */
export function createMapVisibility(view: Pick<MapLayerDrawView, 'tiles' | 'ownColonySlot' | 'radius' | 'clientView' | 'simData'>): (q: number, r: number) => boolean {
  const colony = view.ownColonySlot ?? 0;
  const index = hexIndex(view.radius);
  const vision = view.clientView?.blobs?.combatVision as CombatVisionBlob | undefined;
  const spotted = vision?.byColony?.[colony];
  if (spotted) {
    const live = new Set(spotted);
    return (q, r) => live.has(index.indexOf(q, r));
  }
  if (!view.tiles?.explored) return () => true; // Preview maps without fog data.
  const sources: Array<{ q: number; r: number; radius: number }> = [];
  if (view.clientView?.entities) {
    forEachEntity(view.clientView.entities, view.clientView.count, row => {
      if (row.owner !== colony || row.hp <= 0 || !isEntityContributingVision(row.state)) return;
      const radius = getEntitySpottingRadius(row.kind, view.simData);
      if (radius > 0) sources.push({ q: row.q, r: row.r, radius });
    });
  }
  return (q, r) => index.indexOf(q, r) >= 0 && sources.some(s => hexDistance(q, r, s.q, s.r) <= s.radius);
}

/** Darken explored terrain outside current sight while preserving its map memory. */
export function drawMapFog(ctx: CanvasRenderingContext2D, view: MapLayerDrawView): void {
  if (!view.tiles?.explored || !view.clientView) return;
  const live = createMapVisibility(view);
  const index = hexIndex(view.radius);
  ctx.save();
  ctx.fillStyle = '#0B0E13';
  for (let i = 0; i < Math.min(index.count, view.tiles.count); i++) {
    const q = index.q[i]!, r = index.r[i]!;
    if (live(q, r)) continue;
    ctx.globalAlpha = isMapTileExplored(view, i) ? 0.55 : 0.88;
    const point = view.axialToPixel(q, r);
    ctx.beginPath();
    for (let k = 0; k < 6; k++) {
      const angle = (Math.PI / 180) * (60 * k - 30);
      const x = point.x + view.tilePixelRadius * 1.04 * Math.cos(angle);
      const y = point.y + view.tilePixelRadius * 1.04 * Math.sin(angle);
      if (k === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
}
