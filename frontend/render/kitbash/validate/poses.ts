// Animation poses of a part, mirroring the vertex shader of UnifiedColonyMaterial.
import type { PartDef } from './types';

export interface Pose { label: string; tris: Float32Array }
export function poses(p: PartDef): Pose[] {
  const src = p.tris, out: Pose[] = [];
  const make = (label: string, f: (x: number, y: number, z: number, o: number, t: Float32Array) => void) => {
    const t = new Float32Array(src.length);
    for (let i = 0; i < src.length; i += 3) f(src[i], src[i + 1], src[i + 2], i, t);
    out.push({ label, tris: t });
  };
  const [px, py, pz] = p.pivot;
  if (p.animType === 1) {
    for (let k = 1; k < 24; k++) {
      const a = (k * Math.PI * 2) / 24, c = Math.cos(a), s = Math.sin(a);
      make(`${k * 15}° of its spin`, (x, y, z, i, t) => { const rx = x - px, rz = z - pz; t[i] = px + rx * c - rz * s; t[i + 1] = y; t[i + 2] = pz + rx * s + rz * c; });
    }
  } else if (p.animType === 2) {
    for (const dy of [-0.05, -0.025, 0.025, 0.05]) make(`${dy > 0 ? '+' : ''}${(dy * 100).toFixed(1)} cm bob`, (x, y, z, i, t) => { t[i] = x; t[i + 1] = y + dy; t[i + 2] = z; });
  } else if (p.animType === 3) {
    for (const dz of [-0.015, -0.03, -0.045, -0.06]) make(`${(dz * 100).toFixed(1)} cm recoil`, (x, y, z, i, t) => { t[i] = x; t[i + 1] = y; t[i + 2] = z + dz; });
  } else if (p.animType === 4) {
    const phase = px >= 0 ? 0 : Math.PI;
    for (let k = 1; k < 16; k++) {
      const tau = (k * Math.PI * 2) / 16 + phase, s = Math.sin(tau), c = Math.cos(tau);
      const hipAngle = s * 0.18, ch = Math.cos(hipAngle), sh = Math.sin(hipAngle), lift = Math.max(0, c);
      make(`${Math.round((k * 360) / 16)}° of its biped stride`, (x, y, z, i, t) => {
        const relY = y - py, relZ = z - pz;
        const legT = Math.min(1, Math.max(0, -relY / Math.max(py, 0.1)));
        const kneeT = Math.min(1, Math.max(0, (legT - 0.45) / 0.55));
        t[i] = x;
        t[i + 1] = py + relY * ch - relZ * sh + legT * (Math.abs(s) * 0.038 + lift * 0.045);
        t[i + 2] = pz + relY * sh + relZ * ch - kneeT * lift * 0.055;
      });
    }
  } else if (p.animType === 5) {
    const phase = px >= 0 ? Math.PI : 0;
    for (let k = 1; k < 16; k++) {
      const tau = (k * Math.PI * 2) / 16 + phase, armAngle = Math.sin(tau) * 0.16;
      const ca = Math.cos(armAngle), sa = Math.sin(armAngle);
      make(`${Math.round((k * 360) / 16)}° of its arm swing`, (x, y, z, i, t) => {
        const ry = y - py, rz = z - pz;
        t[i] = x; t[i + 1] = py + ry * ca - rz * sa; t[i + 2] = pz + ry * sa + rz * ca;
      });
    }
  } else if (p.animType === 6) {
    const phase = (px >= 0 ? 0 : Math.PI) + pz * 4.9, sideSign = px >= 0 ? 1 : -1;
    for (let k = 1; k < 16; k++) {
      const tau = (k * Math.PI * 2) / 16 + phase, yaw = sideSign * Math.sin(tau) * 0.14;
      const cy = Math.cos(yaw), sy = Math.sin(yaw), stepLift = Math.max(0, Math.cos(tau)) * 0.075;
      make(`${Math.round((k * 360) / 16)}° of its spider gait`, (x, y, z, i, t) => {
        const rx = x - px, rz = z - pz;
        const radial = Math.min(1, Math.max(0, Math.hypot(rx, rz) / 0.5));
        t[i] = px + rx * cy - rz * sy; t[i + 1] = y + radial * stepLift; t[i + 2] = pz + rx * sy + rz * cy;
      });
    }
  } else if (p.animType === 7) {
    for (let k = 1; k < 16; k++) {
      const wa = (k * Math.PI * 2) / 16, cw = Math.cos(wa), sw = Math.sin(wa);
      make(`${Math.round((k * 360) / 16)}° of its wheel roll`, (x, y, z, i, t) => {
        const wy = y - py, wz = z - pz;
        t[i] = x; t[i + 1] = py + wy * cw - wz * sw; t[i + 2] = pz + wy * sw + wz * cw;
      });
    }
  }
  return out;
}

