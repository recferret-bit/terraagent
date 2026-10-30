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
  notes: 'Bipedal explorer: animType 4 stride legs, animType 5 counter-swing arms, visor, rotating backpack dish, thruster pack. ~1.8m.',
  build: (b) => {
    const box = (w: number, h: number, d: number) => new THREE.BoxGeometry(w, h, d);
    mirror((s) => {
      const x = 0.2 * s;
      const hip: V3 = [x, 1.04, 0];
      const legAnim = { animType: 4 as const, animPivot: hip };
      // Articulated Biped Leg (animType 4): hip ball-joint in pelvis socket, thigh, knee, shin, ankle, foot
      b.addPart(sph(0.085, 8, 6), 'frameGunmetal', { name: 'leg hip', position: hip, ...legAnim });
      b.addPart(rbox(0.18, 0.26, 0.2, 0.035, 1), 'rubberDark', { name: 'leg thigh', position: [x, 0.86, 0], ...legAnim });
      b.addPart(sph(0.085, 8, 6), 'frameGunmetal', { name: 'leg knee', position: [x, 0.71, 0.01], ...legAnim });
      strut(b, [x, 0.6, 0.09], [x, 0.86, 0.09], 0.015, 'hullSecondary', { name: 'leg hydraulic', ...legAnim });
      b.addPart(rbox(0.18, 0.44, 0.2, 0.035, 1), 'rubberDark', { name: 'leg shin', position: [x, 0.49, 0], ...legAnim });
      b.addPart(box(0.14, 0.12, 0.03), 'hullSecondary', { name: 'leg shin plate', position: [x, 0.46, 0.1], ...legAnim });
      b.addPart(cyl(0.06, 0.07, 0.2, 8), 'frameGunmetal', { name: 'leg ankle', position: [x, 0.2, 0], ...legAnim });
      b.addPart(rbox(0.24, 0.12, 0.42, 0.035, 1), 'rubberDark', { name: 'leg foot', position: [x, 0.06, 0.04], ...legAnim });
      b.addPart(box(0.18, 0.06, 0.16), 'hullSecondary', { name: 'leg toe cap', position: [x, 0.12, 0.15], ...legAnim });

      // Counter-Swinging Biped Arm (animType 5): static shoulder bracket -> animated shoulder ball-joint + arm chain
      b.addPart(box(0.1, 0.1, 0.12), 'frameGunmetal', { name: 'shoulder mount', position: [0.35 * s, 1.5, 0] });
      const shoulder: V3 = [0.44 * s, 1.48, 0];
      const armAnim = { animType: 5 as const, animPivot: shoulder };
      const ax = 0.465 * s;
      b.addPart(sph(0.11, 8, 6), 'hullSecondary', { name: 'arm shoulder', position: shoulder, ...armAnim });
      b.addPart(rbox(0.11, 0.26, 0.13, 0.03, 1), 'hullSecondary', { name: 'arm upper', position: [ax, 1.28, 0.01], ...armAnim });
      b.addPart(sph(0.075, 8, 6), 'frameGunmetal', { name: 'arm elbow', position: [ax, 1.11, 0.03], ...armAnim });
      b.addPart(rbox(0.12, 0.28, 0.14, 0.03, 1), 'hullSecondary', { name: 'arm forearm', position: [ax, 0.95, 0.12], rotation: [-0.45, 0, 0], ...armAnim });
      b.addPart(box(0.1, 0.1, 0.11), 'frameGunmetal', { name: 'arm hand', position: [ax, 0.8, 0.23], ...armAnim });
      b.addPart(box(0.135, 0.04, 0.155), 'warningAmber', { name: 'arm cuff light', position: [ax, 1.0, 0.09], rotation: [-0.45, 0, 0], emissiveIntensity: 3.4, ...armAnim });
    });

    // Pelvis + belt + torso
    b.addPart(rbox(0.48, 0.18, 0.32, 0.05, 1), 'frameGunmetal', { name: 'body pelvis', position: [0, 1.11, 0] });
    b.addPart(box(0.5, 0.05, 0.34), 'hullSecondary', { name: 'body belt', position: [0, 1.2, 0] });
    b.addPart(rbox(0.64, 0.48, 0.4, 0.08, 1), 'hullPrimary', { name: 'body torso', position: [0, 1.45, 0] });
    b.addPart(box(0.46, 0.2, 0.08), 'hullSecondary', { name: 'chest plate', position: [0, 1.5, 0.2] });
    b.addPart(cyl(0.06, 0.06, 0.03, 10), 'energyCyan', { name: 'chest core light', position: [0, 1.5, 0.245], rotation: [Math.PI / 2, 0, 0], emissiveIntensity: 4.0 });
    // Neck + head + visor
    b.addPart(cyl(0.07, 0.09, 0.12, 8), 'frameGunmetal', { name: 'neck joint', position: [0, 1.72, 0] });
    b.addPart(rbox(0.38, 0.28, 0.34, 0.07, 1), 'hullPrimary', { name: 'head helmet', position: [0, 1.89, 0.01] });
    b.addPart(box(0.3, 0.11, 0.05), 'glassVisor', { name: 'head visor', position: [0, 1.91, 0.18] });
    b.addPart(box(0.24, 0.03, 0.03), 'energyCyan', { name: 'visor glow light', position: [0, 1.91, 0.205], emissiveIntensity: 4.5 });
    b.addPart(box(0.08, 0.16, 0.18), 'hullSecondary', { name: 'ear pod L', position: [0.21, 1.89, 0] });
    b.addPart(box(0.08, 0.16, 0.18), 'hullSecondary', { name: 'ear pod R', position: [-0.21, 1.89, 0] });
    // Angled antenna (silhouette breaker, sunk into ear pod R)
    strut(b, [-0.21, 1.94, -0.04], [-0.33, 2.38, -0.14], 0.012, 'frameGunmetal', { name: 'antenna mast' });
    b.addPart(sph(0.032, 8, 6), 'warningAmber', { name: 'antenna beacon light', position: [-0.33, 2.39, -0.14], emissiveIntensity: 4.0, animType: 3, animPivot: [-0.33, 2.39, -0.14] });

    // Backpack + thrusters + rotating radar dish
    b.addPart(rbox(0.46, 0.52, 0.24, 0.06, 1), 'frameGunmetal', { name: 'backpack frame', position: [0, 1.4, -0.3] });
    b.addPart(box(0.38, 0.07, 0.22), 'hullSecondary', { name: 'backpack cap', position: [0, 1.67, -0.3] });
    mirror((s) => {
      b.addPart(cyl(0.07, 0.07, 0.34, 10), 'hullPrimary', { name: 'pack tank', position: [0.27 * s, 1.44, -0.31] });
      b.addPart(cyl(0.06, 0.095, 0.16, 10), 'frameGunmetal', { name: 'thruster bell', position: [0.27 * s, 1.21, -0.31] });
      b.addPart(cyl(0.048, 0.032, 0.12, 10), 'energyCyan', {
        name: 'thruster core light', position: [0.27 * s, 1.13, -0.31], emissiveIntensity: 4.2, animType: 2, animPivot: [0.27 * s, 1.13, -0.31],
      });
    });
    // Rotating radar dish on pack (animType 1) — set back to clear helmet over full 360° spin
    b.addPart(cyl(0.025, 0.03, 0.18, 8), 'frameGunmetal', { name: 'radar mast', position: [0, 1.74, -0.36] });
    b.addPart(
      lathe([[0.0, 0.0], [0.07, 0.015], [0.14, 0.07], [0.0, 0.025]], 12),
      'hullPrimary',
      { name: 'radar dish', position: [0.0, 1.82, -0.36], rotation: [-0.45, 0, 0], animType: 1, animPivot: [0, 1.82, -0.36] }
    );
    b.addPart(sph(0.026, 8, 6), 'energyCyan', { name: 'radar feed light', position: [0, 1.86, -0.33], emissiveIntensity: 4.0, animType: 1, animPivot: [0, 1.82, -0.36] });

    // External power cables (anchored from backpack cap to shoulder mount tops, clearing tanks and torso)
    cable(b, [[0.16, 1.69, -0.3], [0.32, 1.74, -0.16], [0.35, 1.52, -0.02]] as V3[], 0.014, 'frameGunmetal', { name: 'pack cable L' });
    cable(b, [[-0.16, 1.69, -0.3], [-0.32, 1.74, -0.16], [-0.35, 1.52, -0.02]] as V3[], 0.014, 'frameGunmetal', { name: 'pack cable R' });
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
  notes: 'Tracked chassis with spinning bogie rollers (animType 7), spinning drill head (animType 1), rear ore hopper, beacon.',
  build: (b) => {
    mirror((s) => b.addGreeble('trackUnit', { x: 0.42 * s, length: 1.3, height: 0.38, width: 0.26 }));
    b.addPart(rbox(0.62, 0.22, 1.1, 0.06, 1), 'hullSecondary', { name: 'chassis bed', position: [0, 0.32, 0] });
    b.addPart(rbox(0.74, 0.3, 0.95, 0.08, 1), 'hullPrimary', { name: 'body hull', position: [0, 0.52, -0.05] });
    b.addPart(rbox(0.5, 0.28, 0.5, 0.07, 1), 'hullPrimary', { name: 'cabin', position: [0, 0.78, 0.15] });
    b.addPart(rbox(0.4, 0.1, 0.05, 0.02, 1), 'glassVisor', { name: 'cabin visor', position: [0, 0.82, 0.41] });
    b.addPart(rbox(0.3, 0.025, 0.02, 0.008, 1), 'energyCyan', { name: 'visor light', position: [0, 0.82, 0.44], emissiveIntensity: 4 });
    b.addPart(rbox(0.8, 0.05, 0.4, 0.02, 1), 'frameGunmetal', { name: 'hull deck', position: [0, 0.68, -0.4] });
    // Ore hopper (rear) + top chute bar (shares hopper grate center so tilt aligns)
    b.addPart(rbox(0.66, 0.32, 0.5, 0.05, 1), 'hullSecondary', { name: 'ore hopper', position: [0, 0.84, -0.42], rotation: [0.12, 0, 0] });
    b.addPart(rbox(0.54, 0.04, 0.38, 0.015, 1), 'frameGunmetal', { name: 'hopper grate', position: [0, 1.0, -0.43], rotation: [0.12, 0, 0] });
    b.addPart(new THREE.BoxGeometry(0.42, 0.03, 0.08), 'hullPrimary', { name: 'hopper chute bar', position: [0, 1.022, -0.43], rotation: [0.12, 0, 0] });
    // Boom + spinning auger drill
    strut(b, [0.0, 0.7, 0.3], [0.0, 0.55, 0.78], 0.06, 'hullSecondary', { name: 'drill boom' });
    b.addPart(rbox(0.2, 0.12, 0.16, 0.03, 1), 'hullSecondary', { name: 'drill head mount', position: [0, 0.54, 0.8] });
    b.addPart(cyl(0.03, 0.03, 0.2, 8), 'frameGunmetal', { name: 'drill shaft', position: [0, 0.4, 0.84] });
    b.addPart(new THREE.ConeGeometry(0.17, 0.34, 10), 'warningAmber', {
      name: 'drill auger light', position: [0, 0.2, 0.84], rotation: [Math.PI, 0, 0], emissiveIntensity: 3.2, animType: 1, animPivot: [0, 0.2, 0.84],
    });
    b.addPart(cyl(0.18, 0.18, 0.03, 12), 'frameGunmetal', { name: 'drill collar', position: [0, 0.36, 0.84], animType: 1, animPivot: [0, 0.36, 0.84] });
    // Antenna mast + pulsing beacon (sunk into cabin roof)
    b.addPart(cyl(0.02, 0.02, 0.3, 6), 'frameGunmetal', { name: 'antenna mast', position: [0.2, 1.03, 0.12] });
    b.addPart(sph(0.045, 10, 8), 'warningAmber', { name: 'beacon light', position: [0.2, 1.19, 0.12], emissiveIntensity: 4, animType: 3, animPivot: [0.2, 1.19, 0.12] });
    // External hydraulic hoses (clear of hull and hopper walls)
    cable(b, [[-0.22, 0.86, 0.1], [-0.36, 0.88, -0.12], [-0.3, 0.88, -0.3]] as V3[], 0.02, 'frameGunmetal', { name: 'hopper hose' });
    cable(b, [[0.22, 0.78, 0.36], [0.24, 0.68, 0.58], [0.08, 0.56, 0.78]] as V3[], 0.018, 'energyCyan', { name: 'drill hose' });
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
        const wPivot: V3 = [0.4 * s, 0.17, z];
        // black tyre, light rim 1 cm proud on both sides, orange hub cap: three tones + animType 7 (WheelSpin)
        b.addPart(cyl(0.17, 0.17, 0.12, 12), 'rubberDark', { name: 'wheel tyre', position: wPivot, rotation: [0, 0, Math.PI / 2], animType: 7, animPivot: wPivot });
        b.addPart(cyl(0.105, 0.105, 0.14, 12), 'hullPrimary', { name: 'wheel rim', position: wPivot, rotation: [0, 0, Math.PI / 2], animType: 7, animPivot: wPivot });
        b.addPart(cyl(0.045, 0.045, 0.16, 8), 'hullSecondary', { name: 'wheel hub', position: wPivot, rotation: [0, 0, Math.PI / 2], animType: 7, animPivot: wPivot });
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
// robot.combat — quad-legged spider walker with twin-barrel turret. ~1.4m
// ---------------------------------------------------------------------------
register({
  id: 'robot.combat',
  label: 'Combat T1',
  category: 'robot',
  footprint: [2, 2],
  notes: 'Four-legged spider walker (animType 6 alternating gait), armored carapace, twin-barrel recoil turret, crimson sensor, radar.',
  build: (b) => {
    // Hull & under-chassis
    b.addPart(rbox(0.8, 0.28, 1.0, 0.1, 1), 'hullPrimary', { name: 'body carapace', position: [0, 0.82, 0] });
    b.addPart(rbox(0.6, 0.22, 0.7, 0.08, 1), 'frameGunmetal', { name: 'under chassis', position: [0, 0.62, 0] });
    b.addPart(rbox(0.7, 0.08, 0.5, 0.03, 1), 'hullSecondary', { name: 'hull deck', position: [0, 0.98, -0.15] });
    b.addPart(rbox(0.3, 0.14, 0.2, 0.04, 1), 'hullSecondary', { name: 'hull glacis', position: [0, 0.8, 0.48], rotation: [0.3, 0, 0] });
    b.addPart(rbox(0.22, 0.06, 0.04, 0.015, 1), 'dangerCrimson', { name: 'visor sensor', position: [0, 0.82, 0.58], emissiveIntensity: 4.5 });
    // Side hull vents (surface detail on left/right carapace faces)
    mirror((s) => {
      b.addPart(rbox(0.03, 0.1, 0.28, 0.01, 1), 'hullSecondary', { name: 'hull side plate', position: [0.405 * s, 0.84, 0.0] });
    });
    // Articulated Spider Legs (4) — animType 6 (SpiderLeg) around hip socket pivot
    mirror((s) => {
      [0.4, -0.4].forEach((z, i) => {
        const hip: V3 = [0.39 * s, 0.76, z * 0.8];
        const femurStart: V3 = [0.46 * s, 0.8, z * 0.86];
        const knee: V3 = [0.78 * s, 1.0, z * 1.2];
        const femurEnd: V3 = [0.73 * s, 0.97, z * 1.15];
        const tibiaStart: V3 = [0.8 * s, 0.94, z * 1.21];
        const footTop: V3 = [0.92 * s, 0.08, z * 1.3];
        const animOpts = { animType: 6 as const, animPivot: hip };
        b.addPart(sph(0.095, 10, 8), 'frameGunmetal', { name: 'leg hip', position: hip, ...animOpts });
        strut(b, femurStart, femurEnd, 0.044, 'rubberDark', { name: 'leg femur', ...animOpts }, 0.052);
        b.addPart(sph(0.075, 10, 8), 'frameGunmetal', { name: 'leg knee', position: knee, ...animOpts });
        strut(b, tibiaStart, footTop, 0.028, 'rubberDark', { name: 'leg tibia', ...animOpts }, 0.05);
        b.addPart(cyl(0.085, 0.115, 0.1, 8), 'rubberDark', { name: 'leg foot', position: [footTop[0], 0.05, footTop[2]], ...animOpts });
        b.addPart(cyl(0.095, 0.095, 0.03, 8), 'hullSecondary', { name: 'leg foot rim', position: [footTop[0], 0.09, footTop[2]], ...animOpts });
        if (i === 0) {
          b.addPart(rbox(0.06, 0.04, 0.1, 0.012, 1), 'warningAmber', {
            name: 'leg knee light', position: [knee[0], knee[1] + 0.07, knee[2]], emissiveIntensity: 3.4, ...animOpts,
          });
        }
      });
    });
    // Turret (manipulator group: hullSecondary housing + frameGunmetal barrels)
    b.addPart(cyl(0.26, 0.3, 0.1, 12), 'frameGunmetal', { name: 'turret ring', position: [0, 1.0, 0.1] });
    b.addPart(rbox(0.46, 0.22, 0.44, 0.07, 1), 'hullSecondary', { name: 'turret housing', position: [0, 1.14, 0.08] });
    mirror((s) => {
      const bPivot: V3 = [0.13 * s, 1.14, 0.3];
      b.addPart(cyl(0.035, 0.04, 0.66, 8), 'frameGunmetal', { name: 'cannon barrel', position: [0.13 * s, 1.14, 0.56], rotation: [Math.PI / 2, 0, 0], animType: 3, animPivot: bPivot });
      b.addPart(cyl(0.055, 0.055, 0.1, 8), 'hullPrimary', { name: 'cannon muzzle', position: [0.13 * s, 1.14, 0.9], rotation: [Math.PI / 2, 0, 0], animType: 3, animPivot: bPivot });
      b.addPart(cyl(0.03, 0.03, 0.03, 8), 'dangerCrimson', { name: 'cannon laser', position: [0.13 * s, 1.14, 0.955], rotation: [Math.PI / 2, 0, 0], emissiveIntensity: 4.5, animType: 3, animPivot: bPivot });
    });
    // Sensor head + radar + antenna
    b.addPart(sph(0.065, 10, 8), 'dangerCrimson', { name: 'turret sensor light', position: [0, 1.28, 0.2], emissiveIntensity: 4.5 });
    b.addPart(cyl(0.02, 0.02, 0.16, 6), 'frameGunmetal', { name: 'radar mast', position: [-0.15, 1.31, -0.06] });
    b.addPart(lathe([[0, 0], [0.07, 0.01], [0.14, 0.06], [0, 0.02]], 12), 'hullPrimary', {
      name: 'radar dish', position: [-0.15, 1.38, -0.06], rotation: [-0.5, 0, 0], animType: 1, animPivot: [-0.15, 1.38, -0.06],
    });
    strut(b, [0.22, 1.0, -0.22], [0.38, 1.52, -0.32], 0.012, 'frameGunmetal', { name: 'antenna mast' });
    // Ammo box + external power cable (clears carapace)
    b.addPart(rbox(0.3, 0.18, 0.24, 0.04, 1), 'hullPrimary', { name: 'ammo box', position: [0, 1.09, -0.32] });
    cable(b, [[0.14, 1.12, -0.32], [0.28, 1.08, -0.14], [0.22, 1.14, 0.04]] as V3[], 0.016, 'frameGunmetal', { name: 'power cable' });
  },
});
