import { HEX_DIRS } from '@terra/sim/grid/hex';
import { DEFAULT_COLONY_COLORS } from '@terra/contracts/tiles/codes';
import { MAP_LAYER_META, type MapLayerId } from '@terra/contracts';
import { resolveMapAdapterForView } from './atlasMapAdapter';
import { drawMapFog, isMapTileExplored } from './visibility';
import { drawEntityDots } from './entityDots';
import { drawResourcesLayer } from './resourceLayer';
import {
  createSectorsMapLayer,
  drawSectorsLayer,
  type SectorLayerDrawSummary,
} from './sectorLayer';
import { resolveTileColorFromTokens } from './tileColors';
import type { MapLayer, MapLayerDrawView } from './types';

function numberColorToHex(n: number): string {
  return `#${(n & 0xffffff).toString(16).padStart(6, '0')}`;
}

export function resolveColonyMapColor(
  owner: number,
  ownColonySlot = 0,
  colonyColors?: Record<number, number>,
): string {
  if (owner === ownColonySlot) return '#FF6B1A';
  const custom = colonyColors?.[owner];
  if (typeof custom === 'number') return numberColorToHex(custom);
  const idx =
    owner === 0 && ownColonySlot !== 0
      ? 1
      : Math.abs(owner) % DEFAULT_COLONY_COLORS.length;
  return numberColorToHex(DEFAULT_COLONY_COLORS[idx] ?? 0x38bdf8);
}

function drawHexPolygonPath(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  hexRadius: number,
): void {
  ctx.beginPath();
  for (let k = 0; k < 6; k++) {
    const angle = (Math.PI / 180) * (60 * k - 30);
    const vx = cx + hexRadius * Math.cos(angle);
    const vy = cy + hexRadius * Math.sin(angle);
    if (k === 0) ctx.moveTo(vx, vy);
    else ctx.lineTo(vx, vy);
  }
  ctx.closePath();
}

export function drawFlatMapBackground(
  ctx: CanvasRenderingContext2D,
  view: MapLayerDrawView,
): void {
  // Terrain off: no opaque square. The caller shows its own backdrop (flat translucent dialog over the blurred scene).
  void ctx;
  void view;
}

export function drawTerrainLayer(
  ctx: CanvasRenderingContext2D,
  view: MapLayerDrawView,
): void {
  if (view.rasterCanvas) {
    ctx.drawImage(
      view.rasterCanvas as CanvasImageSource,
      0,
      0,
      view.width,
      view.height,
    );
    return;
  }
  const tiles = view.tiles;
  if (!tiles) return;
  const adapter = resolveMapAdapterForView(view);
  const drawableTiles = adapter.getDrawableTiles(tiles.count);
  const r = view.tilePixelRadius * 1.08;
  for (let idx = 0; idx < drawableTiles.length; idx++) {
    const t = drawableTiles[idx]!;
    const { x, y } = view.axialToPixel(t.q, t.r);
    ctx.fillStyle = resolveTileColorFromTokens(tiles, t.bufferIndex, view.ownColonySlot ?? 0);
    drawHexPolygonPath(ctx, x, y, r);
    ctx.fill();
  }
}

export interface TerritoryDrawSummary {
  ownedTileCount: number;
  borderEdgeCount: number;
}

export function drawTerritoryLayer(
  ctx: CanvasRenderingContext2D,
  view: MapLayerDrawView,
): TerritoryDrawSummary {
  const tiles = view.tiles;
  if (!tiles) return { ownedTileCount: 0, borderEdgeCount: 0 };

  const adapter = resolveMapAdapterForView(view);
  const drawableTiles = adapter.getDrawableTiles(tiles.count);
  const r = view.tilePixelRadius * 1.05;
  const ownSlot = view.ownColonySlot ?? 0;

  let ownedTileCount = 0;
  let borderEdgeCount = 0;

  ctx.save();
  for (let idx = 0; idx < drawableTiles.length; idx++) {
    const t = drawableTiles[idx]!;
    const i = t.bufferIndex;
    const owner = tiles.owner[i] ?? -1;
    if (owner < 0) continue;
    if (!isMapTileExplored(view, i) && owner !== ownSlot) continue;

    ownedTileCount++;
    const q = t.q;
    const rv = t.r;
    const { x, y } = view.axialToPixel(q, rv);
    const color = resolveColonyMapColor(owner, ownSlot, view.colonyColors);

    ctx.globalAlpha = 0.28;
    ctx.fillStyle = color;
    drawHexPolygonPath(ctx, x, y, r);
    ctx.fill();

    ctx.globalAlpha = 0.95;
    ctx.strokeStyle = color;
    ctx.lineWidth = Math.max(1.5, view.tilePixelRadius * 0.22);
    for (let k = 0; k < HEX_DIRS.length; k++) {
      const [dq, dr] = HEX_DIRS[k]!;
      const nIdx = adapter.tileIndexOf(q + dq, rv + dr, tiles.count);
      const nOwner = nIdx >= 0 && nIdx < tiles.count ? (tiles.owner[nIdx] ?? -1) : -1;
      if (nOwner === owner) continue;
      borderEdgeCount++;
      const a0 = (Math.PI / 180) * (60 * k - 30);
      const a1 = (Math.PI / 180) * (60 * ((k + 1) % 6) - 30);
      ctx.beginPath();
      ctx.moveTo(x + r * Math.cos(a0), y + r * Math.sin(a0));
      ctx.lineTo(x + r * Math.cos(a1), y + r * Math.sin(a1));
      ctx.stroke();
    }
  }
  ctx.restore();

  return { ownedTileCount, borderEdgeCount };
}

export function drawUnitsLayer(
  ctx: CanvasRenderingContext2D,
  view: MapLayerDrawView,
): number {
  return drawEntityDots(ctx, view).length;
}

export function createBuiltinW04Layers(): Record<
  'terrain' | 'territory' | 'sectors' | 'units' | 'resources',
  MapLayer
> {
  return {
    territory: {
      ...MAP_LAYER_META.territory,
      draw: (ctx, view) => {
        drawTerritoryLayer(ctx, view);
      },
    },
    sectors: createSectorsMapLayer(),
    terrain: {
      ...MAP_LAYER_META.terrain,
      draw: (ctx, view) => {
        drawTerrainLayer(ctx, view);
      },
    },
    resources: {
      ...MAP_LAYER_META.resources,
      draw: (ctx, view) => {
        drawResourcesLayer(ctx, view);
      },
    },
    units: {
      ...MAP_LAYER_META.units,
      draw: (ctx, view) => {
        drawUnitsLayer(ctx, view);
      },
    },
  };
}

export interface CompositeMapRenderResult {
  readonly drewFlatBackground: boolean;
  readonly drawnLayers: MapLayerId[];
  readonly territory: TerritoryDrawSummary;
  readonly sectors?: SectorLayerDrawSummary;
  readonly unitDots: number;
}

export function renderCompositeMapLayers(
  ctx: CanvasRenderingContext2D,
  view: MapLayerDrawView,
  activeLayers: ReadonlySet<MapLayerId>,
  extraLayers: readonly MapLayer[] = [],
): CompositeMapRenderResult {
  const drewFlatBackground = !activeLayers.has('terrain');
  if (drewFlatBackground) {
    drawFlatMapBackground(ctx, view);
  }

  const drawnLayers: MapLayerId[] = [];
  let territory: TerritoryDrawSummary = { ownedTileCount: 0, borderEdgeCount: 0 };
  let sectors: SectorLayerDrawSummary | undefined;
  let unitDots = 0;

  if (activeLayers.has('terrain')) {
    drawTerrainLayer(ctx, view);
    drawnLayers.push('terrain');
  }
  if (activeLayers.has('territory')) {
    territory = drawTerritoryLayer(ctx, view);
    drawnLayers.push('territory');
  }
  if (activeLayers.has('resources')) {
    drawResourcesLayer(ctx, view);
    drawnLayers.push('resources');
  }
  drawMapFog(ctx, view);
  if (activeLayers.has('sectors')) {
    sectors = drawSectorsLayer(ctx, view);
    drawnLayers.push('sectors');
  }
  if (activeLayers.has('units')) {
    unitDots = drawUnitsLayer(ctx, view);
    drawnLayers.push('units');
  }

  for (const layer of extraLayers) {
    if (
      layer.id !== 'terrain' &&
      layer.id !== 'territory' &&
      layer.id !== 'sectors' &&
      layer.id !== 'units' &&
      layer.id !== 'resources' &&
      activeLayers.has(layer.id)
    ) {
      layer.draw(ctx, view);
      drawnLayers.push(layer.id);
    }
  }

  return {
    drewFlatBackground,
    drawnLayers,
    territory,
    ...(sectors ? { sectors } : {}),
    unitDots,
  };
}
