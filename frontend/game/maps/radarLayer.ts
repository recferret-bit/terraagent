import {
  ENTITY_KIND,
  getSensorArrayRadarRadius,
  isSensorArrayActive,
} from '@terra/sim';
import { readEntityPower } from '../features/shared/power';
import { entityCount, readEntity, type EntityRow } from '../store/replica/viewCodec';
import type { MapLayerDrawView } from './types';

export interface ActiveSensorArray {
  readonly id: number;
  readonly q: number;
  readonly r: number;
  readonly radiusTiles: number;
}

function finiteOr(v: number | undefined, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

/**
 * Returns every alive, active (completed & powered) Sensor Array belonging to the viewer's colony
 * along with its radar radius in hex tiles.
 */
export function collectActiveSensorArrays(
  view: Pick<MapLayerDrawView, 'clientView' | 'ownColonySlot' | 'simData' | 'spectatorAllVision'>,
): ActiveSensorArray[] {
  const cv = view.clientView;
  if (!cv?.entities) return [];
  const ownSlot = view.ownColonySlot ?? 0;
  const radiusTiles = getSensorArrayRadarRadius(view.simData);
  const ents = cv.entities as Float32Array | readonly { id: number }[];
  const n = entityCount(ents as Float32Array, cv.count);
  const out: ActiveSensorArray[] = [];

  for (let i = 0; i < n; i++) {
    const row: EntityRow = readEntity(ents as Float32Array, i);
    if (row.kind !== ENTITY_KIND.sensorArray || row.hp <= 0) continue;
    if (!view.spectatorAllVision && row.owner !== ownSlot) continue;
    if (!isSensorArrayActive(row.state, row.hp)) continue;
    const ownerPower = readEntityPower(cv, row.id, row.owner);
    if (ownerPower?.state === 'offline') continue;
    out.push({
      id: row.id,
      q: finiteOr(row.x, row.q),
      r: finiteOr(row.y, row.r),
      radiusTiles,
    });
  }
  return out;
}

/** Continuous hex distance in axial `(q, r)` space (avoids integer-rounding jitter on smooth positions). */
export function axialDist(q1: number, r1: number, q2: number, r2: number): number {
  const dq = q1 - q2;
  const dr = r1 - r2;
  return Math.max(Math.abs(dq), Math.abs(dr), Math.abs(dq + dr));
}

/** True when continuous axial `(q, r)` falls within any active owned Sensor Array's radar circle. */
export function isTileInSensorRadar(
  q: number,
  r: number,
  arrays: readonly ActiveSensorArray[],
): boolean {
  for (let i = 0; i < arrays.length; i++) {
    const a = arrays[i]!;
    if (axialDist(q, r, a.q, a.r) <= a.radiusTiles + 0.001) return true;
  }
  return false;
}

/**
 * Draws the Sensor Array radar coverage circles on both the minimap and global map overlays.
 * Drawn after FoW and before entity blips so the range boundary stays crisp over fogged terrain.
 */
export function drawRadarCoverageLayer(
  ctx: CanvasRenderingContext2D,
  view: MapLayerDrawView,
): ActiveSensorArray[] {
  const arrays = collectActiveSensorArrays(view);
  if (arrays.length === 0) return arrays;

  ctx.save();
  for (let i = 0; i < arrays.length; i++) {
    const a = arrays[i]!;
    const center = view.axialToPixel(a.q, a.r);
    const edge = view.axialToPixel(a.q + a.radiusTiles, a.r);
    const pxRadius = Math.hypot(edge.x - center.x, edge.y - center.y);
    if (!Number.isFinite(pxRadius) || pxRadius <= 0.5) continue;

    ctx.beginPath();
    ctx.arc(center.x, center.y, pxRadius, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(56, 189, 248, 0.08)';
    ctx.fill();

    ctx.setLineDash([5, 4]);
    ctx.lineWidth = 1.4;
    ctx.strokeStyle = 'rgba(56, 189, 248, 0.78)';
    ctx.stroke();

    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.arc(center.x, center.y, 2.5, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(56, 189, 248, 0.9)';
    ctx.lineWidth = 1.1;
    ctx.stroke();
  }
  ctx.restore();
  return arrays;
}
