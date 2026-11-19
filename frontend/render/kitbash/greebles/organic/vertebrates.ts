import * as THREE from 'three';
import type { VertebratePartRig } from '../../../animation/vertebrates/types';
import { KitbashRegistry, type KitbashBuilder, type MaterialZoneId, type PartOptions } from '../../KitbashRegistry';
import type { V3 } from '../unitParts';
import { organ, tendril } from './shapes';
import { computeTrunkBounds, makeMammalBodyColor } from './vertebrateColor';
import { sculptedLoft, type LoftStation } from './vertebrateLoft';
import {
  addMammalForelimb,
  addMammalHindlimb,
  addMammalNeckAndHead,
  addMammalTail,
  type MammalBuildSpec,
} from './vertebrateLimbs';

export { buildAvianCore, type BirdBuildSpec } from './avianBuilder';
export type { MammalBuildSpec } from './vertebrateLimbs';

/**
 * Legacy helper retained for compatibility; sculpted mammals use `buildMammalCore` + `sculptedLoft` stations.
 */
export function mammalTrunk(
  rxFront: number,
  ryFront: number,
  rxRear: number,
  ryRear: number,
  zMin: number,
  zMax: number,
  dorsalHump = 0,
): THREE.BufferGeometry {
  const zMid = (zMin + zMax) * 0.5;
  const zQ1 = THREE.MathUtils.lerp(zMin, zMax, 0.28);
  const zQ3 = THREE.MathUtils.lerp(zMin, zMax, 0.74);
  return sculptedLoft(
    [
      { y: 0, z: zMin, rx: rxRear * 0.72, ryTop: ryRear * 0.76, ryBot: ryRear * 0.70, ridge: 0.2 },
      { y: -ryRear * 0.04, z: zQ1, rx: rxRear * 0.96, ryTop: ryRear * 0.96, ryBot: ryRear * 0.88, ridge: 0.25 },
      { y: ryFront * 0.02, z: zMid, rx: (rxFront + rxRear) * 0.44, ryTop: (ryFront + ryRear) * 0.48 + dorsalHump, ryBot: ryRear * 0.74, ridge: 0.3 },
      { y: 0, z: zQ3, rx: rxFront * 0.98, ryTop: ryFront * 1.02 + dorsalHump * 0.4, ryBot: ryFront * 1.08, ridge: 0.35 },
      { y: ryFront * 0.08, z: zMax, rx: rxFront * 0.72, ryTop: ryFront * 0.76, ryBot: ryFront * 0.74, ridge: 0.2 },
    ],
    12,
    6,
    1.1,
    0.015,
  );
}

function sampleTrunkAtZ(stations: readonly LoftStation[], z: number): LoftStation {
  if (z <= stations[0]!.z) return stations[0]!;
  for (let i = 0; i < stations.length - 1; i++) {
    const a = stations[i]!;
    const b = stations[i + 1]!;
    if (z <= b.z) {
      const t = (z - a.z) / Math.max(1e-5, b.z - a.z);
      return {
        y: THREE.MathUtils.lerp(a.y, b.y, t),
        z,
        rx: THREE.MathUtils.lerp(a.rx, b.rx, t),
        ryTop: THREE.MathUtils.lerp(a.ryTop, b.ryTop, t),
        ryBot: THREE.MathUtils.lerp(a.ryBot, b.ryBot, t),
        ridge: THREE.MathUtils.lerp(a.ridge ?? 0, b.ridge ?? 0, t),
        keel: THREE.MathUtils.lerp(a.keel ?? 0, b.keel ?? 0, t),
        topWidth: THREE.MathUtils.lerp(a.topWidth ?? 1, b.topWidth ?? 1, t),
        muscleFlare: THREE.MathUtils.lerp(a.muscleFlare ?? 0, b.muscleFlare ?? 0, t),
      };
    }
  }
  return stations[stations.length - 1]!;
}

function sleepPitchBodyMinY(geos: readonly THREE.BufferGeometry[], torsoY: number): number {
  const mat = new THREE.Matrix4()
    .compose(new THREE.Vector3(0, torsoY, 0), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), 0.03), new THREE.Vector3(1, 1, 1))
    .multiply(new THREE.Matrix4().makeTranslation(0, -torsoY, 0));
  const v = new THREE.Vector3();
  let minY = Infinity;
  for (const geo of geos) {
    const pos = geo.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i).applyMatrix4(mat);
      if (v.y < minY) minY = v.y;
    }
  }
  return minY;
}

function buildMammalTorsoMuscles(
  b: KitbashBuilder,
  s: MammalBuildSpec,
  bodyColor: ReturnType<typeof makeMammalBodyColor>,
  bodyRig: VertebratePartRig,
): THREE.BufferGeometry[] {
  const r = s.legThick;
  const foreRoot = Math.sqrt(s.foreScale ?? 1.0);
  const thRoot = Math.sqrt(s.thighScale ?? 1.0);
  const stFront = sampleTrunkAtZ(s.trunkStations, s.zFront);
  const stBack = sampleTrunkAtZ(s.trunkStations, s.zBack);
  const geos: THREE.BufferGeometry[] = [];

  const armOuterX = s.legXFront * 0.72 + r * 0.45 * foreRoot;
  const trunkFrontOuterX = stFront.rx * (1 + (stFront.muscleFlare ?? 0.30) * 0.36);
  const scapOuterX = Math.max(trunkFrontOuterX + r * 0.22, armOuterX + r * 0.10);
  const scapInnerX = Math.min(stFront.rx * 0.42, s.legXFront * 0.46 - r * 0.06);
  const scapRx = Math.max(r * 0.42, (scapOuterX - scapInnerX) * 0.5);
  const scapCx = (scapOuterX + scapInnerX) * 0.5;
  const scapMidY = THREE.MathUtils.lerp(s.shoulderY, stFront.y + stFront.ryTop * 0.28, 0.45);
  const scapZRear = s.zFront - Math.max(r * 1.54, stFront.rx * 0.54);
  const scapZFwd = Math.min(s.zFront + r * 0.44, s.neckPivot[2] - r * 1.36);

  const thighOuterX = s.legXBack * 0.72 + r * 0.45 * thRoot;
  const trunkBackOuterX = stBack.rx * (1 + (stBack.muscleFlare ?? 0.30) * 0.36);
  const haunchOuterX = Math.max(trunkBackOuterX + r * 0.24 * thRoot, thighOuterX + r * 0.10);
  const haunchInnerX = Math.min(stBack.rx * 0.42, s.legXBack * 0.45 - r * 0.06);
  const haunchRx = Math.max(r * 0.44, (haunchOuterX - haunchInnerX) * 0.5);
  const haunchCx = (haunchOuterX + haunchInnerX) * 0.5;
  const haunchMidY = THREE.MathUtils.lerp(s.hipY, stBack.y + stBack.ryTop * 0.28, 0.46);
  const haunchZRear = s.zBack - Math.max(r * 1.08, stBack.rx * 0.38);
  const haunchZFwd = s.zBack + Math.max(r * 1.48, stBack.rx * 0.52);

  for (const side of [-1, 1] as const) {
    const dir = side > 0 ? 'right' : 'left';
    const scapRearY = THREE.MathUtils.lerp(s.shoulderY, stFront.y + stFront.ryTop * 0.32, 0.50);
    const scapFwdY = THREE.MathUtils.lerp(s.shoulderY, stFront.y + stFront.ryTop * 0.18, 0.38);
    const scapGeo = sculptedLoft(
      [
        { x: side * scapCx * 0.93, y: scapRearY, z: scapZRear, rx: scapRx * 0.87, ryTop: stFront.ryTop * 0.54, ryBot: Math.max(r * 0.50, (scapRearY - s.shoulderY) + r * 0.18), ridge: 0.18 },
        { x: side * scapCx, y: scapMidY, z: s.zFront - r * 0.12, rx: scapRx, ryTop: stFront.ryTop * 0.64, ryBot: Math.max(r * 0.62, (scapMidY - s.shoulderY) + r * 0.26), ridge: 0.16 },
        { x: side * scapCx * 0.93, y: scapFwdY, z: scapZFwd, rx: scapRx * 0.87, ryTop: stFront.ryTop * 0.46, ryBot: Math.max(r * 0.44, (scapFwdY - s.shoulderY) + r * 0.15), ridge: 0.14 },
      ],
      8, 6, 2.3 + side, 0, { subdiv: 2, compactCaps: true, bodyNormalY: stFront.y },
    );
    geos.push(scapGeo);
    b.addPart(scapGeo, 'hullPrimary', {
      name: `${dir} scapular shoulder mass`,
      vertexColor: bodyColor,
      vertRig: bodyRig,
    });

    const haunchRearY = THREE.MathUtils.lerp(s.hipY, stBack.y + stBack.ryTop * 0.20, 0.40);
    const haunchFwdY = THREE.MathUtils.lerp(s.hipY, stBack.y + stBack.ryTop * 0.28, 0.48);
    const haunchGeo = sculptedLoft(
      [
        { x: side * haunchCx * 0.93, y: haunchRearY, z: haunchZRear, rx: haunchRx * 0.87, ryTop: stBack.ryTop * 0.48, ryBot: Math.max(r * 0.50, (haunchRearY - s.hipY) + r * 0.20), ridge: 0.14 },
        { x: side * haunchCx, y: haunchMidY, z: s.zBack + r * 0.08, rx: haunchRx, ryTop: stBack.ryTop * 0.64 * Math.min(1.12, thRoot), ryBot: Math.max(r * 0.68, (haunchMidY - s.hipY) + r * 0.30 * thRoot), ridge: 0.16 },
        { x: side * haunchCx * 0.91, y: haunchFwdY, z: haunchZFwd, rx: haunchRx * 0.86, ryTop: stBack.ryTop * 0.50, ryBot: Math.max(r * 0.50, (haunchFwdY - s.hipY) + r * 0.18), ridge: 0.18 },
      ],
      8, 6, 3.7 + side, 0, { subdiv: 2, compactCaps: true, bodyNormalY: stBack.y },
    );
    geos.push(haunchGeo);
    b.addPart(haunchGeo, 'hullPrimary', {
      name: `${dir} gluteal haunch mass`,
      vertexColor: bodyColor,
      vertRig: bodyRig,
    });
  }

  const bZ0 = s.zFront - r * 0.95;
  const bZ2 = Math.min(s.zFront + r * 0.22, s.neckPivot[2] - r * 1.65);
  const bZ1 = (bZ0 + bZ2) * 0.5;
  const st0 = sampleTrunkAtZ(s.trunkStations, bZ0);
  const st1 = sampleTrunkAtZ(s.trunkStations, bZ1);
  const st2 = sampleTrunkAtZ(s.trunkStations, bZ2);
  const innerArmClearX = Math.max(0.015, s.legXFront * 0.78 - r * 0.56 * foreRoot - 0.018);
  const brisketRx = Math.min(st1.rx * 0.36, innerArmClearX);
  const brisketRy = Math.max(0.016, Math.min(0.028, st1.ryBot * 0.22));
  const brisketGeo = sculptedLoft(
    [
      { y: st0.y - st0.ryBot * 0.96, z: bZ0, rx: brisketRx * 0.78, ryTop: brisketRy * 0.90, ryBot: brisketRy * 0.82, squareness: 0.24, keel: 0.28 },
      { y: st1.y - st1.ryBot * 0.98, z: bZ1, rx: brisketRx, ryTop: brisketRy * 0.98, ryBot: brisketRy * 0.96, squareness: 0.24, keel: 0.32 },
      { y: st2.y - st2.ryBot * 0.96, z: bZ2, rx: brisketRx * 0.76, ryTop: brisketRy * 0.90, ryBot: brisketRy * 0.82, squareness: 0.24, keel: 0.28 },
    ],
    6, 6, 4.1, 0, { subdiv: 1, compactCaps: true, bodyNormalY: st1.y },
  );
  geos.push(brisketGeo);
  b.addPart(brisketGeo, 'hullPrimary', {
    name: 'pectoral brisket mass',
    vertexColor: bodyColor,
    vertRig: bodyRig,
  });

  return geos;
}

/**
 * Assembles a complete warm-blooded quadruped using sculpted anatomical lofts,
 * integrated 3D scapular shoulder, gluteal haunch & pectoral brisket muscle masses,
 * differentiated forelimbs & hindlimbs with closed-form 2-link IK, continuous neck/skull/jaw,
 * cupped ears, sculpted paws/cloven hooves, and tail counterbalance.
 */
export function buildMammalCore(
  b: KitbashBuilder,
  s: MammalBuildSpec,
): { neckPivot: V3; headCenter: V3; headAnim: PartOptions; bodyColor: ReturnType<typeof makeMammalBodyColor> } {
  const bounds = computeTrunkBounds(s.trunkStations);
  const bodyColor = makeMammalBodyColor(s.coatPattern ?? 'countershade', bounds);
  const trunkGeo = sculptedLoft(s.trunkStations, 12, 6, 1.7, 0, { subdiv: 2 });
  const bodyRig: VertebratePartRig = { role: 1 };

  b.addPart(trunkGeo, 'hullPrimary', {
    name: 'sculpted mammalian trunk',
    vertexColor: bodyColor,
    vertRig: bodyRig,
  });
  const muscleGeos = buildMammalTorsoMuscles(b, s, bodyColor, bodyRig);
  const pitchedMinY = sleepPitchBodyMinY([trunkGeo, ...muscleGeos], s.torsoY);
  const autoSleepDrop = Math.max(0.02, pitchedMinY - 0.038);

  b.vertebrateConfig = {
    isBird: 0,
    comY: s.torsoY,
    sleepDrop: s.sleepDrop > 0 ? autoSleepDrop : 0,
    strideLen: s.strideLen,
    liftHeight: s.liftHeight,
    gaitFreq: s.gaitFreq,
    headSleepPitch: s.headSleepPitch,
  };

  // Diagonal quadruped trot phases: RF (0) + LH (0), LF (PI) + RH (PI).
  addMammalForelimb(b, s, -1, Math.PI);
  addMammalForelimb(b, s, 1, 0);
  addMammalHindlimb(b, s, -1, 0);
  addMammalHindlimb(b, s, 1, Math.PI);

  addMammalNeckAndHead(b, s);
  addMammalTail(b, s);

  return {
    neckPivot: s.neckPivot,
    headCenter: s.headCenter,
    headAnim: { animPivot: s.neckPivot, vertRig: { role: 2 } },
    bodyColor,
  };
}

export interface CervineAntlersParams {
  neckPivot: V3;
  brow: V3;
  spread: number;
  height: number;
  tines?: number;
}

KitbashRegistry.registerGreeble('cervineAntlers', (params: CervineAntlersParams, b: KitbashBuilder) => {
  const headOpts: PartOptions = { animPivot: params.neckPivot, vertRig: { role: 2 } };
  const [bx, by, bz] = params.brow;
  const sp = params.spread;
  const h = params.height;

  for (const side of [-1, 1] as const) {
    const dir = side > 0 ? 'right' : 'left';
    // Basal pedicle burr.
    b.addPart(organ([0.026, 0.018, 0.026], 4, side, 0, 5), 'hullSecondary', {
      name: `${dir} antler burr`,
      position: [bx * side, by, bz],
      ...headOpts,
    });
    // Sweeping main beam ending in dorsal crown fork.
    b.addPart(
      tendril(
        [
          [bx * side, by, bz],
          [(bx + sp * 0.42) * side, by + h * 0.36, bz - 0.04],
          [(bx + sp * 0.92) * side, by + h * 0.74, bz - 0.01],
          [(bx + sp * 0.76) * side, by + h, bz + 0.08],
        ],
        [0.024, 0.019, 0.014, 0.005],
        4,
        6,
        5,
      ),
      'hullSecondary',
      { name: `${dir} antler beam`, role: 'whip', ...headOpts },
    );
    // Forward-swept brow tine.
    b.addPart(
      tendril(
        [
          [(bx + sp * 0.22) * side, by + h * 0.18, bz - 0.01],
          [(bx + sp * 0.16) * side, by + h * 0.34, bz + 0.12],
          [(bx + sp * 0.10) * side, by + h * 0.48, bz + 0.17],
        ],
        [0.015, 0.011, 0.004],
        4,
        3,
        4,
      ),
      'hullSecondary',
      { name: `${dir} brow tine`, role: 'whip', ...headOpts },
    );
    // Trez & upper crown tines.
    if ((params.tines ?? 3) >= 2) {
      b.addPart(
        tendril(
          [
            [(bx + sp * 0.64) * side, by + h * 0.54, bz - 0.02],
            [(bx + sp * 0.52) * side, by + h * 0.80, bz + 0.12],
          ],
          [0.014, 0.004],
          4,
          3,
          4,
        ),
        'hullSecondary',
        { name: `${dir} trez tine`, role: 'whip', ...headOpts },
      );
      b.addPart(
        tendril(
          [
            [(bx + sp * 0.88) * side, by + h * 0.78, bz],
            [(bx + sp * 1.06) * side, by + h * 0.98, bz - 0.08],
          ],
          [0.012, 0.004],
          4,
          3,
          4,
        ),
        'hullSecondary',
        { name: `${dir} crown fork`, role: 'whip', ...headOpts },
      );
    }
  }
});

export interface SweptHornsParams {
  neckPivot: V3;
  brow: V3;
  length: number;
  sweepBack?: number;
  flare?: number;
}

KitbashRegistry.registerGreeble('sweptHorns', (params: SweptHornsParams, b: KitbashBuilder) => {
  const headOpts: PartOptions = { animPivot: params.neckPivot, vertRig: { role: 2 } };
  const [bx, by, bz] = params.brow;
  const len = params.length;
  const back = params.sweepBack ?? len * 0.72;
  const flare = params.flare ?? 0.08;

  for (const side of [-1, 1] as const) {
    const dir = side > 0 ? 'right' : 'left';
    b.addPart(organ([0.028, 0.024, 0.028], 4, side, 0, 6), 'rubberDark', {
      name: `${dir} horn boss`,
      position: [bx * side, by, bz],
      ...headOpts,
    });
    b.addPart(
      tendril(
        [
          [bx * side, by, bz],
          [(bx + flare * 0.35) * side, by + len * 0.38, bz - back * 0.25],
          [(bx + flare * 0.75) * side, by + len * 0.72, bz - back * 0.65],
          [(bx + flare) * side, by + len * 0.90, bz - back],
        ],
        [0.027, 0.021, 0.014, 0.004],
        4,
        9,
        6,
      ),
      'rubberDark',
      { name: `${dir} keratin horn`, role: 'whip', ...headOpts },
    );
  }
});

// Legacy compatibility greeble hooks in case external callers invoke them by name.
export interface QuadLegRigParams { hx: number; hy: number; zFront: number; zBack: number; thickness: number; hoof?: boolean }
KitbashRegistry.registerGreeble('organicQuadLegs', (_p: QuadLegRigParams, _b: KitbashBuilder) => {
  // Handled directly inside `buildMammalCore` via anatomically differentiated fore/hind limbs.
});

export interface FeatheredWingsParams { wx: number; wy: number; wz?: number; span: number; chord: number; sweep?: number; tipZone?: MaterialZoneId }
KitbashRegistry.registerGreeble('featheredWings', (_p: FeatheredWingsParams, _b: KitbashBuilder) => {
  // Handled directly inside `buildAvianCore` via articulated 2-segment wing foils + primary blades.
});
