/** Debris and beam impacts stay outside the worked volume (tree canopy, rock), not at its centre. */
export type Vec3 = [number, number, number];

export const DEBRIS_SHELL_MIN = 0.7;
export const DEBRIS_SHELL_MAX = 1.3;
const DEBRIS_JITTER = 0.1;
export const SPAWN_GROUND_CLEAR = 0.08;
const IMPACT_RADIUS = 0.9;

/** Unit direction with a component on X, Y and Z (not a flat XZ ring). */
export function randomShellDir(rand: () => number): Vec3 {
  const y = rand() * 2 - 1;
  const theta = rand() * Math.PI * 2;
  const radial = Math.sqrt(Math.max(0, 1 - y * y));
  return [radial * Math.cos(theta), y, radial * Math.sin(theta)];
}

/** `radius` metres from `center` along `dir`, never below `floor`. Distance stays ≥ `radius`. */
export function pointOnShell(center: readonly [number, number, number], dir: readonly [number, number, number], radius: number, floor: number): Vec3 {
  const len = Math.hypot(dir[0], dir[1], dir[2]) || 1;
  let y = center[1] + (dir[1] / len) * radius;
  if (y < floor) y = floor;
  const yOff = y - center[1];
  const hNeed = Math.sqrt(Math.max(0, radius * radius - yOff * yOff));
  let hx = dir[0];
  let hz = dir[2];
  if (hx * hx + hz * hz < 1e-12) {
    hx = 1;
    hz = 0;
  }
  const h = Math.hypot(hx, hz);
  return [center[0] + (hx / h) * hNeed, y, center[2] + (hz / h) * hNeed];
}

/** Shell point plus a smaller XYZ jitter, pushed back out if that jitter enters the volume or the ground. */
export function debrisSpawnPoint(
  center: readonly [number, number, number],
  dir: readonly [number, number, number],
  radius: number,
  rand: () => number,
  floor: number,
): Vec3 {
  const base = pointOnShell(center, dir, radius, floor);
  const j = DEBRIS_JITTER;
  const q: Vec3 = [
    base[0] + (rand() - 0.5) * 2 * j,
    base[1] + (rand() - 0.5) * 2 * j,
    base[2] + (rand() - 0.5) * 2 * j,
  ];
  const off: Vec3 = [q[0] - center[0], q[1] - center[1], q[2] - center[2]];
  const dist = Math.hypot(off[0], off[1], off[2]);
  if (q[1] >= floor && dist >= DEBRIS_SHELL_MIN) return q;
  return pointOnShell(center, off, Math.max(DEBRIS_SHELL_MIN, dist), floor);
}

/** Beam hit on the outside shell toward `from` (the bot). The sweep stays on that shell. */
export function beamImpactPoint(
  center: readonly [number, number, number],
  from: readonly [number, number, number],
  sweepRadius: number,
  sweepFreq: number,
  clock: number,
  floor: number,
): Vec3 {
  const dx = from[0] - center[0];
  const dy = from[1] - center[1];
  const dz = from[2] - center[2];
  const len = Math.hypot(dx, dy, dz) || 1;
  const a = clock * sweepFreq;
  const wobble = sweepRadius * (0.65 + 0.35 * Math.sin(clock * 2.3));
  return pointOnShell(
    center,
    [dx / len + Math.cos(a) * wobble, dy / len + Math.sin(a * 1.5) * wobble, dz / len + Math.sin(a) * wobble],
    IMPACT_RADIUS,
    floor,
  );
}
