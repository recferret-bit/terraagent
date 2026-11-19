import * as THREE from 'three';
import type { VertebratePartRig } from '../../../animation/vertebrates/types';
import type { KitbashBuilder, MaterialZoneId, PartOptions } from '../../KitbashRegistry';
import type { V3 } from '../unitParts';
import { organ, tendril } from './shapes';
import {
  makeEarColor,
  makeHeadColor,
  makeJawColor,
  makeMuzzleColor,
  makeSmoothBrushTailColor,
  makeTailBandColor,
  smooth01,
  type MammalCoatPattern,
} from './vertebrateColor';
import { sculptedEar, sculptedLoft, type LoftStation } from './vertebrateLoft';

export interface MammalHeadTailSpec {
  id: string;
  torsoY: number;
  trunkStations: readonly LoftStation[];
  coatPattern?: MammalCoatPattern;
  legXFront: number;
  legXBack: number;
  shoulderY: number;
  hipY: number;
  zFront: number;
  zBack: number;
  legThick: number;
  thighScale?: number;
  elbowBackFrac?: number;
  stifleFwdFrac?: number;
  hockBack?: number;
  hareHind?: boolean;
  hoof?: boolean;
  camelPad?: boolean;
  pawZone?: MaterialZoneId;
  sockZone?: MaterialZoneId;
  neckCurve: readonly LoftStation[];
  neckPivot: V3;
  headCenter: V3;
  headWidth: number;
  headHeight: number;
  headLen: number;
  snoutLen: number;
  snoutWidth: number;
  snoutDrop: number;
  muzzleZone?: MaterialZoneId;
  muzzleBlend?: boolean;
  eyeScale?: number;
  eyeForward?: number;
  earWidth: number;
  earHeight: number;
  earPoint?: number;
  earTilt?: number;
  earTuft?: boolean;
  proboscis?: boolean;
  tailPts: readonly V3[];
  tailRadii: readonly number[];
  tailTipZone?: MaterialZoneId;
  tailSmoothTip?: boolean;
  tailBands?: number;
  strideLen: number;
  liftHeight: number;
  gaitFreq: number;
  sleepDrop: number;
  headSleepPitch: number;
}

function addMammalMuzzleAndJaw(
  b: KitbashBuilder,
  s: MammalHeadTailSpec,
  hc: V3,
  hh: number,
  hl: number,
  headOpts: PartOptions,
): void {
  const mzBaseZ = hc[2] + hl * 0.62;
  const mzTipZ = mzBaseZ + s.snoutLen;
  const mzY = hc[1] - s.snoutDrop;
  const mZone = s.muzzleBlend ? 'hullPrimary' : (s.muzzleZone ?? 'hullPrimary');
  const muzzleColor = makeMuzzleColor(s.muzzleBlend, s.coatPattern);

  b.addPart(
    sculptedLoft(
      [
        { y: mzY + hh * 0.08, z: mzBaseZ - 0.020, rx: s.snoutWidth * 0.96, ryTop: hh * 0.48, ryBot: hh * 0.36, ridge: 0.25 },
        { y: mzY + hh * 0.02, z: (mzBaseZ + mzTipZ) * 0.5, rx: s.snoutWidth * 0.72, ryTop: hh * 0.36, ryBot: hh * 0.26, ridge: 0.25 },
        { y: mzY - hh * 0.03, z: mzTipZ, rx: s.snoutWidth * 0.48, ryTop: hh * 0.25, ryBot: hh * 0.18, ridge: 0.18 },
      ],
      8,
      6,
      3.3,
      0,
      { subdiv: 1 },
    ),
    mZone,
    { name: 'nasal muzzle', vertexColor: muzzleColor, ...headOpts },
  );

  b.addPart(
    sculptedLoft(
      [
        { y: mzY - hh * 0.22, z: mzBaseZ - 0.020, rx: s.snoutWidth * 0.80, ryTop: hh * 0.24, ryBot: hh * 0.22 },
        { y: mzY - hh * 0.20, z: (mzBaseZ + mzTipZ) * 0.52, rx: s.snoutWidth * 0.58, ryTop: hh * 0.18, ryBot: hh * 0.18 },
        { y: mzY - hh * 0.16, z: mzTipZ - s.snoutLen * 0.10, rx: s.snoutWidth * 0.38, ryTop: hh * 0.13, ryBot: hh * 0.13 },
      ],
      6,
      6,
      3.7,
      0,
      { subdiv: 1 },
    ),
    'hullPrimary',
    { name: 'lower jaw', vertexColor: makeJawColor(s.muzzleBlend), ...headOpts },
  );

  if (s.proboscis) {
    b.addPart(
      tendril(
        [
          [0, mzY + 0.005, mzTipZ - 0.015],
          [0, mzY - 0.045, mzTipZ + 0.07],
          [0, mzY - 0.095, mzTipZ + 0.095],
        ],
        [s.snoutWidth * 0.42, s.snoutWidth * 0.32, s.snoutWidth * 0.20],
        2,
        6,
        7,
      ),
      'hullPrimary',
      { name: 'prehensile proboscis', role: 'whip', ...headOpts },
    );
    b.addPart(organ([s.snoutWidth * 0.16, 0.010, 0.010], 5, 0, 0, 6), 'glassVisor', {
      name: 'proboscis nostril tip',
      position: [0, mzY - 0.096, mzTipZ + 0.098],
      ...headOpts,
    });
  } else {
    b.addPart(organ([s.snoutWidth * 0.34, hh * 0.16, 0.018], 5, 0, 0, 7), 'glassVisor', {
      name: 'rhinarium nose',
      position: [0, mzY - hh * 0.01, mzTipZ + 0.008],
      ...headOpts,
    });
  }
}

function addMammalEyesAndEars(
  b: KitbashBuilder,
  s: MammalHeadTailSpec,
  hc: V3,
  hw: number,
  hh: number,
  hl: number,
  headOpts: PartOptions,
): void {
  const eyeR = s.eyeScale ?? Math.min(0.013, hw * 0.125);
  const eyeFwd = s.eyeForward ?? 0.36;
  const earColor = makeEarColor(Boolean(s.earTuft || s.coatPattern === 'wolfMask'));
  for (const side of [-1, 1] as const) {
    const dir = side > 0 ? 'right' : 'left';
    const ex = hw * 0.80 * side;
    const ey = hc[1] + hh * 0.22;
    const ez = hc[2] + hl * eyeFwd;
    b.addPart(organ([eyeR * 1.4, eyeR * 0.85, eyeR * 2.0], 6, side, 0, 7), 'hullPrimary', {
      name: `${dir} brow ridge`,
      position: [ex * 0.94, ey + eyeR * 0.85, ez],
      rotation: [0.1, side * 0.2, -side * 0.14],
      ...headOpts,
    });
    b.addPart(organ([eyeR, eyeR * 0.92, eyeR * 1.08], 5, side, 0, 7), 'glassVisor', {
      name: `${dir} eye`,
      position: [ex, ey, ez],
      ...headOpts,
    });

    const earPos: V3 = [hw * 0.62 * side, hc[1] + hh * 0.72, hc[2] - hl * 0.22];
    b.addPart(
      sculptedEar(s.earWidth, s.earHeight, Math.max(0.012, s.earWidth * 0.38), side, s.earPoint ?? 0.85, 6),
      'hullPrimary',
      {
        name: `${dir} pinna ear`,
        position: earPos,
        rotation: [s.earTilt ?? 0.08, side * 0.16, -side * 0.18],
        vertexColor: earColor,
        ...headOpts,
      },
    );
    if (s.earTuft) {
      b.addPart(
        tendril(
          [
            [earPos[0] + side * s.earWidth * 0.22, earPos[1] + s.earHeight * 0.84, earPos[2]],
            [earPos[0] + side * s.earWidth * 0.38, earPos[1] + s.earHeight * 1.18, earPos[2] - 0.02],
          ],
          [0.011, 0.003],
          6,
          4,
          6,
        ),
        'rubberDark',
        { name: `${dir} ear tuft`, role: 'whip', ...headOpts },
      );
    }
  }
}

export function addMammalNeckAndHead(b: KitbashBuilder, s: MammalHeadTailSpec): void {
  const headRig: VertebratePartRig = { role: 2 };
  const headOpts: PartOptions = { animPivot: s.neckPivot, vertRig: headRig };

  const hc = s.headCenter;
  const hw = s.headWidth;
  const hh = s.headHeight;
  const hl = s.headLen;
  const occiputZ = hc[2] - hl * 0.50;
  const lastNeckSt = s.neckCurve[s.neckCurve.length - 1]!;
  const occRx = Math.max(hw * 0.86, lastNeckSt.rx * 1.02);
  const occRyTop = Math.max(hh * 0.82, lastNeckSt.ryTop * 1.02);
  const occRyBot = Math.max(hh * 0.76, lastNeckSt.ryBot * 1.02);
  const firstNeckSt = s.neckCurve[0]!;
  const neckBaseZ = Math.max(firstNeckSt.z, s.neckPivot[2] + 0.004);
  const neckTopZ = occiputZ + 0.008;

  const neckStations = [
    { ...firstNeckSt, y: s.neckPivot[1], z: s.neckPivot[2] - 0.008, rx: firstNeckSt.rx * 0.86, ryTop: firstNeckSt.ryTop * 0.86, ryBot: firstNeckSt.ryBot * 0.86 },
    ...s.neckCurve.map((st, idx) => {
      if (idx === 0) return { ...st, y: s.neckPivot[1], z: Math.max(neckBaseZ, s.neckPivot[2] + 0.004) };
      if (idx === s.neckCurve.length - 1) return { ...st, z: Math.min(st.z, neckTopZ) };
      return st;
    }),
  ];
  b.addPart(sculptedLoft(neckStations, 10, 6, 1.3, 0, { subdiv: s.neckCurve.length >= 3 ? 2 : 1, domeCaps: false }), 'hullPrimary', {
    name: 'muscular neck',
    vertexColor: (_pos, norm, _u, _v, zones, out) => {
      const prim = new THREE.Color(zones.hullPrimary.color);
      const sec = new THREE.Color(zones.hullSecondary.color);
      out.copy(prim).lerp(sec, smooth01(-0.1, -0.65, norm.y) * 0.72);
    },
    ...headOpts,
  });

  b.addPart(
    sculptedLoft(
      [
        { y: hc[1] - hh * 0.06, z: occiputZ - 0.014, rx: lastNeckSt.rx * 0.88, ryTop: lastNeckSt.ryTop * 0.88, ryBot: lastNeckSt.ryBot * 0.88, ridge: 0.16 },
        { y: hc[1] - hh * 0.06, z: occiputZ + 0.006, rx: occRx, ryTop: occRyTop, ryBot: occRyBot, ridge: 0.18 },
        { y: hc[1] + hh * 0.02, z: hc[2] - hl * 0.10, rx: hw * 1.06, ryTop: hh * 0.98, ryBot: hh * 0.84, ridge: 0.14 },
        { y: hc[1] - hh * 0.04, z: hc[2] + hl * 0.58, rx: hw * 0.78, ryTop: hh * 0.76, ryBot: hh * 0.68, ridge: 0.22 },
        { y: hc[1] - hh * 0.14, z: hc[2] + hl * 0.96, rx: s.snoutWidth * 0.95, ryTop: hh * 0.54, ryBot: hh * 0.50, ridge: 0.18 },
        { y: hc[1] - hh * 0.14, z: hc[2] + hl * 1.02, rx: s.snoutWidth * 0.72, ryTop: hh * 0.40, ryBot: hh * 0.36, ridge: 0.14 },
      ],
      10,
      6,
      2.1,
      0,
      { subdiv: 1, domeCaps: false },
    ),
    'hullPrimary',
    { name: 'sculpted cranium', vertexColor: makeHeadColor(s.coatPattern), ...headOpts },
  );

  addMammalMuzzleAndJaw(b, s, hc, hh, hl, headOpts);
  addMammalEyesAndEars(b, s, hc, hw, hh, hl, headOpts);
}

export function addMammalTail(b: KitbashBuilder, s: MammalHeadTailSpec): void {
  const tailPivot = s.tailPts[0]!;
  const tailOpts: PartOptions = { animPivot: tailPivot, vertRig: { role: 3 } };
  const bands = s.tailBands ?? 0;
  const smoothTip = Boolean(s.tailSmoothTip && s.tailTipZone);
  const shaftRadii = s.tailTipZone && !smoothTip
    ? s.tailRadii.map((rad, i) => (i === s.tailRadii.length - 1 ? rad * 0.58 : rad))
    : [...s.tailRadii];
  const tipZone = s.tailTipZone === 'hullSecondary' || s.tailTipZone === 'rubberDark' || s.tailTipZone === 'frameGunmetal'
    ? s.tailTipZone
    : 'rubberDark';
  const tailColor = bands > 0 ? makeTailBandColor(bands) : smoothTip ? makeSmoothBrushTailColor(tipZone, 0.48) : undefined;
  const pts = s.tailPts.map((p, idx) => (idx === 0 ? [p[0], p[1], p[2] + 0.022] as V3 : p));
  b.addPart(tendril(pts, shaftRadii, 6, smoothTip ? 14 : 12, smoothTip ? 10 : 9), 'hullPrimary', {
    name: 'sculpted tail',
    role: 'whip',
    ...(tailColor ? { vertexColor: tailColor } : {}),
    ...tailOpts,
  });
  if (s.tailTipZone && !smoothTip) {
    const end = s.tailPts[s.tailPts.length - 1]!;
    const prev = s.tailPts[Math.max(0, s.tailPts.length - 2)]!;
    const tr = s.tailRadii[s.tailRadii.length - 1]!;
    if (s.tailPts.length === 2) {
      b.addPart(organ([tr * 1.15, tr * 1.10, tr * 1.24], 6, 1.9, 0.02, 8), s.tailTipZone, {
        name: 'tail brush tip',
        position: [end[0], end[1] + 0.004, end[2] - 0.006],
        ...tailOpts,
      });
    } else {
      b.addPart(
        tendril(
          [
            [THREE.MathUtils.lerp(prev[0], end[0], 0.72), THREE.MathUtils.lerp(prev[1], end[1], 0.72), THREE.MathUtils.lerp(prev[2], end[2], 0.72)],
            end,
            [end[0], end[1] - 0.03, end[2] - 0.045],
          ],
          [tr * 1.05, tr * 1.28, tr * 0.30],
          6,
          6,
          8,
        ),
        s.tailTipZone,
        { name: 'tail brush tip', role: 'whip', ...tailOpts },
      );
    }
  }
}
