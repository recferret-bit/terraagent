import { tileXZ } from '@terra/render/planets/hex';
import type { FeatureContext } from '../../core/registry/types';
import { is2x2RingBuildingKind } from './ringSpecs';

/** Indicators follow the pose drawn this frame, including interpolation and prediction corrections. */
export function computeEntityWorldPos(
  ctx: FeatureContext,
  entityId: number,
  kind: number,
  x: number,
  y: number,
): { worldX: number; groundY: number; worldZ: number } {
  const s3 = ctx.services.scene3d;
  const rendered = s3?.renderedEntityGroundPosition?.(entityId);
  if (rendered) return { worldX: rendered.x, groundY: rendered.y, worldZ: rendered.z };
  const ox = is2x2RingBuildingKind(kind) ? x + 0.5 : x;
  const oy = is2x2RingBuildingKind(kind) ? y + 0.5 : y;
  if (s3) {
    const p = s3.tileToWorld(ox, oy);
    return { worldX: p.x, groundY: p.y, worldZ: p.z };
  }
  const [wx, wz] = tileXZ(ox, oy);
  return { worldX: wx, groundY: 0, worldZ: wz };
}
