import { isColonyTileExplored } from '@terra/sim';
import { axialToPlane, hexCount, hexIndex, planeToAxial } from '@terra/sim/grid/hex';
import { PREP_CODES, TERRAIN_CODES } from '@terra/contracts/tiles/codes';
import type { ClientTiles } from '../store/replica/viewCodec';
import type { AtlasMapAdapter } from './atlasMapAdapter';

export const DEFAULT_RASTER_SIZE = 256;

export type TileColorResolver = (
  tiles: ClientTiles,
  index: number,
  viewerColony?: number,
) => string;

/** Fallback tile colour resolver (replaced/extended by W04-04 token table). */
export const defaultTileColorResolver: TileColorResolver = (
  tiles,
  index,
  viewerColony = 0,
) => {
  if ((tiles.explored || tiles.exploredByColony) && !isColonyTileExplored(tiles, index, viewerColony)) {
    return '#3B4C6B';
  }
  const prep = tiles.prep[index] ?? PREP_CODES.wild;
  if (prep === PREP_CODES.living || prep === PREP_CODES.irrigated) return '#3DEB8A';
  if (prep === PREP_CODES.prepared) return '#F3E3A6';
  if (prep === PREP_CODES.ridge || prep === PREP_CODES.moat) return '#A583EE';
  const terrain = tiles.terrain[index] ?? TERRAIN_CODES.flat;
  switch (terrain) {
    case TERRAIN_CODES.shallow:
      return '#66D3F5';
    case TERRAIN_CODES.deep:
      return '#3A78E0';
    case TERRAIN_CODES.forest:
      return '#2FA35C';
    case TERRAIN_CODES.rock:
      return '#A99F94';
    case TERRAIN_CODES.slope:
      return '#D9A05B';
    case TERRAIN_CODES.hole:
      return '#9A5E3E';
    case TERRAIN_CODES.flat:
    default:
      return '#B4CC72';
  }
};

export function createNoop2dContext(
  canvas: HTMLCanvasElement,
): CanvasRenderingContext2D {
  const noop = () => {};
  const ctx = {
    canvas,
    fillStyle: '#000000',
    strokeStyle: '#000000',
    lineWidth: 1,
    globalAlpha: 1,
    font: '10px monospace',
    textAlign: 'left',
    textBaseline: 'alphabetic',
    beginPath: noop,
    closePath: noop,
    moveTo: noop,
    lineTo: noop,
    arc: noop,
    fill: noop,
    stroke: noop,
    fillRect: noop,
    strokeRect: noop,
    clearRect: noop,
    save: noop,
    restore: noop,
    translate: noop,
    scale: noop,
    rotate: noop,
    setTransform: noop,
    drawImage: noop,
    setLineDash: noop,
    fillText: noop,
  };
  return ctx as unknown as CanvasRenderingContext2D;
}

export function getSafe2dContext(
  canvas: HTMLCanvasElement,
): CanvasRenderingContext2D {
  const isJsdom =
    typeof navigator !== 'undefined' &&
    typeof navigator.userAgent === 'string' &&
    /jsdom/i.test(navigator.userAgent);
  if (!isJsdom) {
    try {
      const ctx = canvas.getContext('2d');
      if (ctx) return ctx;
    } catch {
      // Fallback to noop context
    }
  }
  return createNoop2dContext(canvas);
}

export function radiusFromTileCount(count: number): number {
  if (count <= 1) return 0;
  const r = Math.round((-3 + Math.sqrt(9 - 12 * (1 - count))) / 6);
  return Math.max(1, r);
}

export function mapScaleForRadius(size: number, radius: number): number {
  return (size * 0.45) / Math.max(1, radius + 0.5);
}

export function axialToCanvasPixel(
  q: number,
  r: number,
  size: number,
  radius: number,
): { x: number; y: number } {
  const [px, py] = axialToPlane(q, r);
  const scale = mapScaleForRadius(size, radius);
  return {
    x: size * 0.5 + px * scale,
    y: size * 0.5 + py * scale,
  };
}

export function canvasPixelToAxial(
  x: number,
  y: number,
  size: number,
  radius: number,
): { q: number; r: number } {
  const scale = mapScaleForRadius(size, radius);
  const px = (x - size * 0.5) / scale;
  const py = (y - size * 0.5) / scale;
  const [q, r] = planeToAxial(px, py);
  return { q, r };
}

function drawPointyHex(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  hexRadius: number,
  fill: string,
): void {
  ctx.fillStyle = fill;
  ctx.beginPath();
  for (let k = 0; k < 6; k++) {
    const angle = (Math.PI / 180) * (60 * k - 30);
    const vx = cx + hexRadius * Math.cos(angle);
    const vy = cy + hexRadius * Math.sin(angle);
    if (k === 0) ctx.moveTo(vx, vy);
    else ctx.lineTo(vx, vy);
  }
  ctx.closePath();
  ctx.fill();
}

export interface PlanetRasterEntry {
  readonly planetKey: string;
  readonly planetId: string;
  readonly radius: number;
  readonly count: number;
  readonly size: number;
  readonly atlasHash: string | null;
  readonly atlasVersion: number | null;
  readonly viewerColony: number;
  readonly flagKey: string | null;
  readonly canvas: HTMLCanvasElement;
  readonly ctx: CanvasRenderingContext2D;
  readonly terrain: Uint8Array;
  readonly prep: Uint8Array;
  readonly owner: Int16Array;
  readonly explored: Uint8Array;
  readonly exploredByColony: Record<number, Uint8Array>;
  readonly deposit: Uint8Array;
  initialized: boolean;
}

export interface PlanetRasterCacheKeyOptions {
  readonly planetId?: string;
  readonly radius: number;
  readonly count?: number;
  readonly atlasHash?: string | null;
  readonly atlasVersion?: number | null;
  readonly viewerColony?: number | null;
  readonly flagKey?: string | null;
}

export interface PlanetRasterUpdateOptions {
  readonly planetId?: string;
  readonly radius?: number;
  readonly changedIndices?: readonly number[];
  readonly atlasHash?: string | null;
  readonly atlasVersion?: number | null;
  readonly viewerColony?: number | null;
  readonly flagKey?: string | null;
  readonly adapter?: AtlasMapAdapter | null;
}

export function buildRasterCacheKey(opts: PlanetRasterCacheKeyOptions): string {
  const pid = opts.planetId || 'default';
  let key = `${pid}:${opts.radius}`;
  if (opts.atlasHash) key += `:atlas=${opts.atlasHash}`;
  if (typeof opts.atlasVersion === 'number') key += `:v=${opts.atlasVersion}`;
  if (typeof opts.viewerColony === 'number') key += `:col=${opts.viewerColony}`;
  if (opts.flagKey) key += `:flags=${opts.flagKey}`;
  return key;
}

export class PlanetRasterCache {
  private readonly entries = new Map<string, PlanetRasterEntry>();
  private colorResolver: TileColorResolver;
  private readonly size: number;
  dirtyTiles = 0;
  totalRepaints = 0;
  lastPlanetKey: string | null = null;
  lastRadius = 0;
  lastAtlasHash: string | null = null;
  lastViewerColony = 0;

  constructor(
    colorResolver: TileColorResolver = defaultTileColorResolver,
    size: number = DEFAULT_RASTER_SIZE,
  ) {
    this.colorResolver = colorResolver;
    this.size = size;
  }

  setColorResolver(resolver: TileColorResolver): void {
    this.colorResolver = resolver;
    for (const entry of this.entries.values()) {
      entry.initialized = false;
    }
  }

  getEntry(
    planetId: string,
    radius: number,
    meta: Omit<PlanetRasterCacheKeyOptions, 'planetId' | 'radius'> = {},
  ): PlanetRasterEntry {
    const key = buildRasterCacheKey({ planetId, radius, ...meta });
    const existing = this.entries.get(key);
    if (existing && (!meta.count || existing.count === meta.count)) {
      return existing;
    }

    const count = meta.count ?? hexCount(radius);
    const canvas = document.createElement('canvas');
    canvas.width = this.size;
    canvas.height = this.size;
    const ctx = getSafe2dContext(canvas);

    const entry: PlanetRasterEntry = {
      planetKey: key,
      planetId: planetId || 'default',
      radius,
      count,
      size: this.size,
      atlasHash: meta.atlasHash ?? null,
      atlasVersion: meta.atlasVersion ?? null,
      viewerColony: meta.viewerColony ?? 0,
      flagKey: meta.flagKey ?? null,
      canvas,
      ctx,
      terrain: new Uint8Array(count),
      prep: new Uint8Array(count),
      owner: new Int16Array(count),
      explored: new Uint8Array(count),
      exploredByColony: {},
      deposit: new Uint8Array(count),
      initialized: false,
    };
    entry.explored.fill(1);
    this.entries.set(key, entry);
    return entry;
  }

  invalidatePlanet(planetId: string): number {
    let removed = 0;
    for (const [k, entry] of this.entries.entries()) {
      if (entry.planetId === planetId || k.startsWith(`${planetId}:`)) {
        this.entries.delete(k);
        removed++;
      }
    }
    return removed;
  }

  update(
    tiles: ClientTiles,
    opts: PlanetRasterUpdateOptions = {},
  ): { entry: PlanetRasterEntry; repainted: number } {
    const adapter = opts.adapter && opts.adapter.isAtlas ? opts.adapter : null;
    const radius = adapter
      ? adapter.projectionRadius
      : (opts.radius ?? radiusFromTileCount(tiles.count));
    const planetId = opts.planetId ?? adapter?.planetId ?? 'default';
    const atlasHash = opts.atlasHash ?? adapter?.atlasHash ?? null;
    const atlasVersion = opts.atlasVersion ?? adapter?.atlasVersion ?? null;
    const viewerColony = opts.viewerColony ?? undefined;
    const count = adapter ? tiles.count : hexCount(radius);

    const entry = this.getEntry(planetId, radius, {
      count,
      atlasHash,
      atlasVersion,
      viewerColony,
      flagKey: opts.flagKey,
    });
    this.lastPlanetKey = entry.planetKey;
    this.lastRadius = radius;
    this.lastAtlasHash = atlasHash;
    this.lastViewerColony = viewerColony ?? 0;

    const scale = mapScaleForRadius(entry.size, radius);
    const hexRadius = Math.max(1.25, (scale / Math.sqrt(3)) * 1.08);
    const activeViewer = viewerColony ?? 0;

    if (!entry.initialized) {
      entry.ctx.clearRect(0, 0, entry.size, entry.size);
      if (adapter) {
        const drawable = adapter.getDrawableTiles(tiles.count);
        for (let idx = 0; idx < drawable.length; idx++) {
          const t = drawable[idx]!;
          this.syncAndPaintTile(entry, t.q, t.r, t.bufferIndex, tiles, hexRadius, activeViewer);
        }
        entry.initialized = true;
        this.dirtyTiles = drawable.length;
      } else {
        const hx = hexIndex(radius);
        for (let i = 0; i < entry.count && i < tiles.count; i++) {
          this.syncAndPaintTile(entry, hx.q[i]!, hx.r[i]!, i, tiles, hexRadius, activeViewer);
        }
        entry.initialized = true;
        this.dirtyTiles = Math.min(entry.count, tiles.count);
      }
      this.totalRepaints += this.dirtyTiles;
      return { entry, repainted: this.dirtyTiles };
    }

    const dirty = this.collectDirtyIndices(entry, tiles, opts.changedIndices);
    let repainted = 0;
    if (dirty.length > 0) {
      if (adapter) {
        for (const i of dirty) {
          const coord = adapter.tileForBufferIndex(i, tiles.count);
          if (!coord) continue;
          this.syncAndPaintTile(entry, coord.q, coord.r, i, tiles, hexRadius, activeViewer);
          repainted++;
        }
      } else {
        const hx = hexIndex(radius);
        for (const i of dirty) {
          this.syncAndPaintTile(entry, hx.q[i]!, hx.r[i]!, i, tiles, hexRadius, activeViewer);
          repainted++;
        }
      }
      this.dirtyTiles = repainted;
      this.totalRepaints += repainted;
    }
    return { entry, repainted };
  }

  private collectDirtyIndices(
    entry: PlanetRasterEntry,
    tiles: ClientTiles,
    changedIndices?: readonly number[],
  ): number[] {
    const dirty: number[] = [];
    const limit = Math.min(entry.count, tiles.count);
    if (changedIndices && changedIndices.length > 0) {
      for (const i of changedIndices) {
        if (i >= 0 && i < limit && this.isTileDirty(entry, tiles, i)) {
          dirty.push(i);
        }
      }
      return dirty;
    }
    for (let i = 0; i < limit; i++) {
      if (this.isTileDirty(entry, tiles, i)) {
        dirty.push(i);
      }
    }
    return dirty;
  }

  private isColonyExploredDirty(
    entry: PlanetRasterEntry,
    tiles: ClientTiles,
    i: number,
  ): boolean {
    const byteIdx = i >> 3;
    const bitMask = 1 << (i & 7);
    const incoming = tiles.exploredByColony;
    if (incoming) {
      for (const [k, bitset] of Object.entries(incoming)) {
        const col = Number(k);
        const curBit = (bitset[byteIdx] ?? 0) & bitMask;
        const prevBit = (entry.exploredByColony[col]?.[byteIdx] ?? 0) & bitMask;
        if (curBit !== prevBit) return true;
      }
    }
    for (const [k, prevBitset] of Object.entries(entry.exploredByColony)) {
      const col = Number(k);
      if (incoming && incoming[col]) continue;
      if (((prevBitset[byteIdx] ?? 0) & bitMask) !== 0) return true;
    }
    return false;
  }

  private syncColonyExploredTile(
    entry: PlanetRasterEntry,
    tiles: ClientTiles,
    i: number,
  ): void {
    const byteIdx = i >> 3;
    const bitMask = 1 << (i & 7);
    const byteLen = Math.ceil(entry.count / 8);
    const incoming = tiles.exploredByColony;
    if (incoming) {
      for (const [k, bitset] of Object.entries(incoming)) {
        const col = Number(k);
        const dst = entry.exploredByColony[col] ?? (entry.exploredByColony[col] = new Uint8Array(byteLen));
        if (((bitset[byteIdx] ?? 0) & bitMask) !== 0) {
          dst[byteIdx] |= bitMask;
        } else {
          dst[byteIdx] &= ~bitMask;
        }
      }
    }
    for (const [k, dst] of Object.entries(entry.exploredByColony)) {
      const col = Number(k);
      if (incoming && incoming[col]) continue;
      dst[byteIdx] &= ~bitMask;
    }
  }

  private isTileDirty(
    entry: PlanetRasterEntry,
    tiles: ClientTiles,
    i: number,
  ): boolean {
    const exp = tiles.explored ? tiles.explored[i]! : 1;
    const dep = tiles.deposit ? tiles.deposit[i]! : 0;
    return (
      entry.terrain[i] !== tiles.terrain[i] ||
      entry.prep[i] !== tiles.prep[i] ||
      entry.owner[i] !== tiles.owner[i] ||
      entry.explored[i] !== exp ||
      entry.deposit[i] !== dep ||
      this.isColonyExploredDirty(entry, tiles, i)
    );
  }

  private syncAndPaintTile(
    entry: PlanetRasterEntry,
    q: number,
    r: number,
    i: number,
    tiles: ClientTiles,
    hexRadius: number,
    viewerColony = 0,
  ): void {
    entry.terrain[i] = tiles.terrain[i]!;
    entry.prep[i] = tiles.prep[i]!;
    entry.owner[i] = tiles.owner[i]!;
    entry.explored[i] = tiles.explored ? tiles.explored[i]! : 1;
    entry.deposit[i] = tiles.deposit ? tiles.deposit[i]! : 0;
    this.syncColonyExploredTile(entry, tiles, i);
    const { x, y } = axialToCanvasPixel(q, r, entry.size, entry.radius);
    const fill = this.colorResolver(tiles, i, viewerColony);
    drawPointyHex(entry.ctx, x, y, hexRadius, fill);
  }

  clear(): void {
    this.entries.clear();
    this.dirtyTiles = 0;
    this.totalRepaints = 0;
    this.lastPlanetKey = null;
    this.lastRadius = 0;
    this.lastAtlasHash = null;
    this.lastViewerColony = 0;
  }
}
