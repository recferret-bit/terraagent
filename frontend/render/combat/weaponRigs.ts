import * as THREE from 'three';

export interface WeaponSocket { pivot: THREE.Vector3Tuple; muzzle: THREE.Vector3Tuple }
export interface WeaponRigDefinition {
  pivot: THREE.Vector3Tuple;
  carrier?: 'spider' | 'biped';
  /** Fixed guns steer the chassis; turrets leave their foundation/chassis still. */
  chassisAim?: boolean;
  head: readonly string[];
  barrels: readonly string[];
  sockets: readonly WeaponSocket[];
}
const combat: WeaponRigDefinition = {
  pivot: [0, 1.14, 0.08], carrier: 'spider',
  head: ['turret housing', 'cannon mantlet', 'turret sensor light', 'radar mast', 'radar dish', 'antenna mast', 'ammo box', 'power cable'],
  barrels: ['cannon barrel', 'cannon muzzle', 'cannon laser'],
  sockets: [-1, 1].map(s => ({ pivot: [s * 0.13, 1.14, 0.34], muzzle: [s * 0.13, 1.14, 0.97] })),
};
const rigs = new Map<string, WeaponRigDefinition>([
  ['robot.hero', {
    pivot: [0, 2.13 * 0.88, 0.01 * 0.88], carrier: 'biped',
    head: ['defense gun housing'], barrels: ['defense gun barrel'],
    sockets: [{ pivot: [0, 2.13 * 0.88, 0.11 * 0.88], muzzle: [0, 2.13 * 0.88, 0.41 * 0.88] }],
  }],
  ['robot.combat', combat], ['robot.tank', combat], ['robot.artillery', combat],
  ['robot.recon', {
    pivot: [0, 0.78, 0.03],
    head: ['recon turret housing', 'turret commander hatch', 'turret sight visor', 'turret rangefinder light'],
    barrels: ['recon gun mantlet', 'recon cannon barrel', 'recon muzzle brake'],
    sockets: [{ pivot: [0.06, 0.87, 0.29], muzzle: [0.06, 0.87, 0.90] }],
  }],
  ['building.turret', {
    pivot: [0, 1.24, 0],
    head: ['turret breech housing', 'turret roof carapace', 'cannon mantlet block', 'radar rotor mast', 'targeting radar dish', 'radar lock light'],
    barrels: ['autocannon barrel', 'muzzle accelerator tube', 'barrel cooling collar', 'muzzle flash suppressor light'],
    sockets: [-1, 1].map(s => ({ pivot: [s * 0.3, 1.49, 0.44], muzzle: [s * 0.3, 1.49, 1.67] })),
  }],
  ['building.laserTower', {
    pivot: [0, 2.08, 0],
    head: ['optical emitter head housing', 'emitter roof heatsink cap', 'emitter targeting beacon light'],
    barrels: ['optical focus barrel', 'barrel focusing collar', 'laser aperture lens light'],
    sockets: [{ pivot: [0, 2.3, 0.36], muzzle: [0, 2.3, 0.94] }],
  }],
]);
export const WeaponRigRegistry = {
  register(id: string, definition: WeaponRigDefinition): void { rigs.set(id, definition); },
  get(id: string): WeaponRigDefinition | undefined { return rigs.get(id); },
};

/** Explicit named parts from the authored model, never a heuristic muzzle bounding box. */
export function stampWeaponRig(geometry: THREE.BufferGeometry, rig: WeaponRigDefinition): void {
  const positions = geometry.getAttribute('position');
  const parts = geometry.userData.partRanges as { name: string; start: number; count: number }[];
  const slots = new Float32Array(positions.count);
  for (const part of parts) {
    let slot = rig.head.includes(part.name) ? 1 : 0;
    if (rig.barrels.includes(part.name)) {
      let x = 0;
      for (let i = part.start; i < part.start + part.count; i++) x += positions.getX(i);
      slot = rig.sockets.length === 1 || x / part.count < 0 ? 2 : 3;
    }
    slots.fill(slot, part.start, part.start + part.count);
  }
  geometry.setAttribute('aWeaponPart', new THREE.BufferAttribute(slots, 1));
}
