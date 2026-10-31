import * as THREE from 'three';
import { KitbashBuilder } from '../KitbashRegistry';
import { rbox, cyl, sph, strut, sag, mirror, lathe, type V3 } from '../greebles/unitParts';
import { register } from './units/common';

// Artificial orbital objects (~1.2–2.4 m native size; the orbit stage scales them). Origin = body centre, nose +Z.
// Pillar 1: >= 7 parts, silhouette breakers, 60/30/10 zones, emissive beacons with aPartAnim tags. Ground-snap waived.

const solarWing = (b: KitbashBuilder, side: 1 | -1, startX: number, reach: number, zSpan = 1.15, y = 0) => {
  strut(b, [side * (startX - 0.08), y, 0], [side * (startX + 0.35), y, 0], 0.045, 'frameGunmetal');
  const cx = side * (startX + 0.3 + reach / 2);
  b.addPart(rbox(reach, 0.04, zSpan, 0.01, 1), 'frameGunmetal', { name: 'solar wing frame', position: [cx, y, 0] });
  const cols = 3, rows = 2, margin = 0.04, gap = 0.018;
  const cw = (reach - 2 * margin - (cols - 1) * gap) / cols;
  const cd = (zSpan - 2 * margin - (rows - 1) * gap) / rows;
  for (let c = 0; c < cols; c++) {
    for (let r = 0; r < rows; r++) {
      const lx = -reach / 2 + margin + cw / 2 + c * (cw + gap);
      const lz = -zSpan / 2 + margin + cd / 2 + r * (cd + gap);
      b.addPart(new THREE.BoxGeometry(cw, 0.016, cd), 'solarCell', {
        name: 'solar cell',
        position: [cx + lx, y + 0.018, lz],
      });
    }
  }
  b.addPart(new THREE.BoxGeometry(reach - 2 * margin, 0.02, 0.014), 'hullPrimary', {
    name: 'solar bus bar',
    position: [cx, y + 0.022, 0],
  });
};

register({
  id: 'prop.satComms', label: 'Comms Satellite', category: 'prop', footprint: [2, 2], snap: false,
  notes: 'Bus + gold foil band, 2 solar wings, parabolic dish, whip antenna, beacon.',
  build: (b) => {
    b.addPart(rbox(1.0, 0.9, 1.3, 0.12), 'hullPrimary');
    b.addPart(rbox(1.04, 0.24, 1.34, 0.06), 'hullSecondary', { position: [0, 0.1, 0] });          // foil band
    b.addPart(rbox(0.88, 0.2, 1.16, 0.05), 'frameGunmetal', { position: [0, -0.48, 0] });         // thruster deck
    b.addPart(rbox(0.54, 0.26, 0.08, 0.02), 'hullSecondary', { position: [0, -0.14, 0.64] });     // forward sensor plate
    b.addPart(sph(0.075), 'energyCyan', { position: [0, -0.14, 0.68], emissiveIntensity: 3.8 });
    mirror((s) => solarWing(b, s, 0.5, 2.0, 1.15, 0));
    // Parabolic dish on mast
    const dishSpin = { animType: 1 as const, animPivot: [0, 0.88, 0.15] as V3 };
    b.addPart(cyl(0.07, 0.09, 0.52, 8), 'frameGunmetal', { position: [0, 0.64, 0.15] });
    b.addPart(cyl(0.16, 0.18, 0.12, 10), 'hullSecondary', { position: [0, 0.9, 0.15], rotation: [-0.45, 0, 0], ...dishSpin });
    b.addPart(lathe([[0, 0], [0.22, 0.04], [0.42, 0.14], [0.52, 0.26], [0, 0.08]], 14), 'hullPrimary', {
      position: [0, 0.88, 0.15], rotation: [-0.45, 0, 0], ...dishSpin,
    });
    b.addPart(cyl(0.025, 0.03, 0.34, 6), 'frameGunmetal', { position: [0, 1.04, 0.23], rotation: [-0.45, 0, 0], ...dishSpin });
    b.addPart(sph(0.065), 'energyCyan', { position: [0, 1.18, 0.3], emissiveIntensity: 4, ...dishSpin });
    // Aft whip antenna + beacon + thruster nozzle + power harness
    strut(b, [0.32, 0.38, -0.48], [0.55, 0.95, -0.85], 0.02, 'frameGunmetal');
    b.addPart(sph(0.065), 'warningAmber', { position: [0.55, 0.95, -0.85], emissiveIntensity: 4.2 });
    sag(b, [0.49, 0.22, 0.18], [0.92, 0.0, 0.18], 0.06, 0.018);
    b.addPart(cyl(0.14, 0.2, 0.24, 10), 'frameGunmetal', { position: [0, -0.1, -0.7], rotation: [Math.PI / 2, 0, 0] });
  },
});

register({
  id: 'prop.satSolar', label: 'Solar Relay', category: 'prop', footprint: [2, 2], snap: false,
  notes: 'Long truss with 4 big solar sails, central power core, radiator fins.',
  build: (b) => {
    b.addPart(rbox(0.9, 0.84, 1.6, 0.12), 'hullPrimary');
    b.addPart(cyl(0.32, 0.32, 1.76, 12), 'frameGunmetal', { rotation: [Math.PI / 2, 0, 0], position: [0, 0, 0] });
    b.addPart(cyl(0.34, 0.38, 0.12, 10), 'hullSecondary', { position: [0, 0.42, 0] });
    b.addPart(sph(0.26), 'energyCyan', { position: [0, 0.52, 0], emissiveIntensity: 3.8 });
    b.addPart(rbox(0.16, 0.16, 3.8, 0.03), 'frameGunmetal', { position: [0, 0, 0] });
    b.addPart(rbox(0.28, 0.24, 0.18, 0.03), 'hullSecondary', { position: [0, 0, 1.88] });
    b.addPart(rbox(0.28, 0.24, 0.18, 0.03), 'hullSecondary', { position: [0, 0, -1.88] });
    mirror((s) => {
      solarWing(b, s, 0.45, 2.3, 1.25, 0.0);
      b.addPart(rbox(0.06, 0.72, 0.54, 0.02), 'hullSecondary', { position: [s * 0.32, -0.62, 0.35] }); // radiator fin
      b.addPart(rbox(0.04, 0.52, 0.14, 0.01), 'frameGunmetal', { position: [s * 0.35, -0.64, 0.35] });
    });
    b.addPart(sph(0.08), 'warningAmber', { position: [0, 0, 1.98], emissiveIntensity: 4 });
    strut(b, [0, 0.36, -0.55], [0, 1.05, -0.95], 0.025, 'frameGunmetal');
    b.addPart(sph(0.07), 'energyCyan', { position: [0, 1.05, -0.95], emissiveIntensity: 3.6 });
    sag(b, [0.44, 0.22, 0.2], [0.88, 0.0, 0.2], 0.06, 0.018);
  },
});

register({
  id: 'prop.stationRing', label: 'Orbital Habitat Ring', category: 'prop', footprint: [4, 4], snap: false,
  notes: 'Spinning habitat ring on spokes around a docking hub, solar masts, dish, nav lights.',
  build: (b) => {
    // Central static docking hub along Y axis
    b.addPart(cyl(0.45, 0.45, 2.2, 12), 'hullPrimary');
    b.addPart(cyl(0.52, 0.52, 0.26, 12), 'hullSecondary', { position: [0, 0.65, 0] });
    b.addPart(cyl(0.52, 0.52, 0.26, 12), 'hullSecondary', { position: [0, -0.65, 0] });
    b.addPart(cyl(0.28, 0.4, 0.32, 10), 'frameGunmetal', { position: [0, 1.18, 0] }); // upper dock
    b.addPart(sph(0.09), 'dangerCrimson', { position: [0, -1.12, 0], emissiveIntensity: 4.2 });
    // Spinning habitat ring assembly in XZ plane (y = 0)
    const ringSpin = { animType: 1 as const, animPivot: [0, 0, 0] as V3 };
    b.addPart(cyl(0.56, 0.56, 0.32, 12), 'hullSecondary', { position: [0, 0, 0], ...ringSpin });
    b.addPart(new THREE.TorusGeometry(1.65, 0.2, 8, 28), 'hullPrimary', { rotation: [Math.PI / 2, 0, 0], ...ringSpin });
    b.addPart(new THREE.TorusGeometry(1.65, 0.065, 6, 28), 'energyCyan', {
      position: [0, 0.18, 0], rotation: [Math.PI / 2, 0, 0], emissiveIntensity: 3.4, ...ringSpin,
    });
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
      strut(b, [Math.cos(a) * 0.5, 0, Math.sin(a) * 0.5], [Math.cos(a) * 1.55, 0, Math.sin(a) * 1.55], 0.055, 'frameGunmetal', ringSpin);
    }
    mirror((s) => {
      b.addPart(rbox(0.36, 0.28, 0.38, 0.04), 'hullSecondary', { position: [s * 1.65, 0, 0], ...ringSpin });
    });
    // Solar wings on upper static collar (y = 0.65, well clear of spinning ring at y = 0)
    mirror((s) => { solarWing(b, s, 0.5, 1.8, 1.05, 0.65); });
    // Lower static comms dish + power harness
    b.addPart(lathe([[0, 0], [0.18, 0.04], [0.36, 0.14], [0, 0.06]], 12), 'hullPrimary', {
      position: [0, -0.65, 0.52], rotation: [Math.PI / 2, 0, 0],
    });
    b.addPart(sph(0.065), 'energyCyan', { position: [0, -0.65, 0.64], emissiveIntensity: 3.8 });
    sag(b, [0.49, 0.72, 0.12], [0.92, 0.65, 0.12], 0.05, 0.018);
  },
});
