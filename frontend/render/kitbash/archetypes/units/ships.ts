import * as THREE from 'three';
import { KitbashBuilder, type MaterialZoneId, type PartOptions } from '../../KitbashRegistry';
import { rbox, cyl, sph, strut, sag, mirror, lathe, type V3 } from '../../greebles/unitParts';
import { register } from './common';

const dish = (b: KitbashBuilder, pos: V3, r: number, tilt = -0.6, latheSeg = 12) => {
  b.addPart(cyl(r * 0.12, r * 0.15, r * 1.05, 8), 'frameGunmetal', { name: 'dish mast', position: [pos[0], pos[1] - r * 0.42, pos[2]] });
  b.addPart(lathe([[0.02, 0], [r * 0.4, r * 0.08], [r * 0.8, r * 0.3], [r, r * 0.42], [0.02, r * 0.12]], latheSeg), 'hullPrimary', {
    name: 'radar dish', position: pos, rotation: [tilt, 0, 0], animType: 1, animPivot: pos,
  });
  b.addPart(cyl(r * 0.035, r * 0.035, r * 0.52, 6), 'frameGunmetal', {
    name: 'dish feed boom', position: [pos[0], pos[1] + r * 0.24, pos[2] + r * 0.15], rotation: [0.55, 0, 0], animType: 1, animPivot: pos,
  });
  b.addPart(sph(r * 0.11, 8, 6), 'energyCyan', {
    name: 'dish feed horn light', position: [pos[0], pos[1] + r * 0.45, pos[2] + r * 0.3], emissiveIntensity: 4, animType: 1, animPivot: pos,
  });
};

export interface CarrierHullOpts {
  /** Repaint a named part. Omit to keep the carrier livery. */
  zoneFor?: (name: string, stock: MaterialZoneId) => MaterialZoneId;
  /**
   * Segments on the carrier's 8-side cylinders (not the dish masts). Default 8 matches ship.carrier.
   * The guild trader drops to 6 so added cargo pods stay under the 3.5k triangle cap.
   */
  roundSeg?: number;
  /** Radar-dish lathe segments. Default 12 matches ship.carrier. */
  dishSeg?: number;
}

// ~52 m, origin at the hull centre, nose = +Z, belly = -Y. ship.carrier and ship.guildTrader both call this.
export function buildCarrierHull(b: KitbashBuilder, opts: CarrierHullOpts = {}): void {
  const roundSeg = opts.roundSeg ?? 8;
  const dishSeg = opts.dishSeg ?? 12;
  const add = (geo: THREE.BufferGeometry, zone: MaterialZoneId, options: PartOptions & { name: string }) =>
    b.addPart(geo, opts.zoneFor ? opts.zoneFor(options.name, zone) : zone, options);

  add(rbox(9, 6.4, 34, 1.6), 'hullPrimary', { name: 'carrier main hull', position: [0, 0, -2] });
  add(rbox(9.4, 1.0, 34.4, 0.4), 'frameGunmetal', { name: 'keel armor belt', position: [0, -1.9, -2] });
  add(lathe([[0.05, 0], [4.2, 0], [3.7, 4], [2.4, 8], [1.0, 10.5], [0.05, 11.5]], 12), 'hullPrimary', {
    name: 'carrier nose cone', position: [0, 0, 14], rotation: [Math.PI / 2, 0, 0], scale: [1.07, 1, 0.78],
  });
  add(cyl(0.9, 1.5, 5.8, 6), 'hullSecondary', { name: 'nose dorsal crest', position: [0, 2.5, 18], rotation: [Math.PI / 2 + 0.28, 0, 0], scale: [1, 1, 0.22] });
  [-10, 2].forEach((z) => add(rbox(9.6, 6.8, 1.0, 0.35), 'hullSecondary', { name: 'hull frame rib', position: [0, 0, z] }));
  add(rbox(10.4, 7.2, 8, 1.2), 'frameGunmetal', { name: 'aft engine block', position: [0, 0, -22] });
  [[-2.6, 1.6], [2.6, 1.6], [-2.6, -1.6], [2.6, -1.6]].forEach(([x, y]) => {
    add(cyl(1.75, 1.75, 0.6, roundSeg), 'hullSecondary', { name: 'thruster mount collar', position: [x, y, -25.8], rotation: [Math.PI / 2, 0, 0] });
    add(cyl(1.5, 1.1, 3, roundSeg), 'frameGunmetal', { name: 'main thruster bell', position: [x, y, -27.2], rotation: [Math.PI / 2, 0, 0] });
    add(cyl(1.15, 1.15, 0.4, roundSeg), 'energyCyan', { name: 'thruster plasma core light', position: [x, y, -28.6], rotation: [Math.PI / 2, 0, 0], emissiveIntensity: 4.5 });
  });

  add(rbox(5, 3, 7, 0.8), 'hullPrimary', { name: 'command bridge superstructure', position: [0, 4.4, 8] });
  add(rbox(4.2, 1.1, 0.5, 0.18), 'glassVisor', { name: 'bridge cockpit visor', position: [0, 4.7, 11.45], rotation: [-0.2, 0, 0] });
  add(cyl(0.12, 0.12, 3.6, 6), 'energyCyan', { name: 'bridge brow light', position: [0, 5.25, 11.5], rotation: [0, 0, Math.PI / 2], emissiveIntensity: 4.2 });
  add(rbox(3, 1.3, 3.5, 0.4), 'hullSecondary', { name: 'upper sensor citadel', position: [0, 6.2, 6.8] });
  strut(b, [0, 6.6, 5.3], [0, 14, 4.0], 0.14, 'frameGunmetal', { name: 'primary comms mast' });
  add(sph(0.28, 8, 6), 'warningAmber', { name: 'mast beacon light', position: [0, 14.05, 4.0], emissiveIntensity: 4 });
  dish(b, [-1.1, 7.6, 7.6], 1.1, -0.6, dishSeg);
  dish(b, [1.8, 6.3, 9.8], 0.95, -0.75, dishSeg);
  sag(b, [0, 12.8, 4.2], [-2.1, 5.2, 6.0], 1.1, 0.07, 'frameGunmetal', { name: 'bridge telemetry cable' });

  [-9, -15].forEach((z, i) => {
    add(cyl(1.4, 1.4, 4.0, roundSeg), i % 2 ? 'hullSecondary' : 'hullPrimary', { name: 'dorsal cargo tank', position: [0, 3.8, z], rotation: [Math.PI / 2, 0, 0] });
  });
  add(cyl(0.22, 0.22, 14.5, roundSeg), 'frameGunmetal', { name: 'dorsal spine conduit', position: [0, 3.2, -12.5], rotation: [Math.PI / 2, 0, 0] });

  mirror((s) => {
    add(cyl(0.32, 0.38, 8.2, roundSeg), 'frameGunmetal', { name: 'wing root boom', position: [8.0 * s, 0.65, -8], rotation: [0, 0, Math.PI / 2] });
    add(rbox(11, 0.32, 9, 0.12), 'frameGunmetal', { name: 'collector wing frame', position: [14.0 * s, 0.65, -8] });
    for (let i = 0; i < 3; i++) {
      add(cyl(1.4, 1.4, 8.2, 6), i === 1 ? 'hullSecondary' : 'hullPrimary', {
        name: 'wing collector vane', position: [(10.5 + i * 3.5) * s, 0.78, -8], rotation: [Math.PI / 2, 0, 0], scale: [1, 1, 0.14],
      });
    }
    add(cyl(0.12, 0.12, 8.4, 6), 'energyCyan', { name: 'wing tip plasma strip light', position: [19.45 * s, 0.65, -8], rotation: [Math.PI / 2, 0, 0], emissiveIntensity: 3.8 });
  });

  add(rbox(6.4, 0.9, 16, 0.25), 'hullSecondary', { name: 'drop bay coaming', position: [0, -3.35, 1] });
  add(new THREE.BoxGeometry(5.0, 0.5, 14.6), 'frameGunmetal', { name: 'drop bay well', position: [0, -3.68, 1] });
  mirror((s) => {
    add(cyl(0.14, 0.14, 15.2, 6), 'warningAmber', { name: 'bay guide strip light', position: [2.85 * s, -3.78, 1], rotation: [Math.PI / 2, 0, 0], emissiveIntensity: 3.6 });
    add(rbox(2.2, 0.3, 14, 0.12), 'hullPrimary', { name: 'drop bay door', position: [3.65 * s, -3.75, 1], rotation: [0, 0, 0.65 * s] });
  });
  [-4.0, 1.0, 6.0].forEach((z) => {
    add(cyl(1.0, 1.0, 0.65, 10), 'frameGunmetal', { name: 'racked pod adapter', position: [0, -4.05, z] });
    add(new THREE.ConeGeometry(0.85, 1.7, 10), 'hullPrimary', { name: 'racked drop pod', position: [0, -5.0, z], rotation: [Math.PI, 0, 0] });
    add(cyl(0.82, 0.82, 0.14, 10), 'energyCyan', { name: 'pod clamp ring light', position: [0, -4.32, z], emissiveIntensity: 3.6 });
  });
  mirror((s) => {
    strut(b, [3.6 * s, -2.2, -14], [5.6 * s, -4.55, -15], 0.26, 'frameGunmetal', { name: 'landing skid strut' });
    add(cyl(0.35, 0.35, 4.2, roundSeg), 'frameGunmetal', { name: 'landing skid runner', position: [5.6 * s, -4.65, -15], rotation: [Math.PI / 2, 0, 0] });
  });
}

register({
  id: 'ship.carrier',
  label: 'Orbital Carrier',
  category: 'ship',
  footprint: [8, 20],
  snap: false,
  notes: '52m mothership: nose cone, bridge tower, belly drop-bay with pods, 4 engines, collector wings, rotating dishes.',
  build: (b) => buildCarrierHull(b),
});

// ---------------------------------------------------------------------------
// Drop pod — base at y=0 (centre of heat shield), ~3 m tall.
// ---------------------------------------------------------------------------
function podShell(b: KitbashBuilder) {
  // Ablative heat shield (underside, charred) + proud rim collar
  b.addPart(
    lathe([[0.02, 0], [0.7, 0.02], [1.15, 0.14], [1.32, 0.34], [1.3, 0.5], [0.02, 0.5]], 16),
    'frameGunmetal',
    { name: 'ablative heat shield' },
  );
  b.addPart(cyl(1.34, 1.34, 0.08, 16), 'hullSecondary', { name: 'heat shield rim band', position: [0, 0.48, 0] });
  // 4 petal panels with tight seam gaps bridged by ribs
  const outer: [number, number][] = [[1.25, 0.48], [1.0, 1.3], [0.68, 2.3], [0.4, 2.95]];
  const inner = outer.map(([r, y]) => [r - 0.12, y - (y > 2.9 ? 0.02 : 0)] as [number, number]).reverse();
  const prof = [...outer, ...inner];
  for (let i = 0; i < 4; i++) {
    const start = (i * Math.PI) / 2 + 0.018;
    b.addPart(lathe(prof, 8, start, Math.PI / 2 - 0.036), i % 2 ? 'hullSecondary' : 'hullPrimary', { name: `pod petal ${i + 1}` });
  }
  // Panel seam ribs (r=0.042 bridges each 0.036-rad gap without exceeding curved flat-surface threshold)
  for (let i = 0; i < 4; i++) {
    const a = (i * Math.PI) / 2;
    strut(b, [Math.cos(a) * 1.18, 0.5, Math.sin(a) * 1.18], [Math.cos(a) * 0.38, 2.88, Math.sin(a) * 0.38], 0.042, 'frameGunmetal', { name: 'petal seam rib' });
  }
  // Retro-thruster nozzles ring (mounted into each petal so every petal has 3 features: 2 ribs + 1 thruster)
  for (let i = 0; i < 4; i++) {
    const a = (i * Math.PI) / 2 + Math.PI / 4;
    const x = Math.cos(a) * 1.2, z = Math.sin(a) * 1.2;
    b.addPart(cyl(0.12, 0.2, 0.34, 8), 'frameGunmetal', { name: 'retro thruster bell', position: [x, 0.66, z], rotation: [-Math.sin(a) * 0.45, 0, Math.cos(a) * 0.45] });
    b.addPart(cyl(0.15, 0.15, 0.06, 8), 'energyCyan', {
      name: 'retro thruster glow light',
      position: [x + Math.cos(a) * 0.08, 0.5, z + Math.sin(a) * 0.08], rotation: [-Math.sin(a) * 0.45, 0, Math.cos(a) * 0.45],
      emissiveIntensity: 4,
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
    // Interior floor + seat back + seat cushion so floor has >= 2 features and seat is connected
    b.addPart(cyl(0.9, 0.9, 0.1, 12), 'frameGunmetal', { name: 'capsule deck floor', position: [0, 0.52, 0] });
    b.addPart(rbox(0.55, 0.16, 0.45, 0.04), 'hullSecondary', { name: 'crash seat base', position: [0, 0.62, -0.2] });
    b.addPart(rbox(0.7, 1.2, 0.22, 0.08), 'frameGunmetal', { name: 'crash seat backrest', position: [0, 1.12, -0.52] });
    b.addPart(rbox(0.5, 0.1, 0.06, 0.02), 'energyCyan', { name: 'harness status light', position: [0, 1.62, -0.4], emissiveIntensity: 3.6 });
    // Chute housing (top cap) + proud amber collar
    b.addPart(cyl(0.42, 0.5, 0.38, 12), 'frameGunmetal', { name: 'drogue chute canister', position: [0, 3.02, 0] });
    b.addPart(lathe([[0.02, 0], [0.38, 0], [0.34, 0.12], [0.2, 0.22], [0.02, 0.26]], 12), 'hullSecondary', { name: 'chute cap dome', position: [0, 3.18, 0] });
    b.addPart(cyl(0.52, 0.52, 0.06, 12), 'warningAmber', { name: 'chute separation ring light', position: [0, 2.94, 0], emissiveIntensity: 3.4 });
    // Hatch (front, +Z)
    b.addPart(rbox(0.72, 0.9, 0.14, 0.05), 'frameGunmetal', { name: 'egress hatch frame', position: [0, 1.55, 0.88], rotation: [-0.3, 0, 0] });
    b.addPart(rbox(0.5, 0.65, 0.1, 0.04), 'glassVisor', { name: 'hatch viewport visor', position: [0, 1.56, 0.94], rotation: [-0.3, 0, 0] });
    b.addPart(rbox(0.56, 0.06, 0.08, 0.02), 'warningAmber', { name: 'hatch release strip light', position: [0, 1.16, 1.04], rotation: [-0.3, 0, 0], emissiveIntensity: 3.4 });
    // Folded landing legs anchored into hull and foot pads
    for (let i = 0; i < 3; i++) {
      const a = (i * Math.PI * 2) / 3 + Math.PI / 6;
      const c = Math.cos(a), s = Math.sin(a);
      strut(b, [c * 1.05, 0.9, s * 1.05], [c * 1.62, 0.04, s * 1.62], 0.055, 'frameGunmetal', { name: 'landing leg strut' });
      b.addPart(cyl(0.2, 0.22, 0.08, 8), 'hullSecondary', { name: 'landing foot pad', position: [c * 1.62, 0.04, s * 1.62] });
    }
    // Antenna + beacon + anchored telemetry cable
    strut(b, [-0.28, 2.95, -0.1], [-0.58, 3.68, -0.28], 0.025, 'frameGunmetal', { name: 'recovery aerial mast' });
    b.addPart(sph(0.07, 8, 6), 'warningAmber', { name: 'recovery beacon light', position: [-0.58, 3.7, -0.28], emissiveIntensity: 4 });
    sag(b, [0.25, 2.98, 0.25], [0.25, 1.92, 0.75], 0.08, 0.03, 'frameGunmetal', { name: 'umbilical release cable' });
  },
});
