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
    b.addPart(sph(0.19, 14, 10), 'terraformEmerald', { position: [0, 0.34, -0.17], scale: [1.0, 0.7, 1.2], emissiveIntensity: 0.0 });
    for (let i = 0; i < 3; i++) {
      b.addPart(rbox(0.3 - i * 0.03, 0.05, 0.14, 0.02), 'hullPrimary', { position: [0, 0.5 - i * 0.012, -0.12 + i * 0.12], rotation: [0.1 - i * 0.1, 0, 0] });
    }
    b.addPart(sph(0.1), 'frameGunmetal', { position: [0, 0.3, 0.3] });
    mirror((s) => {
      b.addPart(sph(0.035), 'energyCyan', { position: [0.07 * s, 0.4, 0.37], emissiveIntensity: 4.2 });
      strut(b, [0.05 * s, 0.34, 0.33], [0.1 * s, 0.4, 0.36], 0.012, 'frameGunmetal');
      [-0.12, 0.05, 0.2].forEach((z, i) => {
        const hip: V3 = [0.13 * s, 0.27, z];
        const knee: V3 = [0.3 * s, 0.4, z + (i - 1) * 0.05];
        const foot: V3 = [0.42 * s, 0.0, z + (i - 1) * 0.12];
        strut(b, hip, knee, 0.02, 'frameGunmetal');
        strut(b, knee, foot, 0.012, 'hullSecondary', {}, 0.02);
      });
      cable(b, [[0.06 * s, 0.34, 0.36], [0.2 * s, 0.55, 0.5], [0.3 * s, 0.5, 0.7]] as V3[], 0.008, 'frameGunmetal');
    });
    b.addPart(sph(0.07), 'terraformEmerald', { position: [0, 0.38, -0.5], emissiveIntensity: 3.4, animType: 3, animPivot: [0, 0.38, -0.5] });
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
    b.addPart(new THREE.SphereGeometry(0.8, 20, 12, 0, Math.PI * 2, 0, Math.PI / 2), 'hullSecondary', { position: [0, 1.2, 0], scale: [1, 0.8, 1.15], ...bob });
    b.addPart(cyl(0.82, 0.7, 0.1, 20), 'hullPrimary', { position: [0, 1.17, 0], scale: [1, 1, 1.15], ...bob });
    b.addPart(sph(0.34, 12, 8), 'frameGunmetal', { position: [0, 1.0, 0.05], scale: [1, 0.7, 1], ...bob });
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * Math.PI * 2;
      b.addPart(sph(0.07), 'terraformEmerald', { position: [Math.cos(a) * 0.55, 1.5 - 0.1 * Math.abs(Math.sin(a * 2)), Math.sin(a) * 0.63], emissiveIntensity: 3.5, ...bob });
    }
    b.addPart(sph(0.14), 'energyCyan', { position: [0, 1.62, 0.1], emissiveIntensity: 4, ...bob });
    // Fins
    mirror((s) => {
      b.addPart(rbox(0.9, 0.05, 0.6, 0.02), 'hullSecondary', { position: [0.95 * s, 1.25, 0], rotation: [0, 0.3 * s, -0.35 * s], ...bob });
    });
    // Tendrils: ground-touching at y=0 (static tips), plus bobbing upper part.
    const r = rng(11);
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2 + 0.3;
      const x = Math.cos(a) * 0.5, z = Math.sin(a) * 0.55;
      cable(b, [[x, 1.1, z], [x * 1.3 + r() * 0.1, 0.65, z * 1.3], [x * 1.9, 0.3, z * 1.9 + 0.1], [x * 2.2, 0.0, z * 2.2]] as V3[], 0.03, i % 2 ? 'terraformEmerald' : 'frameGunmetal', i % 2 ? { emissiveIntensity: 3.2 } : {});
    }
    sag(b, [0.2, 1.05, 0.3], [0.45, 0.7, 0.9], 0.2, 0.045, 'hullPrimary');
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
    b.addPart(rockGeo(0.75, 3, 0.8), 'frameGunmetal', { position: [0, 0.5, 0] });
    b.addPart(rockGeo(0.5, 5, 0.9), 'frameGunmetal', { position: [0.7, 0.3, 0.3] });
    b.addPart(rockGeo(0.4, 8, 0.9), 'frameGunmetal', { position: [-0.6, 0.25, 0.45] });
    b.addPart(rockGeo(0.3, 12), 'frameGunmetal', { position: [-0.15, 0.2, -0.75] });
    b.addPart(rbox(0.3, 0.9, 0.3, 0.06), 'hullPrimary', { position: [0.15, 1.0, 0.1], rotation: [0.2, 0.5, 0.3] });
    b.addPart(rbox(0.22, 0.6, 0.22, 0.05), 'hullPrimary', { position: [-0.3, 0.9, 0.2], rotation: [-0.3, 0.2, -0.4] });
    b.addPart(rbox(0.5, 0.12, 0.2, 0.04), 'hullSecondary', { position: [0.5, 0.75, 0.2], rotation: [0, 0.7, 0.4] });
    for (let i = 0; i < 4; i++) {
      b.addPart(rockGeo(0.09, 20 + i, 1, 0), 'warningAmber', { position: [0.8 - i * 0.45, 0.07, 0.9 - i * 0.25], emissiveIntensity: 3.0 });
    }
  },
});

register({
  id: 'resource.crystalDeposit',
  label: 'Crystal Deposit',
  category: 'resource',
  footprint: [2, 2],
  notes: 'Glowing cyan crystal spires erupting from a rock bed.',
  build: (b) => {
    b.addPart(rockGeo(0.7, 31, 0.5), 'frameGunmetal', { position: [0, 0.2, 0] });
    b.addPart(rockGeo(0.35, 33, 0.6), 'frameGunmetal', { position: [0.7, 0.12, 0.2] });
    const r = rng(77);
    const spires: [number, number, number, number][] = [
      [0, 0, 1.5, 0.17], [0.3, 0.15, 1.05, 0.13], [-0.3, 0.1, 0.9, 0.12], [0.12, -0.3, 0.7, 0.1], [-0.15, 0.3, 0.6, 0.09], [0.6, 0.25, 0.5, 0.08],
    ];
    spires.forEach(([x, z, h, rad], i) => {
      const lean = (r() - 0.5) * 0.5;
      b.addPart(cyl(0.0, rad, h * 0.3, 6), 'energyCyan', { position: [x, h * 0.85 + 0.12, z], rotation: [lean, 0, lean * 0.6], emissiveIntensity: i === 0 ? 4.2 : 3.4 });
      b.addPart(cyl(rad, rad * 0.9, h * 0.7, 6), 'energyCyan', { position: [x, h * 0.35 + 0.1, z], rotation: [lean, 0, lean * 0.6], emissiveIntensity: 3.0 });
    });
    for (let i = 0; i < 5; i++) {
      b.addPart(new THREE.OctahedronGeometry(0.07, 0), 'energyCyan', { position: [(r() - 0.5) * 1.8, 0.07, (r() - 0.5) * 1.8], emissiveIntensity: 3.2 });
    }
  },
});

register({
  id: 'resource.oilDeposit',
  label: 'Oil Deposit',
  category: 'resource',
  footprint: [2, 2],
  notes: 'Dark viscous pool in a rock ring with seep bubbles, rusty pump jack stub and amber marker.',
  build: (b) => {
    b.addPart(lathe([[0, 0.0], [0.95, 0.0], [1.0, 0.1], [0, 0.1]], 24), 'frameGunmetal', { position: [0, 0, 0] }); // base
    b.addPart(cyl(0.88, 0.88, 0.07, 24), 'glassVisor', { position: [0, 0.12, 0] }); // pool
    b.addPart(cyl(0.5, 0.5, 0.02, 20), 'dangerCrimson', { position: [-0.15, 0.16, 0.1], emissiveIntensity: 3.0 }); // iridescent sheen
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * Math.PI * 2;
      b.addPart(rockGeo(0.2 + (i % 3) * 0.05, 40 + i, 0.7), 'frameGunmetal', { position: [Math.cos(a) * 1.0, 0.14, Math.sin(a) * 1.0] });
    }
    b.addPart(sph(0.12, 10, 6), 'glassVisor', { position: [0.3, 0.14, -0.2], scale: [1, 0.6, 1] });
    b.addPart(sph(0.08, 10, 6), 'glassVisor', { position: [-0.35, 0.14, -0.3], scale: [1, 0.6, 1] });
    // Pump jack stub
    b.addPart(rbox(0.5, 0.12, 0.4, 0.04), 'frameGunmetal', { position: [0, 0.2, -1.15] });
    strut(b, [0, 0.2, -1.15], [0, 1.0, -1.15], 0.05, 'hullSecondary');
    b.addPart(rbox(0.1, 0.12, 0.9, 0.03), 'hullSecondary', { position: [0, 1.05, -1.15], rotation: [0.25, 0, 0], animType: 3, animPivot: [0, 1.05, -1.15] });
    b.addPart(sph(0.06), 'warningAmber', { position: [0, 1.15, -0.8], emissiveIntensity: 4, animType: 3, animPivot: [0, 1.05, -1.15] });
    sag(b, [0.0, 0.95, -1.4], [0.2, 0.15, -0.5], 0.15, 0.03);
  },
});
