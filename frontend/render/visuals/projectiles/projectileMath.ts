import { DEFAULT_TILE_SIZE_M } from './pools';
import type { VfxWeaponKind } from './types';

export function axialToWorldVfxPoint(
  q: number,
  r: number,
  heightY = 0.6,
  tileSizeM = DEFAULT_TILE_SIZE_M,
): { x: number; y: number; z: number } {
  return {
    x: (q + r / 2) * tileSizeM,
    y: heightY,
    z: ((r * Math.sqrt(3)) / 2) * tileSizeM,
  };
}

export function evalParabolicArcY(y0: number, y1: number, arcHeight: number, t: number): number {
  const clamped = Math.max(0, Math.min(1, t));
  return y0 + (y1 - y0) * clamped + 4 * arcHeight * clamped * (1 - clamped);
}

export function resolveVfxWeaponKind(input: {
  weaponKind?: VfxWeaponKind | string;
  weaponType?: string;
  weaponId?: string;
  arc?: string;
}): VfxWeaponKind {
  const kind = input.weaponKind?.toLowerCase();
  if (
    kind === 'bullet' ||
    kind === 'shell' ||
    kind === 'rocket' ||
    kind === 'laser' ||
    kind === 'acid'
  ) {
    return kind;
  }
  const wt = input.weaponType?.toLowerCase() ?? '';
  const wid = input.weaponId?.toLowerCase() ?? '';
  if (wt === 'laser' || wid.includes('laser') || wid.includes('beam')) return 'laser';
  if (wt === 'acid' || wid.includes('acid') || wid.includes('spitter')) return 'acid';
  if (
    wt === 'shell' ||
    wid.includes('shell') ||
    wid.includes('artillery') ||
    input.arc === 'indirect'
  ) {
    return 'shell';
  }
  if (wt === 'rocket' || wid.includes('rocket') || wid.includes('missile')) return 'rocket';
  return 'bullet';
}

export function defaultFlightSpeedMps(kind: Exclude<VfxWeaponKind, 'laser'>): number {
  switch (kind) {
    case 'bullet':
      return 28;
    case 'rocket':
      return 18;
    case 'shell':
      return 14;
    case 'acid':
      return 15;
  }
}

export function computeArcHeight(
  kind: Exclude<VfxWeaponKind, 'laser'>,
  y0: number,
  y1: number,
  horizDist: number,
  arcHint?: 'direct' | 'indirect',
): number {
  const halfDeltaY = Math.abs(y1 - y0) * 0.5;
  if (kind === 'shell' || arcHint === 'indirect') {
    return halfDeltaY + Math.max(1.8, Math.min(9.0, horizDist * 0.34));
  }
  if (kind === 'acid') {
    return halfDeltaY + Math.max(0.85, Math.min(4.5, horizDist * 0.2));
  }
  return 0;
}
