// Tech & defense: drone array, robotics factory, turret.
import * as THREE from 'three';
import { KitbashBuilder } from '../../KitbashRegistry';
import { box, cyl, roundedTank, ring, strut, cable, lamp, glow, dish, plinth, type V3, spin } from './kit';

const PI = Math.PI;

// ---------------------------------------------------------------- Drone control array (2x2)
export function droneArray() {
  const b = new KitbashBuilder();
  plinth(b, 4, 4);
  // central control tower
  box(b, 'hullPrimary', [1.4, 1.22, 1.4], [0, 0.18, -0.3], { r: 0.14, seg: 1, name: 'control tower base' });
  for (const sx of [-1, 1]) cyl(b, 'hullSecondary', 0.12, 0.12, 0.55, [sx * 0.7, 0.45, -0.3], { seg: 6, name: 'tower side conduit' });
  cyl(b, 'hullSecondary', 0.12, 0.12, 0.55, [0, 0.45, -1.0], { seg: 6, name: 'tower rear conduit' });
  cyl(b, 'hullPrimary', 0.45, 0.6, 1.42, [0, 1.38, -0.3], { seg: 10, name: 'control tower column' });
  ring(b, 'energyCyan', 0.52, 0.05, [0, 2.0, -0.3], { seg: 12, name: 'tower telemetry ring A light' });
  ring(b, 'energyCyan', 0.46, 0.05, [0, 2.5, -0.3], { seg: 12, name: 'tower telemetry ring B light' });
  cyl(b, 'frameGunmetal', 0.5, 0.5, 0.16, [0, 2.78, -0.3], { seg: 10, name: 'tower upper deck' });
  cyl(b, 'frameGunmetal', 0.07, 0.08, 0.72, [0, 2.9, -0.3], { seg: 6, name: 'central dish pedestal' });
  lamp(b, 'dangerCrimson', 0.08, [0, 2.96, 0.12], { name: 'tower deck beacon light' });
  // rotating dish array: 3 dishes on masts of different heights
  const dishes: [number, number, number, number][] = [[0, 4.0, -0.3, 0.68], [-1.35, 2.7, -1.1, 0.55], [1.4, 2.2, -1.2, 0.5]];
  dishes.forEach(([x, y, z, R], i) => {
    const A = spin(x, z);
    if (i > 0) {
      cyl(b, 'hullSecondary', 0.22, 0.25, 0.32, [x, 0.18, z], { seg: 8, name: 'relay mast base' });
      cyl(b, 'frameGunmetal', 0.07, 0.1, y - 0.58, [x, 0.19, z], { seg: 8, name: 'relay mast column' });
    }
    cyl(b, 'frameGunmetal', 0.06, 0.06, 0.48, [x, y - 0.46, z], { seg: 6, name: 'dish rotor neck', ...A });
    dish(b, R, [x, y, z], -0.6 - i * 0.15, { name: 'comms dish', ...A });
    b.addPart(new THREE.CylinderGeometry(0.025, 0.025, 0.48, 5), 'frameGunmetal', { name: 'dish feed boom', position: [x, y + 0.26, z + 0.16], rotation: [0.5, 0, 0], ...A });
    b.addPart(new THREE.SphereGeometry(0.07, 8, 6), 'energyCyan', { name: 'dish feed horn light', position: [x, y + 0.46, z + 0.28], ...A });
  });
  // landing pads + hovering drone on vertical guide beam
  for (const [x, z] of [[-1.2, 1.15], [0.3, 1.2]] as [number, number][]) {
    cyl(b, 'hullSecondary', 0.5, 0.5, 0.12, [x, 0.19, z], { seg: 12, name: 'drone landing pad' });
    ring(b, 'warningAmber', 0.38, 0.03, [x, 0.32, z], { seg: 12, name: 'pad target ring light' });
  }
  const dx = 0.3, dz = 1.2, dy = 0.94;
  // guide column passes through drone body with its 2/3 centroid at dy = 0.94 so +/-5 cm bob never increases embed depth
  cyl(b, 'energyCyan', 0.04, 0.04, 1.02, [dx, 0.26, dz], { seg: 6, emissiveIntensity: 3.6, name: 'tether guide beam light' });
  const bob = { animType: 2 as const, animPivot: [dx, dy, dz] as V3 };
  box(b, 'hullPrimary', [0.38, 0.22, 0.38], [dx, dy - 0.11, dz], { r: 0.05, name: 'hover drone hull', ...bob });
  b.addPart(new THREE.SphereGeometry(0.07, 8, 6), 'energyCyan', { name: 'drone nose eye light', position: [dx, dy, dz + 0.19], ...bob });
  for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
    strut(b, 'frameGunmetal', [dx + sx * 0.14, dy, dz + sz * 0.14], [dx + sx * 0.38, dy + 0.05, dz + sz * 0.38], 0.025, { name: 'drone rotor arm', ...bob });
    cyl(b, 'hullSecondary', 0.15, 0.15, 0.03, [dx + sx * 0.38, dy + 0.04, dz + sz * 0.38], { seg: 8, name: 'drone rotor shroud', ...bob });
  }
  // docked drone on other pad
  cyl(b, 'hullPrimary', 0.2, 0.22, 0.16, [-1.2, 0.29, 1.15], { seg: 8, name: 'docked drone body' });
  lamp(b, 'energyCyan', 0.06, [-1.2, 0.45, 1.27], { name: 'docked drone status light' });
  cable(b, [0.45, 0.75, 0.36], [0.3, 0.27, 0.76], 0.08, 0.04, 'frameGunmetal', { name: 'pad power cable' });
  cable(b, [-0.35, 2.75, -0.45], [-1.35, 2.0, -1.1], 0.22, 0.03, 'frameGunmetal', { name: 'relay aerial cable' });
  return b.build();
}

// ---------------------------------------------------------------- Robotics factory (4x3)
export function roboticsFactory() {
  const b = new KitbashBuilder();
  plinth(b, 8, 6);
  box(b, 'hullPrimary', [6.0, 2.02, 3.6], [-0.6, 0.18, -0.9], { r: 0.16, seg: 1, name: 'factory main hall' });
  box(b, 'frameGunmetal', [6.1, 0.2, 3.7], [-0.6, 1.4, -0.9], { r: 0.04, name: 'hall belt band' });
  glow(b, 'energyCyan', [1.8, 0.14, 0.08], [0.8, 1.75, 0.88], { name: 'factory front status light' });
  // dual roof clerestory monitor bays
  for (const x of [-1.9, 0.5]) {
    box(b, 'hullSecondary', [2.0, 0.58, 1.9], [x, 2.15, -0.1], { r: 0.06, name: 'roof monitor bay' });
    glow(b, 'energyCyan', [1.7, 0.28, 0.08], [x, 2.3, 0.84], { emissiveIntensity: 3.2, name: 'clerestory window light' });
    b.addPart(new THREE.CylinderGeometry(0.08, 0.08, 1.7, 6), 'frameGunmetal', { name: 'monitor roof ridge', position: [x, 2.73, -0.1], rotation: [PI / 2, 0, 0] });
  }
  // roof gantry rails + trolley + welding actuator
  for (const z of [-2.0, 0.2]) strut(b, 'frameGunmetal', [-3.65, 3.2, z], [2.45, 3.2, z], 0.075, { name: 'roof gantry rail' });
  for (const x of [-3.5, 2.3]) {
    for (const z of [-2.0, 0.2]) cyl(b, 'frameGunmetal', 0.08, 0.08, 1.08, [x, 2.15, z], { seg: 6, name: 'gantry stanchion' });
    strut(b, 'frameGunmetal', [x, 3.2, -2.0], [x, 3.2, 0.2], 0.075, { name: 'gantry end tie' });
  }
  cyl(b, 'hullSecondary', 0.42, 0.45, 0.35, [0.2, 3.22, -0.9], { seg: 8, name: 'gantry crane carriage' });
  strut(b, 'frameGunmetal', [0.2, 3.3, -0.9], [0.2, 2.4, 1.7], 0.07, { name: 'crane jib boom' });
  // vertical guide shaft passes completely through the bobbing welder head so +/-5 cm bob never deepens vertex embed
  cyl(b, 'frameGunmetal', 0.045, 0.045, 1.0, [0.2, 1.48, 1.7], { seg: 6, name: 'welder guide shaft' });
  const W2 = { animType: 2 as const, animPivot: [0.2, 1.8, 1.7] as V3 };
  box(b, 'hullSecondary', [0.38, 0.26, 0.48], [0.2, 1.66, 1.7], { r: 0.05, name: 'welder head carriage', ...W2 });
  lamp(b, 'energyCyan', 0.07, [0.2, 1.66, 1.96], { name: 'welder arc torch light', ...W2 });
  // big roller door + amber hazard
  box(b, 'frameGunmetal', [2.6, 1.52, 0.2], [-2.3, 0.18, 0.92], { r: 0.06, name: 'bay roller door' });
  glow(b, 'warningAmber', [2.2, 0.1, 0.06], [-2.3, 1.45, 1.02], { name: 'bay door header light' });
  // conveyor out front with robot torso in progress
  box(b, 'frameGunmetal', [4.8, 0.37, 1.0], [0.3, 0.18, 2.1], { r: 0.08, name: 'assembly conveyor bed' });
  glow(b, 'energyCyan', [4.5, 0.05, 0.08], [0.3, 0.44, 2.58], { name: 'conveyor line light' });
  for (let k = 0; k < 6; k++) {
    b.addPart(new THREE.CylinderGeometry(0.09, 0.09, 0.9, 8), 'hullSecondary', { name: 'conveyor roller', position: [-1.7 + k * 0.8, 0.54, 2.1], rotation: [PI / 2, 0, 0] });
  }
  cyl(b, 'hullPrimary', 0.28, 0.3, 0.42, [-0.9, 0.52, 2.1], { seg: 8, name: 'chassis assembly A' });
  cyl(b, 'hullSecondary', 0.18, 0.2, 0.3, [-0.9, 0.9, 2.1], { seg: 8, name: 'turret assembly A' });
  glow(b, 'energyCyan', [0.2, 0.06, 0.06], [-0.9, 1.05, 2.26], { name: 'assembly optic light' });
  cyl(b, 'hullPrimary', 0.26, 0.28, 0.38, [1.5, 0.52, 2.1], { seg: 8, name: 'chassis assembly B' });
  // rear chimney stacks (mounted along -Z back wall so back face carries detail) + coolant silo tank
  for (const [x, h] of [[-2.8, 3.2], [-1.8, 2.8]] as [number, number][]) {
    cyl(b, 'frameGunmetal', 0.18, 0.22, h - 0.3, [x, 0.3, -2.7], { seg: 8, name: 'foundry exhaust stack' });
    ring(b, 'warningAmber', 0.19, 0.03, [x, h - 0.1, -2.7], { seg: 8, name: 'stack beacon ring light' });
  }
  roundedTank(b, 'hullSecondary', 0.55, 1.4, [2.75, 0.18, -1.6], { seg: 10, name: 'coolant silo tank' });
  ring(b, 'energyCyan', 0.56, 0.035, [2.75, 1.0, -1.6], { seg: 12, name: 'silo gauge ring light' });
  strut(b, 'frameGunmetal', [2.75, 2.35, -1.6], [2.2, 2.1, -1.2], 0.07, { name: 'silo manifold pipe' });
  // antenna (mounted on -X left wall so left face carries detail) + transformer + anchored cables
  strut(b, 'frameGunmetal', [-3.6, 0.5, -0.9], [-3.6, 4.6, -0.9], 0.06, { name: 'comms whip mast' });
  lamp(b, 'dangerCrimson', 0.09, [-3.6, 4.66, -0.9], { name: 'mast warning light' });
  cable(b, [-3.6, 4.3, -0.9], [-2.3, 3.2, -2.0], 0.35, 0.025, 'frameGunmetal', { name: 'aerial guy cable' });
  cyl(b, 'hullSecondary', 0.24, 0.26, 0.55, [3.0, 0.18, 1.2], { seg: 8, name: 'factory substation unit' });
  cable(b, [2.85, 1.2, -1.15], [3.0, 0.68, 1.05], 0.22, 0.045, 'frameGunmetal', { name: 'substation feeder cable' });
  return b.build();
}

// ---------------------------------------------------------------- Turret (1x1)
export function turret() {
  const b = new KitbashBuilder();
  plinth(b, 2, 2);
  cyl(b, 'frameGunmetal', 0.78, 0.88, 0.38, [0, 0.18, 0], { seg: 8, name: 'turret pedestal base' });
  cyl(b, 'hullPrimary', 0.6, 0.72, 0.58, [0, 0.52, 0], { seg: 8, name: 'turret barbette' });
  ring(b, 'warningAmber', 0.66, 0.04, [0, 0.75, 0], { seg: 8, name: 'barbette hazard ring light' });
  cyl(b, 'frameGunmetal', 0.45, 0.45, 0.22, [0, 1.06, 0], { seg: 10, name: 'azimuth bearing ring' });
  // turret housing (static in mesh; yawed as a whole by game logic)
  box(b, 'hullPrimary', [0.92, 0.52, 1.0], [0, 1.24, 0], { r: 0.1, seg: 1, name: 'turret breech housing' });
  box(b, 'hullSecondary', [0.96, 0.12, 0.52], [0, 1.72, -0.15], { r: 0.04, name: 'turret roof carapace' });
  box(b, 'frameGunmetal', [0.88, 0.26, 0.36], [0, 1.36, 0.44], { r: 0.05, name: 'cannon mantlet block' });
  // top radar sensor assembly (rotates 360 deg on roof, clear of barrels below)
  const A = spin(0, -0.15);
  cyl(b, 'frameGunmetal', 0.045, 0.045, 0.42, [0, 1.8, -0.15], { seg: 6, name: 'radar rotor mast', ...A });
  dish(b, 0.28, [0, 2.22, -0.15], -0.7, { name: 'targeting radar dish', ...A });
  lamp(b, 'energyCyan', 0.065, [0, 2.28, -0.1], { name: 'radar lock light', ...A });
  // twin barrels with recoil tag (extend cleanly through mantlet collar so -6 cm recoil never deepens vertex embed)
  const R3 = { animType: 3 as const, animPivot: [0, 1.49, 0.55] as V3 };
  for (const sx of [-1, 1]) {
    b.addPart(new THREE.CylinderGeometry(0.095, 0.11, 0.95, 10), 'frameGunmetal', { name: 'autocannon barrel', position: [sx * 0.3, 1.49, 0.72], rotation: [PI / 2, 0, 0], ...R3 });
    b.addPart(new THREE.CylinderGeometry(0.065, 0.065, 0.52, 8), 'frameGunmetal', { name: 'muzzle accelerator tube', position: [sx * 0.3, 1.49, 1.4], rotation: [PI / 2, 0, 0], ...R3 });
    ring(b, 'hullSecondary', 0.115, 0.03, [sx * 0.3, 1.49, 0.95], { rotation: [0, 0, 0], name: 'barrel cooling collar', ...R3 });
    b.addPart(new THREE.CylinderGeometry(0.045, 0.045, 0.02, 8), 'warningAmber', { name: 'muzzle flash suppressor light', position: [sx * 0.3, 1.49, 1.66], rotation: [PI / 2, 0, 0], ...R3 });
  }
  // ammo box + cable anchored to turret housing
  box(b, 'hullSecondary', [0.4, 0.42, 0.4], [-0.75, 0.19, 0.45], { r: 0.05, name: 'ammo feed magazine' });
  cable(b, [-0.75, 0.56, 0.45], [-0.58, 1.04, 0.15], 0.03, 0.035, 'frameGunmetal', { name: 'ammo belt conduit' });
  return b.build();
}

// ---------------------------------------------------------------- Laser tower (1x1)
export function laserTower() {
  const b = new KitbashBuilder();
  plinth(b, 2, 2);
  cyl(b, 'frameGunmetal', 0.76, 0.86, 0.36, [0, 0.18, 0], { seg: 8, name: 'optical tower pedestal base' });
  box(b, 'hullPrimary', [1.16, 0.62, 1.16], [0, 0.50, 0], { r: 0.10, seg: 1, name: 'optical capacitor housing' });
  // Side cooling fin plates & status strips on the 4 housing walls
  for (const sx of [-1, 1]) {
    box(b, 'hullSecondary', [0.08, 0.38, 0.68], [sx * 0.58, 0.62, 0], { r: 0.02, name: 'housing side cooling fin' });
  }
  glow(b, 'energyCyan', [0.68, 0.08, 0.06], [0, 0.82, 0.58], { name: 'capacitor front status light' });
  box(b, 'hullSecondary', [0.68, 0.34, 0.08], [0, 0.62, -0.58], { r: 0.02, name: 'capacitor rear manifold plate' });
  // Vertical optical focus column + plasma rings
  cyl(b, 'hullPrimary', 0.38, 0.48, 0.88, [0, 1.08, 0], { seg: 10, name: 'optical focus column' });
  ring(b, 'energyCyan', 0.46, 0.04, [0, 1.36, 0], { seg: 10, name: 'column focus ring A light' });
  ring(b, 'warningAmber', 0.42, 0.04, [0, 1.68, 0], { seg: 10, name: 'column focus ring B light' });
  cyl(b, 'frameGunmetal', 0.44, 0.44, 0.18, [0, 1.92, 0], { seg: 10, name: 'emitter azimuth collar' });
  // Rotating upper laser emitter head (animType 1 around tower axis)
  const A = spin(0, 0);
  box(b, 'hullSecondary', [0.76, 0.44, 0.84], [0, 2.08, 0], { r: 0.08, seg: 1, name: 'optical emitter head housing', ...A });
  box(b, 'frameGunmetal', [0.56, 0.10, 0.56], [0, 2.50, 0], { r: 0.03, name: 'emitter roof heatsink cap', ...A });
  lamp(b, 'dangerCrimson', 0.075, [0, 2.60, 0], { name: 'emitter targeting beacon light', ...A });
  b.addPart(new THREE.CylinderGeometry(0.16, 0.20, 0.56, 10), 'frameGunmetal', {
    name: 'optical focus barrel', position: [0, 2.30, 0.62], rotation: [PI / 2, 0, 0], ...A,
  });
  ring(b, 'hullPrimary', 0.19, 0.035, [0, 2.30, 0.72], { rotation: [0, 0, 0], name: 'barrel focusing collar', ...A });
  b.addPart(new THREE.CylinderGeometry(0.11, 0.11, 0.06, 10), 'dangerCrimson', {
    name: 'laser aperture lens light', position: [0, 2.30, 0.91], rotation: [PI / 2, 0, 0], emissiveIntensity: 4.5, ...A,
  });
  // External power cell unit + anchored conduit cable
  cyl(b, 'hullSecondary', 0.18, 0.20, 0.50, [0, 0.16, -0.76], { seg: 8, name: 'power cell transformer' });
  cable(b, [0, 0.62, -0.76], [0, 0.86, -0.60], 0.03, 0.03, 'frameGunmetal', { name: 'emitter feeder cable' });
  return b.build();
}
