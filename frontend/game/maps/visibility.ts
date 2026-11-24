import { getEntitySpottingRadius, isAnyColonyTileExplored, isColonyTileExplored, isEntityContributingVision, type CombatVisionBlob } from '@terra/sim';
import { hexDistance } from '@terra/sim/grid/hex';
import { forEachEntity } from '../store/replica/viewCodec';
import { resolveMapAdapterForView } from './atlasMapAdapter';
import type { MapLayerDrawView } from './types';

export function isMapTileExplored(view: MapLayerDrawView, index: number): boolean {
  const tiles = view.tiles;
  if (!tiles || (!tiles.explored && !tiles.exploredByColony)) return true; // Preview maps without fog data.
  if (view.spectatorAllVision) return isAnyColonyTileExplored(tiles, index);
  const colony = view.ownColonySlot ?? 0;
  return isColonyTileExplored(tiles, index, colony);
}

/** Prefer the authoritative spotting set. Earlier-wave/local previews use the same shared sight rules. */
export function createMapVisibility(
  view: Pick<
    MapLayerDrawView,
    'tiles' | 'ownColonySlot' | 'spectatorAllVision' | 'radius' | 'clientView' | 'simData' | 'atlasAdapter' | 'atlasManifest'
  >,
): (q: number, r: number) => boolean {
  const colony = view.ownColonySlot ?? 0;
  const allColonies = Boolean(view.spectatorAllVision);
  const adapter = resolveMapAdapterForView(view);
  const bufferCount = view.tiles?.count;
  const vision = view.clientView?.blobs?.combatVision as CombatVisionBlob | undefined;
  if (allColonies && vision?.byColony) {
    const live = new Set<number>();
    for (const list of Object.values(vision.byColony)) {
      if (Array.isArray(list)) for (const t of list) live.add(t);
    }
    return (q, r) => live.has(adapter.tileIndexOf(q, r, bufferCount));
  }
  const spotted = vision?.byColony?.[colony];
  if (spotted) {
    const live = new Set(spotted);
    return (q, r) => live.has(adapter.tileIndexOf(q, r, bufferCount));
  }
  if (!view.tiles?.explored && !view.tiles?.exploredByColony) return () => true; // Preview maps without fog data.
  const sources: Array<{ q: number; r: number; radius: number }> = [];
  if (view.clientView?.entities) {
    forEachEntity(view.clientView.entities, view.clientView.count, row => {
      if ((allColonies ? row.owner < 0 : row.owner !== colony) || row.hp <= 0 || !isEntityContributingVision(row.state, row.kind)) return;
      const radius = getEntitySpottingRadius(row.kind, view.simData);
      if (radius > 0) sources.push({ q: row.q, r: row.r, radius });
    });
  }
  return (q, r) => adapter.tileIndexOf(q, r, bufferCount) >= 0 && sources.some(s => hexDistance(q, r, s.q, s.r) <= s.radius);
}

interface FogCacheEntry {
  key: string;
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
}

const fogCacheByCtx = new WeakMap<CanvasRenderingContext2D, FogCacheEntry>();

function hashByteArray(h: number, arr: ArrayLike<number> | undefined): number {
  if (!arr) return h;
  h = Math.imul(h ^ arr.length, 2654435761) | 0;
  for (let i = 0; i < arr.length; i++) {
    const v = arr[i]!;
    if (v !== 0) h = (Math.imul(h ^ (i + 1), 16777619) ^ v) | 0;
  }
  return h;
}

function hashExploredTiles(view: MapLayerDrawView): number {
  const tiles = view.tiles;
  if (!tiles) return 0;
  if (view.spectatorAllVision) {
    let h = 17;
    if (tiles.exploredByColony) {
      for (const key of Object.keys(tiles.exploredByColony)) {
        h = hashByteArray(h, tiles.exploredByColony[Number(key)]);
      }
    }
    return hashByteArray(h, tiles.explored);
  }
  const colony = view.ownColonySlot ?? 0;
  const arr = tiles.exploredByColony?.[colony] ?? tiles.explored;
  return arr ? hashByteArray(0, arr) : 0;
}

function buildFogCacheKey(ctx: CanvasRenderingContext2D, view: MapLayerDrawView, w: number, h: number): string {
  const colony = view.ownColonySlot ?? 0;
  const origin = view.axialToPixel(0, 0);
  const t = typeof ctx.getTransform === 'function' ? ctx.getTransform() : null;
  const tx = t ? `${t.a.toFixed(3)},${t.d.toFixed(3)},${t.e.toFixed(2)},${t.f.toFixed(2)}` : '1,1,0,0';
  const vision = view.clientView?.blobs?.combatVision as CombatVisionBlob | undefined;
  const allColonies = Boolean(view.spectatorAllVision);
  let visionSig = '';
  if (allColonies && vision?.byColony) {
    let sh = 0;
    for (const list of Object.values(vision.byColony)) {
      if (!Array.isArray(list)) continue;
      sh = (Math.imul(sh, 31) + list.length) | 0;
      for (let i = 0; i < list.length; i++) sh = (Math.imul(sh, 31) + list[i]!) | 0;
    }
    visionSig = `all:${sh}`;
  } else {
    const spotted = vision?.byColony?.[colony];
    if (spotted) {
      let sh = spotted.length;
      for (let i = 0; i < spotted.length; i++) sh = (Math.imul(sh, 31) + spotted[i]!) | 0;
      visionSig = `s:${spotted.length}:${sh}`;
    } else if (view.clientView?.entities) {
      let eh = 0;
      forEachEntity(view.clientView.entities, view.clientView.count, row => {
        if ((allColonies ? row.owner < 0 : row.owner !== colony) || row.hp <= 0 || !isEntityContributingVision(row.state, row.kind)) return;
        eh = (Math.imul(eh ^ row.q, 31) ^ row.r) | 0;
      });
      visionSig = `e:${eh}`;
    }
  }
  return `${w}x${h}|${tx}|${view.radius}|${colony}|${view.spectatorAllVision ? 1 : 0}|${view.tilePixelRadius.toFixed(2)}|${origin.x.toFixed(2)},${origin.y.toFixed(2)}|${hashExploredTiles(view)}|${visionSig}`;
}

function paintMapFogHexes(ctx: CanvasRenderingContext2D, view: MapLayerDrawView): void {
  if (!view.tiles) return;
  const live = createMapVisibility(view);
  const adapter = resolveMapAdapterForView(view);
  const drawableTiles = adapter.getDrawableTiles(view.tiles.count);
  ctx.save();
  ctx.fillStyle = '#0B0E13';
  for (let idx = 0; idx < drawableTiles.length; idx++) {
    const t = drawableTiles[idx]!;
    const q = t.q;
    const r = t.r;
    if (live(q, r)) continue;
    ctx.globalAlpha = isMapTileExplored(view, t.bufferIndex) ? 0.55 : 0.88;
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

/** Darken explored terrain outside current sight while preserving its map memory. */
export function drawMapFog(ctx: CanvasRenderingContext2D, view: MapLayerDrawView): void {
  if ((!view.tiles?.explored && !view.tiles?.exploredByColony) || !view.clientView) return;
  const targetCanvas = (ctx as { canvas?: HTMLCanvasElement | null }).canvas;
  if (typeof document === 'undefined' || !targetCanvas || typeof ctx.drawImage !== 'function') {
    paintMapFogHexes(ctx, view);
    return;
  }
  const w = targetCanvas.width;
  const h = targetCanvas.height;
  if (!(w > 0 && h > 0)) {
    paintMapFogHexes(ctx, view);
    return;
  }
  let entry = fogCacheByCtx.get(ctx);
  if (!entry) {
    const offscreen = document.createElement('canvas');
    const offCtx = offscreen.getContext('2d');
    if (!offCtx) {
      paintMapFogHexes(ctx, view);
      return;
    }
    entry = { key: '', canvas: offscreen, ctx: offCtx };
    fogCacheByCtx.set(ctx, entry);
  }
  const key = buildFogCacheKey(ctx, view, w, h);
  if (entry.key !== key || entry.canvas.width !== w || entry.canvas.height !== h) {
    entry.canvas.width = w;
    entry.canvas.height = h;
    entry.ctx.setTransform(1, 0, 0, 1, 0, 0);
    entry.ctx.clearRect(0, 0, w, h);
    if (typeof ctx.getTransform === 'function' && typeof entry.ctx.setTransform === 'function') {
      entry.ctx.setTransform(ctx.getTransform());
    }
    paintMapFogHexes(entry.ctx, view);
    entry.key = key;
  }
  ctx.save();
  if (typeof ctx.setTransform === 'function') ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.drawImage(entry.canvas, 0, 0);
  ctx.restore();
}
