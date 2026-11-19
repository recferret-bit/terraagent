import * as THREE from 'three';
import { KitbashRegistry, type KitbashBuilder, type MaterialZoneId, type PartOptions } from '../../KitbashRegistry';
import type { V3 } from '../unitParts';
import { organ, tendril, tissue, type Tissue } from './shapes';

/** Single continuous sculpted mammalian trunk (deep thoracic brisket, tucked lumbar waist, rounded haunches). */
export function mammalTrunk(
  rxFront: number,
  ryFront: number,
  rxRear: number,
  ryRear: number,
  zMin: number,
  zMax: number,
  dorsalHump = 0,
): THREE.BufferGeometry {
  const g = new THREE.SphereGeometry(1, 14, 10);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const t = (z + 1) * 0.5; // 0 = rear haunches, 1 = front chest
    g.attributes.uv.setXY(i, Math.atan2(y, x) / (Math.PI * 2) + 0.5, t);
    const waist = 1 - 0.13 * Math.sin(t * Math.PI);
    const rx = (rxRear + (rxFront - rxRear) * t) * waist;
    const ry = (ryRear + (ryFront - ryRear) * t) * (1 - 0.09 * Math.sin(t * Math.PI));
    const archY = ryFront * (0.08 * Math.sin(t * Math.PI) - 0.05 * (1 - t));
    const humpY = dorsalHump > 0 && y > 0 ? dorsalHump * Math.pow(y, 1.35) * Math.exp(-Math.pow((t - 0.48) / 0.24, 2)) : 0;
    const pz = zMin + (zMax - zMin) * t;
    p.setXYZ(i, x * rx, y * ry + archY + humpY, pz);
  }
  g.computeVertexNormals();
  return tissue(g, 6);
}

export interface QuadLegRigParams {
  hx: number;
  hy: number;
  zFront: number;
  zBack: number;
  thickness: number;
  hoof?: boolean;
  pawScale?: number;
}

function addQuadLeg(b: KitbashBuilder, p: QuadLegRigParams, side: number, hz: number, tag: string): void {
  const r = p.thickness;
  const hipX = p.hx * side;
  const hip: V3 = [hipX, p.hy, hz];
  // Anatomical mammalian stance: limb drops cleanly beneath the shoulder/haunch (never outrigger crab-legs)
  // while staying >= 1.8 cm outside the narrowed ribcage/pelvis wall across the full sagittal stride.
  const limbX = (p.hx + r * 0.78) * side;
  const footX = (p.hx + r * 0.68) * side;
  const kneeY = p.hy * (1 - 0.3173);
  const ankleY = p.hy * (1 - 0.3173 - 0.5769);
  const pawS = p.pawScale ?? 1.0;

  const upper: PartOptions = { animType: 4, animPivot: hip };
  const lower: PartOptions = { animType: 14, animPivot: hip };
  const foot: PartOptions = { animType: 24, animPivot: hip };

  // Circular-YZ shoulder/haunch muscle mass centered on `hip` so X-pitch stays 100% invariant against the torso.
  b.addPart(organ([r * 1.55, r * 1.52, r * 1.52], 6, hz, 0, 8), 'hullPrimary', {
    name: `${tag} shoulder hip`,
    position: hip,
    ...upper,
  });

  b.addPart(
    tendril(
      [
        [limbX - side * r * 0.16, p.hy + r * 0.12, hz],
        [limbX, (p.hy + kneeY) * 0.52, hz - r * 0.16],
        [limbX, kneeY, hz],
      ],
      [r * 1.18, r * 0.94, r * 0.76],
      6,
      5,
      6,
    ),
    'hullPrimary',
    { name: `${tag} upper limb`, ...upper },
  );

  b.addPart(organ([r * 0.80, r * 0.80, r * 0.80], 2, hz + 1, 0, 6), 'frameGunmetal', {
    name: `${tag} knee joint`,
    position: [limbX, kneeY, hz],
    ...lower,
  });

  b.addPart(
    tendril(
      [
        [limbX, kneeY, hz],
        [(limbX + footX) * 0.5, (kneeY + ankleY) * 0.52, hz + r * 0.08],
        [footX, ankleY, hz],
      ],
      [r * 0.74, r * 0.58, r * 0.48],
      6,
      5,
      6,
    ),
    'hullSecondary',
    { name: `${tag} lower shin`, ...lower },
  );

  const footHalfY = Math.max(0.018, ankleY * 0.55);
  const footTissue: Tissue = p.hoof ? 4 : 2;
  const footZone: MaterialZoneId = p.hoof ? 'rubberDark' : 'frameGunmetal';
  b.addPart(
    organ([r * 0.85 * pawS, footHalfY, r * 1.18 * pawS], footTissue, hz + 2, 0, 7),
    footZone,
    {
      name: `${tag} ${p.hoof ? 'hoof' : 'paw'}`,
      position: [footX, footHalfY, hz + r * 0.22],
      ...foot,
    },
  );
}

KitbashRegistry.registerGreeble('organicQuadLegs', (params: QuadLegRigParams, b: KitbashBuilder) => {
  for (const side of [-1, 1] as const) {
    const dir = side > 0 ? 'right' : 'left';
    addQuadLeg(b, params, side, params.zFront, `${dir} fore`);
    addQuadLeg(b, params, side, params.zBack, `${dir} hind`);
  }
});

export interface FeatheredWingsParams {
  wx: number;
  wy: number;
  wz?: number;
  span: number;
  chord: number;
  sweep?: number;
  tipZone?: MaterialZoneId;
}

KitbashRegistry.registerGreeble('featheredWings', (params: FeatheredWingsParams, b: KitbashBuilder) => {
  const wz = params.wz ?? 0.02;
  const sweep = params.sweep ?? params.chord * 0.45;
  const tipZone = params.tipZone ?? 'hullSecondary';
  const rSh = Math.max(0.032, params.chord * 0.32);

  for (const side of [-1, 1] as const) {
    const dir = side > 0 ? 'right' : 'left';
    const pivot: V3 = [params.wx * side, params.wy, wz];
    const flap: PartOptions = { animType: 92, animPivot: pivot };

    // Circular-XY shoulder coverts centered at `pivot` so Z-axis wing strokes stay invariant at the torso mount.
    b.addPart(organ([rSh, rSh, params.chord * 0.40], 7, side, 0, 7), 'hullPrimary', {
      name: `${dir} wing shoulder`,
      position: pivot,
      ...flap,
    });

    const innerSpan = params.span * 0.56;
    const innerX = (params.wx + rSh * 0.45 + innerSpan * 0.44) * side;
    const innerZ = wz - sweep * 0.24;
    b.addPart(
      organ([innerSpan * 0.54, Math.max(0.020, params.chord * 0.12), params.chord * 0.52], 7, side + 1, 0.025, 9),
      'hullPrimary',
      {
        name: `${dir} secondary wing`,
        position: [innerX, params.wy + 0.006, innerZ],
        rotation: [0, -side * 0.09, 0],
        ...flap,
      },
    );

    const outerSpan = params.span * 0.54;
    const outerStart: V3 = [(params.wx + rSh * 0.45 + innerSpan * 0.68) * side, params.wy + 0.008, wz - sweep * 0.30];
    const outerMid: V3 = [(params.wx + rSh * 0.45 + innerSpan * 0.78 + outerSpan * 0.46) * side, params.wy + 0.014, wz - sweep * 0.58];
    const outerTip: V3 = [(params.wx + rSh * 0.45 + innerSpan * 0.78 + outerSpan * 0.92) * side, params.wy + 0.020, wz - sweep * 0.92];
    b.addPart(
      tendril(
        [outerStart, outerMid, outerTip],
        [params.chord * 0.26, params.chord * 0.18, params.chord * 0.05],
        7,
        5,
        6,
      ),
      tipZone,
      {
        name: `${dir} primary flight feathers`,
        role: 'whip',
        ...flap,
      },
    );
  }
});

export interface CervineAntlersParams {
  neckPivot: V3;
  brow: V3;
  spread: number;
  height: number;
  tines?: number;
}

KitbashRegistry.registerGreeble('cervineAntlers', (params: CervineAntlersParams, b: KitbashBuilder) => {
  const headAnim: PartOptions = { animType: 78, animPivot: params.neckPivot };
  const [bx, by, bz] = params.brow;
  const sp = params.spread;
  const h = params.height;

  for (const side of [-1, 1] as const) {
    const dir = side > 0 ? 'right' : 'left';
    b.addPart(
      tendril(
        [
          [bx * side, by, bz],
          [(bx + sp * 0.55) * side, by + h * 0.46, bz - 0.03],
          [(bx + sp) * side, by + h * 0.88, bz + 0.04],
          [(bx + sp * 0.78) * side, by + h, bz + 0.12],
        ],
        [0.028, 0.022, 0.015, 0.007],
        4,
        7,
        6,
      ),
      'hullSecondary',
      { name: `${dir} antler beam`, ...headAnim },
    );
    if ((params.tines ?? 2) >= 2) {
      b.addPart(
        tendril(
          [
            [(bx + sp * 0.48) * side, by + h * 0.42, bz - 0.02],
            [(bx + sp * 0.36) * side, by + h * 0.68, bz + 0.13],
          ],
          [0.018, 0.006],
          4,
          5,
          5,
        ),
        'hullSecondary',
        { name: `${dir} brow tine`, ...headAnim },
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
  const headAnim: PartOptions = { animType: 78, animPivot: params.neckPivot };
  const [bx, by, bz] = params.brow;
  const len = params.length;
  const back = params.sweepBack ?? len * 0.72;
  const flare = params.flare ?? 0.08;

  for (const side of [-1, 1] as const) {
    const dir = side > 0 ? 'right' : 'left';
    b.addPart(
      tendril(
        [
          [bx * side, by, bz],
          [(bx + flare * 0.6) * side, by + len * 0.48, bz - back * 0.45],
          [(bx + flare) * side, by + len * 0.85, bz - back],
        ],
        [0.028, 0.019, 0.006],
        4,
        7,
        6,
      ),
      'rubberDark',
      { name: `${dir} keratin horn`, ...headAnim },
    );
  }
});
