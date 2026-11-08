import { axialToPlane, hexCount, hexIndex, planeToAxial } from '@terra/sim/grid/hex';
import { PREP_CODES, TERRAIN_CODES } from '@terra/contracts/tiles/codes';
import type { ClientTiles } from '../store/replica/viewCodec';

export const DEFAULT_RASTER_SIZE = 256;

export type TileColorResolver = (tiles: ClientTiles, index: number) => string;

/** Fallback tile colour resolver (replaced/extended by W04-04 token table). */
export const defaultTileColorResolver: TileColorResolver = (tiles, index) => {
  if (tiles.explored && tiles.explored[index] === 0) {
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
  readonly radius: number;
  readonly count: number;
  readonly size: number;
  readonly canvas: HTMLCanvasElement;
  readonly ctx: CanvasRenderingContext2D;
  readonly terrain: Uint8Array;
  readonly prep: Uint8Array;
  readonly owner: Int16Array;
  readonly explored: Uint8Array;
  readonly deposit: Uint8Array;
  initialized: boolean;
}

export class PlanetRasterCache {
  private readonly entries = new Map<string, PlanetRasterEntry>();
  private colorResolver: TileColorResolver;
  private readonly size: number;
  dirtyTiles = 0;
  totalRepaints = 0;
  lastPlanetKey: string | null = null;
  lastRadius = 0;

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

  getEntry(planetId: string, radius: number): PlanetRasterEntry {
    const key = `${planetId || 'default'}:${radius}`;
    const existing = this.entries.get(key);
    if (existing) return existing;

    const count = hexCount(radius);
    const canvas = document.createElement('canvas');
    canvas.width = this.size;
    canvas.height = this.size;
    const ctx = getSafe2dContext(canvas);

    const entry: PlanetRasterEntry = {
      planetKey: key,
      radius,
      count,
      size: this.size,
      canvas,
      ctx,
      terrain: new Uint8Array(count),
      prep: new Uint8Array(count),
      owner: new Int16Array(count),
      explored: new Uint8Array(count),
      deposit: new Uint8Array(count),
      initialized: false,
    };
    entry.explored.fill(1);
    this.entries.set(key, entry);
    return entry;
  }

  update(
    tiles: ClientTiles,
    opts: {
      planetId?: string;
      radius?: number;
      changedIndices?: readonly number[];
    } = {},
  ): { entry: PlanetRasterEntry; repainted: number } {
    const radius = opts.radius ?? radiusFromTileCount(tiles.count);
    const planetId = opts.planetId ?? 'default';
    const entry = this.getEntry(planetId, radius);
    this.lastPlanetKey = entry.planetKey;
    this.lastRadius = radius;

    const hx = hexIndex(radius);
    const scale = mapScaleForRadius(entry.size, radius);
    const hexRadius = Math.max(1.25, (scale / Math.sqrt(3)) * 1.08);

    if (!entry.initialized) {
      entry.ctx.clearRect(0, 0, entry.size, entry.size);
      for (let i = 0; i < entry.count && i < tiles.count; i++) {
        this.syncAndPaintTile(entry, hx.q[i]!, hx.r[i]!, i, tiles, hexRadius);
      }
      entry.initialized = true;
      this.dirtyTiles = Math.min(entry.count, tiles.count);
      this.totalRepaints += this.dirtyTiles;
      return { entry, repainted: this.dirtyTiles };
    }

    const dirty = this.collectDirtyIndices(entry, tiles, opts.changedIndices);
    if (dirty.length > 0) {
      for (const i of dirty) {
        this.syncAndPaintTile(entry, hx.q[i]!, hx.r[i]!, i, tiles, hexRadius);
      }
      this.dirtyTiles = dirty.length;
      this.totalRepaints += dirty.length;
    }
    return { entry, repainted: dirty.length };
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
      entry.deposit[i] !== dep
    );
  }

  private syncAndPaintTile(
    entry: PlanetRasterEntry,
    q: number,
    r: number,
    i: number,
    tiles: ClientTiles,
    hexRadius: number,
  ): void {
    entry.terrain[i] = tiles.terrain[i]!;
    entry.prep[i] = tiles.prep[i]!;
    entry.owner[i] = tiles.owner[i]!;
    entry.explored[i] = tiles.explored ? tiles.explored[i]! : 1;
    entry.deposit[i] = tiles.deposit ? tiles.deposit[i]! : 0;
    const { x, y } = axialToCanvasPixel(q, r, entry.size, entry.radius);
    const fill = this.colorResolver(tiles, i);
    drawPointyHex(entry.ctx, x, y, hexRadius, fill);
  }

  clear(): void {
    this.entries.clear();
    this.dirtyTiles = 0;
    this.totalRepaints = 0;
    this.lastPlanetKey = null;
    this.lastRadius = 0;
  }
}
