import * as THREE from 'three';

export interface WeaponSocket { pivot: THREE.Vector3Tuple; muzzle: THREE.Vector3Tuple; side?: 0 | 1 }
export interface WeaponRigDefinition {
  pivot: THREE.Vector3Tuple;
  carrier?: 'spider' | 'biped';
  /** Fixed guns steer the chassis; turrets leave their foundation/chassis still. */
  chassisAim?: boolean;
  /** Maximum turret yaw rotation speed in radians/second (smooth slewing, no teleports). */
  turnSpeedRadPerS?: number;
  /** Glow heat multiplier for barrel heating (`0` disables barrel thermal glow, e.g. laser apertures & rocket pods). */
  heatScale?: number;
  /** Heat gained per fired round (`0..1`). */
  heatGain?: number;
  /** Heat dissipation rate per second (`0..1`/s). */
  heatCooldownPerS?: number;
  /** Axial barrel recoil travel in metres. */
  barrelRecoilM?: number;
  /** Barrel recoil cycle duration in seconds. */
  recoilDurationS?: number;
  /** Suspension/carriage kickback push distance in metres. */
  bodyRecoilPushM?: number;
  /** Suspension compression drop in metres. */
  bodyRecoilDropM?: number;
  /** Pitch kickback in radians. */
  bodyRecoilPitchRad?: number;
  /** True when the chassis suspension below the turret also rocks on firing (units yes, bolted tower pedestals no). */
  chassisRecoil?: boolean;
  /** Local Z coordinate on turret housing where spent brass casings eject (defaults to `pivot[2]`). */
  ejectZ?: number;
  head: readonly string[];
  barrels: readonly string[];
  sockets: readonly WeaponSocket[];
}

const artillerySpider: WeaponRigDefinition = {
  pivot: [0, 1.15, 0.06], carrier: 'spider', turnSpeedRadPerS: 4.4,
  heatScale: 1.0, heatGain: 0.52, heatCooldownPerS: 0.16,
  barrelRecoilM: 0.16, recoilDurationS: 0.42,
  bodyRecoilPushM: 0.12, bodyRecoilDropM: 0.068, bodyRecoilPitchRad: 0.11, chassisRecoil: true,
  head: [
    'turret housing', 'artillery cradle cheek', 'cannon mantlet', 'rangefinder housing',
    'turret optics light', 'radar mast', 'radar dish', 'antenna mast', 'ammo bustle', 'power cable',
  ],
  barrels: ['cannon barrel', 'bore evacuator', 'cannon muzzle'],
  sockets: [{ pivot: [0, 1.17, 0.31], muzzle: [0, 1.17, 1.15], side: 0 }],
};

const rocketSpider: WeaponRigDefinition = {
  pivot: [0, 1.15, 0.05], carrier: 'spider', turnSpeedRadPerS: 5.0, heatScale: 0,
  barrelRecoilM: 0.085, recoilDurationS: 0.32,
  bodyRecoilPushM: 0.09, bodyRecoilDropM: 0.052, bodyRecoilPitchRad: 0.08, chassisRecoil: true,
  head: [
    'turret housing', 'turret trunnion', 'turret sensor bezel', 'turret visor light',
    'radar mast', 'radar dish', 'radar feed horn', 'antenna mast', 'ammo bustle', 'power cable',
  ],
  barrels: ['rocket pod', 'rocket pod plate', 'rocket pod bezel', 'rocket tube collar', 'rocket warhead', 'rocket exhaust baffle'],
  sockets: [0, 1, 2, 3].flatMap(idx => {
    const dx = (idx % 2 === 0 ? -1 : 1) * 0.048;
    const dy = (idx < 2 ? 1 : -1) * 0.046;
    return [
      { pivot: [-0.345 + dx, 1.16 + dy, 0.06], muzzle: [-0.345 + dx, 1.16 + dy, 0.37], side: 0 as const },
      { pivot: [0.345 + dx, 1.16 + dy, 0.06], muzzle: [0.345 + dx, 1.16 + dy, 0.37], side: 1 as const },
    ];
  }),
};

const rigs = new Map<string, WeaponRigDefinition>([
  ['robot.artillery', artillerySpider],
  ['robot.tank', rocketSpider],
  ['robot.combat', rocketSpider],
  ['robot.recon', {
    pivot: [0, 0.78, 0.03], turnSpeedRadPerS: 7.0,
    heatScale: 1.0, heatGain: 0.30, heatCooldownPerS: 0.24,
    barrelRecoilM: 0.10, recoilDurationS: 0.26,
    bodyRecoilPushM: 0.075, bodyRecoilDropM: 0.032, bodyRecoilPitchRad: 0.065, chassisRecoil: true,
    ejectZ: 0.12,
    head: [
      'recon turret housing', 'turret commander hatch', 'turret sight visor', 'turret rangefinder light',
      'recon radar mast', 'recon radar dish', 'recon radar feed horn', 'merc emblem', 'merc marker light',
    ],
    barrels: ['recon gun mantlet', 'recon cannon barrel', 'recon muzzle brake'],
    sockets: [{ pivot: [0.06, 0.87, 0.29], muzzle: [0.06, 0.87, 0.90], side: 0 }],
  }],
  ['building.turret', {
    pivot: [0, 1.24, 0], turnSpeedRadPerS: 5.8,
    heatScale: 1.0, heatGain: 0.34, heatCooldownPerS: 0.20,
    barrelRecoilM: 0.14, recoilDurationS: 0.30,
    bodyRecoilPushM: 0.048, bodyRecoilDropM: 0.015, bodyRecoilPitchRad: 0.045, chassisRecoil: false,
    ejectZ: 0.16,
    head: ['turret breech housing', 'turret roof carapace', 'cannon mantlet block', 'radar rotor mast', 'targeting radar dish', 'radar lock light'],
    barrels: ['autocannon barrel', 'muzzle accelerator tube', 'barrel cooling collar', 'muzzle flash suppressor light'],
    sockets: [-1, 1].map((s, idx) => ({ pivot: [s * 0.3, 1.49, 0.44], muzzle: [s * 0.3, 1.49, 1.67], side: (idx === 0 ? 0 : 1) as 0 | 1 })),
  }],
  ['building.laserTower', {
    pivot: [0, 2.08, 0], turnSpeedRadPerS: 6.4, heatScale: 0,
    barrelRecoilM: 0, recoilDurationS: 0.2,
    bodyRecoilPushM: 0, bodyRecoilDropM: 0, bodyRecoilPitchRad: 0, chassisRecoil: false,
    head: ['optical emitter head housing', 'emitter roof heatsink cap', 'emitter targeting beacon light'],
    barrels: ['optical focus barrel', 'barrel focusing collar', 'laser aperture lens light'],
    sockets: [{ pivot: [0, 2.3, 0.36], muzzle: [0, 2.3, 0.94], side: 0 }],
  }],
]);

export const WeaponRigRegistry = {
  register(id: string, definition: WeaponRigDefinition): void { rigs.set(id, definition); },
  get(id: string): WeaponRigDefinition | undefined { return rigs.get(id); },
};

export function resolveSocketSide(def: WeaponRigDefinition, index: number): 0 | 1 {
  const s = def.sockets[index]!;
  if (s.side === 0 || s.side === 1) return s.side;
  return def.sockets.length === 1 || index === 0 ? 0 : 1;
}

/** Explicit named parts from the authored model, never a heuristic muzzle bounding box. */
export function stampWeaponRig(geometry: THREE.BufferGeometry, rig: WeaponRigDefinition): void {
  const positions = geometry.getAttribute('position');
  const parts = geometry.userData.partRanges as { name: string; start: number; count: number }[];
  const slots = new Float32Array(positions.count);
  const sides = new Set(rig.sockets.map((_, i) => resolveSocketSide(rig, i)));
  const singleSideSlot = sides.size === 1 ? (sides.has(1) ? 3 : 2) : null;
  for (const part of parts) {
    let slot = rig.head.includes(part.name) ? 1 : 0;
    if (rig.barrels.includes(part.name)) {
      if (singleSideSlot !== null) {
        slot = singleSideSlot;
      } else {
        let x = 0;
        for (let i = part.start; i < part.start + part.count; i++) x += positions.getX(i);
        slot = x / part.count < 0 ? 2 : 3;
      }
    }
    slots.fill(slot, part.start, part.start + part.count);
  }
  geometry.setAttribute('aWeaponPart', new THREE.BufferAttribute(slots, 1));
}
