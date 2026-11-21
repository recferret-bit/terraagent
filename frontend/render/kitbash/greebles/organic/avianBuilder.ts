import * as THREE from 'three';
import type { VertebratePartRig } from '../../../animation/vertebrates/types';
import type { KitbashBuilder, MaterialZoneId, PartOptions } from '../../KitbashRegistry';
import type { V3 } from '../unitParts';
import { organ, tendril } from './shapes';
import {
  makeBirdBeakColor,
  makeBirdCovertColor,
  makeBirdHeadColor,
  makeBirdPlumageColor,
  makeBirdWingColor,
} from './vertebrateColor';
import { sculptedFeather, sculptedLoft, sculptedWingFoil, type LoftStation, type WingStation } from './vertebrateLoft';

export interface BirdBuildSpec {
  flyY?: number;
  torsoLen: number;
  torsoW: number;
  torsoH: number;
  keelDepth?: number;
  wingSpan: number;
  wingChord: number;
  wingSweep?: number;
  wristFrac?: number;
  wristLift?: number;
  wristSweep?: number;
  wingStyle?: 'slotted' | 'scythe' | 'pelagic' | 'rounded';
  flapRate?: number;
  flapAmp?: number;
  wristBend?: number;
  /** Optional explicit normalized bird size class (`0..1`); defaults to normalized `wingSpan`. */
  birdSize?: number;
  neckCurve: readonly V3[];
  neckRadii: readonly number[];
  neckZone?: MaterialZoneId;
  /** Optional smooth ventral breast / throat countershading (`hullSecondary` on underside). */
  breastBib?: boolean;
  /** Optional rich dorsal mantle / covert tint (`0xRRGGBB`, max channel <= 218). */
  mantleTint?: number;
  /** Optional soft pale ventral belly / chest blush tint (`0xRRGGBB`, max channel <= 218). */
  bellyTint?: number;
  /** Optional pale proximal upper-bill color transitioning to dark distal hook. */
  beakBaseTint?: number;
  /** Optional dark dorsal crown over pale throat (`canopyToucan` / `oasisSwallow`). */
  bibCrownDark?: boolean;
  headR: V3;
  browFlare?: number;
  upperBeak: readonly V3[];
  upperBeakR: readonly number[];
  lowerBeak: readonly V3[];
  lowerBeakR: readonly number[];
  beakZone?: MaterialZoneId;
  tailLen: number;
  tailSpread: number;
  tailStyle?: 'fan' | 'forked' | 'wedge' | 'pintail';
  crestPts?: readonly V3[];
  crestRadii?: readonly number[];
  crestZone?: MaterialZoneId;
  gularPouch?: boolean;
  neckRuff?: boolean;
  trailingLegs?: number;
}

function addBirdWings(b: KitbashBuilder, s: BirdBuildSpec, flyY: number): void {
  const wx = s.torsoW * 0.64;
  const wy = flyY + s.torsoH * 0.22;
  const wz = s.torsoLen * 0.11;
  const halfSpan = s.wingSpan * 0.5;
  const wristFrac = s.wristFrac ?? 0.44;
  const wristX = wx + halfSpan * wristFrac;
  const wristLift = s.wristLift ?? s.torsoH * 0.24;
  const wristSweep = s.wristSweep ?? s.wingChord * 0.22;
  const tipSweep = s.wingSweep ?? s.wingChord * 0.62;
  const style = s.wingStyle ?? 'slotted';
  const darkTips = style === 'pelagic' || style === 'scythe';
  const rootChord = Math.min(s.wingChord * 0.92, s.torsoLen * 0.94);

  for (const side of [-1, 1] as const) {
    const dir = side > 0 ? 'right' : 'left';
    const shoulder: V3 = [wx * side, wy, wz];
    const wrist: V3 = [wristX * side, wy + wristLift, wz + wristSweep];
    const innerOpts: PartOptions = { animPivot: shoulder, vertRig: { role: 7, joint: wrist } };
    const outerOpts: PartOptions = { animPivot: shoulder, vertRig: { role: 8, joint: wrist } };

    const wristChord = s.wingChord * 0.82;
    const wristThick = s.wingChord * 0.090;
    const wristCamber = s.wingChord * 0.052;
    const innerStations: WingStation[] = [
      { x: wx * 0.66 * side, y: wy - s.torsoH * 0.02, z: wz, chord: rootChord * 0.90, thick: s.wingChord * 0.118, camber: s.wingChord * 0.055, twist: -0.04 },
      { x: (wx + halfSpan * wristFrac * 0.32) * side, y: wy + wristLift * 0.34, z: wz + wristSweep * 0.34, chord: s.wingChord * 0.94, thick: s.wingChord * 0.116, camber: s.wingChord * 0.064, twist: -0.03 },
      { x: (wx + halfSpan * wristFrac * 0.70) * side, y: wy + wristLift * 0.74, z: wz + wristSweep * 0.72, chord: s.wingChord * 0.88, thick: s.wingChord * 0.100, camber: s.wingChord * 0.056, twist: -0.01 },
      { x: wrist[0], y: wrist[1], z: wrist[2], chord: wristChord, thick: wristThick, camber: wristCamber, twist: 0 },
    ];
    b.addPart(sculptedWingFoil(innerStations, 10, 7, 2), 'hullPrimary', {
      name: `${dir} inner wing`,
      vertexColor: makeBirdWingColor(false, darkTips, s.mantleTint),
      ...innerOpts,
    });

    // Sleek flush upper covert plumage blended into the leading camber of the inner wing.
    const covertStations: WingStation[] = [
      { x: (wx + halfSpan * wristFrac * 0.04) * side, y: wy + wristLift * 0.04 + s.wingChord * 0.050, z: wz + wristSweep * 0.04 + rootChord * 0.13, chord: rootChord * 0.25, thick: s.wingChord * 0.054, camber: s.wingChord * 0.028, twist: -0.03 },
      { x: (wx + halfSpan * wristFrac * 0.38) * side, y: wy + wristLift * 0.38 + s.wingChord * 0.050, z: wz + wristSweep * 0.38 + s.wingChord * 0.11, chord: s.wingChord * 0.38, thick: s.wingChord * 0.058, camber: s.wingChord * 0.032, twist: -0.02 },
      { x: (wx + halfSpan * wristFrac * 0.74) * side, y: wy + wristLift * 0.76 + s.wingChord * 0.044, z: wz + wristSweep * 0.74 + s.wingChord * 0.09, chord: s.wingChord * 0.32, thick: s.wingChord * 0.046, camber: s.wingChord * 0.024, twist: -0.01 },
      { x: wrist[0] - side * 0.010, y: wrist[1] + s.wingChord * 0.032, z: wrist[2] + wristChord * 0.07, chord: wristChord * 0.16, thick: wristThick * 0.38, camber: wristCamber * 0.32, twist: 0 },
    ];
    b.addPart(sculptedWingFoil(covertStations, 8, 7, 2), s.mantleTint !== undefined ? 'hullPrimary' : 'hullSecondary', {
      name: `${dir} upper wing coverts`,
      vertexColor: makeBirdCovertColor(s.mantleTint),
      ...innerOpts,
    });

    const outerTipX = (wx + halfSpan * (style === 'slotted' ? 0.82 : 0.86)) * side;
    const outerTipY = wy + wristLift * (style === 'pelagic' ? 0.42 : 0.76);
    const outerTipZ = wz - tipSweep * 0.70;
    const outerStations: WingStation[] = [
      { x: wrist[0] - side * 0.015, y: wrist[1] - 0.0006, z: wrist[2] - 0.006, chord: wristChord * 0.78, thick: Math.max(0.0028, Math.min(wristThick * 0.56, wristThick - 0.0065)), camber: wristCamber * 0.70, twist: 0 },
      { x: THREE.MathUtils.lerp(wrist[0], outerTipX, 0.38), y: THREE.MathUtils.lerp(wrist[1], outerTipY, 0.38), z: THREE.MathUtils.lerp(wrist[2], outerTipZ, 0.38), chord: s.wingChord * (style === 'scythe' ? 0.58 : 0.68), thick: s.wingChord * 0.056, camber: s.wingChord * 0.032 },
      { x: THREE.MathUtils.lerp(wrist[0], outerTipX, 0.74), y: THREE.MathUtils.lerp(wrist[1], outerTipY, 0.74), z: THREE.MathUtils.lerp(wrist[2], outerTipZ, 0.74), chord: s.wingChord * (style === 'scythe' ? 0.34 : 0.48), thick: s.wingChord * 0.034, camber: s.wingChord * 0.018 },
      { x: outerTipX, y: outerTipY, z: outerTipZ, chord: s.wingChord * (style === 'scythe' ? 0.16 : 0.30), thick: s.wingChord * 0.020, camber: s.wingChord * 0.010 },
    ];
    b.addPart(sculptedWingFoil(outerStations, 10, 7, 2), style === 'pelagic' || style === 'slotted' ? 'hullSecondary' : 'hullPrimary', {
      name: `${dir} outer wing`,
      vertexColor: makeBirdWingColor(true, darkTips),
      ...outerOpts,
    });

    // Shingled primary flight feathers fanning cleanly outward along the outer hand wing.
    const featherCount = style === 'slotted' ? 5 : 4;
    for (let f = 0; f < featherCount; f++) {
      const frac = f / Math.max(1, featherCount - 1);
      const tSpan = style === 'slotted' ? 0.46 + frac * 0.50 : 0.40 + frac * 0.56;
      const bladeLen = s.wingChord * (style === 'slotted' ? 0.64 - frac * 0.08 : 0.54 - frac * 0.10);
      const bladeW = s.wingChord * (style === 'slotted' ? 0.14 : 0.16);
      const rootX = THREE.MathUtils.lerp(wrist[0], outerTipX, tSpan);
      const rootY = THREE.MathUtils.lerp(wrist[1], outerTipY, tSpan) + (f - 1.5) * 0.0075;
      const rootZ = THREE.MathUtils.lerp(wrist[2], outerTipZ, tSpan) - s.wingChord * (0.04 + frac * 0.04);
      const fanYaw = -side * (style === 'slotted' ? 1.24 - frac * 0.50 : 1.38 - frac * 0.22);

      b.addPart(sculptedFeather(bladeLen, bladeW, 0.005, 0.0035, 7), style === 'pelagic' ? 'rubberDark' : 'hullSecondary', {
        name: `${dir} primary feather ${f + 1}`,
        position: [rootX, rootY, rootZ],
        rotation: [0.012, fanYaw, side * 0.045],
        ...outerOpts,
      });
    }
  }
}

function addBirdBeakAndCrest(
  b: KitbashBuilder,
  s: BirdBuildSpec,
  hc: V3,
  hrx: number,
  hry: number,
  hrz: number,
  headOpts: PartOptions,
): void {
  const beakRoot: V3 = [0, hc[1] - hry * 0.06, hc[2] + hrz * 0.56];
  const bZone = s.beakZone ?? 'frameGunmetal';
  const toWorld = (pts: readonly V3[]): V3[] => [
    beakRoot,
    ...pts.map(([dx, dy, dz]): V3 => [beakRoot[0] + dx, beakRoot[1] + dy, beakRoot[2] + dz]),
  ];
  const beakColor = makeBirdBeakColor(s.beakBaseTint);
  b.addPart(tendril(toWorld(s.upperBeak), [...s.upperBeakR], 4, 6, 6), bZone, {
    name: 'upper beak culmen',
    role: 'whip',
    ...(beakColor ? { vertexColor: beakColor } : {}),
    ...headOpts,
  });
  const lowerRoot: V3 = [beakRoot[0], beakRoot[1] - 0.004, beakRoot[2] - 0.002];
  b.addPart(
    tendril(
      [lowerRoot, ...s.lowerBeak.map(([dx, dy, dz]): V3 => [beakRoot[0] + dx, beakRoot[1] + dy - 0.003, beakRoot[2] + dz])],
      s.lowerBeakR.map((v) => v * 0.80),
      4,
      5,
      6,
    ),
    'rubberDark',
    {
      name: 'lower beak mandible',
      role: 'whip',
      ...headOpts,
    },
  );

  if (s.crestPts && s.crestRadii) {
    const cWorld: V3[] = s.crestPts.map(([dx, dy, dz]) => [hc[0] + dx, hc[1] + dy, hc[2] + dz]);
    b.addPart(tendril(cWorld, [...s.crestRadii], 7, 5, 5), s.crestZone ?? 'hullSecondary', {
      name: 'occipital crest plume',
      role: 'whip',
      ...headOpts,
    });
  }

  if (s.gularPouch) {
    b.addPart(organ([hrx * 0.72, hry * 0.85, hrz * 1.15], 2, 5.1, 0.02, 8), 'hullSecondary', {
      name: 'inflated gular throat pouch',
      position: [0, hc[1] - hry * 0.92, hc[2] + hrz * 0.24],
      ...headOpts,
    });
  }
}

function addBirdHeadAndBeak(b: KitbashBuilder, s: BirdBuildSpec, flyY: number): void {
  const neckRootY = THREE.MathUtils.lerp(flyY + s.torsoH * 0.14, s.neckCurve[0]?.[1] ?? flyY + s.torsoH * 0.14, 0.55);
  const neckRoot: V3 = [0, neckRootY, s.torsoLen * 0.50];
  const neckRig: VertebratePartRig = { role: 10 };
  const headOpts: PartOptions = { animPivot: neckRoot, vertRig: neckRig };
  const neckZone = s.neckZone ?? 'hullPrimary';
  const neckColor = makeBirdHeadColor(s, true);
  const headColor = makeBirdHeadColor(s, false);

  const neckPts: V3[] = [];
  const neckRadii: number[] = [];
  if (s.neckCurve.length > 0) {
    const r0 = Math.min(s.neckRadii[0]!, s.torsoW * 0.48);
    const entryY = THREE.MathUtils.lerp(flyY + s.torsoH * 0.12, s.neckCurve[0]![1], 0.45);
    neckPts.push([0, entryY, s.torsoLen * 0.42]);
    neckRadii.push(r0 * 0.86);
    neckPts.push([0, neckRootY, s.torsoLen * 0.52]);
    neckRadii.push(r0);
    for (let i = 0; i < s.neckCurve.length; i++) {
      if (i === 0 && s.neckCurve[0]![2] <= s.torsoLen * 0.57) continue;
      neckPts.push(s.neckCurve[i]!);
      neckRadii.push(i === 0 ? r0 : s.neckRadii[i]!);
    }
  }
  b.addPart(tendril(neckPts, neckRadii, s.neckRuff ? 2 : 7, s.trailingLegs ? 14 : 11, 8), neckZone, {
    name: 'avian neck',
    ...(neckColor ? { vertexColor: neckColor } : {}),
    ...headOpts,
  });

  if (s.neckRuff) {
    const r0 = Math.min(s.neckRadii[0]!, s.torsoW * 0.48);
    b.addPart(
      sculptedLoft(
        [
          { y: neckRootY, z: s.torsoLen * 0.50, rx: r0 * 0.96, ryTop: r0 * 0.92, ryBot: r0 * 0.94 },
          { y: THREE.MathUtils.lerp(neckRootY, s.neckCurve[0]![1], 0.45), z: s.torsoLen * 0.58, rx: r0 * 1.24, ryTop: r0 * 1.14, ryBot: r0 * 1.18, ridge: 0.08 },
          { y: THREE.MathUtils.lerp(neckRootY, s.neckCurve[0]![1], 0.85), z: s.torsoLen * 0.66, rx: r0 * 0.86, ryTop: r0 * 0.84, ryBot: r0 * 0.84 },
        ],
        10,
        7,
        2.2,
        0.015,
        { subdiv: 1, domeCaps: false },
      ),
      'hullSecondary',
      { name: 'plumage neck ruff', ...headOpts },
    );
  }

  const headCenter = s.neckCurve[s.neckCurve.length - 1]!;
  const [hrx, hry, hrz] = s.headR;
  const hc: V3 = [headCenter[0], headCenter[1] + hry * 0.18, headCenter[2] + hrz * 0.32];

  // Sculpted avian cranium (tapering forward toward beak, fuller occipital nape).
  b.addPart(
    sculptedLoft(
      [
        { y: hc[1] - hry * 0.04, z: hc[2] - hrz * 0.64, rx: hrx * 0.78, ryTop: hry * 0.80, ryBot: hry * 0.70 },
        { y: hc[1] + hry * 0.02, z: hc[2] - hrz * 0.10, rx: hrx * 1.02, ryTop: hry * 0.96, ryBot: hry * 0.86 },
        { y: hc[1] - hry * 0.04, z: hc[2] + hrz * 0.65, rx: hrx * 0.70, ryTop: hry * 0.72, ryBot: hry * 0.64 },
      ],
      10,
      s.neckRuff ? 2 : 7,
      3.4,
      0,
      { subdiv: 1, domeCaps: false },
    ),
    neckZone,
    { name: 'avian cranium', ...(headColor ? { vertexColor: headColor } : {}), ...headOpts },
  );

  // Subtle recessed eyes beneath supraorbital brow ridge (no bulging cartoon marbles!).
  const eyeR = Math.min(0.010, hrx * 0.15);
  const brow = s.browFlare ?? 1.25;
  for (const side of [-1, 1] as const) {
    const dir = side > 0 ? 'right' : 'left';
    const ex = hrx * 0.76 * side;
    const ey = hc[1] + hry * 0.16;
    const ez = hc[2] + hrz * 0.28;
    b.addPart(organ([eyeR * brow, eyeR * 0.75, eyeR * 2.0], 7, side, 0, 7), neckZone, {
      name: `${dir} supraorbital brow`,
      position: [ex * 0.94, ey + eyeR * 0.85, ez],
      rotation: [0.1, side * 0.2, -side * 0.14],
      ...headOpts,
    });
    b.addPart(organ([eyeR, eyeR * 0.95, eyeR * 1.05], 5, side, 0, 7), 'glassVisor', {
      name: `${dir} avian eye`,
      position: [ex, ey, ez],
      ...headOpts,
    });
  }

  addBirdBeakAndCrest(b, s, hc, hrx, hry, hrz, headOpts);
}

function addBirdTail(b: KitbashBuilder, s: BirdBuildSpec, flyY: number): void {
  const tailRoot: V3 = [0, flyY + 0.008, -s.torsoLen * 0.84];
  const tailOpts: PartOptions = { animPivot: tailRoot, vertRig: { role: 9 } };
  const style = s.tailStyle ?? 'fan';

  // Upper tail covert cape bridging cleanly inside rump to overlapping rectrix fan.
  b.addPart(
    sculptedLoft(
      [
        { y: tailRoot[1] + 0.008, z: -s.torsoLen * 0.70, rx: s.torsoW * 0.34, ryTop: s.torsoH * 0.25, ryBot: s.torsoH * 0.22 },
        { y: tailRoot[1] + 0.006, z: tailRoot[2] - s.tailLen * 0.14, rx: s.torsoW * 0.28, ryTop: s.torsoH * 0.14, ryBot: s.torsoH * 0.12 },
      ],
      8, 7, 3.1, 0, { subdiv: 1 },
    ),
    'hullPrimary',
    { name: 'upper tail coverts', ...tailOpts },
  );

  for (let i = -2; i <= 2; i++) {
    const absI = Math.abs(i);
    let len = s.tailLen;
    let yaw = -i * (s.tailSpread / s.tailLen) * 0.16;
    if (style === 'forked') {
      len = s.tailLen * (0.54 + absI * 0.26);
      yaw = -i * 0.075;
    } else if (style === 'wedge') {
      len = s.tailLen * (1.06 - absI * 0.15);
      yaw = -i * 0.055;
    } else if (style === 'pintail') {
      len = i === 0 ? s.tailLen * 1.38 : s.tailLen * (0.74 - absI * 0.08);
      yaw = -i * 0.065;
    }
    const fW = Math.max(0.028, s.tailSpread * 0.36);
    b.addPart(sculptedFeather(len, fW, 0.005, 0.003, 7), absI === 2 ? 'hullSecondary' : 'hullPrimary', {
      name: `tail rectrix ${i + 3}`,
      position: [i * fW * 0.24, tailRoot[1] + 0.005 - absI * 0.0025, tailRoot[2] + absI * 0.002],
      rotation: [0.025, yaw, i * 0.035],
      ...tailOpts,
    });
  }
}

function addBirdLegs(b: KitbashBuilder, s: BirdBuildSpec, flyY: number): void {
  const bodyOpts: PartOptions = { vertRig: { role: 1 } };
  const legLen = s.trailingLegs ?? 0;
  const keel = s.keelDepth ?? s.torsoH * 1.14;
  for (const side of [-1, 1] as const) {
    const dir = side > 0 ? 'right' : 'left';
    const lx = s.torsoW * 0.42 * side;
    const ly = flyY - Math.max(s.torsoH * 0.66, keel * 0.80);
    const lz = -s.torsoLen * 0.18;

    b.addPart(organ([s.torsoW * 0.24, s.torsoH * 0.28, s.torsoW * 0.24], 7, side, 0, 6), 'hullPrimary', {
      name: `${dir} tibial plumage`,
      position: [lx, flyY - Math.max(s.torsoH * 0.72, keel * 0.72), lz],
      ...bodyOpts,
    });

    if (legLen > 0.05) {
      const hipAnchor: V3 = [lx, ly + 0.018, lz + 0.010];
      const hock: V3 = [lx, ly - 0.016, lz - legLen * 0.46];
      const foot: V3 = [lx, ly - 0.028, lz - legLen];
      b.addPart(tendril([hipAnchor, hock, foot], [0.011, 0.008, 0.007], 4, 8, 6), 'frameGunmetal', {
        name: `${dir} trailing wader leg`,
        role: 'whip',
        ...bodyOpts,
      });
      b.addPart(organ([0.0095, 0.006, 0.022], 4, side, 0, 6), 'frameGunmetal', {
        name: `${dir} trailing foot`,
        position: [foot[0], foot[1] - 0.001, foot[2] - 0.005],
        ...bodyOpts,
      });
      for (const toeSide of [-1, 1] as const) {
        b.addPart(
          tendril(
            [[foot[0] + toeSide * 0.0052, foot[1] - 0.001, foot[2] + 0.004], [foot[0] + toeSide * 0.0072, foot[1] - 0.002, foot[2] - 0.025]],
            [0.0050, 0.0032], 4, 2, 5,
          ),
          'frameGunmetal',
          { name: `${dir} trailing ${toeSide > 0 ? 'outer' : 'inner'} toe`, role: 'whip', ...bodyOpts },
        );
      }
    } else {
      b.addPart(tendril([[lx, ly, lz], [lx, ly - 0.022, lz - 0.028]], [0.014, 0.009], 4, 4, 6), 'frameGunmetal', {
        name: `${dir} tucked tarsus`,
        role: 'whip',
        ...bodyOpts,
      });
      b.addPart(organ([0.018, 0.014, 0.028], 4, side, 0, 6), 'rubberDark', {
        name: `${dir} tucked talons`,
        position: [lx, ly - 0.024, lz - 0.028],
        ...bodyOpts,
      });
    }
  }
}

export function buildAvianCore(b: KitbashBuilder, s: BirdBuildSpec): void {
  const flyY = s.flyY ?? 0.65;
  const L = s.torsoLen;
  const W = s.torsoW;
  const H = s.torsoH;
  const keel = s.keelDepth ?? H * 1.14;

  const birdSize = s.birdSize ?? THREE.MathUtils.clamp((s.wingSpan - 0.45) / 0.80, 0, 1);
  b.vertebrateConfig = {
    isBird: 1,
    comY: flyY,
    sleepDrop: 0,
    strideLen: s.flapAmp ?? 0.42,
    liftHeight: s.wristBend ?? 0.34,
    gaitFreq: s.flapRate ?? 7.5,
    headSleepPitch: 0,
    birdSize,
  };

  // Smooth convex rounded breast tapering cleanly into the concentric neck socket (zero rim cavity).
  const neckR0 = Math.min(s.neckRadii[0] ?? W * 0.46, W * 0.56);
  const neckRootY = THREE.MathUtils.lerp(flyY + H * 0.12, s.neckCurve[0]?.[1] ?? flyY + H * 0.12, 0.55);
  const fuselageStations: LoftStation[] = [
    { y: flyY + 0.004, z: -L * 0.94, rx: W * 0.18, ryTop: H * 0.16, ryBot: H * 0.14, ridge: 0.18 },
    { y: flyY + 0.004, z: -L * 0.84, rx: W * 0.36, ryTop: H * 0.32, ryBot: H * 0.28, ridge: 0.22 },
    { y: flyY - H * 0.02, z: -L * 0.42, rx: W * 0.78, ryTop: H * 0.76, ryBot: H * 0.74, ridge: 0.18 },
    { y: flyY - H * 0.06, z: L * 0.04, rx: W * 1.02, ryTop: H * 0.94, ryBot: keel * 0.98, ridge: 0.18 },
    { y: flyY + H * 0.01, z: L * 0.36, rx: W * 0.88, ryTop: H * 0.84, ryBot: keel * 0.88, ridge: 0.14 },
    { y: neckRootY, z: L * 0.50, rx: Math.max(W * 0.48, neckR0 * 1.02), ryTop: Math.max(H * 0.46, neckR0 * 0.98), ryBot: Math.max(H * 0.48, neckR0 * 1.04), ridge: 0.10 },
  ];
  const bodyOpts: PartOptions = { vertRig: { role: 1 } };
  b.addPart(sculptedLoft(fuselageStations, 12, 7, 1.1, 0, { subdiv: 2, domeCaps: true }), 'hullPrimary', {
    name: 'aerodynamic fuselage',
    vertexColor: makeBirdPlumageColor(s),
    ...bodyOpts,
  });

  addBirdWings(b, s, flyY);
  addBirdHeadAndBeak(b, s, flyY);
  addBirdTail(b, s, flyY);
  addBirdLegs(b, s, flyY);
}
