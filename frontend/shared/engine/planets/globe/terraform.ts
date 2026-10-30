import * as THREE from 'three';
import type { PlanetKind } from '../PlanetSpec';

export const KIND_INDEX: Record<PlanetKind, number> = { dune: 0, oceanForest: 1, forestRock: 2 };

/** Per-world terraform targets: the new sea level and the colour of fresh water. */
export const TERRA: Record<PlanetKind, { sea: number; seaColor: number }> = {
  dune: { sea: 0.46, seaColor: 0x1b78a0 },
  oceanForest: { sea: 0.6, seaColor: 0x1aa0c0 },
  forestRock: { sea: 0.36, seaColor: 0x2a80a8 },
};
/** Player territory colours (HDR-friendly, mutually distinct): ignition orange, signal blue, amber, magenta, cyan. */
export const PLAYER_COLORS: [number, number, number][] = [[1.0, 0.42, 0.1], [0.22, 0.45, 1.0], [1.0, 0.85, 0.18], [0.92, 0.25, 0.95], [0.1, 0.95, 0.95]];
export const playerColorVecs = () => PLAYER_COLORS.map(([r, g, b]) => new THREE.Vector3(r, g, b));
/** Five colony beacons spread around the globe (golden-angle longitudes, alternating hemispheres): one is always in view. */
export function colonyPoints(seed: number): THREE.Vector3[] {
  const pts: THREE.Vector3[] = [];
  const h = (n: number) => { const x = Math.sin(seed * 12.9898 + n * 78.233) * 43758.5453; return x - Math.floor(x); };
  for (let i = 0; i < 5; i++) {
    const lon = (i / 5) * Math.PI * 2 + h(i) * 0.5;
    const lat = (i % 2 ? -1 : 1) * (0.18 + 0.4 * h(i + 9));
    pts.push(new THREE.Vector3(Math.cos(lat) * Math.cos(lon), Math.sin(lat), Math.cos(lat) * Math.sin(lon)));
  }
  return pts;
}
export const TERRA_ATM = new THREE.Color(0x7fc4ff), DUSTY_ATM = new THREE.Color(0xd49a6a);
export const smooth01 = (t: number) => { const x = Math.min(1, Math.max(0, t)); return x * x * (3 - 2 * x); };
