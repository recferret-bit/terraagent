// Animation poses of a part, mirroring the vertex shader of UnifiedColonyMaterial.
import type { PartDef } from './types';

export interface Pose { label: string; tris: Float32Array }

function bodyTransform(x: number, y: number, z: number, cy0: number, roll: number, pitch: number, yaw: number, sx: number, hy: number, sz: number): [number, number, number] {
  const rx = x, ry = y - cy0, rz = z;
  const cr = Math.cos(roll), sr = Math.sin(roll);
  const rx1 = rx * cr - ry * sr, ry1 = rx * sr + ry * cr;
  const cp = Math.cos(pitch), sp = Math.sin(pitch);
  const ry2 = ry1 * cp - rz * sp, rz2 = ry1 * sp + rz * cp;
  const cy = Math.cos(yaw), sy = Math.sin(yaw);
  return [rx1 * cy - rz2 * sy + sx, cy0 + ry2 + hy, rx1 * sy + rz2 * cy + sz];
}

const bipedBody = (x: number, y: number, z: number, g: number) =>
  bodyTransform(x, y, z, 0.92, -Math.cos(g) * 0.055, Math.sin(g * 2 - 0.4) * 0.048, -Math.sin(g) * 0.075, -Math.cos(g) * 0.036, -Math.cos(g * 2) * 0.022 - Math.sin(g * 2) * 0.012, Math.sin(g * 2) * 0.025);

const spiderBody = (x: number, y: number, z: number, g: number) =>
  bodyTransform(x, y, z, 0.76, Math.sin(g - 0.25) * 0.095, Math.sin(g * 2 - 0.45) * 0.068, Math.cos(g) * 0.065, Math.cos(g) * 0.042, -Math.cos(g * 2) * 0.044 - Math.sin(g * 2) * 0.026, Math.sin(g * 2) * 0.034);

function bipedLegPoint(x: number, y: number, z: number, px: number, py: number, pz: number, g: number, sub: number): [number, number, number] {
  const tau = g + (px >= 0 ? 0 : Math.PI), s = Math.sin(tau), lift = Math.max(0, Math.cos(tau));
  const [bhx, bhy, bhz] = bipedBody(px, py, pz, g);
  const dhx = bhx - px, dhy = bhy - py, dhz = bhz - pz;
  const hipAngle = s * 0.22, ch = Math.cos(hipAngle), sh = Math.sin(hipAngle);
  if (sub === 0) {
    const ry = y - py, rz = z - pz;
    return [x + dhx, py + dhy + ry * ch - rz * sh, pz + dhz + ry * sh + rz * ch];
  }
  const ky0 = -0.3173 * py, shinAngle = hipAngle + lift * 0.52, cs = Math.cos(shinAngle), ss = Math.sin(shinAngle);
  const kmy = py + dhy + ky0 * ch, kmz = pz + dhz + ky0 * sh;
  if (sub === 1) {
    const uy = y - (py + ky0), uz = z - pz;
    return [x + dhx, kmy + uy * cs - uz * ss, kmz + uy * ss + uz * cs];
  }
  const ay0 = -0.5769 * py;
  return [x + dhx, kmy + ay0 * cs + (y - (py + ky0 + ay0)), kmz + ay0 * ss + (z - pz)];
}

function spiderLegPoint(x: number, y: number, z: number, px: number, py: number, pz: number, g: number, sub: number): [number, number, number] {
  const sideSign = px >= 0 ? 1 : -1, tau = g + (px >= 0 ? 0 : Math.PI) + pz * 4.9;
  const yaw = sideSign * Math.sin(tau) * 0.18, cy = Math.cos(yaw), sy = Math.sin(yaw);
  const [bhx, bhy, bhz] = spiderBody(px, py, pz, g);
  const dhx = bhx - px, dhy = bhy - py, dhz = bhz - pz;
  const stepLift = Math.pow(Math.max(0, Math.cos(tau)), 0.8) * 0.1;
  const femAngle = (sideSign * (stepLift - dhy + 0.004)) / Math.max(Math.abs(px), 0.2);
  const cf = Math.cos(femAngle), sf = Math.sin(femAngle);
  if (sub === 0) {
    const rx = x - px, ry = y - py, rz = z - pz, rx1 = rx * cf - ry * sf, ry1 = rx * sf + ry * cf;
    return [px + dhx + rx1 * cy - rz * sy, py + dhy + ry1, pz + dhz + rx1 * sy + rz * cy];
  }
  const k0x = px, k0y = 0.24, k0z = 0.5 * pz, kx1 = k0x * cf - k0y * sf, ky1 = k0x * sf + k0y * cf;
  const kmx = px + dhx + kx1 * cy - k0z * sy, kmy = py + dhy + ky1, kmz = pz + dhz + kx1 * sy + k0z * cy;
  const ux = x - (px + k0x), uy = y - (py + k0y), uz = z - (pz + k0z);
  return [kmx + ux * cy - uz * sy, kmy + uy, kmz + ux * sy + uz * cy];
}

export function poses(p: PartDef): Pose[] {
  const src = p.tris, out: Pose[] = [];
  const make = (label: string, f: (x: number, y: number, z: number, o: number, t: Float32Array) => void) => {
    const t = new Float32Array(src.length);
    for (let i = 0; i < src.length; i += 3) f(src[i], src[i + 1], src[i + 2], i, t);
    out.push({ label, tris: t });
  };
  const [px, py, pz] = p.pivot;
  const raw = Math.round(p.animType), sub = Math.floor(raw / 10), base = raw - sub * 10;
  if (base === 1 && sub === 0) {
    for (let k = 1; k < 24; k++) {
      const a = (k * Math.PI * 2) / 24, c = Math.cos(a), s = Math.sin(a);
      make(`${k * 15}° of its spin`, (x, y, z, i, t) => { const rx = x - px, rz = z - pz; t[i] = px + rx * c - rz * s; t[i + 1] = y; t[i + 2] = pz + rx * s + rz * c; });
    }
  } else if (base === 2 && sub === 0) {
    for (const dy of [-0.05, -0.025, 0.025, 0.05]) make(`${dy > 0 ? '+' : ''}${(dy * 100).toFixed(1)} cm bob`, (x, y, z, i, t) => { t[i] = x; t[i + 1] = y + dy; t[i + 2] = z; });
  } else if (base === 3 && sub === 0) {
    for (const dz of [-0.015, -0.03, -0.045, -0.06]) make(`${(dz * 100).toFixed(1)} cm recoil`, (x, y, z, i, t) => { t[i] = x; t[i + 1] = y; t[i + 2] = z + dz; });
  } else if (base === 4) {
    for (let k = 1; k < 16; k++) {
      const g = (k * Math.PI * 2) / 16;
      make(`${Math.round((k * 360) / 16)}° of its biped stride`, (x, y, z, i, t) => {
        const [tx, ty, tz] = bipedLegPoint(x, y, z, px, py, pz, g, sub);
        t[i] = tx; t[i + 1] = ty; t[i + 2] = tz;
      });
    }
  } else if (base === 5) {
    const phase = px >= 0 ? Math.PI : 0;
    for (let k = 1; k < 16; k++) {
      const g = (k * Math.PI * 2) / 16, tau = g + phase, armAngle = Math.sin(tau) * 0.22;
      const ca = Math.cos(armAngle), sa = Math.sin(armAngle);
      make(`${Math.round((k * 360) / 16)}° of its arm swing`, (x, y, z, i, t) => {
        const ry = y - py, rz = z - pz;
        const [bx, by, bz] = bipedBody(x, py + ry * ca - rz * sa, pz + ry * sa + rz * ca, g);
        t[i] = bx; t[i + 1] = by; t[i + 2] = bz;
      });
    }
  } else if (base === 6) {
    for (let k = 1; k < 16; k++) {
      const g = (k * Math.PI * 2) / 16;
      make(`${Math.round((k * 360) / 16)}° of its spider gait`, (x, y, z, i, t) => {
        const [tx, ty, tz] = spiderLegPoint(x, y, z, px, py, pz, g, sub);
        t[i] = tx; t[i + 1] = ty; t[i + 2] = tz;
      });
    }
  } else if (base === 7) {
    for (let k = 1; k < 16; k++) {
      const wa = (k * Math.PI * 2) / 16, cw = Math.cos(wa), sw = Math.sin(wa);
      make(`${Math.round((k * 360) / 16)}° of its wheel roll`, (x, y, z, i, t) => {
        const wy = y - py, wz = z - pz;
        t[i] = x; t[i + 1] = py + wy * cw - wz * sw; t[i + 2] = pz + wy * sw + wz * cw;
      });
    }
  } else if (base === 8 || base === 9) {
    const fn = base === 8 ? bipedBody : spiderBody, name = base === 8 ? 'biped body step' : 'spider body step';
    for (let k = 1; k < 16; k++) {
      const g = (k * Math.PI * 2) / 16, c = Math.cos(g), s = Math.sin(g);
      make(`${Math.round((k * 360) / 16)}° of its ${name}`, (x, y, z, i, t) => {
        let tx = x, ty = y, tz = z;
        if (sub === 1) { const rx = x - px, rz = z - pz; tx = px + rx * c - rz * s; tz = pz + rx * s + rz * c; }
        else if (sub === 2) { ty += Math.sin(g + px * 3.1) * 0.025; }
        else if (sub === 3) { tz -= Math.pow(Math.max(Math.sin(g + px * 2.3), 0), 6) * 0.06; }
        const [bx, by, bz] = fn(tx, ty, tz, g);
        t[i] = bx; t[i + 1] = by; t[i + 2] = bz;
      });
    }
  }
  return out;
}

