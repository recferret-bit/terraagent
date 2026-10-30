import * as THREE from 'three';
import { KitbashBuilder } from '../../KitbashRegistry';
import { rbox, cyl, sph, strut, sag, mirror, lathe, type V3 } from '../../greebles/unitParts';
import { register } from './common';

const dish = (b: KitbashBuilder, pos: V3, r: number, tilt = -0.6) => {
  b.addPart(cyl(r * 0.12, r * 0.15, r * 1.0, 8), 'frameGunmetal', { position: [pos[0], pos[1] - r * 0.5, pos[2]] });
  b.addPart(lathe([[0, 0], [r * 0.4, r * 0.08], [r * 0.8, r * 0.3], [r, r * 0.42], [0, r * 0.12]], 18), 'hullPrimary', {
    position: pos, rotation: [tilt, 0, 0], animType: 1, animPivot: pos,
  });
  b.addPart(sph(r * 0.1), 'energyCyan', { position: [pos[0], pos[1] + r * 0.45, pos[2] + r * 0.3], emissiveIntensity: 4, animType: 1, animPivot: pos });
};

// ---------------------------------------------------------------------------
// ship.carrier — ~52 m long, local origin at hull centre, nose = +Z, belly = -Y.
// ---------------------------------------------------------------------------
register({
  id: 'ship.carrier',
  label: 'Orbital Carrier',
  category: 'ship',
  footprint: [8, 20],
  snap: false,
  notes: '52m mothership: nose cone, bridge tower, belly drop-bay with pods, 4 engines, solar wings, rotating dishes.',
  build: (b) => {
    // --- Main hull ---
    b.addPart(rbox(9, 6.4, 34, 1.6), 'hullPrimary', { position: [0, 0, -2] });
    b.addPart(rbox(9.4, 1.0, 34.4, 0.4), 'frameGunmetal', { position: [0, -1.9, -2] }); // keel plating
    // Nose cone
    b.addPart(lathe([[0, 0], [4.2, 0], [3.7, 4], [2.4, 8], [1.0, 10.5], [0, 11.5]], 24), 'hullPrimary', {
      position: [0, 0, 14], rotation: [Math.PI / 2, 0, 0], scale: [1.07, 1, 0.78],
    });
    b.addPart(rbox(4, 0.5, 6, 0.2), 'hullSecondary', { position: [0, 2.6, 18], rotation: [0.28, 0, 0] }); // nose stripe
    // Hazard bands
    [-12, -4, 4].forEach((z) => b.addPart(rbox(9.6, 6.8, 1.0, 0.4), 'hullSecondary', { position: [0, 0, z] }));
    // Engine block
    b.addPart(rbox(10.4, 7.2, 8, 1.2), 'frameGunmetal', { position: [0, 0, -22] });
    [[-2.6, 1.6], [2.6, 1.6], [-2.6, -1.6], [2.6, -1.6]].forEach(([x, y]) => {
      b.addPart(cyl(1.5, 1.1, 3, 14), 'frameGunmetal', { position: [x, y, -27], rotation: [Math.PI / 2, 0, 0] });
      b.addPart(cyl(1.15, 1.15, 0.4, 14), 'energyCyan', { position: [x, y, -28.5], rotation: [Math.PI / 2, 0, 0], emissiveIntensity: 4.5, animType: 3, animPivot: [x, y, -28.5] });
      b.addPart(cyl(1.7, 1.7, 0.5, 14), 'hullSecondary', { position: [x, y, -25.6], rotation: [Math.PI / 2, 0, 0] });
    });

    // --- Bridge tower ---
    b.addPart(rbox(5, 3, 7, 0.9), 'hullPrimary', { position: [0, 4.5, 8] });
    b.addPart(rbox(4.2, 1.1, 0.5, 0.2), 'glassVisor', { position: [0, 4.8, 11.6], rotation: [-0.2, 0, 0] });
    b.addPart(rbox(3.6, 0.2, 0.3, 0.08), 'energyCyan', { position: [0, 4.8, 11.85], emissiveIntensity: 4.2 });
    b.addPart(rbox(3, 1.2, 3.5, 0.5), 'hullSecondary', { position: [0, 6.4, 6.8] });
    // Mast + dishes
    strut(b, [0, 7, 5.5], [1.2, 14, 3.5], 0.14, 'frameGunmetal');
    b.addPart(sph(0.3), 'warningAmber', { position: [1.2, 14.1, 3.5], emissiveIntensity: 4, animType: 3, animPivot: [1.2, 14.1, 3.5] });
    dish(b, [-1.8, 8.4, 5.5], 1.7);
    dish(b, [2.6, 7.7, 1.0], 1.2, -0.9);
    sag(b, [1.2, 13, 3.5], [3.2, 4.2, 10], 2.5, 0.07);

    // --- Dorsal cargo containers + antennas ---
    [-8, -13, -17].forEach((z, i) => {
      b.addPart(rbox(3, 1.8, 3.8, 0.3), i % 2 ? 'hullSecondary' : 'hullPrimary', { position: [0, 4.0, z] });
    });
    b.addPart(rbox(3.4, 0.2, 14, 0.1), 'frameGunmetal', { position: [0, 3.25, -12.6] });

    // --- Solar wings on trusses ---
    mirror((s) => {
      b.addPart(rbox(8, 0.5, 0.9, 0.2), 'frameGunmetal', { position: [(4.5 + 4) * s, 0.6, -8] });
      b.addPart(rbox(11, 0.3, 9, 0.12), 'frameGunmetal', { position: [(14) * s, 0.7, -8], rotation: [0, 0, -0.06 * s] });
      for (let i = 0; i < 3; i++) {
        b.addPart(rbox(3.4, 0.14, 8.3, 0.05), 'solarCell', { position: [(11 + i * 3.6) * s, 0.9 - i * 0.2 * 0.06 * 0, -8], rotation: [0, 0, -0.06 * s] });
      }
    });

    // --- Belly drop bay (-Y) ---
    b.addPart(rbox(6.4, 0.9, 16, 0.3), 'frameGunmetal', { position: [0, -3.35, 1] }); // bay frame
    b.addPart(rbox(5.0, 0.5, 14.6, 0.15), 'glassVisor', { position: [0, -3.85, 1] });  // dark recess
    mirror((s) => {
      b.addPart(rbox(0.25, 0.25, 15.4, 0.1), 'warningAmber', { position: [3.0 * s, -3.85, 1], emissiveIntensity: 3.6 });
      // open bay doors, hinged outward
      b.addPart(rbox(2.2, 0.3, 14, 0.12), 'hullSecondary', { position: [(3.6 + 0.8) * s, -3.9, 1], rotation: [0, 0, 0.7 * s] });
    });
    // Drop pods racked in the bay
    [-4.5, -0.5, 3.5, 7.0].forEach((z) => {
      b.addPart(cyl(1.0, 1.0, 0.5, 12), 'frameGunmetal', { position: [0, -4.15, z] });
      b.addPart(new THREE.ConeGeometry(0.85, 1.7, 12), 'hullPrimary', { position: [0, -5.1, z], rotation: [Math.PI, 0, 0] });
      b.addPart(cyl(0.8, 0.8, 0.12, 12), 'energyCyan', { position: [0, -4.35, z], emissiveIntensity: 3.6 });
    });
    // Landing / docking skids
    mirror((s) => {
      strut(b, [4.2 * s, -2.8, -14], [6 * s, -4.5, -15], 0.25, 'frameGunmetal');
      b.addPart(rbox(1.2, 0.3, 4, 0.12), 'frameGunmetal', { position: [6 * s, -4.65, -15] });
    });
  },
});

// ---------------------------------------------------------------------------
// Drop pod — base at y=0 (centre of heat shield), ~3 m tall.
// ---------------------------------------------------------------------------
function podShell(b: KitbashBuilder) {
  // Ablative heat shield (underside, charred) + rim
  b.addPart(
    lathe([[0, 0], [0.7, 0.02], [1.15, 0.14], [1.32, 0.34], [1.3, 0.5], [0, 0.5]], 28),
    'frameGunmetal'
  );
  b.addPart(cyl(1.34, 1.34, 0.08, 28), 'hullSecondary', { position: [0, 0.46, 0] });
  // 4 petal panels with gaps (thick shells, outer up/inner down)
  const outer: [number, number][] = [[1.25, 0.5], [1.0, 1.3], [0.68, 2.3], [0.4, 2.95]];
  const inner = outer.map(([r, y]) => [r - 0.1, y - (y > 2.9 ? 0.02 : 0)] as [number, number]).reverse();
  const prof = [...outer, ...inner];
  for (let i = 0; i < 4; i++) {
    const start = (i * Math.PI) / 2 + 0.12;
    b.addPart(lathe(prof, 8, start, Math.PI / 2 - 0.24), i % 2 ? 'hullSecondary' : 'hullPrimary');
  }
  // Panel seam bolts/ribs
  for (let i = 0; i < 4; i++) {
    const a = (i * Math.PI) / 2;
    strut(b, [Math.cos(a) * 1.22, 0.55, Math.sin(a) * 1.22], [Math.cos(a) * 0.45, 2.85, Math.sin(a) * 0.45], 0.05, 'frameGunmetal');
  }
  // Retro-thruster nozzles ring (angled outward, glowing, pulse)
  for (let i = 0; i < 4; i++) {
    const a = (i * Math.PI) / 2 + Math.PI / 4;
    const x = Math.cos(a) * 1.35, z = Math.sin(a) * 1.35;
    b.addPart(cyl(0.12, 0.2, 0.34, 10), 'frameGunmetal', { position: [x, 0.62, z], rotation: [-Math.sin(a) * 0.45, 0, Math.cos(a) * 0.45] });
    b.addPart(cyl(0.15, 0.15, 0.05, 10), 'energyCyan', {
      position: [x + Math.cos(a) * 0.07, 0.45, z + Math.sin(a) * 0.07], rotation: [-Math.sin(a) * 0.45, 0, Math.cos(a) * 0.45],
      emissiveIntensity: 4, animType: 3, animPivot: [x, 0.45, z],
    });
  }
}

register({
  id: 'ship.dropPodShell',
  label: 'Drop Pod Shell',
  category: 'ship',
  footprint: [3, 3],
  notes: 'Detachable outer shell: ablative heat shield, 4 petal panels, retro nozzles. Hero fits inside (r~0.8).',
  build: (b) => podShell(b),
});

register({
  id: 'ship.dropPod',
  label: 'Drop Pod',
  category: 'ship',
  footprint: [3, 3],
  notes: 'Reentry capsule ~3.1m: shell + chute housing, hatch, folding legs, seat, beacon, antenna.',
  build: (b) => {
    podShell(b);
    // Interior floor + seat/harness so pod is not hollow when hero is absent
    b.addPart(cyl(0.9, 0.9, 0.08, 20), 'frameGunmetal', { position: [0, 0.54, 0] });
    b.addPart(rbox(0.7, 1.2, 0.2, 0.08), 'frameGunmetal', { position: [0, 1.2, -0.55] });
    b.addPart(rbox(0.5, 0.1, 0.05, 0.02), 'energyCyan', { position: [0, 1.7, -0.43], emissiveIntensity: 3.6 });
    // Chute housing (top cap)
    b.addPart(cyl(0.42, 0.5, 0.35, 16), 'frameGunmetal', { position: [0, 3.05, 0] });
    b.addPart(lathe([[0, 0], [0.38, 0], [0.34, 0.12], [0.2, 0.22], [0, 0.26]], 16), 'hullSecondary', { position: [0, 3.2, 0] });
    b.addPart(cyl(0.44, 0.44, 0.06, 16), 'warningAmber', { position: [0, 2.93, 0], emissiveIntensity: 3.2 });
    // Hatch (front, +Z)
    b.addPart(rbox(0.72, 0.9, 0.12, 0.05), 'frameGunmetal', { position: [0, 1.55, 0.88], rotation: [-0.3, 0, 0] });
    b.addPart(rbox(0.5, 0.65, 0.1, 0.05), 'glassVisor', { position: [0, 1.56, 0.93], rotation: [-0.3, 0, 0] });
    b.addPart(rbox(0.56, 0.05, 0.05, 0.02), 'warningAmber', { position: [0, 1.15, 1.0], rotation: [-0.3, 0, 0], emissiveIntensity: 3.4 });
    // Folded landing legs
    for (let i = 0; i < 3; i++) {
      const a = (i * Math.PI * 2) / 3 + Math.PI / 6;
      const c = Math.cos(a), s = Math.sin(a);
      strut(b, [c * 1.25, 0.95, s * 1.25], [c * 1.65, 0.12, s * 1.65], 0.05, 'frameGunmetal');
      b.addPart(cyl(0.2, 0.22, 0.06, 10), 'hullSecondary', { position: [c * 1.68, 0.03, s * 1.68] });
    }
    // Antenna + beacon + cable
    strut(b, [-0.3, 2.9, -0.1], [-0.6, 3.7, -0.3], 0.022, 'frameGunmetal');
    b.addPart(sph(0.07), 'warningAmber', { position: [-0.6, 3.72, -0.3], emissiveIntensity: 4, animType: 3, animPivot: [-0.6, 3.72, -0.3] });
    sag(b, [0.3, 3.0, 0.2], [1.0, 1.1, 0.55], 0.25, 0.03);
  },
});
