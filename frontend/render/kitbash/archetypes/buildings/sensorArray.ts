// Low-profile Indra Lanza-style 3D planar phased-array surveillance building: sensorArray (2x2).
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { KitbashBuilder } from '../../KitbashRegistry';
import { gridPort } from './gridPorts';
import { box, cyl, ring, strut, cable, lamp, glow, plinth, spin } from './kit';

const TILT = 0.22;
const CT = Math.cos(TILT);
const ST = Math.sin(TILT);

function addShelterHull(b: KitbashBuilder): void {
  // Low-profile tactical container shelter (y: 0.18..1.10)
  box(b, 'hullPrimary', [1.92, 0.82, 1.88], [-0.15, 0.18, 0.10], { r: 0.08, seg: 1, name: 'telemetry control cabin' });
  box(b, 'hullSecondary', [1.72, 0.14, 1.68], [-0.15, 0.96, 0.10], { r: 0.05, seg: 1, name: 'cabin roof trim deck' });
  strut(b, 'frameGunmetal', [-0.86, 1.09, -0.50], [-0.86, 1.09, 0.70], 0.045, { seg: 5, name: 'left roof cooling rail' });
  strut(b, 'frameGunmetal', [0.56, 1.09, -0.50], [0.56, 1.09, 0.70], 0.045, { seg: 5, name: 'right roof cooling rail' });

  // Front wall (+Z): airlock, terminal pedestal, mounted cyan header lamp (matches BUILDING_LIGHT_RIGS)
  box(b, 'frameGunmetal', [0.62, 0.62, 0.12], [-0.52, 0.18, 1.04], { r: 0.03, seg: 1, name: 'cabin airlock frame' });
  box(b, 'hullSecondary', [0.44, 0.50, 0.08], [-0.52, 0.22, 1.09], { r: 0.02, seg: 1, name: 'cabin airlock door' });
  cyl(b, 'frameGunmetal', 0.16, 0.20, 0.44, [0.30, 0.24, 1.03], { seg: 6, name: 'front telemetry pedestal' });
  glow(b, 'energyCyan', [0.36, 0.10, 0.06], [0.30, 0.52, 1.08], { name: 'front terminal screen light' });
  lamp(b, 'energyCyan', 0.075, [-0.15, 0.88, 1.10], { name: 'sensor cabin header light' });

  // Rear wall (-Z): high-draw power conditioner cabinet
  box(b, 'hullSecondary', [1.10, 0.68, 0.42], [-0.20, 0.18, -0.90], { r: 0.05, seg: 1, name: 'high-draw power conditioner' });
  cyl(b, 'frameGunmetal', 0.09, 0.11, 0.48, [-0.52, 0.22, -1.10], { seg: 5, name: 'conditioner left stabilizer' });
  cyl(b, 'frameGunmetal', 0.09, 0.11, 0.48, [0.12, 0.22, -1.10], { seg: 5, name: 'conditioner right stabilizer' });
  glow(b, 'warningAmber', [0.64, 0.08, 0.06], [-0.20, 0.70, -1.11], { name: 'conditioner load bar light' });

  // Left wall (-X): low cryo-condenser cooling tank & vertical ribs
  cyl(b, 'frameGunmetal', 0.32, 0.36, 0.76, [-1.36, 0.18, 0.10], { seg: 6, name: 'cryo-condenser vessel' });
  cyl(b, 'hullSecondary', 0.38, 0.38, 0.09, [-1.36, 0.46, 0.10], { seg: 6, name: 'cryo pressure band' });
  cyl(b, 'hullPrimary', 0.34, 0.36, 0.12, [-1.36, 0.90, 0.10], { seg: 6, name: 'cryo vessel cap' });
  strut(b, 'hullSecondary', [-1.36, 0.88, 0.10], [-0.80, 0.88, 0.10], 0.065, { seg: 5, name: 'cryo coolant pipe' });
  glow(b, 'energyCyan', [0.06, 0.34, 0.06], [-1.68, 0.48, 0.10], { name: 'cryo sight gauge light' });
  cyl(b, 'frameGunmetal', 0.065, 0.075, 0.48, [-1.12, 0.28, 0.64], { seg: 5, name: 'left front cooling column' });
  cyl(b, 'frameGunmetal', 0.065, 0.075, 0.48, [-1.12, 0.28, -0.44], { seg: 5, name: 'left rear cooling column' });

  // Right wall (+X): signal bus junction manifold & external service cans
  box(b, 'frameGunmetal', [0.26, 0.68, 0.96], [0.84, 0.18, 0.10], { r: 0.04, seg: 1, name: 'signal bus junction housing' });
  cyl(b, 'hullSecondary', 0.14, 0.16, 0.46, [0.94, 0.26, -0.10], { seg: 6, name: 'bus manifold relay can' });
  cyl(b, 'hullSecondary', 0.14, 0.16, 0.46, [0.94, 0.26, 0.30], { seg: 6, name: 'bus manifold filter can' });
  glow(b, 'energyCyan', [0.06, 0.08, 0.48], [0.95, 0.74, 0.10], { name: 'bus status strip light' });
}

function addLanzaPlanarRadar(b: KitbashBuilder): void {
  const rx = -0.15;
  const rz = 0.10;
  cyl(b, 'frameGunmetal', 0.56, 0.62, 0.18, [rx, 1.06, rz], { seg: 6, name: 'radar azimuth slewing base' });
  ring(b, 'energyCyan', 0.58, 0.03, [rx, 1.14, rz], { seg: 6, tubeSeg: 4, name: 'azimuth ring light' });

  const R = spin(rx, rz);
  cyl(b, 'hullSecondary', 0.44, 0.46, 0.16, [rx, 1.22, rz], { seg: 6, name: 'radar rotary turntable', ...R });
  box(b, 'hullSecondary', [0.78, 0.36, 0.40], [rx, 1.34, rz - 0.26], { r: 0.04, seg: 1, name: 'transmitter counterweight cabinet', ...R });
  box(b, 'frameGunmetal', [0.96, 0.20, 0.32], [rx, 1.34, rz + 0.08], { r: 0.04, seg: 1, name: 'array trunnion yoke', ...R });

  // Tilted rectangular planar phased-array panel + backing frame
  const cy = 1.90;
  const cz = rz + 0.18;
  b.addPart(new RoundedBoxGeometry(1.54, 0.88, 0.14, 1, 0.04), 'frameGunmetal', {
    name: 'planar array backing frame',
    position: [rx, cy - 0.06 * ST, cz - 0.06 * CT],
    rotation: [-TILT, 0, 0],
    ...R,
  });
  b.addPart(new RoundedBoxGeometry(1.38, 0.76, 0.10, 1, 0.03), 'hullPrimary', {
    name: 'lanza planar phased array',
    position: [rx, cy, cz],
    rotation: [-TILT, 0, 0],
    ...R,
  });

  // Stacked horizontal waveguide element slats across the tilted face + emissive scan bar
  const rowOffsets = [-0.24, -0.08, 0.24];
  const rowNames = ['lower waveguide row', 'mid waveguide row', 'upper waveguide row'];
  for (let i = 0; i < rowOffsets.length; i++) {
    const dy = rowOffsets[i]!;
    const dz = 0.055;
    const wy = cy + dy * CT + dz * ST;
    const wz = cz - dy * ST + dz * CT;
    strut(b, 'hullSecondary', [rx - 0.62, wy, wz], [rx + 0.62, wy, wz], 0.032, { seg: 5, name: rowNames[i]!, ...R });
  }
  const scanDy = 0.08;
  const scanDz = 0.055;
  b.addPart(new THREE.BoxGeometry(1.22, 0.05, 0.055), 'energyCyan', {
    name: 'phased array scan bar light',
    position: [rx, cy + scanDy * CT + scanDz * ST, cz - scanDy * ST + scanDz * CT],
    rotation: [-TILT, 0, 0],
    emissiveIntensity: 3.6,
    ...R,
  });

  // Rear A-frame hydraulic elevation struts + top horizontal IFF interrogator bar
  strut(b, 'frameGunmetal', [rx - 0.36, 1.40, rz - 0.24], [rx - 0.44, 2.04, rz + 0.04], 0.055, { seg: 5, name: 'left array elevation strut', ...R });
  strut(b, 'frameGunmetal', [rx + 0.36, 1.40, rz - 0.24], [rx + 0.44, 2.04, rz + 0.04], 0.055, { seg: 5, name: 'right array elevation strut', ...R });
  strut(b, 'frameGunmetal', [rx - 0.42, 2.24, rz + 0.03], [rx - 0.42, 2.44, rz + 0.01], 0.04, { seg: 5, name: 'left iff riser', ...R });
  strut(b, 'frameGunmetal', [rx + 0.42, 2.24, rz + 0.03], [rx + 0.42, 2.44, rz + 0.01], 0.04, { seg: 5, name: 'right iff riser', ...R });
  box(b, 'hullSecondary', [1.24, 0.11, 0.10], [rx, 2.40, rz + 0.01], { r: 0.025, seg: 1, name: 'iff interrogator bar antenna', ...R });
  glow(b, 'energyCyan', [0.36, 0.05, 0.05], [rx, 2.43, rz + 0.06], { name: 'iff beacon bar light', ...R });
}

function addAntennas(b: KitbashBuilder): void {
  // Antenna 1: Rear-right elevated power grid mast at [1.35, y, -1.25] -> gridPort terminal at y = 2.95
  cyl(b, 'hullPrimary', 0.24, 0.30, 0.36, [1.35, 0.18, -1.25], { seg: 6, name: 'grid mast plinth pad' });
  cyl(b, 'hullSecondary', 0.25, 0.25, 0.10, [1.35, 0.52, -1.25], { seg: 6, name: 'grid mast isolator collar' });
  cyl(b, 'frameGunmetal', 0.10, 0.14, 1.84, [1.35, 0.56, -1.25], { seg: 5, name: 'grid antenna tower mast' });
  cyl(b, 'hullSecondary', 0.15, 0.15, 0.09, [1.35, 1.45, -1.25], { seg: 5, name: 'grid mast stiffening collar' });
  strut(b, 'frameGunmetal', [1.35, 0.82, -1.25], [0.80, 0.82, -0.35], 0.045, { seg: 5, name: 'grid mast upper brace' });
  cable(b, [1.28, 0.48, -1.16], [0.90, 0.44, -0.28], 0.07, 0.032, 'frameGunmetal', { points: 3, seg: 3, name: 'grid power feeder cable' });
  gridPort(b, 'building.sensorArray', 2.30);

  // Antenna 2: Rear-left compact dipole mast at [-1.42, y, -1.25]
  cyl(b, 'frameGunmetal', 0.22, 0.26, 0.30, [-1.42, 0.18, -1.25], { seg: 5, name: 'dipole antenna pedestal' });
  cyl(b, 'hullSecondary', 0.16, 0.18, 0.12, [-1.42, 0.44, -1.25], { seg: 5, name: 'dipole base collar' });
  cyl(b, 'hullSecondary', 0.07, 0.10, 1.68, [-1.42, 0.52, -1.25], { seg: 5, name: 'dipole antenna mast' });
  strut(b, 'frameGunmetal', [-1.74, 1.62, -1.25], [-1.10, 1.62, -1.25], 0.035, { seg: 5, name: 'lower dipole crossarm' });
  strut(b, 'frameGunmetal', [-1.66, 1.94, -1.25], [-1.18, 1.94, -1.25], 0.032, { seg: 5, name: 'upper dipole crossarm' });
  cyl(b, 'hullPrimary', 0.028, 0.032, 0.38, [-1.71, 1.44, -1.25], { seg: 5, name: 'left dipole tip rod' });
  cyl(b, 'hullPrimary', 0.028, 0.032, 0.38, [-1.13, 1.44, -1.25], { seg: 5, name: 'right dipole tip rod' });
  lamp(b, 'warningAmber', 0.06, [-1.42, 2.23, -1.25], { housing: false, name: 'dipole mast beacon light' });
  cable(b, [-1.36, 0.52, -1.18], [-0.72, 0.52, -0.90], 0.05, 0.028, 'frameGunmetal', { points: 3, seg: 3, name: 'dipole coax feeder cable' });

  // Antenna 3: Front-right compact monopole whip at [1.35, y, 1.32]
  cyl(b, 'hullSecondary', 0.20, 0.26, 0.34, [1.35, 0.18, 1.32], { seg: 5, name: 'whip monopole base pad' });
  cyl(b, 'hullPrimary', 0.13, 0.13, 0.36, [1.35, 0.46, 1.32], { seg: 5, name: 'whip phasing coil' });
  cyl(b, 'frameGunmetal', 0.038, 0.07, 1.54, [1.35, 0.78, 1.32], { seg: 5, name: 'whip monopole shaft' });
  cyl(b, 'hullSecondary', 0.09, 0.09, 0.07, [1.35, 1.35, 1.32], { seg: 5, name: 'whip lower tuning ring' });
  cyl(b, 'hullSecondary', 0.09, 0.09, 0.07, [1.35, 1.85, 1.32], { seg: 5, name: 'whip upper tuning ring' });
  lamp(b, 'energyCyan', 0.055, [1.35, 2.35, 1.32], { housing: false, name: 'whip monopole beacon light' });
  strut(b, 'frameGunmetal', [1.35, 0.30, 1.12], [0.90, 0.30, 0.52], 0.042, { seg: 5, name: 'whip signal conduit' });
}

/** Builds the T1 Sensor Array (2x2): low tactical shelter, rotating Lanza planar radar + IFF bar, and 3 antennas. */
export function sensorArray(): THREE.BufferGeometry {
  const b = new KitbashBuilder();
  plinth(b, 4, 4);
  addShelterHull(b);
  addLanzaPlanarRadar(b);
  addAntennas(b);
  return b.build();
}
