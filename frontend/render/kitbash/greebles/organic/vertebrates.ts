import { KitbashRegistry, type KitbashBuilder, type MaterialZoneId, type PartOptions } from '../../KitbashRegistry';
import type { V3 } from '../unitParts';
import { organ, tendril, type Tissue } from './shapes';

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
  const hip: V3 = [p.hx * side, p.hy, hz];
  const legX = (p.hx + r * 1.32) * side;
  const kneeY = p.hy * (1 - 0.3173);
  const ankleY = p.hy * (1 - 0.3173 - 0.5769);
  const pawS = p.pawScale ?? 1.0;

  const upper: PartOptions = { animType: 4, animPivot: hip };
  const lower: PartOptions = { animType: 14, animPivot: hip };
  const foot: PartOptions = { animType: 24, animPivot: hip };

  // Spherical/circular-YZ shoulder/hip muscle pad centered on `hip` so X-pitch never deepens torso overlap.
  b.addPart(organ([r * 1.68, r * 1.42, r * 1.42], 2, hz, 0, 8), 'hullPrimary', {
    name: `${tag} shoulder hip`,
    position: hip,
    ...upper,
  });

  b.addPart(
    tendril(
      [
        [legX, p.hy + r * 0.15, hz],
        [legX, (p.hy + kneeY) * 0.5, hz - r * 0.18],
        [legX, kneeY, hz],
      ],
      [r * 1.10, r * 0.92, r * 0.76],
      1,
      5,
      6,
    ),
    'hullPrimary',
    { name: `${tag} upper limb`, ...upper },
  );

  b.addPart(organ([r * 0.82, r * 0.82, r * 0.82], 2, hz + 1, 0, 6), 'frameGunmetal', {
    name: `${tag} knee joint`,
    position: [legX, kneeY, hz],
    ...lower,
  });

  b.addPart(
    tendril(
      [
        [legX, kneeY, hz],
        [legX, (kneeY + ankleY) * 0.52, hz + r * 0.10],
        [legX, ankleY, hz],
      ],
      [r * 0.74, r * 0.58, r * 0.48],
      1,
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
      position: [legX, footHalfY, hz + r * 0.22],
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
    b.addPart(organ([rSh, rSh, params.chord * 0.40], 2, side, 0, 7), 'hullPrimary', {
      name: `${dir} wing shoulder`,
      position: pivot,
      ...flap,
    });

    const innerSpan = params.span * 0.56;
    const innerX = (params.wx + rSh * 0.45 + innerSpan * 0.44) * side;
    const innerZ = wz - sweep * 0.24;
    b.addPart(
      organ([innerSpan * 0.54, Math.max(0.020, params.chord * 0.12), params.chord * 0.52], 1, side + 1, 0.025, 9),
      'hullPrimary',
      {
        name: `${dir} secondary wing`,
        position: [innerX, params.wy + 0.006, innerZ],
        rotation: [0, -side * 0.09, 0],
        ...flap,
      },
    );

    const outerSpan = params.span * 0.52;
    const outerX = (params.wx + rSh * 0.45 + innerSpan * 0.78 + outerSpan * 0.34) * side;
    b.addPart(
      organ([outerSpan * 0.52, Math.max(0.016, params.chord * 0.09), params.chord * 0.38], 1, side + 3, 0.035, 8),
      tipZone,
      {
        name: `${dir} primary flight feathers`,
        position: [outerX, params.wy + 0.012, wz - sweep * 0.52],
        rotation: [0, -side * 0.16, 0],
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
