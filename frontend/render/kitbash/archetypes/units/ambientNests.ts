import type { KitbashBuilder } from '../../KitbashRegistry';
import { rbox, cyl, sph, strut, cable, lathe, type V3 } from '../../greebles/unitParts';
import { register } from './common';

const DOME_AT: V3 = [0.02, 0, -0.10];
/** Profile radii of the chitin dome, bottom to crown. */
const DOME_RINGS: Array<[number, number]> = [[0, 0.30], [0.08, 0.78], [0.18, 0.96], [0.32, 0.74], [0.42, 0.32], [0.46, 0.05]];

/** Point on the dome. Positive `inset` is inside the shell, negative stands proud of it. */
function domePoint(y: number, ang: number, inset: number): V3 {
  let radius = DOME_RINGS[DOME_RINGS.length - 1][1];
  for (let i = 1; i < DOME_RINGS.length; i++) {
    const [y0, r0] = DOME_RINGS[i - 1];
    const [y1, r1] = DOME_RINGS[i];
    if (y <= y1) {
      radius = r0 + (r1 - r0) * ((y - y0) / (y1 - y0));
      break;
    }
  }
  const rad = Math.max(0.02, radius - inset);
  return [DOME_AT[0] + Math.cos(ang) * rad, y, DOME_AT[2] + Math.sin(ang) * rad];
}

// ---------------------------------------------------------------------------
// fauna.nest.skitter — low single-throat burrow for the 0.5 m skitter
// ---------------------------------------------------------------------------

/** Low heap: narrow ground foot, wide belly, so flank ribs can leave the soil. */
function addSkitterHeap(b: KitbashBuilder): void {
  b.addPart(
    lathe([
      [0.05, 0.0], [0.30, 0.0], [0.78, 0.08], [0.96, 0.18],
      [0.74, 0.32], [0.32, 0.42], [0.05, 0.46],
    ], 12),
    'hullPrimary',
    { name: 'chitin dome', position: DOME_AT },
  );
  b.addPart(sph(0.38, 10, 8), 'frameGunmetal', {
    name: 'spoil lobe', position: [-0.78, 0.20, -0.36], scale: [1.25, 0.52, 1.05],
  });
  // Struts run from inside the shell to outside it, so each rib crosses the chitin.
  const ribs: Array<[number, number]> = [[0.20, 0.7], [0.16, 2.3], [0.24, -0.9]];
  ribs.forEach(([y, ang], i) => {
    strut(b, domePoint(y, ang, 0.08), domePoint(y + 0.03, ang, -0.07), 0.026, 'hullSecondary', {
      name: `dorsal ridge ${i + 1}`,
    });
  });
}

function addSkitterMouth(b: KitbashBuilder): void {
  b.addPart(cyl(0.15, 0.17, 0.42, 10), 'frameGunmetal', {
    name: 'burrow throat', position: [0.10, 0.17, 0.62], rotation: [Math.PI / 2, 0, 0],
  });
  const lips: Array<{ pos: V3; size: V3; rot: V3; zone: 'hullSecondary' | 'frameGunmetal' }> = [
    { pos: [0.10, 0.34, 0.74], size: [0.42, 0.06, 0.16], rot: [-0.42, 0.04, 0], zone: 'hullSecondary' },
    { pos: [0.10, 0.27, 0.70], size: [0.30, 0.045, 0.10], rot: [-0.25, 0, 0], zone: 'frameGunmetal' },
    { pos: [-0.12, 0.17, 0.76], size: [0.07, 0.24, 0.14], rot: [0, 0.15, 0.12], zone: 'hullSecondary' },
    { pos: [0.32, 0.17, 0.74], size: [0.07, 0.22, 0.14], rot: [0, -0.12, -0.1], zone: 'hullSecondary' },
    { pos: [0.10, 0.055, 0.72], size: [0.34, 0.05, 0.16], rot: [0.2, 0, 0], zone: 'hullSecondary' },
  ];
  lips.forEach((lip, i) => {
    b.addPart(rbox(lip.size[0], lip.size[1], lip.size[2], 0.015, 1), lip.zone, {
      name: `lip rib ${i + 1}`, position: lip.pos, rotation: lip.rot,
    });
  });
  b.addPart(sph(0.045, 8, 6), 'warningAmber', {
    name: 'amber mote', position: [0.10, 0.38, 0.80], emissiveIntensity: 3.8,
  });
}

function addSkitterBreakers(b: KitbashBuilder): void {
  const whips: V3[][] = [
    [[0.18, 0.36, 0.02], [0.42, 0.74, 0.22], [0.58, 0.58, 0.48]],
    [[-0.16, 0.34, -0.02], [-0.46, 0.70, 0.16], [-0.30, 0.52, 0.46]],
  ];
  whips.forEach((pts, i) => {
    cable(b, pts as V3[], 0.013, 'frameGunmetal', { name: `burrow whip ${i + 1}`, role: 'whip' });
  });
  const nodules: V3[] = [[0.36, 0.36, 0.08], [-0.08, 0.40, -0.22], domePoint(0.22, 1.35, 0.02)];
  nodules.forEach((p, i) => {
    b.addPart(sph(0.065, 8, 6), 'terraformEmerald', {
      name: `belly nodule ${i + 1}`, position: p, emissiveIntensity: 3.6,
    });
  });
  b.addPart(rbox(0.07, 0.30, 0.08, 0.02, 1), 'hullSecondary', {
    name: 'crest horn', position: [0.40, 0.50, -0.28], rotation: [0.7, 0.35, -0.45],
  });
  const toes: Array<[V3, V3]> = [
    [[0.92, 0.06, 0.18], [0.48, 0.24, 0.06]],
    [[0.70, 0.05, -0.62], [0.28, 0.26, -0.28]],
    [[-0.55, 0.06, 0.55], [-0.16, 0.22, 0.22]],
    [[-1.05, 0.08, -0.15], [-0.62, 0.24, -0.28]],
  ];
  toes.forEach(([a, c], i) => {
    strut(b, a, c, 0.032, 'frameGunmetal', { name: `root rib ${i + 1}` }, 0.02);
  });
  b.addPart(sph(0.07, 8, 6), 'terraformEmerald', {
    name: 'spoil nodule', position: [-0.78, 0.43, -0.36], emissiveIntensity: 3.4,
  });
}

register({
  id: 'fauna.nest.skitter',
  label: 'Skitter Burrow',
  category: 'fauna',
  footprint: [2, 2],
  notes:
    'Low single-throat burrow for the six-legged skitter: chitin dome, dark mouth with ribbed lips, whip feelers and emerald nodules. Not a multi-tunnel ant mound.',
  build: (b) => {
    addSkitterHeap(b);
    addSkitterMouth(b);
    addSkitterBreakers(b);
  },
});

// ---------------------------------------------------------------------------
// fauna.nest.drifter — ground ring the floater hovers over; mast stops ~1.1 m
// ---------------------------------------------------------------------------

/** Torus cross-section revolved around Y, lowest vertex exactly on y = 0. */
function cradleProfile(R: number, r: number, n = 8): [number, number][] {
  const pts: [number, number][] = [];
  for (let i = 0; i <= n; i++) {
    const t = (i / n) * Math.PI * 2;
    pts.push([R + r * Math.cos(t), r + r * Math.sin(t)]);
  }
  return pts;
}

function addDrifterCradle(b: KitbashBuilder): void {
  const R = 0.78;
  const tube = 0.12;
  b.addPart(lathe(cradleProfile(R, tube), 14), 'hullPrimary', { name: 'cradle ring', position: [0, 0, 0] });
  b.addPart(cyl(0.16, 0.22, 0.18, 10), 'frameGunmetal', { name: 'perch socket', position: [0, 0.09, 0] });
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + 0.35;
    const c = Math.cos(a);
    const s = Math.sin(a);
    strut(b, [c * 0.12, tube, s * 0.12], [c * R, tube, s * R], 0.032, 'frameGunmetal', {
      name: `cradle spoke ${i + 1}`,
    });
  }
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2 + 0.12;
    b.addPart(sph(0.09, 8, 6), 'terraformEmerald', {
      name: `spore pod ${i + 1}`,
      position: [Math.cos(a) * R, tube + 0.05, Math.sin(a) * R],
      emissiveIntensity: 3.6,
    });
  }
}

function addDrifterMast(b: KitbashBuilder): void {
  const R = 0.78;
  const tube = 0.12;
  b.addPart(cyl(0.055, 0.07, 0.86, 8), 'frameGunmetal', { name: 'perch mast', position: [0, 0.52, 0] });
  b.addPart(cyl(0.22, 0.08, 0.16, 10), 'hullSecondary', { name: 'perch cup', position: [0, 0.96, 0] });
  b.addPart(sph(0.07, 8, 6), 'terraformEmerald', {
    name: 'cup spore', position: [0, 1.08, 0], emissiveIntensity: 4.0,
  });
  b.addPart(cyl(0.09, 0.09, 0.05, 8), 'hullSecondary', { name: 'mast band', position: [0, 0.62, 0] });
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2 + 0.12 + Math.PI / 5;
    b.addPart(sph(0.075, 7, 5), 'hullSecondary', {
      name: `cradle bead ${i + 1}`,
      position: [Math.cos(a) * R, tube + 0.10, Math.sin(a) * R],
    });
  }
  for (const side of [1, -1] as const) {
    const a = side * 1.15;
    const c = Math.cos(a);
    const s = Math.sin(a);
    const tip: V3 = [c * 1.02, 0.46, s * 1.02];
    strut(b, [c * R, tube + 0.04, s * R], tip, 0.028, 'frameGunmetal', { name: `cradle peg ${side === 1 ? 'a' : 'b'}` });
    b.addPart(sph(0.05, 7, 5), 'hullSecondary', { name: `peg cap ${side === 1 ? 'a' : 'b'}`, position: tip });
  }
}

register({
  id: 'fauna.nest.drifter',
  label: 'Drifter Perch',
  category: 'fauna',
  footprint: [2, 2],
  notes:
    'Ground ring cradle a flying drifter hovers over: radial spokes, central mast and cup stopping near 1.1 m, emerald spore pods. No wings.',
  build: (b) => {
    addDrifterCradle(b);
    addDrifterMast(b);
  },
});
