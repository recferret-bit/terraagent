import * as THREE from 'three';
import { GRID_PORTS } from '../../kitbash/archetypes/buildings/gridPorts';
import { PYLON_CROSSBEAMS, PYLON_INSULATOR_DROP } from '../../kitbash/archetypes/buildings/power';

/** Model-space point `[x, y, z]` a cable ends on. */
export type CableAnchor = [number, number, number];

/**
 * Where a cable meets a building wall: the box around `(cx, cz)` with half-size `r`, at height `y`. Explicit for the
 * Command Hub (its bounding box includes the landing pad and antenna, which would leave the cable ending in the air);
 * any other building uses `boxAnchorFromBounds`.
 */
interface WallAnchor {
  cx: number;
  cz: number;
  r: number;
  y: number;
}

const WALL_ANCHORS: Readonly<Record<string, WallAnchor>> = {
  // Lower hull (4.4 × 4.2 m around (-0.2, -0.2), 0.16..1.5 m): the cable enters its wall at 1.3 m.
  'building.commandHub': { cx: -0.2, cz: -0.2, r: 2.05, y: 1.3 },
};

/** Conductors a pylon carries (one per crossbeam), lowest first. */
export const PYLON_CONDUCTORS = PYLON_CROSSBEAMS.length;

/**
 * The insulator cap of crossbeam `conductor` on the pylon side facing local direction `localDirX` (model space, before
 * the in-game plinth strip: subtract `stripOffsetY`).
 */
export function pylonCableAnchor(conductor: number, localDirX: number, stripOffsetY = 0): CableAnchor {
  const [y, w] = PYLON_CROSSBEAMS[Math.max(0, Math.min(PYLON_CROSSBEAMS.length - 1, conductor))];
  const side = localDirX < 0 ? -1 : 1;
  return [side * w, y - PYLON_INSULATOR_DROP - 0.05 - stripOffsetY, 0];
}

function boxAnchorFromBounds(box: THREE.Box3): WallAnchor {
  const cx = (box.min.x + box.max.x) / 2;
  const cz = (box.min.z + box.max.z) / 2;
  const r = 0.8 * Math.min(box.max.x - box.min.x, box.max.z - box.min.z) / 2;
  const h = box.max.y - Math.max(0, box.min.y);
  return { cx, cz, r, y: Math.max(0.6, Math.min(1.4, h * 0.3)) };
}

/**
 * The point on a building's wall facing local direction `(dx, dz)` (model space, any length) where a cable ends:
 * the side of a square of half-size `r` around the wall anchor's centre.
 */
export function buildingCableAnchor(
  archetypeId: string,
  bounds: THREE.Box3 | null,
  dx: number,
  dz: number,
  stripOffsetY = 0,
): CableAnchor {
  const port = GRID_PORTS[archetypeId];
  if (port) return [port[0], port[1] - stripOffsetY, port[2]];
  const wall = WALL_ANCHORS[archetypeId] ?? (bounds ? boxAnchorFromBounds(bounds) : { cx: 0, cz: 0, r: 0.8, y: 1.0 });
  const m = Math.max(Math.abs(dx), Math.abs(dz), 1e-6);
  const k = wall.r / m;
  const y = WALL_ANCHORS[archetypeId] ? wall.y - stripOffsetY : wall.y;
  return [wall.cx + dx * k, y, wall.cz + dz * k];
}
