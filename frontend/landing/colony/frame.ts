import { S3 } from './hexMap';

/** Per-frame geometry and the lightning/repair schedule, shared by every colony layer. */
export interface Frame {
  w: number; h: number; dpr: number; s: number; cx: number; cy: number;
  t: number; ct: number; severed: boolean; repairK: number;
}
export const STRIKE_TARGET = 2;
const CYCLE_S = 9;

export function makeFrame(w: number, h: number, dpr: number, t: number, R: number): Frame {
  const s = Math.min(w / (S3 * (2 * R + 2)), h / (1.5 * 0.58 * (2 * R + 3))) * 0.98;
  const ct = t % CYCLE_S;
  return { w, h, dpr, s, cx: w / 2, cy: h * 0.5, t, ct, severed: ct > 3 && ct < 7.4, repairK: Math.min(1, Math.max(0, (ct - 4.2) / 3.2)) };
}

export const proj = (f: Frame, q: number, r: number, h = 0) => ({ x: f.cx + f.s * S3 * (q + r / 2), y: f.cy + f.s * 1.5 * r * 0.58 - h * f.s * 0.32 });
