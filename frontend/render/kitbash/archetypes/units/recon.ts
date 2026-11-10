import * as THREE from 'three';
import type { KitbashBuilder } from '../../KitbashRegistry';
import { rbox, cyl, strut, mirror, type V3 } from '../../greebles/unitParts';
import { register } from './common';
import { activeReconPalette, stampMercenaryMarks } from './reconFaction';

/** Three driven axles, with independently stamped wheel pivots and visible rims/hubs. */
function runningGear(b: KitbashBuilder): void {
  b.addPart(rbox(0.58, 0.22, 1.22, 0.04), 'frameGunmetal', { name: 'under chassis', position: [0, 0.37, 0] });
  for (const z of [-0.48, 0, 0.48]) {
    mirror(s => {
      b.addPart(cyl(0.045, 0.045, 0.30, 8), 'frameGunmetal', {
        name: 'suspension half axle', position: [s * 0.35, 0.26, z], rotation: [0, 0, Math.PI / 2],
      });
      b.addPart(new THREE.BoxGeometry(0.04, 0.11, 0.08), 'hullSecondary', {
        name: 'chassis suspension bracket', position: [s * 0.29, 0.33, z],
      });
      const pivot: V3 = [s * 0.47, 0.23, z];
      const wheel = { animType: 7 as const, animPivot: pivot, rotation: [0, 0, Math.PI / 2] as V3 };
      b.addPart(cyl(0.23, 0.23, 0.18, 12), 'rubberDark', { name: 'wheel tyre', position: pivot, ...wheel });
      b.addPart(cyl(0.15, 0.15, 0.04, 12), 'hullPrimary', { name: 'wheel rim', position: [s * 0.555, 0.23, z], ...wheel });
      b.addPart(cyl(0.065, 0.065, 0.045, 8), 'hullSecondary', { name: 'wheel hub', position: [s * 0.58, 0.23, z], ...wheel });
    });
  }
}

function armoredBody(b: KitbashBuilder): void {
  b.addPart(rbox(0.74, 0.30, 1.36, 0.07), 'hullPrimary', { name: 'body hull', position: [0, 0.57, 0] });
  // A chamfered glacis, inset driver optics and raised service details keep the nose readable.
  b.addPart(rbox(0.54, 0.10, 0.28, 0.035), 'hullSecondary', { name: 'front glacis armor', position: [0, 0.70, 0.47] });
  b.addPart(rbox(0.28, 0.065, 0.045, 0.012), 'glassVisor', { name: 'driver visor', position: [0, 0.66, 0.681] });
  b.addPart(rbox(0.32, 0.05, 0.24, 0.018), 'frameGunmetal', { name: 'rear engine access hatch', position: [0, 0.73, -0.48] });
  for (const x of [-0.09, 0, 0.09]) {
    b.addPart(new THREE.BoxGeometry(0.028, 0.035, 0.19), 'hullSecondary', { name: 'engine cooling slat', position: [x, 0.76, -0.48] });
  }
  mirror(s => {
    b.addPart(rbox(0.15, 0.07, 1.38, 0.025), 'hullPrimary', { name: 'hull mudguard', position: [s * 0.405, 0.52, 0] });
    b.addPart(new THREE.BoxGeometry(0.09, 0.035, 0.22), 'frameGunmetal', { name: 'mudguard tread plate', position: [s * 0.42, 0.56, -0.34] });
    b.addPart(new THREE.BoxGeometry(0.035, 0.12, 0.62), 'hullSecondary', { name: 'side armor strip', position: [s * 0.37, 0.64, -0.08] });
    b.addPart(cyl(0.047, 0.047, 0.05, 8), 'energyCyan', {
      name: 'headlamp light', position: [s * 0.26, 0.57, 0.67], rotation: [Math.PI / 2, 0, 0], emissiveIntensity: 3.5,
    });
    b.addPart(cyl(0.028, 0.028, 0.045, 8), 'warningAmber', {
      name: 'tail lamp light', position: [s * 0.25, 0.57, -0.68], rotation: [Math.PI / 2, 0, 0], emissiveIntensity: 3.2,
    });
    b.addPart(cyl(0.035, 0.045, 0.10, 8), 'hullSecondary', { name: 'antenna socket', position: [s * 0.28, 0.74, -0.48] });
    strut(b, [s * 0.28, 0.77, -0.48], [s * 0.32, 1.30 + s * 0.05, -0.60], 0.009, 'frameGunmetal', { name: 'radio antenna whip' });
  });
}

function turret(b: KitbashBuilder): void {
  b.addPart(cyl(0.24, 0.24, 0.10, 12), 'frameGunmetal', { name: 'turret bearing', position: [0, 0.74, 0.03] });
  b.addPart(rbox(0.46, 0.22, 0.50, 0.055), 'hullPrimary', { name: 'recon turret housing', position: [0, 0.88, 0.03] });
  b.addPart(cyl(0.10, 0.10, 0.04, 10), 'hullSecondary', { name: 'turret commander hatch', position: [0, 0.995, -0.03] });
  b.addPart(rbox(0.15, 0.09, 0.055, 0.014), 'glassVisor', { name: 'turret sight visor', position: [-0.135, 0.93, 0.275] });
  b.addPart(cyl(0.024, 0.024, 0.03, 8), 'energyCyan', {
    name: 'turret rangefinder light', position: [-0.135, 0.93, 0.31], rotation: [Math.PI / 2, 0, 0], emissiveIntensity: 3.5,
  });
  b.addPart(rbox(0.13, 0.13, 0.17, 0.025), 'hullSecondary', { name: 'recon gun mantlet', position: [0.06, 0.87, 0.29] });
  b.addPart(cyl(0.033, 0.04, 0.55, 10), 'frameGunmetal', {
    name: 'recon cannon barrel', position: [0.06, 0.87, 0.59], rotation: [Math.PI / 2, 0, 0],
  });
  b.addPart(cyl(0.05, 0.05, 0.10, 10), 'hullSecondary', {
    name: 'recon muzzle brake', position: [0.06, 0.87, 0.85], rotation: [Math.PI / 2, 0, 0],
  });
}

function buildRecon(b: KitbashBuilder): void {
  runningGear(b);
  armoredBody(b);
  turret(b);
  if (activeReconPalette().marks) stampMercenaryMarks(b);
}

register({
  id: 'robot.recon', label: 'Recon Armored Scout', category: 'robot', footprint: [1, 1],
  notes: 'Six-wheel light armored recon vehicle: driven wheels, independent autocannon turret, driver optics and twin radio antennas. Holds position while firing. faction=mercenary repaints the hull grey-teal and adds a roof emblem plus an emissive marker.',
  zones: () => activeReconPalette().zones,
  build: buildRecon,
});
