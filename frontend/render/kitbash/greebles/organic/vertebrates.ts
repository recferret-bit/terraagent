import * as THREE from 'three';
import type { VertebratePartRig } from '../../../animation/vertebrates/types';
import { KitbashRegistry, type KitbashBuilder, type MaterialZoneId, type PartOptions } from '../../KitbashRegistry';
import type { V3 } from '../unitParts';
import { organ, tendril } from './shapes';
import { makeMammalBodyColor } from './vertebrateColor';
import { sculptedLoft } from './vertebrateLoft';
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

/**
 * Assembles a complete warm-blooded quadruped using sculpted anatomical lofts,
 * differentiated forelimbs & hindlimbs with closed-form 2-link IK, continuous neck/skull/jaw,
 * cupped ears, sculpted paws/cloven hooves, and tail counterbalance.
 */
export function buildMammalCore(b: KitbashBuilder, s: MammalBuildSpec): { neckPivot: V3; headCenter: V3; headAnim: PartOptions } {
  b.vertebrateConfig = {
    isBird: 0,
    comY: s.torsoY,
    sleepDrop: s.sleepDrop,
    strideLen: s.strideLen,
    liftHeight: s.liftHeight,
    gaitFreq: s.gaitFreq,
    headSleepPitch: s.headSleepPitch,
  };

  const bodyRig: VertebratePartRig = { role: 1 };
  b.addPart(sculptedLoft(s.trunkStations, 14, 6, 1.7, 0), 'hullPrimary', {
    name: 'sculpted mammalian trunk',
    vertexColor: makeMammalBodyColor(s.coatPattern ?? 'countershade'),
    vertRig: bodyRig,
  });

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
        7,
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
        4,
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
          4,
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
          4,
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
