import { rbox, cyl, sph, strut, sag, cable, mirror, lathe, solarPanel, type V3 } from '../../greebles/unitParts';
import * as THREE from 'three';
import { register } from './common';

// ---------------------------------------------------------------------------
// robot.hero — legged explorer, ~1.8 m. Forward = +Z.
// ---------------------------------------------------------------------------
register({
  id: 'robot.hero',
  scale: 0.88,
  label: 'Hero Explorer',
  category: 'robot',
  footprint: [1, 1],
  notes: 'Bipedal explorer: visor, rotating backpack dish, antenna, thruster pack, sagging cables. ~1.8m.',
  build: (b) => {
    mirror((s) => {
      const x = 0.2 * s;
      // Legs: foot, ankle, shin, knee, thigh, hip joint
      b.addPart(rbox(0.28, 0.12, 0.46, 0.05), 'frameGunmetal', { position: [x, 0.06, 0.05] });
      b.addPart(rbox(0.22, 0.07, 0.2, 0.03), 'hullSecondary', { position: [x, 0.13, 0.15] }); // toe cap
      b.addPart(cyl(0.06, 0.07, 0.18, 10), 'frameGunmetal', { position: [x, 0.2, 0] });
      b.addPart(rbox(0.19, 0.5, 0.22, 0.06), 'hullPrimary', { position: [x, 0.5, 0], rotation: [-0.06, 0, 0] });
      b.addPart(rbox(0.21, 0.1, 0.1, 0.03), 'hullSecondary', { position: [x, 0.42, 0.13] }); // shin plate
      b.addPart(sph(0.1), 'frameGunmetal', { position: [x, 0.78, 0.02] });
      b.addPart(rbox(0.21, 0.34, 0.23, 0.06), 'hullPrimary', { position: [x, 0.95, 0], rotation: [0.04, 0, 0] });
      strut(b, [x, 0.65, 0.1], [x, 0.9, 0.12], 0.015, 'frameGunmetal'); // hydraulic

      // Arms
      const ax = 0.46 * s;
      b.addPart(sph(0.14), 'hullSecondary', { position: [ax, 1.5, 0] }); // shoulder pad
      b.addPart(rbox(0.12, 0.3, 0.14, 0.04), 'hullPrimary', { position: [ax + 0.02 * s, 1.28, 0.02] });
      b.addPart(sph(0.075), 'frameGunmetal', { position: [ax + 0.02 * s, 1.1, 0.04] });
      b.addPart(rbox(0.13, 0.3, 0.15, 0.04), 'hullPrimary', { position: [ax + 0.02 * s, 0.93, 0.14], rotation: [-0.5, 0, 0] });
      b.addPart(rbox(0.12, 0.12, 0.13, 0.04), 'frameGunmetal', { position: [ax + 0.02 * s, 0.77, 0.27] }); // hand
      b.addPart(rbox(0.14, 0.04, 0.16, 0.015), 'warningAmber', { position: [ax + 0.02 * s, 1.0, 0.1], rotation: [-0.5, 0, 0], emissiveIntensity: 3.2 });
    });

    // Pelvis + belt
    b.addPart(rbox(0.5, 0.2, 0.34, 0.07), 'frameGunmetal', { position: [0, 1.1, 0] });
    b.addPart(rbox(0.52, 0.05, 0.36, 0.02), 'hullSecondary', { position: [0, 1.2, 0] });
    // Torso
    b.addPart(rbox(0.66, 0.5, 0.42, 0.12), 'hullPrimary', { position: [0, 1.45, 0] });
    b.addPart(rbox(0.5, 0.2, 0.08, 0.04), 'hullSecondary', { position: [0, 1.5, 0.21] }); // chest plate
    b.addPart(cyl(0.06, 0.06, 0.03, 16), 'energyCyan', { position: [0, 1.5, 0.26], rotation: [Math.PI / 2, 0, 0], emissiveIntensity: 4.0 }); // core
    // Neck + head
    b.addPart(cyl(0.07, 0.09, 0.1, 10), 'frameGunmetal', { position: [0, 1.74, 0] });
    b.addPart(rbox(0.4, 0.3, 0.36, 0.11), 'hullPrimary', { position: [0, 1.9, 0.01] });
    b.addPart(rbox(0.32, 0.12, 0.06, 0.04), 'glassVisor', { position: [0, 1.92, 0.18] });
    b.addPart(rbox(0.26, 0.035, 0.03, 0.012), 'energyCyan', { position: [0, 1.92, 0.215], emissiveIntensity: 4.5 }); // visor glow
    b.addPart(rbox(0.1, 0.18, 0.2, 0.04), 'hullSecondary', { position: [0.22, 1.9, 0] });
    b.addPart(rbox(0.1, 0.18, 0.2, 0.04), 'hullSecondary', { position: [-0.22, 1.9, 0] });
    // Angled antenna (silhouette breaker)
    strut(b, [-0.2, 2.0, -0.08], [-0.34, 2.42, -0.16], 0.012, 'frameGunmetal');
    b.addPart(sph(0.035), 'warningAmber', { position: [-0.34, 2.43, -0.16], emissiveIntensity: 4.0, animType: 3, animPivot: [-0.34, 2.43, -0.16] });

    // Backpack
    b.addPart(rbox(0.5, 0.6, 0.26, 0.08), 'frameGunmetal', { position: [0, 1.4, -0.34] });
    b.addPart(rbox(0.4, 0.16, 0.2, 0.05), 'hullSecondary', { position: [0, 1.62, -0.34] });
    mirror((s) => {
      b.addPart(new THREE.CapsuleGeometry(0.075, 0.38, 4, 10), 'hullPrimary', { position: [0.3 * s, 1.38, -0.34] });
      b.addPart(cyl(0.065, 0.1, 0.12, 10), 'frameGunmetal', { position: [0.3 * s, 1.1, -0.34] }); // thruster bell
      b.addPart(cyl(0.05, 0.03, 0.03, 10), 'energyCyan', { position: [0.3 * s, 1.03, -0.34], emissiveIntensity: 4.2, animType: 2, animPivot: [0.3 * s, 1.03, -0.34] });
    });
    // Rotating radar dish on pack (animType 1)
    b.addPart(cyl(0.025, 0.03, 0.14, 8), 'frameGunmetal', { position: [0, 1.78, -0.36] });
    b.addPart(
      lathe([[0.0, 0.0], [0.08, 0.02], [0.16, 0.08], [0.17, 0.1], [0.0, 0.03]], 16),
      'hullPrimary',
      { position: [0.0, 1.86, -0.36], rotation: [-0.6, 0, 0], animType: 1, animPivot: [0, 1.86, -0.36] }
    );
    b.addPart(sph(0.028), 'energyCyan', { position: [0, 1.93, -0.3], emissiveIntensity: 4.0, animType: 1, animPivot: [0, 1.86, -0.36] });

    // Cables
    sag(b, [0.15, 1.2, -0.45], [0.26, 1.12, 0.12], 0.14, 0.018);
    sag(b, [-0.15, 1.2, -0.45], [-0.28, 1.1, 0.1], 0.12, 0.018);
    cable(b, [[0.46, 1.4, -0.3], [0.62, 1.2, -0.22], [0.5, 1.0, 0.08]] as V3[], 0.015, 'frameGunmetal');
    sag(b, [-0.3, 1.66, -0.3], [-0.3, 1.82, -0.1], 0.05, 0.012, 'energyCyan');
  },
});

// ---------------------------------------------------------------------------
// robot.miner — tracked, front auger-drill + ore hopper. ~1.1m tall.
// ---------------------------------------------------------------------------
register({
  id: 'robot.miner',
  label: 'Miner T1',
  category: 'robot',
  footprint: [1, 2],
  notes: 'Tracked chassis, spinning drill head on boom, rear ore hopper, beacon, sagging hose.',
  build: (b) => {
    mirror((s) => b.addGreeble('trackUnit', { x: 0.42 * s, length: 1.3, height: 0.38, width: 0.26 }));
    b.addPart(rbox(0.62, 0.22, 1.1, 0.08), 'frameGunmetal', { position: [0, 0.32, 0] }); // axle bed
    b.addPart(rbox(0.74, 0.3, 0.95, 0.1), 'hullPrimary', { position: [0, 0.52, -0.05] });
    b.addPart(rbox(0.5, 0.28, 0.5, 0.09), 'hullPrimary', { position: [0, 0.78, 0.15] }); // cab
    b.addPart(rbox(0.4, 0.1, 0.05, 0.03), 'glassVisor', { position: [0, 0.82, 0.41] });
    b.addPart(rbox(0.3, 0.025, 0.02, 0.01), 'energyCyan', { position: [0, 0.82, 0.44], emissiveIntensity: 4 });
    b.addPart(rbox(0.8, 0.05, 0.4, 0.02), 'hullSecondary', { position: [0, 0.68, -0.4] });
    // Ore hopper (rear)
    b.addPart(rbox(0.66, 0.32, 0.5, 0.06), 'hullSecondary', { position: [0, 0.84, -0.42], rotation: [0.12, 0, 0] });
    b.addPart(rbox(0.54, 0.04, 0.38, 0.015), 'frameGunmetal', { position: [0, 1.0, -0.43], rotation: [0.12, 0, 0] });
    // Boom + drill
    strut(b, [0.0, 0.7, 0.3], [0.0, 0.55, 0.78], 0.06, 'frameGunmetal');
    b.addPart(rbox(0.2, 0.12, 0.16, 0.04), 'hullSecondary', { position: [0, 0.54, 0.8] });
    b.addPart(cyl(0.03, 0.03, 0.2, 8), 'frameGunmetal', { position: [0, 0.4, 0.84] });
    b.addPart(new THREE.ConeGeometry(0.17, 0.34, 10), 'warningAmber', {
      position: [0, 0.2, 0.84], rotation: [Math.PI, 0, 0], emissiveIntensity: 3.0, animType: 1, animPivot: [0, 0.2, 0.84],
    });
    b.addPart(cyl(0.18, 0.18, 0.03, 12), 'frameGunmetal', { position: [0, 0.36, 0.84], animType: 1, animPivot: [0, 0.36, 0.84] });
    // Beacon + antenna
    b.addPart(cyl(0.02, 0.02, 0.3, 6), 'frameGunmetal', { position: [0.25, 1.05, 0.05] });
    b.addPart(sph(0.045), 'warningAmber', { position: [0.25, 1.22, 0.05], emissiveIntensity: 4, animType: 3, animPivot: [0.25, 1.22, 0.05] });
    sag(b, [-0.2, 0.94, -0.4], [-0.1, 0.58, 0.55], 0.1, 0.025);
    sag(b, [0.3, 0.56, 0.35], [0.05, 0.56, 0.7], 0.05, 0.02, 'energyCyan');
  },
});

// ---------------------------------------------------------------------------
// robot.builder — 6-wheeled, crane arm + claw + welding torch + solar roof. ~1.3m
// Validated with the model-geometry-validator skill: every part touches its support (≥ 1 cm overlap that hides inside the
// neighbour), insets stand proud of their frames, the cable clears the cabin and the radar sweep clears everything.
// ---------------------------------------------------------------------------
register({
  id: 'robot.builder',
  label: 'Builder T1',
  category: 'robot',
  footprint: [1, 1],
  notes: 'Six-wheeled chassis, articulated crane with claw, weld torch, solar wing, rotating radar.',
  build: (b) => {
    b.addPart(rbox(0.7, 0.2, 1.0, 0.08, 1), 'hullSecondary', { name: 'chassis', position: [0, 0.34, 0] });
    mirror((s) => {
      [-0.38, 0, 0.38].forEach((z) => {
        // black tyre, light rim 1 cm proud on both sides, orange hub cap: three tones so a wheel never reads as a puck
        b.addPart(cyl(0.17, 0.17, 0.12, 12), 'rubberDark', { name: 'wheel tyre', position: [0.4 * s, 0.17, z], rotation: [0, 0, Math.PI / 2] });
        b.addPart(cyl(0.105, 0.105, 0.14, 12), 'hullPrimary', { name: 'wheel rim', position: [0.4 * s, 0.17, z], rotation: [0, 0, Math.PI / 2] });
        b.addPart(cyl(0.045, 0.045, 0.16, 8), 'hullSecondary', { name: 'wheel hub', position: [0.4 * s, 0.17, z], rotation: [0, 0, Math.PI / 2] });
      });
    });
    b.addPart(rbox(0.6, 0.36, 0.85, 0.1), 'hullPrimary', { name: 'body hull', position: [0, 0.6, -0.05] });
    b.addPart(rbox(0.46, 0.26, 0.34, 0.08, 1), 'hullPrimary', { name: 'cabin', position: [0, 0.895, 0.2] }); // sunk 1.5 cm into the hull roof
    b.addPart(rbox(0.36, 0.1, 0.04, 0.02, 1), 'glassVisor', { name: 'visor', position: [0, 0.925, 0.38] });
    b.addPart(rbox(0.26, 0.02, 0.02, 0.008, 1), 'energyCyan', { name: 'visor light', position: [0, 0.925, 0.4], emissiveIntensity: 4 });
    b.addPart(rbox(0.62, 0.05, 0.4, 0.02, 1), 'hullSecondary', { name: 'stripe deck', position: [0, 0.8, -0.3] });
    // Crane: turntable, boom, jib, claw
    b.addPart(cyl(0.17, 0.2, 0.08, 12), 'frameGunmetal', { name: 'crane turntable', position: [0, 0.82, -0.3] });
    strut(b, [0, 0.86, -0.3], [0, 1.3, -0.1], 0.045, 'hullSecondary', { name: 'boom' });
    b.addPart(sph(0.07), 'frameGunmetal', { name: 'boom joint', position: [0, 1.3, -0.1] });
    strut(b, [0, 1.3, -0.1], [0, 1.1, 0.5], 0.04, 'hullSecondary', { name: 'jib' });
    strut(b, [0, 0.9, -0.28], [0, 1.275, -0.05], 0.018, 'hullPrimary', { name: 'hydraulic ram' }); // both ends land on the boom / jib line
    b.addPart(sph(0.06), 'frameGunmetal', { name: 'claw joint', position: [0, 1.1, 0.5] });
    mirror((s) => {
      // pincers hang from the joint: top end sunk into the sphere, tips angled in but never crossing
      b.addPart(rbox(0.03, 0.2, 0.05, 0.012, 1), 'hullSecondary', { name: 'claw finger', position: [0.046 * s, 0.9957, 0.5], rotation: [0, 0, -0.12 * s] });
    });
    sag(b, [0, 1.25, -0.1], [0, 1.05, 0.5], 0.09, 0.012, 'warningAmber'); // anchored under the two joints, hangs clear of the jib and the cabin roof
    // Weld torch (side): the arm starts inside the hull wall
    strut(b, [0.26, 0.6, 0.3], [0.5, 0.45, 0.62], 0.025, 'hullSecondary', { name: 'torch arm' });
    b.addPart(sph(0.04), 'energyCyan', { name: 'torch tip', position: [0.5, 0.44, 0.64], emissiveIntensity: 5, animType: 3, animPivot: [0.5, 0.44, 0.64] });
    // Solar wing (angled, breaks silhouette): the low edge is sunk into the hull wall; cell grid + bus bars on the front, ribs on the back
    solarPanel(b, { position: [-0.38, 0.93, -0.2], rotation: [0, 0, 0.5], height: 0.5, width: 0.6, name: 'solar' });
    // Radar: the mast is sunk into the cabin roof, the dish sits over the mast tip and spins about it
    b.addPart(cyl(0.015, 0.015, 0.2, 6), 'frameGunmetal', { name: 'radar mast', position: [0.18, 1.11, 0.15] });
    b.addPart(lathe([[0, 0], [0.06, 0.01], [0.12, 0.05], [0, 0.02]], 12), 'hullPrimary', {
      name: 'radar dish', position: [0.18, 1.2, 0.15], rotation: [-0.5, 0, 0], animType: 1, animPivot: [0.18, 1.2, 0.15],
    });
  },
});

// ---------------------------------------------------------------------------
// robot.combat — quad-legged walker with twin-barrel turret. ~1.4m
// ---------------------------------------------------------------------------
register({
  id: 'robot.combat',
  label: 'Combat T1',
  category: 'robot',
  footprint: [2, 2],
  notes: 'Four-legged spider walker, armored carapace, twin-barrel recoil turret, crimson sensor, radar.',
  build: (b) => {
    // Hull
    b.addPart(rbox(0.8, 0.28, 1.0, 0.12), 'hullPrimary', { position: [0, 0.82, 0] });
    b.addPart(rbox(0.6, 0.22, 0.7, 0.1), 'frameGunmetal', { position: [0, 0.62, 0] });
    b.addPart(rbox(0.7, 0.08, 0.5, 0.03), 'hullSecondary', { position: [0, 1.0, -0.15] });
    b.addPart(rbox(0.3, 0.14, 0.2, 0.05), 'hullSecondary', { position: [0, 0.8, 0.5], rotation: [0.3, 0, 0] }); // glacis
    b.addPart(rbox(0.22, 0.06, 0.04, 0.02), 'dangerCrimson', { position: [0, 0.82, 0.62], emissiveIntensity: 4.5 });
    // Legs (4)
    mirror((s) => {
      [0.4, -0.4].forEach((z, i) => {
        const hip: V3 = [0.36 * s, 0.76, z * 0.8];
        const knee: V3 = [0.78 * s, 1.0, z * 1.2];
        const foot: V3 = [0.92 * s, 0.05, z * 1.3];
        b.addPart(sph(0.09), 'frameGunmetal', { position: hip });
        strut(b, hip, knee, 0.05, 'hullPrimary', {}, 0.06);
        b.addPart(sph(0.075), 'frameGunmetal', { position: knee });
        strut(b, knee, foot, 0.025, 'frameGunmetal', {}, 0.055);
        b.addPart(cyl(0.09, 0.12, 0.1, 8), 'hullSecondary', { position: [foot[0], 0.05, foot[2]] });
        if (i === 0) b.addPart(rbox(0.06, 0.04, 0.12, 0.015), 'warningAmber', { position: [knee[0], knee[1] + 0.06, knee[2]], emissiveIntensity: 3.2 });
      });
    });
    // Turret
    b.addPart(cyl(0.26, 0.3, 0.1, 14), 'frameGunmetal', { position: [0, 1.05, 0.1] });
    b.addPart(rbox(0.46, 0.22, 0.44, 0.09), 'hullPrimary', { position: [0, 1.2, 0.08] });
    mirror((s) => {
      b.addPart(cyl(0.035, 0.04, 0.7, 8), 'frameGunmetal', { position: [0.13 * s, 1.2, 0.58], rotation: [Math.PI / 2, 0, 0], animType: 3, animPivot: [0.13 * s, 1.2, 0.3] });
      b.addPart(cyl(0.055, 0.055, 0.1, 8), 'hullSecondary', { position: [0.13 * s, 1.2, 0.95], rotation: [Math.PI / 2, 0, 0], animType: 3, animPivot: [0.13 * s, 1.2, 0.3] });
      b.addPart(cyl(0.03, 0.03, 0.03, 8), 'dangerCrimson', { position: [0.13 * s, 1.2, 1.0], rotation: [Math.PI / 2, 0, 0], emissiveIntensity: 4.5, animType: 3, animPivot: [0.13 * s, 1.2, 0.3] });
    });
    // Sensor head + radar + antenna
    b.addPart(sph(0.07), 'dangerCrimson', { position: [0, 1.36, 0.22], emissiveIntensity: 4.5 });
    b.addPart(cyl(0.02, 0.02, 0.15, 6), 'frameGunmetal', { position: [-0.15, 1.4, -0.1] });
    b.addPart(lathe([[0, 0], [0.07, 0.01], [0.14, 0.06], [0, 0.02]], 12), 'hullPrimary', {
      position: [-0.15, 1.5, -0.1], rotation: [-0.5, 0, 0], animType: 1, animPivot: [-0.15, 1.5, -0.1],
    });
    strut(b, [0.25, 1.1, -0.2], [0.4, 1.6, -0.3], 0.01, 'frameGunmetal');
    sag(b, [0.28, 1.0, -0.4], [0.5, 0.86, 0.2], 0.12, 0.02);
    // Ammo box
    b.addPart(rbox(0.3, 0.2, 0.26, 0.05), 'hullSecondary', { position: [0, 1.12, -0.42] });
  },
});
