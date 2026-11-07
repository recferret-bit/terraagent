import { insectPartPoses } from '../../animation/insects/validationPoses';
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

const bipedBody = (x: number, y: number, z: number, g: number, w = 1, wk = 0) =>
  bodyTransform(
    x, y, z, 0.92,
    -Math.cos(g) * 0.055 * w + Math.sin(g) * 0.04 * wk,
    Math.sin(g * 2 - 0.4) * 0.048 * w + (0.09 + Math.sin(g * 2) * 0.05) * wk,
    -Math.sin(g) * 0.075 * w + Math.cos(g) * 0.08 * wk,
    -Math.cos(g) * 0.036 * w + Math.sin(g) * 0.022 * wk,
    (-Math.cos(g * 2) * 0.022 - Math.sin(g * 2) * 0.012) * w + (0.012 + Math.sin(g * 2) * 0.012) * wk,
    Math.sin(g * 2) * 0.025 * w + (0.02 + Math.sin(g * 2) * 0.018) * wk,
  );

const spiderBody = (x: number, y: number, z: number, g: number, w = 1, wk = 0) =>
  bodyTransform(
    x, y, z, 0.76,
    Math.sin(g - 0.25) * 0.065 * w + Math.sin(g) * 0.035 * wk,
    Math.sin(g * 2 - 0.45) * 0.048 * w + (0.06 + Math.sin(g * 2) * 0.04) * wk,
    Math.cos(g) * 0.05 * w + Math.cos(g) * 0.055 * wk,
    Math.cos(g) * 0.03 * w + Math.sin(g) * 0.018 * wk,
    (-Math.cos(g * 2) * 0.032 - Math.sin(g * 2) * 0.018) * w + (0.01 + Math.sin(g * 2) * 0.01) * wk,
    Math.sin(g * 2) * 0.024 * w + (0.015 + Math.sin(g * 2) * 0.015) * wk,
  );

function bipedLegPoint(x: number, y: number, z: number, px: number, py: number, pz: number, g: number, sub: number, w = 1, wk = 0, _organic = false): [number, number, number] {
  const tau = g + (px >= 0 ? 0 : Math.PI), s = Math.sin(tau), lift = Math.max(0, Math.cos(tau));
  const [bhx, bhy, bhz] = bipedBody(px, py, pz, g, w, wk);
  const dhx = bhx - px, dhy = bhy - py, dhz = bhz - pz;
  const hipAngle = s * 0.22 * w, ch = Math.cos(hipAngle), sh = Math.sin(hipAngle);
  if (sub === 0) {
    const ry = y - py, rz = z - pz;
    return [x + dhx, py + dhy + ry * ch - rz * sh, pz + dhz + ry * sh + rz * ch];
  }
  const ky0 = -0.3173 * py, shinAngle = hipAngle + lift * 0.52 * w, cs = Math.cos(shinAngle), ss = Math.sin(shinAngle);
  const kmy = py + dhy + ky0 * ch, kmz = pz + dhz + ky0 * sh;
  if (sub === 1) {
    const uy = y - (py + ky0), uz = z - pz;
    return [x + dhx, kmy + uy * cs - uz * ss, kmz + uy * ss + uz * cs];
  }
  const ay0 = -0.5769 * py;
  return [x + dhx, kmy + ay0 * cs + (y - (py + ky0 + ay0)), kmz + ay0 * ss + (z - pz)];
}

function spiderLegPoint(x: number, y: number, z: number, px: number, py: number, pz: number, g: number, sub: number, w = 1, wk = 0, organic = false): [number, number, number] {
  const sideSign = px >= 0 ? 1 : -1, tau = g + (px >= 0 ? 0 : Math.PI) + (organic ? (Math.abs(pz) > 0.1 ? Math.PI : 0) : pz * 4.9);
  const yaw = sideSign * Math.sin(tau) * 0.18 * w, cy = Math.cos(yaw), sy = Math.sin(yaw);
  const [bhx, bhy, bhz] = spiderBody(px, py, pz, g, w, wk);
  const dhx = bhx - px, dhy = bhy - py, dhz = bhz - pz;
  const stepLift = Math.pow(Math.max(0, Math.cos(tau)), 0.8) * 0.085 * w;
  const femAngle = (sideSign * (stepLift - dhy + 0.004 * w)) / Math.max(Math.abs(px), 0.25);
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

type MakePoseFn = (label: string, f: (x: number, y: number, z: number, o: number, t: Float32Array) => void) => void;

function addArmPoses(make: MakePoseFn, px: number, py: number, pz: number): void {
  const phase = px >= 0 ? Math.PI : 0, sideSign = px >= 0 ? 1 : -1;
  for (let k = 1; k < 16; k++) {
    const g = (k * Math.PI * 2) / 16, tau = g + phase, armAngle = Math.sin(tau) * 0.22;
    const ca = Math.cos(armAngle), sa = Math.sin(armAngle);
    make(`${Math.round((k * 360) / 16)}° of its arm swing`, (x, y, z, i, t) => {
      const ry = y - py, rz = z - pz;
      const [bx, by, bz] = bipedBody(x, py + ry * ca - rz * sa, pz + ry * sa + rz * ca, g, 1, 0);
      t[i] = bx; t[i + 1] = by; t[i + 2] = bz;
    });
  }
  for (let k = 0; k < 8; k++) {
    const g = (k * Math.PI * 2) / 8;
    const workAngle = -0.62 + Math.sin(g * 2 + phase * 0.5) * 0.26;
    const workYaw = sideSign * (-0.10 + Math.cos(g * 2 + phase * 0.5) * 0.08);
    const ca = Math.cos(workAngle), sa = Math.sin(workAngle), cy = Math.cos(workYaw), sy = Math.sin(workYaw);
    make(`${Math.round((k * 360) / 8)}° of its work sweep`, (x, y, z, i, t) => {
      const rx = x - px, ry = y - py, rz = z - pz;
      const ry1 = ry * ca - rz * sa, rz1 = ry * sa + rz * ca;
      const [bx, by, bz] = bipedBody(px + rx * cy - rz1 * sy, py + ry1, pz + rx * sy + rz1 * cy, g, 0, 1);
      t[i] = bx; t[i + 1] = by; t[i + 2] = bz;
    });
  }
}

function addBodyCarrierPoses(make: MakePoseFn, base: number, sub: number, px: number, py: number, pz: number): void {
  const fn = base === 8 ? bipedBody : spiderBody, name = base === 8 ? 'biped body step' : 'spider body step';
  for (let k = 1; k < 16; k++) {
    const g = (k * Math.PI * 2) / 16, c = Math.cos(g), s = Math.sin(g);
    make(`${Math.round((k * 360) / 16)}° of its ${name}`, (x, y, z, i, t) => {
      let tx = x, ty = y, tz = z;
      if (sub === 1) { const rx = x - px, rz = z - pz; tx = px + rx * c - rz * s; tz = pz + rx * s + rz * c; }
      else if (sub === 2) { ty += Math.sin(g + px * 3.1) * 0.025; }
      else if (sub === 3) { tz -= Math.pow(Math.max(Math.sin(g + px * 2.3), 0), 6) * 0.06; }
      [tx, ty, tz] = organicPose(tx, ty, tz, px, py, pz, g, sub, 0);
      const [bx, by, bz] = fn(tx, ty, tz, g, 1, 0);
      t[i] = bx; t[i + 1] = by; t[i + 2] = bz;
    });
  }
  for (let k = 0; k < 8; k++) {
    const g = (k * Math.PI * 2) / 8, c = Math.cos(g * 2), s = Math.sin(g * 2);
    make(`${Math.round((k * 360) / 8)}° of its ${base === 8 ? 'biped' : 'spider'} work effort`, (x, y, z, i, t) => {
      let tx = x, ty = y, tz = z;
      if (sub === 1) { const rx = x - px, rz = z - pz; tx = px + rx * c - rz * s; tz = pz + rx * s + rz * c; }
      else if (sub === 2) { ty += Math.sin(g + px * 3.1) * 0.025; }
      else if (sub === 3) { tz -= Math.pow(Math.max(Math.sin(g * 2 + px * 2.3), 0), 6) * 0.06; }
      [tx, ty, tz] = organicPose(tx, ty, tz, px, py, pz, g, sub, 1);
      const [bx, by, bz] = fn(tx, ty, tz, g, 0, 1);
      t[i] = bx; t[i + 1] = by; t[i + 2] = bz;
    });
  }
}

/** Mirrors ORGANIC_MOTION: jaws/feelers rotate; gland tissue has a bounded 1.8% strain. */
function organicPose(x: number, y: number, z: number, px: number, py: number, pz: number, g: number, sub: number, wk: number): [number, number, number] {
  const side = px >= 0 ? 1 : -1;
  if (sub === 4 || sub === 5) {
    const a = sub === 4 ? -side * (0.06 + 0.24 * wk * (0.5 + 0.5 * Math.sin(g * 2)))
      : side * (0.10 * Math.sin(g + px * 9) + 0.04 * Math.sin(g * 2));
    const rx = x - px, rz = z - pz;
    return [px + rx * Math.cos(a) - rz * Math.sin(a), y, pz + rx * Math.sin(a) + rz * Math.cos(a)];
  }
  if (sub === 6) {
    const pulse = 1 + 0.018 * Math.sin(g + px * 3.1);
    return [px + (x - px) * pulse, py + (y - py) * pulse, pz + (z - pz) * pulse];
  }
  return [x, y, z];
}

export function poses(p: PartDef): Pose[] {
  if (p.insectSpecies !== undefined) return insectPartPoses(p);
  const src = p.tris, out: Pose[] = [];
  const make: MakePoseFn = (label, f) => {
    const t = new Float32Array(src.length);
    for (let i = 0; i < src.length; i += 3) f(src[i], src[i + 1], src[i + 2], i, t);
    out.push({ label, tris: t });
  };
  const [px, py, pz] = p.pivot;
  const raw = Math.round(p.animType), sub = Math.floor(raw / 10), base = raw - sub * 10;
  if (raw === 60) {
    for (let k = 1; k < 16; k++) make(`gland pulse ${k}`, (x, y, z, i, t) => {
      const point = organicPose(x, y, z, px, py, pz, k * Math.PI * 2 / 16, 6, 0);
      t[i] = point[0]; t[i + 1] = point[1]; t[i + 2] = point[2];
    });
  } else if (base === 1 && sub === 0) {
    for (let k = 1; k < 24; k++) {
      const a = (k * Math.PI * 2) / 24, c = Math.cos(a), s = Math.sin(a);
      make(`${k * 15}° of its spin`, (x, y, z, i, t) => { const rx = x - px, rz = z - pz; t[i] = px + rx * c - rz * s; t[i + 1] = y; t[i + 2] = pz + rx * s + rz * c; });
    }
  } else if (base === 2 && sub === 0) {
    for (const dy of [-0.05, -0.025, 0.025, 0.05]) make(`${dy > 0 ? '+' : ''}${(dy * 100).toFixed(1)} cm bob`, (x, y, z, i, t) => { t[i] = x; t[i + 1] = y + dy; t[i + 2] = z; });
  } else if (base === 3 && sub === 0) {
    for (const dz of [-0.015, -0.03, -0.045, -0.06]) make(`${(dz * 100).toFixed(1)} cm recoil`, (x, y, z, i, t) => { t[i] = x; t[i + 1] = y; t[i + 2] = z + dz; });
  } else if (base === 4 || base === 6) {
    const fn = base === 4 ? bipedLegPoint : spiderLegPoint, label = base === 4 ? 'biped' : 'spider';
    for (let k = 1; k < 16; k++) {
      const g = (k * Math.PI * 2) / 16;
      make(`${Math.round((k * 360) / 16)}° of its ${label} gait`, (x, y, z, i, t) => {
        const [tx, ty, tz] = fn(x, y, z, px, py, pz, g, sub, 1, 0, (p.tissue ?? 0) > 0);
        t[i] = tx; t[i + 1] = ty; t[i + 2] = tz;
      });
    }
    for (let k = 0; k < 8; k++) {
      const g = (k * Math.PI * 2) / 8;
      make(`${Math.round((k * 360) / 8)}° of its ${label} work stance`, (x, y, z, i, t) => {
        const [tx, ty, tz] = fn(x, y, z, px, py, pz, g, sub, 0, 1, (p.tissue ?? 0) > 0);
        t[i] = tx; t[i + 1] = ty; t[i + 2] = tz;
      });
    }
  } else if (base === 5) {
    addArmPoses(make, px, py, pz);
  } else if (base === 7) {
    for (let k = 1; k < 16; k++) {
      const wa = (k * Math.PI * 2) / 16, cw = Math.cos(wa), sw = Math.sin(wa);
      make(`${Math.round((k * 360) / 16)}° of its wheel roll`, (x, y, z, i, t) => {
        const wy = y - py, wz = z - pz;
        t[i] = x; t[i + 1] = py + wy * cw - wz * sw; t[i + 2] = pz + wy * sw + wz * cw;
      });
    }
  } else if (base === 8 || base === 9) {
    addBodyCarrierPoses(make, base, sub, px, py, pz);
  }
  return out;
}

