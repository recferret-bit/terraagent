import * as THREE from 'three';
import { rbox, cyl, sph, strut, sag, cable, mirror, rockGeo, rng, lathe, type V3 } from '../../greebles/unitParts';
import { register } from './common';

// ---------------------------------------------------------------------------
// fauna.skitter — small six-legged scuttler (~0.5 m)
// ---------------------------------------------------------------------------
register({
  id: 'fauna.skitter',
  label: 'Skitter',
  category: 'fauna',
  footprint: [1, 1],
  notes: 'Six-legged alien beetle, glowing eye stalks, shell plates, whip antennae, tail bulb.',
  build: (b) => {
    b.addPart(new THREE.CapsuleGeometry(0.17, 0.3, 6, 12), 'hullSecondary', { position: [0, 0.3, 0], rotation: [Math.PI / 2, 0, 0], scale: [1.15, 1, 0.8] });
    b.addPart(sph(0.19, 14, 10), 'terraformEmerald', { position: [0, 0.34, -0.17], scale: [1.0, 0.7, 1.2], emissiveIntensity: 3.2 });
    for (let i = 0; i < 3; i++) {
      b.addPart(rbox(0.3 - i * 0.03, 0.06, 0.14, 0.02), 'hullPrimary', { position: [0, 0.43 - i * 0.015, -0.12 + i * 0.12], rotation: [0.1 - i * 0.1, 0, 0] });
    }
    b.addPart(sph(0.1), 'frameGunmetal', { position: [0, 0.3, 0.3] });
    mirror((s) => {
      b.addPart(sph(0.035), 'energyCyan', { position: [0.09 * s, 0.39, 0.35], emissiveIntensity: 4.2 });
      strut(b, [0.04 * s, 0.32, 0.31], [0.09 * s, 0.39, 0.35], 0.015, 'frameGunmetal');
      [-0.12, 0.05, 0.2].forEach((z, i) => {
        const hip: V3 = [0.13 * s, 0.27, z];
        const knee: V3 = [0.3 * s, 0.4, z + (i - 1) * 0.05];
        const foot: V3 = [0.42 * s, 0.0, z + (i - 1) * 0.12];
        strut(b, hip, knee, 0.02, 'frameGunmetal');
        strut(b, knee, foot, 0.014, 'hullSecondary', {}, 0.02);
      });
      cable(b, [[0.05 * s, 0.33, 0.33], [0.2 * s, 0.55, 0.5], [0.3 * s, 0.5, 0.7]] as V3[], 0.008, 'frameGunmetal', { name: 'whip antenna' });
    });
    b.addPart(sph(0.07), 'terraformEmerald', { position: [0, 0.34, -0.37], emissiveIntensity: 3.4 });
  },
});

// ---------------------------------------------------------------------------
// fauna.drifter — large floating jelly-manta (~1.8 m), bobbing
// ---------------------------------------------------------------------------
register({
  id: 'fauna.drifter',
  label: 'Drifter',
  category: 'fauna',
  footprint: [2, 2],
  notes: 'Floating grazer: bell dome, glowing spots, trailing tendrils that touch ground, side fins; body bobs (animType 2).',
  build: (b) => {
    const bob = { animType: 2 as const, animPivot: [0, 1.2, 0] as V3 };
    // Grounded bio-anchor pad & central oral stalk
    b.addPart(cyl(0.24, 0.3, 0.12, 10), 'frameGunmetal', { position: [0, 0.06, 0] });
    b.addPart(cyl(0.04, 0.04, 1.02, 8), 'terraformEmerald', { position: [0, 0.51, 0], emissiveIntensity: 3.2 });
    // Bobbing bell assembly (closed watertight dome + collar)
    b.addPart(rbox(0.2, 0.44, 0.2, 0.04), 'frameGunmetal', { position: [0, 1.02, 0], ...bob });
    b.addPart(sph(0.8, 16, 10), 'hullSecondary', { position: [0, 1.36, 0], scale: [1, 0.42, 1.15], ...bob });
    b.addPart(cyl(0.82, 0.72, 0.14, 16), 'hullPrimary', { position: [0, 1.25, 0], scale: [1, 1, 1.15], ...bob });
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * Math.PI * 2;
      b.addPart(sph(0.08, 8, 6), 'terraformEmerald', {
        position: [Math.cos(a) * 0.48, 1.61, Math.sin(a) * 0.55],
        emissiveIntensity: 3.5,
        ...bob,
      });
    }
    b.addPart(sph(0.15, 10, 8), 'energyCyan', { position: [0, 1.66, 0.0], emissiveIntensity: 4, ...bob });
    // Side fins + dorsal fin ridges
    mirror((s) => {
      b.addPart(rbox(0.85, 0.06, 0.56, 0.02), 'hullPrimary', { position: [0.78 * s, 1.24, 0], rotation: [0, 0.25 * s, -0.3 * s], ...bob });
      b.addPart(rbox(0.55, 0.05, 0.18, 0.02), 'hullSecondary', { position: [0.82 * s, 1.27, 0], rotation: [0, 0.25 * s, -0.3 * s], ...bob });
    });
    // Trailing tendrils moving with the bell
    const r = rng(11);
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2 + 0.3;
      const x = Math.cos(a) * 0.48, z = Math.sin(a) * 0.52;
      cable(
        b,
        [[x, 1.22, z], [x * 1.25 + r() * 0.08, 0.75, z * 1.25], [x * 1.55, 0.4, z * 1.55 + 0.08], [x * 1.75, 0.14, z * 1.75]] as V3[],
        0.025,
        i % 2 ? 'terraformEmerald' : 'frameGunmetal',
        { name: 'drifter tendril', ...(i % 2 ? { emissiveIntensity: 3.2 } : {}), ...bob },
      );
    }
  },
});

// ---------------------------------------------------------------------------
// Resource deposits
// ---------------------------------------------------------------------------
register({
  id: 'resource.metalDeposit',
  label: 'Metal Deposit',
  category: 'resource',
  footprint: [2, 2],
  notes: 'Rock cluster with exposed metallic ore veins and amber-lit nuggets.',
  build: (b) => {
    b.addPart(rockGeo(0.7, 3, 0.78), 'hullPrimary', { position: [0, 0.42, 0] });
    b.addPart(rockGeo(0.34, 5, 0.82), 'hullSecondary', { position: [0.58, 0.24, 0.26] });
    b.addPart(rockGeo(0.32, 8, 0.82), 'frameGunmetal', { position: [-0.52, 0.22, 0.34] });
    b.addPart(rockGeo(0.24, 12, 0.82), 'hullSecondary', { position: [-0.15, 0.2, -0.54] });
    b.addPart(rbox(0.3, 0.82, 0.3, 0.06), 'frameGunmetal', { position: [0.14, 0.78, 0.08], rotation: [0.2, 0.5, 0.3] });
    b.addPart(rbox(0.24, 0.58, 0.24, 0.05), 'hullSecondary', { position: [-0.26, 0.68, 0.16], rotation: [-0.3, 0.2, -0.4] });
    b.addPart(rbox(0.46, 0.16, 0.22, 0.04), 'hullPrimary', { position: [0.42, 0.48, 0.2], rotation: [0, 0.7, 0.4] });
    const nuggets: V3[] = [
      [0.78, 0.36, 0.28],
      [0.32, 0.72, -0.34],
      [-0.68, 0.32, 0.42],
      [-0.18, 0.32, -0.62],
    ];
    nuggets.forEach((pos, i) => {
      b.addPart(rockGeo(0.11, 20 + i, 1, 0), 'warningAmber', { position: pos, emissiveIntensity: 3.2 });
    });
  },
});

register({
  id: 'resource.crystalDeposit',
  label: 'Crystal Deposit',
  category: 'resource',
  footprint: [2, 2],
  notes: 'Glowing cyan crystal spires erupting from a rock bed.',
  build: (b) => {
    b.addPart(rockGeo(0.64, 31, 0.48), 'hullPrimary', { position: [0, 0.18, 0] });
    b.addPart(rockGeo(0.33, 33, 0.58), 'frameGunmetal', { position: [0.54, 0.14, 0.18] });
    b.addPart(rockGeo(0.31, 35, 0.58), 'hullSecondary', { position: [-0.46, 0.14, -0.2] });
    const r = rng(77);
    const spires: [number, number, number, number][] = [
      [0, 0, 1.45, 0.17], [0.26, 0.14, 1.05, 0.13], [-0.26, 0.1, 0.92, 0.12], [0.12, -0.26, 0.82, 0.1], [-0.14, 0.26, 0.76, 0.095], [0.52, 0.18, 0.72, 0.09],
    ];
    spires.forEach(([x, z, h, rad], i) => {
      const lean = (r() - 0.5) * 0.22;
      b.addPart(cyl(0.0, rad * 0.9, h * 0.42, 6), 'energyCyan', { position: [x, 0.18 + h * 0.78, z], rotation: [lean, 0, lean * 0.6], emissiveIntensity: i === 0 ? 4.2 : 3.4 });
      b.addPart(cyl(rad * 0.9, rad, h * 0.66, 6), 'energyCyan', { position: [x, 0.18 + h * 0.33, z], rotation: [lean, 0, lean * 0.6], emissiveIntensity: 3.0 });
    });
    const shards: V3[] = [
      [0.44, 0.38, -0.18],
      [-0.38, 0.38, 0.26],
      [0.74, 0.26, 0.24],
      [-0.64, 0.24, -0.26],
      [0.16, 0.42, 0.42],
    ];
    shards.forEach((pos) => {
      b.addPart(new THREE.OctahedronGeometry(0.11, 0), 'energyCyan', { position: pos, emissiveIntensity: 3.2 });
    });
  },
});

register({
  id: 'resource.oilDeposit',
  label: 'Oil Deposit',
  category: 'resource',
  footprint: [2, 2],
  notes: 'Dark viscous pool in a rock ring with seep bubbles, rusty pump jack stub and amber marker.',
  build: (b) => {
    b.addPart(lathe([[0, 0.0], [0.98, 0.0], [1.05, 0.11], [0, 0.11]], 20), 'hullPrimary', { position: [0, 0, 0] }); // base
    b.addPart(cyl(0.86, 0.86, 0.07, 20), 'glassVisor', { position: [0, 0.12, 0] }); // pool
    b.addPart(cyl(0.48, 0.48, 0.03, 16), 'dangerCrimson', { position: [-0.15, 0.155, 0.1], emissiveIntensity: 3.0 }); // iridescent sheen
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2 + 0.38;
      const zone = i % 2 === 0 ? 'hullSecondary' : 'frameGunmetal';
      b.addPart(rockGeo(0.18 + (i % 2) * 0.03, 40 + i, 0.75), zone, { position: [Math.cos(a) * 0.94, 0.14, Math.sin(a) * 0.94] });
    }
    b.addPart(sph(0.12, 10, 6), 'hullSecondary', { position: [0.3, 0.15, -0.2], scale: [1, 0.6, 1] });
    b.addPart(sph(0.09, 10, 6), 'hullSecondary', { position: [-0.35, 0.15, -0.3], scale: [1, 0.6, 1] });
    // Wellhead cap in pool + Pump jack stub on rim
    b.addPart(cyl(0.14, 0.18, 0.22, 8), 'frameGunmetal', { position: [0, 0.2, -0.45] });
    b.addPart(rbox(0.5, 0.16, 0.44, 0.04), 'frameGunmetal', { position: [0, 0.14, -1.02] });
    strut(b, [0, 0.16, -1.02], [0, 1.0, -1.02], 0.055, 'hullPrimary');
    b.addPart(rbox(0.14, 0.14, 0.86, 0.03), 'hullSecondary', { position: [0, 1.02, -0.95], rotation: [-0.2, 0, 0] });
    b.addPart(sph(0.07), 'warningAmber', { position: [0, 1.1, -0.56], emissiveIntensity: 4, animType: 3, animPivot: [0, 1.1, -0.56] });
    sag(b, [0.0, 0.82, -1.0], [0.0, 0.26, -0.48], 0.08, 0.025);
  },
});
