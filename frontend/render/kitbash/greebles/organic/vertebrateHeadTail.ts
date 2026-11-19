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

export type MammalSkullProfile =
  | 'canid'
  | 'feline'
  | 'ungulate'
  | 'camelid'
  | 'ursine'
  | 'rodent'
  | 'lagomorph'
  | 'tapir'
  | 'prosimian';

export interface MammalHeadTailSpec {
  id: string;
  torsoY: number;
  trunkStations: readonly LoftStation[];
  coatPattern?: MammalCoatPattern;
  skullProfile?: MammalSkullProfile;
  legXFront: number;
  legXBack: number;
  shoulderY: number;
  hipY: number;
  zFront: number;
  zBack: number;
  legThick: number;
  foreScale?: number;
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
  bluntSkull?: boolean;
  eyeScale?: number;
  eyeForward?: number;
  earWidth: number;
  earHeight: number;
  earPoint?: number;
  earTilt?: number;
  earSpread?: number;
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

function resolveSkullProfile(s: MammalHeadTailSpec): MammalSkullProfile {
  if (s.skullProfile) return s.skullProfile;
  if (s.proboscis) return 'tapir';
  if (s.camelPad) return 'camelid';
  if (s.hoof) return 'ungulate';
  if (s.hareHind) return 'lagomorph';
  if (s.bluntSkull) return s.id.includes('Capybara') ? 'rodent' : 'ursine';
  if (s.coatPattern === 'felineSpots') return 'feline';
  if (s.coatPattern === 'lemurMask') return 'prosimian';
  return 'canid';
}

function addMammalNoseOrProboscis(
  b: KitbashBuilder,
  s: MammalHeadTailSpec,
  profile: MammalSkullProfile,
  mzY: number,
  mzTipZ: number,
  hh: number,
  headOpts: PartOptions,
): void {
  if (s.proboscis) {
    b.addPart(
      tendril(
        [
          [0, mzY + 0.014, mzTipZ - 0.020],
          [0, mzY - 0.032, mzTipZ + 0.074],
          [0, mzY - 0.095, mzTipZ + 0.106],
        ],
        [s.snoutWidth * 0.54, s.snoutWidth * 0.40, s.snoutWidth * 0.25],
        2,
        5,
        6,
      ),
      'hullPrimary',
      { name: 'prehensile proboscis', role: 'whip', ...headOpts },
    );
    b.addPart(organ([s.snoutWidth * 0.18, 0.011, 0.011], 5, 0, 0, 5), 'glassVisor', {
      name: 'proboscis nostril tip',
      position: [0, mzY - 0.097, mzTipZ + 0.108],
      ...headOpts,
    });
    return;
  }
  const isBoxy = profile === 'rodent' || profile === 'ursine';
  const isUngulate = profile === 'ungulate' || profile === 'camelid';
  const noseRx = isBoxy ? s.snoutWidth * 0.44 : isUngulate ? s.snoutWidth * 0.42 : s.snoutWidth * 0.36;
  b.addPart(organ([noseRx, hh * 0.17, 0.020], 5, 0, 0, 5), 'glassVisor', {
    name: 'rhinarium nose',
    position: [0, mzY + (profile === 'rodent' ? hh * 0.12 : -hh * 0.01), mzTipZ + 0.008],
    ...headOpts,
  });
}

function addMammalMuzzleAndJaw(
  b: KitbashBuilder,
  s: MammalHeadTailSpec,
  hc: V3,
  hh: number,
  hl: number,
  headOpts: PartOptions,
): void {
  const profile = resolveSkullProfile(s);
  const mzBaseZ = hc[2] + hl * 0.56;
  const mzTipZ = mzBaseZ + s.snoutLen;
  const mzY = hc[1] - s.snoutDrop;
  const mZone = s.muzzleBlend ? 'hullPrimary' : (s.muzzleZone ?? 'hullPrimary');
  const muzzleColor = makeMuzzleColor(s.muzzleBlend, s.coatPattern);

  const isBoxy = profile === 'rodent' || profile === 'ursine';
  const isFeline = profile === 'feline';
  const isUngulate = profile === 'ungulate' || profile === 'camelid';
  const sq = profile === 'rodent' ? 0.46 : profile === 'ursine' ? 0.38 : isUngulate ? 0.28 : isFeline ? 0.26 : 0.18;
  const baseRx = isUngulate || profile === 'tapir' ? Math.max(s.snoutWidth * 1.12, s.headWidth * 0.66) : s.snoutWidth * 1.02;
  const midRx = isBoxy ? s.snoutWidth * 0.96 : isFeline ? s.snoutWidth * 1.04 : isUngulate ? s.snoutWidth * 0.84 : s.snoutWidth * 0.82;
  const tipRx =
    profile === 'rodent'
      ? s.snoutWidth * 0.92
      : profile === 'ursine'
        ? s.snoutWidth * 0.86
        : isFeline
          ? s.snoutWidth * 0.88
          : profile === 'camelid'
            ? s.snoutWidth * 0.90
            : isUngulate
              ? s.snoutWidth * 0.82
              : s.snoutWidth * 0.64;
  const topW = isFeline || profile === 'camelid' || profile === 'lagomorph' ? 0.78 : isUngulate ? 0.84 : 0.94;
  const tipTopH = profile === 'rodent' ? 0.58 : profile === 'ursine' ? 0.46 : isFeline ? 0.38 : isUngulate ? 0.38 : 0.32;
  const tipBotH = profile === 'rodent' ? 0.46 : profile === 'camelid' ? 0.48 : isFeline ? 0.34 : isUngulate ? 0.30 : 0.24;

  b.addPart(
    sculptedLoft(
      [
        { y: mzY + hh * 0.08, z: mzBaseZ - 0.016, rx: baseRx, ryTop: hh * (isBoxy ? 0.66 : isUngulate ? 0.58 : 0.52), ryBot: hh * (isBoxy ? 0.50 : 0.38), ridge: isBoxy ? 0.04 : 0.18, squareness: sq, topWidth: topW },
        { y: mzY + hh * (isBoxy ? 0.06 : 0.02), z: (mzBaseZ + mzTipZ) * 0.5, rx: midRx, ryTop: hh * (isBoxy ? 0.62 : isUngulate ? 0.48 : 0.44), ryBot: hh * (isBoxy ? 0.44 : 0.32), ridge: isBoxy ? 0.04 : 0.16, squareness: sq, topWidth: topW },
        { y: mzY - hh * 0.02, z: mzTipZ, rx: tipRx, ryTop: hh * tipTopH, ryBot: hh * tipBotH, ridge: isBoxy ? 0.02 : 0.10, squareness: sq, topWidth: topW },
      ],
      8,
      6,
      3.3,
      0,
      { subdiv: 1, domeCaps: false },
    ),
    mZone,
    { name: 'nasal muzzle', vertexColor: muzzleColor, ...headOpts },
  );

  const jawSq = isBoxy || isUngulate ? 0.28 : 0.14;
  b.addPart(
    sculptedLoft(
      [
        { y: mzY - hh * 0.24, z: mzBaseZ - 0.022, rx: baseRx * 0.84, ryTop: hh * 0.24, ryBot: hh * (isBoxy || isUngulate ? 0.34 : 0.26), squareness: jawSq },
        { y: mzY - hh * 0.21, z: (mzBaseZ + mzTipZ) * 0.52, rx: s.snoutWidth * (isBoxy ? 0.76 : 0.66), ryTop: hh * 0.18, ryBot: hh * 0.22, squareness: jawSq },
        { y: mzY - hh * 0.16, z: mzTipZ - s.snoutLen * 0.08, rx: tipRx * 0.74, ryTop: hh * 0.14, ryBot: hh * 0.16, squareness: jawSq },
      ],
      6,
      6,
      3.7,
      0,
      { subdiv: 1, domeCaps: false },
    ),
    'hullPrimary',
    { name: 'lower jaw', vertexColor: makeJawColor(s.muzzleBlend), ...headOpts },
  );

  addMammalNoseOrProboscis(b, s, profile, mzY, mzTipZ, hh, headOpts);
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
  const profile = resolveSkullProfile(s);
  const eyeR = s.eyeScale ?? Math.min(0.013, hw * 0.125);
  const eyeFwd = s.eyeForward ?? 0.36;
  const earColor = makeEarColor(Boolean(s.earTuft || s.coatPattern === 'wolfMask' || s.coatPattern === 'oryxMarkings'));
  const eyeLatFrac =
    profile === 'rodent'
      ? 0.92
      : profile === 'ungulate' || profile === 'camelid' || profile === 'lagomorph'
        ? 0.82
        : profile === 'tapir'
          ? 0.78
          : profile === 'canid' || profile === 'ursine'
            ? 0.64
            : 0.58;
  const earRoll = s.earSpread ?? 0.18;
  for (const side of [-1, 1] as const) {
    const dir = side > 0 ? 'right' : 'left';
    const ex = hw * eyeLatFrac * side;
    const ey = hc[1] + hh * (profile === 'rodent' ? 0.34 : profile === 'camelid' ? 0.28 : 0.22);
    const ez = hc[2] + hl * eyeFwd;
    b.addPart(organ([eyeR * 1.45, eyeR * 0.85, eyeR * 2.0], 6, side, 0, 5), 'hullPrimary', {
      name: `${dir} brow ridge`,
      position: [ex * 0.94, ey + eyeR * 0.85, ez],
      rotation: [0.1, side * 0.2, -side * 0.14],
      ...headOpts,
    });
    b.addPart(organ([eyeR, eyeR * 0.92, eyeR * 1.08], 5, side, 0, 5), 'glassVisor', {
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
        rotation: [s.earTilt ?? 0.08, side * 0.16, -side * earRoll],
        vertexColor: earColor,
        ...headOpts,
      },
    );
    if (s.earTuft) {
      b.addPart(
        tendril(
          [
            [earPos[0] + side * s.earWidth * 0.16, earPos[1] + s.earHeight * 0.78, earPos[2]],
            [earPos[0] + side * s.earWidth * 0.34, earPos[1] + s.earHeight * 1.24, earPos[2] - 0.016],
            [earPos[0] + side * s.earWidth * 0.54, earPos[1] + s.earHeight * 1.62, earPos[2] - 0.042],
          ],
          [0.015, 0.010, 0.003],
          6,
          4,
          5,
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
  const profile = resolveSkullProfile(s);

  const hc = s.headCenter;
  const hw = s.headWidth;
  const hh = s.headHeight;
  const hl = s.headLen;
  const occiputZ = hc[2] - hl * 0.50;
  const lastNeckSt = s.neckCurve[s.neckCurve.length - 1]!;
  const occRx = Math.max(hw * 0.84, lastNeckSt.rx * 0.96);
  const occRyTop = Math.max(hh * 0.84, lastNeckSt.ryTop * 0.96);
  const occRyBot = Math.max(hh * 0.78, lastNeckSt.ryBot * 0.94);
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
    vertexColor: (_pos, norm, _u, v, zones, out) => {
      const prim = new THREE.Color(zones.hullPrimary.color);
      const sec = new THREE.Color(zones.hullSecondary.color);
      const dark = new THREE.Color(zones.rubberDark.color);
      out.copy(prim);
      if (s.coatPattern === 'tapirSaddle') return;
      if (s.coatPattern === 'oryxMarkings') {
        const throatLight = smooth01(-0.08, -0.58, norm.y) * smooth01(0.35, 0.78, v);
        const brisketDark = smooth01(-0.12, -0.68, norm.y) * (1 - smooth01(0.28, 0.62, v));
        out.lerp(sec, throatLight * 0.72);
        out.lerp(dark, brisketDark * 0.88);
        return;
      }
      out.lerp(sec, smooth01(-0.14, -0.68, norm.y) * 0.62);
    },
    ...headOpts,
  });

  const sq =
    profile === 'rodent'
      ? 0.44
      : profile === 'ursine'
        ? 0.32
        : profile === 'ungulate' || profile === 'camelid'
          ? 0.24
          : profile === 'feline'
            ? 0.22
            : 0.12;
  const cheekFlare =
    profile === 'ursine'
      ? 1.24
      : profile === 'feline'
        ? 1.22
        : profile === 'canid' || profile === 'lagomorph'
          ? 1.16
          : profile === 'rodent'
            ? 1.12
            : 1.08;
  const cheekTopW =
    profile === 'feline' || profile === 'ursine' || profile === 'lagomorph'
      ? 0.82
      : profile === 'ungulate' || profile === 'camelid'
        ? 1.12
        : 0.92;
  const crownTop = profile === 'tapir' ? 1.14 : profile === 'camelid' || profile === 'lagomorph' ? 1.08 : profile === 'rodent' ? 0.94 : 1.02;
  const jowlBot = profile === 'ungulate' || profile === 'camelid' || profile === 'rodent' || profile === 'ursine' ? 0.98 : 0.88;
  const stopTop = profile === 'rodent' ? 0.82 : profile === 'tapir' ? 0.74 : profile === 'ungulate' ? 0.68 : 0.56;

  b.addPart(
    sculptedLoft(
      [
        { y: hc[1] - hh * 0.05, z: occiputZ - 0.012, rx: lastNeckSt.rx * 0.86, ryTop: lastNeckSt.ryTop * 0.86, ryBot: lastNeckSt.ryBot * 0.84, ridge: 0.16, squareness: sq },
        { y: hc[1] - hh * 0.04, z: occiputZ + 0.006, rx: occRx, ryTop: occRyTop, ryBot: occRyBot, ridge: 0.16, squareness: sq },
        { y: hc[1] + hh * 0.03, z: hc[2] - hl * 0.08, rx: hw * cheekFlare, ryTop: hh * crownTop, ryBot: hh * jowlBot, ridge: profile === 'tapir' ? 0.34 : sq > 0.25 ? 0.06 : 0.14, squareness: sq, topWidth: cheekTopW },
        { y: hc[1] - hh * 0.01, z: hc[2] + hl * 0.34, rx: hw * (sq > 0.25 ? 1.02 : 0.92), ryTop: hh * (profile === 'rodent' ? 0.90 : 0.86), ryBot: hh * 0.78, ridge: profile === 'tapir' ? 0.28 : 0.16, squareness: sq, topWidth: cheekTopW },
        { y: hc[1] - hh * 0.10, z: hc[2] + hl * 0.64, rx: s.snoutWidth * (sq > 0.25 ? 1.06 : 0.98), ryTop: hh * stopTop, ryBot: hh * 0.56, ridge: 0.16, squareness: sq },
        { y: hc[1] - hh * 0.12, z: hc[2] + hl * 0.74, rx: s.snoutWidth * (sq > 0.25 ? 0.90 : 0.80), ryTop: hh * (stopTop * 0.78), ryBot: hh * 0.44, ridge: 0.14, squareness: sq },
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
  const tailSegs = bands > 0 ? 22 : smoothTip ? 10 : 8;
  b.addPart(tendril(pts, shaftRadii, 6, tailSegs, smoothTip ? 8 : 7), 'hullPrimary', {
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
      b.addPart(organ([tr * 1.10, tr * 1.05, tr * 1.15], 6, 1.9, 0.02, 6), s.tailTipZone, {
        name: 'tail brush tip',
        position: [end[0], end[1] + 0.008, end[2] - 0.012],
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
          4,
          6,
        ),
        s.tailTipZone,
        { name: 'tail brush tip', role: 'whip', ...tailOpts },
      );
    }
  }
}
