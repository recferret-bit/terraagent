import { DEFAULT_COLONY_COLORS } from '@terra/contracts/tiles/codes';
import { hexIndex, hexRound } from '@terra/sim/grid/hex';
import { forEachEntity, type EntityRow } from '../store/replica/viewCodec';
import { radiusFromTileCount } from './rasterCache';
import type { MapLayer, MapLayerDrawView } from './types';

export const MAX_ENTITY_DOTS = 1500;

export const DEFAULT_DOT_RADIUS_PX = 2.5;
export const DEFAULT_OWN_DOT_COLOR = '#FF6B1A';
export const DEFAULT_FAUNA_DOT_COLOR = '#F04848';
export const DEFAULT_GUILD_DOT_COLOR = '#52B4FF';

export type EntityDotRole = 'own' | 'foreign' | 'fauna' | 'guild';

export interface EntityDot {
  readonly id: number;
  readonly q: number;
  readonly r: number;
  readonly x: number;
  readonly y: number;
  readonly color: string;
  readonly role: EntityDotRole;
  readonly radiusPx: number;
}

export interface CollectEntityDotsOptions {
  readonly radiusPx?: number;
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

export function classifyEntityRole(
  owner: number,
  ownColonySlot: number,
  archetypeOrDesc?: string,
): EntityDotRole {
  const desc = (archetypeOrDesc ?? '').toLowerCase();
  const isGuild =
    owner === -3 ||
    desc.includes('guild') ||
    desc.includes('freighter') ||
    desc.includes('barge');
  if (isGuild) return 'guild';

  const isFauna =
    owner === -2 ||
    desc.startsWith('fauna') ||
    desc.includes('fauna') ||
    (owner < 0 && owner !== ownColonySlot);
  if (isFauna) return 'fauna';

  if (owner === ownColonySlot) return 'own';

  return 'foreign';
}

export function resolveEntityDotColor(
  role: EntityDotRole,
  owner: number,
  context?: {
    colonyColors?: Record<number, number>;
    ownColonySlot?: number;
  },
): string {
  switch (role) {
    case 'own':
      return resolveCssToken('--ta-orange', DEFAULT_OWN_DOT_COLOR);
    case 'fauna':
      return resolveCssToken('--ta-fault', DEFAULT_FAUNA_DOT_COLOR);
    case 'guild':
      return resolveCssToken('--ta-blue-hi', DEFAULT_GUILD_DOT_COLOR);
    case 'foreign':
      return resolveForeignColonyColor(
        owner,
        context?.colonyColors,
        context?.ownColonySlot ?? 0,
      );
  }
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

export function collectEntityDots(
  view: MapLayerDrawView,
  options?: CollectEntityDotsOptions,
): EntityDot[] {
  if (!view.clientView?.entities) return [];

  const dots: EntityDot[] = [];
  const ownColonySlot = view.ownColonySlot ?? 0;
  const radiusPx = options?.radiusPx ?? DEFAULT_DOT_RADIUS_PX;
  const planetRadius = resolvePlanetRadius(view);
  const rawList = Array.isArray(view.clientView.entities)
    ? (view.clientView.entities as readonly unknown[])
    : null;

  forEachEntity(
    view.clientView.entities as unknown as Float32Array,
    view.clientView.count,
    (row: EntityRow, i: number) => {
      if (dots.length >= MAX_ENTITY_DOTS) return false;

      const raw = rawList ? (rawList[i] as Record<string, unknown> | undefined) : undefined;
      const rowAny = row as unknown as Record<string, unknown>;
      const archetype = String(raw?.archetype ?? rowAny?.archetype ?? '');
      const unit = String(raw?.unit ?? rowAny?.unit ?? '');
      const desc = `${archetype} ${unit}`.trim();

      const role = classifyEntityRole(row.owner, ownColonySlot, desc);

      const axialQ = typeof row.x === 'number' && !Number.isNaN(row.x) ? row.x : (row.q ?? 0);
      const axialR = typeof row.y === 'number' && !Number.isNaN(row.y) ? row.y : (row.r ?? 0);
      const [roundedQ, roundedR] = hexRound(axialQ, axialR);
      const q = typeof row.q === 'number' && !Number.isNaN(row.q) ? row.q : roundedQ;
      const r = typeof row.r === 'number' && !Number.isNaN(row.r) ? row.r : roundedR;

      if (role !== 'own' && !isTileExplored(view, planetRadius, roundedQ, roundedR)) {
        return;
      }

      const { x, y } = view.axialToPixel(axialQ, axialR);
      const color = resolveEntityDotColor(role, row.owner, {
        colonyColors: view.colonyColors,
        ownColonySlot,
      });

      dots.push({
        id: row.id,
        q,
        r,
        x,
        y,
        color,
        role,
        radiusPx,
      });

      if (dots.length >= MAX_ENTITY_DOTS) return false;
    },
  );

  return dots;
}

export function drawEntityDots(
  ctx: CanvasRenderingContext2D,
  view: MapLayerDrawView,
  options?: CollectEntityDotsOptions,
): EntityDot[] {
  const dots = collectEntityDots(view, options);
  for (let i = 0; i < dots.length; i++) {
    const dot = dots[i]!;
    ctx.fillStyle = dot.color;
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
