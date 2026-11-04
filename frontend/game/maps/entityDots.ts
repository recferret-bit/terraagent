import { DEFAULT_COLONY_COLORS } from '@terra/contracts/tiles/codes';
import { ENTITY_KIND, presenceRoleOf, type ViewEntity } from '@terra/sim';
import { hexIndex, hexRound } from '@terra/sim/grid/hex';
import { is2x2BuildingKind, isConstructibleBuilding } from '../app/online/entityKinds';
import { E, ENTITY_FIELDS, entityCount, readEntity, type EntityRow } from '../store/replica/viewCodec';
import { radiusFromTileCount } from './rasterCache';
import type { MapLayer, MapLayerDrawView } from './types';

/** Most markers drawn per map; units are kept first, buildings fill what is left. */
export const MAX_ENTITY_DOTS = 1500;

export const DEFAULT_DOT_RADIUS_PX = 2.5;
export const DEFAULT_OWN_DOT_COLOR = '#FF6B1A';
export const DEFAULT_FAUNA_DOT_COLOR = '#F04848';
export const DEFAULT_GUILD_DOT_COLOR = '#52B4FF';
export const DEFAULT_NEUTRAL_DOT_COLOR = '#8A93A6';

/** Square side (px) of a building marker by footprint: Command Hub 3x3, economy 2x2, pylon / pod 1x1. */
export const BUILDING_SQUARE_PX = { hub: 5, large: 4, small: 3 } as const;

/**
 * Owner codes the map understands besides colony indices. The sim only defines `-1` (unowned, `ecs/columns.ts`);
 * `-2` (fauna) and `-3` (Guild) are W04 placeholders until those factions land in the sim.
 */
export const OWNER_NONE = -1;
export const OWNER_FAUNA = -2;
export const OWNER_GUILD = -3;

export type EntityDotRole = 'own' | 'foreign' | 'fauna' | 'guild' | 'neutral';
/** `square` = building (drawn first, under the units), `dot` = unit. */
export type EntityDotShape = 'dot' | 'square';

export interface EntityDot {
  readonly id: number;
  readonly kind: number;
  readonly q: number;
  readonly r: number;
  readonly x: number;
  readonly y: number;
  readonly color: string;
  readonly role: EntityDotRole;
  readonly shape: EntityDotShape;
  /** Dot radius, or half the square's side. */
  readonly radiusPx: number;
}

/** Role colours, resolved from the design tokens once per draw (never per entity). */
export interface DotPalette {
  readonly own: string;
  readonly fauna: string;
  readonly guild: string;
  readonly neutral: string;
}

export interface CollectEntityDotsOptions {
  readonly radiusPx?: number;
  readonly palette?: DotPalette;
}

export function resolveCssToken(tokenName: string, fallback: string): string {
  if (typeof window !== 'undefined' && typeof document !== 'undefined') {
    try {
      const val = window
        .getComputedStyle(document.documentElement)
        .getPropertyValue(tokenName)
        .trim();
      if (val) return val;
    } catch {
      // Fallback if DOM style query is unavailable
    }
  }
  return fallback;
}

/** Reads the four role tokens with one computed-style lookup (a theme change is picked up on the next draw). */
export function resolveDotPalette(): DotPalette {
  let style: CSSStyleDeclaration | null = null;
  if (typeof window !== 'undefined' && typeof document !== 'undefined') {
    try {
      style = window.getComputedStyle(document.documentElement);
    } catch {
      style = null;
    }
  }
  const read = (name: string, fallback: string) => style?.getPropertyValue(name).trim() || fallback;
  return {
    own: read('--ta-orange', DEFAULT_OWN_DOT_COLOR),
    fauna: read('--ta-fault', DEFAULT_FAUNA_DOT_COLOR),
    guild: read('--ta-blue-hi', DEFAULT_GUILD_DOT_COLOR),
    neutral: read('--ta-steel', DEFAULT_NEUTRAL_DOT_COLOR),
  };
}

export function formatHexColor(color: number | string): string {
  if (typeof color === 'string') {
    return color.startsWith('#') ? color : `#${color}`;
  }
  return `#${(color & 0xffffff).toString(16).padStart(6, '0')}`;
}

export function resolveForeignColonyColor(
  owner: number,
  colonyColors?: Record<number, number>,
  ownColonySlot: number = 0,
): string {
  if (colonyColors && typeof colonyColors[owner] === 'number') {
    return formatHexColor(colonyColors[owner]!);
  }
  const len = DEFAULT_COLONY_COLORS.length;
  let idx = Math.abs(owner) % len;
  if (owner === 0 && ownColonySlot !== 0 && idx === 0) {
    idx = 1;
  }
  return formatHexColor(DEFAULT_COLONY_COLORS[idx]!);
}

/** Buildings (constructible economy / power / hub kinds and the landed pod) are squares; everything else a unit. */
export function isBuildingKind(kind: number): boolean {
  return isConstructibleBuilding(kind) || kind === ENTITY_KIND.pod;
}

export function buildingSquarePx(kind: number): number {
  if (kind === ENTITY_KIND.commandHub) return BUILDING_SQUARE_PX.hub;
  return is2x2BuildingKind(kind) ? BUILDING_SQUARE_PX.large : BUILDING_SQUARE_PX.small;
}

/**
 * Who an entity belongs to on the map. Guild and fauna by placeholder owner code or descriptor (fauna also by a
 * presence role registered in the sim); the own colony; any other negative owner (unowned, `-1`) is neutral, not
 * fauna; non-negative owners are foreign colonies.
 */
export function classifyEntityRole(
  owner: number,
  ownColonySlot: number,
  archetypeOrDesc?: string,
  kind?: number,
): EntityDotRole {
  const desc = (archetypeOrDesc ?? '').toLowerCase();
  if (owner === OWNER_GUILD || desc.includes('guild') || desc.includes('freighter') || desc.includes('barge')) return 'guild';
  const faunaKind = kind !== undefined && presenceRoleOf(kind) === 'fauna';
  if (owner === OWNER_FAUNA || desc.includes('fauna') || faunaKind) return 'fauna';
  if (owner === ownColonySlot) return 'own';
  if (owner < 0) return 'neutral';
  return 'foreign';
}

export function resolveEntityDotColor(
  role: EntityDotRole,
  owner: number,
  context?: {
    colonyColors?: Record<number, number>;
    ownColonySlot?: number;
    palette?: DotPalette;
  },
): string {
  if (role === 'foreign') {
    return resolveForeignColonyColor(owner, context?.colonyColors, context?.ownColonySlot ?? 0);
  }
  return (context?.palette ?? resolveDotPalette())[role];
}

function resolvePlanetRadius(view: MapLayerDrawView): number {
  if (view.radius > 0) return view.radius;
  if (view.clientView?.planet?.radius && view.clientView.planet.radius > 0) {
    return view.clientView.planet.radius;
  }
  if (view.tiles && view.tiles.count > 0) {
    return radiusFromTileCount(view.tiles.count);
  }
  return 0;
}

function isTileExplored(
  view: MapLayerDrawView,
  radius: number,
  q: number,
  r: number,
): boolean {
  if (!view.tiles?.explored || radius <= 0) return true;
  const tileIdx = hexIndex(radius).indexOf(q, r);
  if (tileIdx < 0 || tileIdx >= view.tiles.explored.length) return false;
  return view.tiles.explored[tileIdx] !== 0;
}

/**
 * Walks entity rows without a fresh object per packed row (one scratch row is refilled); `ViewEntity[]` input
 * (headless hosts, tests) passes the raw entry too, for its optional `archetype` / `unit` descriptors.
 */
function walkEntityRows(
  ents: Float32Array | readonly unknown[],
  count: number | undefined,
  fn: (row: EntityRow, raw: Record<string, unknown> | undefined) => boolean,
): void {
  if (ents instanceof Float32Array) {
    const n = entityCount(ents, count);
    const stride = ENTITY_FIELDS.length;
    const row = {} as EntityRow;
    for (let i = 0; i < n; i++) {
      const o = i * stride;
      for (const f of ENTITY_FIELDS) row[f] = ents[o + E[f]]!;
      if (!fn(row, undefined)) return;
    }
    return;
  }
  const list = ents as readonly ViewEntity[];
  for (let i = 0; i < list.length; i++) {
    if (!fn(readEntity(list, i), list[i] as unknown as Record<string, unknown>)) return;
  }
}

/** Optional `archetype` / `unit` descriptors of a `ViewEntity` entry ('' for packed rows). */
function descriptorOf(raw: Record<string, unknown> | undefined): string {
  if (!raw) return '';
  const archetype = raw.archetype ?? '';
  const unit = raw.unit ?? '';
  return archetype || unit ? `${String(archetype)} ${String(unit)}`.trim() : '';
}

const finiteOr = (v: number | undefined, fallback: number): number =>
  typeof v === 'number' && !Number.isNaN(v) ? v : fallback;

interface DotContext {
  readonly view: MapLayerDrawView;
  readonly ownColonySlot: number;
  readonly planetRadius: number;
  readonly radiusPx: number;
  readonly palette: DotPalette;
}

/** One map marker for `row`, or null when it sits on an unexplored tile (own entities always show). */
function makeDot(c: DotContext, row: EntityRow, raw: Record<string, unknown> | undefined): EntityDot | null {
  const role = classifyEntityRole(row.owner, c.ownColonySlot, descriptorOf(raw), row.kind);
  const axialQ = finiteOr(row.x, row.q ?? 0);
  const axialR = finiteOr(row.y, row.r ?? 0);
  const [roundedQ, roundedR] = hexRound(axialQ, axialR);
  if (role !== 'own' && !isTileExplored(c.view, c.planetRadius, roundedQ, roundedR)) return null;
  const q = finiteOr(row.q, roundedQ);
  const r = finiteOr(row.r, roundedR);
  const { x, y } = c.view.axialToPixel(axialQ, axialR);
  const color = resolveEntityDotColor(role, row.owner, {
    colonyColors: c.view.colonyColors,
    ownColonySlot: c.ownColonySlot,
    palette: c.palette,
  });
  const square = isBuildingKind(row.kind);
  const radiusPx = square ? buildingSquarePx(row.kind) / 2 : c.radiusPx;
  return { id: row.id, kind: row.kind, q, r, x, y, color, role, shape: square ? 'square' : 'dot', radiusPx };
}

/**
 * Map markers for every visible entity: buildings first (drawn under), then units. Under `MAX_ENTITY_DOTS` units
 * are kept first and buildings fill the remaining room.
 */
export function collectEntityDots(
  view: MapLayerDrawView,
  options?: CollectEntityDotsOptions,
): EntityDot[] {
  if (!view.clientView?.entities) return [];
  const ctx: DotContext = {
    view,
    ownColonySlot: view.ownColonySlot ?? 0,
    planetRadius: resolvePlanetRadius(view),
    radiusPx: options?.radiusPx ?? DEFAULT_DOT_RADIUS_PX,
    palette: options?.palette ?? resolveDotPalette(),
  };
  const units: EntityDot[] = [];
  const buildings: EntityDot[] = [];
  walkEntityRows(view.clientView.entities as Float32Array | readonly unknown[], view.clientView.count, (row, raw) => {
    const building = isBuildingKind(row.kind);
    if (building && buildings.length >= MAX_ENTITY_DOTS) return true;
    const dot = makeDot(ctx, row, raw);
    if (dot) (building ? buildings : units).push(dot);
    return units.length < MAX_ENTITY_DOTS;
  });
  if (buildings.length > MAX_ENTITY_DOTS - units.length) buildings.length = MAX_ENTITY_DOTS - units.length;
  return buildings.concat(units);
}

export function drawEntityDots(
  ctx: CanvasRenderingContext2D,
  view: MapLayerDrawView,
  options?: CollectEntityDotsOptions,
): EntityDot[] {
  const dots = collectEntityDots(view, options);
  for (let i = 0; i < dots.length; i++) {
    const dot = dots[i]!;
    if (dot.id === view.selectedEntityId) {
      ctx.strokeStyle = dot.color;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(dot.x, dot.y, dot.radiusPx + 4, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.fillStyle = dot.color;
    if (dot.shape === 'square') {
      const s = dot.radiusPx * 2;
      ctx.fillRect(dot.x - dot.radiusPx, dot.y - dot.radiusPx, s, s);
      continue;
    }
    ctx.beginPath();
    ctx.arc(dot.x, dot.y, dot.radiusPx, 0, Math.PI * 2);
    ctx.fill();
  }
  return dots;
}

export function createUnitsMapLayer(): MapLayer {
  return {
    id: 'units',
    label: 'Units',
    wave: 'W04',
    defaultOn: true,
    order: 30,
    draw(ctx: CanvasRenderingContext2D, view: MapLayerDrawView): void {
      drawEntityDots(ctx, view);
    },
  };
}

export const unitsMapLayer: MapLayer = createUnitsMapLayer();
