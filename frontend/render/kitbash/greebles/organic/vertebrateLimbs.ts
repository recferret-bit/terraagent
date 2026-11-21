import * as THREE from 'three';
import type { VertebratePartRig } from '../../../animation/vertebrates/types';
import type { KitbashBuilder, MaterialZoneId, PartOptions } from '../../KitbashRegistry';
import type { V3 } from '../unitParts';
import { organ } from './shapes';
import { computeTrunkBounds, makeLimbColor } from './vertebrateColor';
import { addMammalNeckAndHead, addMammalTail, type MammalHeadTailSpec } from './vertebrateHeadTail';
import { sculptedLimbSegment } from './vertebrateLoft';

export type { MammalCoatPattern } from './vertebrateColor';
export type MammalBuildSpec = MammalHeadTailSpec;
export { addMammalNeckAndHead, addMammalTail };

function addFoot(
  b: KitbashBuilder,
  s: MammalBuildSpec,
  ankle: V3,
  side: number,
  tag: string,
  rig: VertebratePartRig,
  rootPivot: V3,
): void {
  const r = s.legThick;
  const pawOpts: PartOptions = { animPivot: rootPivot, vertRig: rig };
  if (s.hoof) {
    const hW = r * 0.36;
    const hH = ankle[1] * 0.64;
    const hL = r * 0.96;
    for (const toeSide of [-1, 1] as const) {
      b.addPart(organ([hW, hH, hL], 4, toeSide, 0, 5), 'rubberDark', {
        name: `${tag} cloven hoof ${toeSide > 0 ? 'outer' : 'inner'}`,
        position: [ankle[0] + toeSide * hW * 1.02, hH, ankle[2] + r * 0.24],
        rotation: [0, toeSide * 0.10 * side, 0],
        ...pawOpts,
      });
    }
    return;
  }

  if (s.camelPad) {
    const pH = ankle[1] * 0.58;
    for (const toeSide of [-1, 1] as const) {
      b.addPart(organ([r * 0.44, pH, r * 0.92], 2, toeSide, 0, 5), 'rubberDark', {
        name: `${tag} cushion pad ${toeSide > 0 ? 'R' : 'L'}`,
        position: [ankle[0] + toeSide * r * 0.44, pH, ankle[2] + r * 0.24],
        ...pawOpts,
      });
    }
    return;
  }

  const pH = Math.max(0.015, ankle[1] * 0.58);
  const pawZone = s.pawZone ?? 'hullPrimary';
  const toeZone: MaterialZoneId = s.pawZone ?? 'frameGunmetal';
  const footLen = s.hareHind && tag.includes('hind') ? r * 1.48 : r * 1.02;
  const pawZ = Math.max(footLen * 0.86, 0.024);
  b.addPart(organ([r * 0.78, pH, pawZ], 6, side, 0, 5), pawZone, {
    name: `${tag} paw pad`,
    position: [ankle[0], pH, ankle[2] + footLen * 0.40],
    ...pawOpts,
  });
  for (const tIdx of [-1, 0, 1] as const) {
    const tz = ankle[2] + footLen * 0.40 + pawZ * (tIdx === 0 ? 0.78 : 0.65);
    b.addPart(organ([r * 0.19, pH * 0.42, Math.max(r * 0.30, 0.012)], 4, tIdx, 0, 4), toeZone, {
      name: `${tag} toe ${tIdx + 2}`,
      position: [ankle[0] + tIdx * r * 0.48, pH * 0.42, tz],
      ...pawOpts,
    });
  }
}

export function addMammalForelimb(b: KitbashBuilder, s: MammalBuildSpec, side: number, phase: number): void {
  const dir = side > 0 ? 'right' : 'left';
  const r = s.legThick;
  const foreS = s.foreScale ?? 1.0;
  const foreRoot = Math.sqrt(foreS);
  const shoulder: V3 = [s.legXFront * side, s.shoulderY, s.zFront];
  const limbX = s.legXFront * side;
  const footX = (s.legXFront - r * 0.03) * side;
  const elbowBack = s.elbowBackFrac ?? (s.hoof || s.camelPad ? 0.068 : 0.088);
  const elbowY = s.shoulderY * 0.58;
  const elbowZ = s.zFront - s.shoulderY * elbowBack;
  const elbow: V3 = [limbX, elbowY, elbowZ];
  const footH = Math.max(0.032, r * 0.90);
  const ankle: V3 = [footX, footH, s.zFront + s.shoulderY * 0.016];

  const upperRig: VertebratePartRig = { role: 4, joint: elbow, tip: ankle, meta: phase };
  const lowerRig: VertebratePartRig = { role: 5, joint: elbow, tip: ankle, meta: phase };
  const footRig: VertebratePartRig = { role: 6, joint: elbow, tip: ankle, meta: phase };

  const bounds = computeTrunkBounds(s.trunkStations);
  // Muscular scapular deltoid & triceps wedge anchored high and medially inside the 3D shoulder blade mass.
  const scapTopY = Math.min(s.shoulderY + r * 0.96, s.torsoY + r * 0.56);
  const scapRoot: V3 = [limbX * 0.48, scapTopY, s.zFront - r * 0.30];
  const scapMid: V3 = [
    THREE.MathUtils.lerp(limbX * 0.48, elbow[0], 0.34),
    THREE.MathUtils.lerp(scapTopY, elbowY, 0.34),
    THREE.MathUtils.lerp(s.zFront - r * 0.30, elbowZ, 0.42),
  ];
  const armMid: V3 = [
    THREE.MathUtils.lerp(limbX * 0.48, elbow[0], 0.68),
    THREE.MathUtils.lerp(scapTopY, elbowY, 0.68),
    THREE.MathUtils.lerp(s.zFront - r * 0.30, elbowZ, 0.72),
  ];
  b.addPart(
    sculptedLimbSegment(
      [scapRoot, scapMid, armMid, elbow],
      [r * 0.36 * foreRoot, r * 0.43 * foreRoot, r * 0.44 * foreRoot, r * 0.44 * foreRoot],
      [r * 0.98 * foreRoot, r * 1.12 * foreS, r * 0.86 * foreRoot, r * 0.64 * foreRoot],
      8,
      6,
      s.torsoY,
    ),
    'hullPrimary',
    { name: `${dir} fore upper arm`, vertexColor: makeLimbColor(false, s.coatPattern, bounds), animPivot: shoulder, vertRig: upperRig },
  );

  const wrist: V3 = [footX, Math.max(footH + 0.035, s.shoulderY * 0.24), ankle[2] - r * 0.14];
  const foreMid: V3 = [
    THREE.MathUtils.lerp(elbow[0], wrist[0], 0.42),
    THREE.MathUtils.lerp(elbowY, wrist[1], 0.42),
    THREE.MathUtils.lerp(elbowZ, wrist[2], 0.42),
  ];
  const pastern: V3 = [footX, footH * 0.82, ankle[2] + r * 0.04];
  b.addPart(
    sculptedLimbSegment(
      [elbow, foreMid, wrist, pastern],
      [r * 0.42 * foreRoot, r * 0.43 * foreRoot, r * 0.37, r * 0.32],
      [r * 0.56 * foreRoot, r * 0.54 * foreRoot, r * 0.40, r * 0.32],
      7,
      6,
    ),
    s.sockZone ?? 'hullPrimary',
    { name: `${dir} fore forearm`, vertexColor: makeLimbColor(Boolean(s.sockZone), s.coatPattern), animPivot: shoulder, vertRig: lowerRig },
  );

  addFoot(b, s, ankle, side, `${dir} fore`, footRig, shoulder);
}

export function addMammalHindlimb(b: KitbashBuilder, s: MammalBuildSpec, side: number, phase: number): void {
  const dir = side > 0 ? 'right' : 'left';
  const r = s.legThick;
  const thS = s.thighScale ?? 1.0;
  const thRoot = Math.sqrt(thS);
  const hip: V3 = [s.legXBack * side, s.hipY, s.zBack];
  const limbX = s.legXBack * side;
  const footX = s.legXBack * side;
  const stifleFwd = s.stifleFwdFrac ?? (s.hareHind ? 0.24 : 0.118);
  const stifleY = s.hipY * 0.60;
  const stifleZ = s.zBack + s.hipY * stifleFwd;
  const stifle: V3 = [limbX + side * r * 0.04, stifleY, stifleZ];
  const footH = Math.max(0.032, r * 0.90);
  const hockBack = s.hockBack ?? s.hipY * (s.hoof || s.camelPad ? 0.125 : 0.140);
  const hockY = s.hareHind ? Math.max(footH + 0.058, s.hipY * 0.38) : s.hipY * 0.34;
  const hock: V3 = [footX, hockY, s.zBack - hockBack];
  const ankle: V3 = [footX, footH, s.zBack - (s.hareHind ? 0.004 : hockBack * 0.28)];

  const upperRig: VertebratePartRig = { role: 4, joint: stifle, tip: ankle, meta: phase };
  const lowerRig: VertebratePartRig = { role: 5, joint: stifle, tip: ankle, meta: phase };
  const footRig: VertebratePartRig = { role: 6, joint: stifle, tip: ankle, meta: phase };

  const bounds = computeTrunkBounds(s.trunkStations);
  // Broad 3D gluteal/quadriceps/hamstring haunch wedge anchored high inside the pelvic haunch mass.
  const hipTopY = Math.min(s.hipY + r * 1.18, s.torsoY + r * 0.76);
  const hipRootX = side * Math.max(s.legXBack * 0.50, s.legXBack - r * 0.80);
  const hipRoot: V3 = [hipRootX, hipTopY, s.zBack - r * 0.14];
  const hipMid: V3 = [
    THREE.MathUtils.lerp(hipRootX, stifle[0], 0.34),
    THREE.MathUtils.lerp(hipTopY, stifleY, 0.34),
    THREE.MathUtils.lerp(s.zBack - r * 0.14, stifleZ, 0.36),
  ];
  const thighMid: V3 = [
    THREE.MathUtils.lerp(hipRootX, stifle[0], 0.68),
    THREE.MathUtils.lerp(hipTopY, stifleY, 0.68),
    THREE.MathUtils.lerp(s.zBack - r * 0.14, stifleZ, 0.70),
  ];
  b.addPart(
    sculptedLimbSegment(
      [hipRoot, hipMid, thighMid, stifle],
      [r * 0.35 * thRoot, r * 0.43 * thRoot, r * 0.45 * thRoot, r * 0.44 * thRoot],
      [r * 1.36 * thRoot, r * 1.48 * thS, r * 1.08 * thRoot, r * 0.72 * thRoot],
      8,
      6,
      s.torsoY,
    ),
    'hullPrimary',
    { name: `${dir} hind thigh`, vertexColor: makeLimbColor(false, s.coatPattern, bounds), animPivot: hip, vertRig: upperRig },
  );

  // Muscular gastrocnemius calf (gaskin) sweeping backward to a crisp calcaneal hock heel, then straight cannon into foot.
  const gaskinMid: V3 = [
    THREE.MathUtils.lerp(stifle[0], hock[0], 0.46),
    THREE.MathUtils.lerp(stifleY, hockY, 0.44),
    THREE.MathUtils.lerp(stifleZ, hock[2], 0.50),
  ];
  const cannonMid: V3 = [
    footX,
    THREE.MathUtils.lerp(hockY, footH * 0.82, 0.48),
    THREE.MathUtils.lerp(hock[2], ankle[2], 0.55),
  ];
  const pastern: V3 = [footX, footH * 0.82, ankle[2] + r * 0.04];
  b.addPart(
    sculptedLimbSegment(
      [stifle, gaskinMid, hock, cannonMid, pastern],
      [r * 0.42 * thRoot, r * 0.43 * thRoot, r * 0.36, r * 0.32, r * 0.30],
      [r * 0.60 * thRoot, r * 0.58 * thRoot, r * 0.48, r * 0.35, r * 0.32],
      7,
      6,
    ),
    s.sockZone ?? 'hullPrimary',
    { name: `${dir} hind gaskin`, vertexColor: makeLimbColor(Boolean(s.sockZone), s.coatPattern), animPivot: hip, vertRig: lowerRig },
  );

  addFoot(b, s, ankle, side, `${dir} hind`, footRig, hip);
}
