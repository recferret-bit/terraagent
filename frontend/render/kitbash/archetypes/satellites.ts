import * as THREE from 'three';
import { KitbashBuilder } from '../KitbashRegistry';
import { rbox, cyl, sph, strut, sag, mirror, lathe, type V3 } from '../greebles/unitParts';
import { register } from './units/common';

// Artificial orbital objects (~1.2–2.4 m native size; the orbit stage scales them). Origin = body centre, nose +Z.
// Pillar 1: >= 7 parts, silhouette breakers, 60/30/10 zones, emissive beacons with aPartAnim tags. Ground-snap waived.

const solarWing = (b: KitbashBuilder, side: 1 | -1, reach: number, panels: number, y = 0) => {
  strut(b, [side * 0.55, y, 0], [side * 0.95, y, 0], 0.05, 'frameGunmetal');
  for (let i = 0; i < panels; i++) {
    const x = side * (1.0 + 0.5 * reach * (i + 0.5) / panels * 2);
    b.addPart(rbox(reach / panels * 0.96, 0.05, 1.5, 0.02), 'solarCell', { position: [x + side * 0.0, y, 0] });
    b.addPart(rbox(reach / panels * 0.96, 0.03, 0.12, 0.01), 'frameGunmetal', { position: [x, y + 0.03, 0.4] });
  }
  b.addPart(rbox(reach + 0.1, 0.035, 0.08, 0.01), 'frameGunmetal', { position: [side * (1.0 + reach * 0.5), y - 0.03, 0] });
};

register({
  id: 'prop.satComms', label: 'Comms Satellite', category: 'prop', footprint: [2, 2], snap: false,
  notes: 'Bus + gold foil band, 2 solar wings, parabolic dish, whip antenna, beacon.',
  build: (b) => {
    b.addPart(rbox(1.0, 0.9, 1.3, 0.14), 'hullPrimary');
    b.addPart(rbox(1.04, 0.22, 1.34, 0.08), 'hullSecondary', { position: [0, 0.12, 0] });         // foil band
    b.addPart(rbox(0.9, 0.2, 1.2, 0.06), 'frameGunmetal', { position: [0, -0.52, 0] });           // thruster deck
    mirror((s) => solarWing(b, s, 2.2, 3));
    b.addPart(cyl(0.05, 0.07, 0.5, 8), 'frameGunmetal', { position: [0, 0.65, 0.2] });
    b.addPart(lathe([[0, 0], [0.3, 0.05], [0.6, 0.2], [0.8, 0.38], [0, 0.1]], 20), 'hullPrimary', {
      position: [0, 1.0, 0.2], rotation: [-0.9, 0, 0.25], animType: 1, animPivot: [0, 1.0, 0.2],
    });
    b.addPart(sph(0.07), 'energyCyan', { position: [0, 1.3, 0.55], emissiveIntensity: 4, animType: 1, animPivot: [0, 1.0, 0.2] });
    strut(b, [0.3, 0.45, -0.4], [0.9, 1.3, -0.9], 0.015, 'frameGunmetal');                         // whip antenna
    b.addPart(sph(0.06), 'warningAmber', { position: [0.9, 1.3, -0.9], emissiveIntensity: 4.2, animType: 3, animPivot: [0.9, 1.3, -0.9] });
    sag(b, [0.45, 0.2, 0.6], [1.0, 0.0, 0.0], 0.15, 0.015);
    b.addPart(cyl(0.12, 0.16, 0.2, 10), 'frameGunmetal', { position: [0, -0.1, -0.78], rotation: [Math.PI / 2, 0, 0] });
  },
});

register({
  id: 'prop.satSolar', label: 'Solar Relay', category: 'prop', footprint: [2, 2], snap: false,
  notes: 'Long truss with 4 big solar sails, central power core, radiator fins.',
  build: (b) => {
    b.addPart(rbox(0.8, 0.8, 1.6, 0.12), 'hullPrimary');
    b.addPart(cyl(0.3, 0.3, 1.7, 12), 'frameGunmetal', { rotation: [Math.PI / 2, 0, 0], position: [0, 0, 0] });
    b.addPart(sph(0.28), 'energyCyan', { position: [0, 0.5, 0], emissiveIntensity: 3.8, animType: 3, animPivot: [0, 0.5, 0] });
    b.addPart(rbox(0.12, 0.12, 4.2, 0.03), 'frameGunmetal', { position: [0, 0, 0] });
    mirror((s) => {
      solarWing(b, s, 2.6, 4, 0.0);
      b.addPart(rbox(0.05, 0.9, 0.5, 0.02), 'hullSecondary', { position: [s * 0.5, -0.65, 0.4] });  // radiator fin
    });
    b.addPart(rbox(0.06, 0.06, 4.0, 0.02), 'frameGunmetal', { position: [0, 0, 0] });
    b.addPart(sph(0.07), 'warningAmber', { position: [0, 0.05, 2.1], emissiveIntensity: 4, animType: 3, animPivot: [0, 0.05, 2.1] });
    strut(b, [0, 0.4, -0.6], [0, 1.2, -1.0], 0.02, 'frameGunmetal');
  },
});

register({
  id: 'prop.stationRing', label: 'Orbital Habitat Ring', category: 'prop', footprint: [4, 4], snap: false,
  notes: 'Spinning habitat ring on spokes around a docking hub, solar masts, dish, nav lights.',
  build: (b) => {
    b.addPart(cyl(0.45, 0.45, 2.2, 14), 'hullPrimary', { rotation: [Math.PI / 2, 0, 0] });         // hub
    b.addPart(cyl(0.5, 0.5, 0.3, 14), 'hullSecondary', { rotation: [Math.PI / 2, 0, 0], position: [0, 0, 0.7] });
    b.addPart(cyl(0.28, 0.4, 0.35, 12), 'frameGunmetal', { rotation: [Math.PI / 2, 0, 0], position: [0, 0, 1.3] }); // dock
    b.addPart(new THREE.TorusGeometry(1.7, 0.2, 10, 40), 'hullPrimary', { animType: 1, animPivot: [0, 0, 0] });
    b.addPart(new THREE.TorusGeometry(1.7, 0.06, 6, 40), 'energyCyan', { position: [0, 0, 0.19], emissiveIntensity: 3.4, animType: 1, animPivot: [0, 0, 0] });
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
      strut(b, [0, 0, 0], [Math.cos(a) * 1.7, Math.sin(a) * 1.7, 0], 0.05, 'frameGunmetal');
    }
    mirror((s) => { solarWing(b, s, 1.8, 3, 0); });
    b.addPart(lathe([[0, 0], [0.2, 0.04], [0.42, 0.14], [0.55, 0.28], [0, 0.08]], 16), 'hullPrimary', { position: [0, 0.8, -0.5], rotation: [-0.8, 0, 0], animType: 1, animPivot: [0, 0.8, -0.5] });
    b.addPart(sph(0.07), 'dangerCrimson', { position: [0, 0, -1.2], emissiveIntensity: 4.2, animType: 3, animPivot: [0, 0, -1.2] });
    sag(b, [0, 0.45, 0.3], [0, 1.2, -0.3], 0.1, 0.02);
  },
});
