import * as THREE from 'three';
import { TILE_M } from '@terra/render/planets/hex';
import type { RTSCamera } from '../app/RTSCamera';
import type { MapLayerDrawView } from './types';

export interface TrapezoidCorner {
  readonly worldX: number;
  readonly worldZ: number;
  readonly x: number;
  readonly y: number;
}

export interface CameraFootprintSource {
  readonly camera?: THREE.PerspectiveCamera | null;
  readonly rtsCamera?: RTSCamera | null;
  readonly targetX?: number;
  readonly targetZ?: number;
  readonly yaw?: number;
  readonly dist?: number;
}

const NDC_CORNERS: readonly (readonly [number, number])[] = [
  [-1, -1], // bottom-left (near)
  [1, -1],  // bottom-right (near)
  [1, 1],   // top-right (far)
  [-1, 1],  // top-left (far)
];

function worldMetresToAxialFractional(
  wx: number,
  wz: number,
): { q: number; r: number } {
  const px = wx / TILE_M;
  const py = wz / TILE_M;
  const r = (2 * py) / Math.sqrt(3);
  const q = px - r * 0.5;
  return { q, r };
}

function computeAnalyticalWorldCorners(
  targetX: number,
  targetZ: number,
  yaw: number,
  dist: number,
): Array<{ worldX: number; worldZ: number }> {
  // Camera sits at target + (cos(yaw), sin(yaw)) * hDist, looking along (-cos(yaw), -sin(yaw)).
  const fwdX = -Math.cos(yaw);
  const fwdZ = -Math.sin(yaw);
  const rightX = Math.sin(yaw);
  const rightZ = -Math.cos(yaw);

  const scale = Math.max(8, dist);
  const nearDist = -scale * 0.28;
  const farDist = scale * 0.42;
  const nearHalfW = scale * 0.28;
  const farHalfW = scale * 0.46;

  return [
    {
      worldX: targetX + fwdX * nearDist - rightX * nearHalfW,
      worldZ: targetZ + fwdZ * nearDist - rightZ * nearHalfW,
    },
    {
      worldX: targetX + fwdX * nearDist + rightX * nearHalfW,
      worldZ: targetZ + fwdZ * nearDist + rightZ * nearHalfW,
    },
    {
      worldX: targetX + fwdX * farDist + rightX * farHalfW,
      worldZ: targetZ + fwdZ * farDist + rightZ * farHalfW,
    },
    {
      worldX: targetX + fwdX * farDist - rightX * farHalfW,
      worldZ: targetZ + fwdZ * farDist - rightZ * farHalfW,
    },
  ];
}

function projectFrustumRaysToGround(
  camera: THREE.PerspectiveCamera,
  groundY: number,
  maxDist: number,
): Array<{ worldX: number; worldZ: number }> | null {
  camera.updateMatrixWorld();
  const origin = camera.position;
  if (origin.y <= groundY + 0.5) return null;

  const corners: Array<{ worldX: number; worldZ: number }> = [];
  const pt = new THREE.Vector3();
  for (const [nx, ny] of NDC_CORNERS) {
    pt.set(nx, ny, 0.5).unproject(camera);
    const dx = pt.x - origin.x;
    const dy = pt.y - origin.y;
    const dz = pt.z - origin.z;
    const len = Math.hypot(dx, dy, dz);
    if (len < 1e-6) return null;
    const dirX = dx / len;
    const dirY = dy / len;
    const dirZ = dz / len;
    if (dirY >= -1e-3) return null;
    const t = Math.min(maxDist, (groundY - origin.y) / dirY);
    if (!Number.isFinite(t) || t <= 0) return null;
    corners.push({
      worldX: origin.x + dirX * t,
      worldZ: origin.z + dirZ * t,
    });
  }
  return corners.length === 4 ? corners : null;
}

export function computeCameraTrapezoid(
  view: Pick<MapLayerDrawView, 'axialToPixel'>,
  source: CameraFootprintSource = {},
): TrapezoidCorner[] {
  const rts = source.rtsCamera ?? null;
  const cam = source.camera ?? null;
  const targetX = source.targetX ?? rts?.target.x ?? 0;
  const targetZ = source.targetZ ?? rts?.target.z ?? 0;
  const groundY = rts?.target.y ?? 0;
  const inferredYaw =
    cam && rts
      ? Math.atan2(cam.position.z - rts.target.z, cam.position.x - rts.target.x)
      : undefined;
  const inferredDist =
    cam && rts
      ? Math.hypot(
          cam.position.x - rts.target.x,
          cam.position.y - rts.target.y,
          cam.position.z - rts.target.z,
        )
      : undefined;
  const yaw = source.yaw ?? inferredYaw ?? Math.PI / 4;
  const dist = source.dist ?? inferredDist ?? 56;

  let worldCorners: Array<{ worldX: number; worldZ: number }> | null = null;
  if (cam && source.targetX === undefined && source.yaw === undefined) {
    worldCorners = projectFrustumRaysToGround(cam, groundY, dist * 3.5);
  }
  if (!worldCorners) {
    worldCorners = computeAnalyticalWorldCorners(targetX, targetZ, yaw, dist);
  }

  return worldCorners.map(({ worldX, worldZ }) => {
    const { q, r } = worldMetresToAxialFractional(worldX, worldZ);
    const { x, y } = view.axialToPixel(q, r);
    return { worldX, worldZ, x, y };
  });
}

export function drawCameraTrapezoid(
  ctx: CanvasRenderingContext2D,
  view: Pick<MapLayerDrawView, 'axialToPixel'>,
  source: CameraFootprintSource = {},
): TrapezoidCorner[] {
  const corners = computeCameraTrapezoid(view, source);
  if (corners.length < 4) return corners;

  ctx.save();
  ctx.beginPath();
  ctx.moveTo(corners[0]!.x, corners[0]!.y);
  for (let i = 1; i < corners.length; i++) {
    ctx.lineTo(corners[i]!.x, corners[i]!.y);
  }
  ctx.closePath();
  ctx.fillStyle = 'rgba(242, 245, 250, 0.12)';
  ctx.fill();
  ctx.strokeStyle = '#F2F5FA';
  ctx.lineWidth = 1.5;
  ctx.stroke();
  ctx.restore();

  return corners;
}
