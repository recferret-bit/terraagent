import * as THREE from 'three';
import { vertebratePartMatrix } from '../../../animation/vertebrates/pose';
import type { VertebrateRigConfig } from '../../../animation/vertebrates/types';
import type { CheckStage, ValidationContext } from '../context';
import type { P } from '../types';

const sameVec3 = (a: [number, number, number], b: [number, number, number]) =>
  Math.abs(a[0] - b[0]) < 1e-4 && Math.abs(a[1] - b[1]) < 1e-4 && Math.abs(a[2] - b[2]) < 1e-4;

function boxDim(p: P, axis: 0 | 1 | 2): number {
  return p.box[axis + 3]! - p.box[axis]!;
}

function boxOverlap(a: P, b: P): [number, number, number] {
  return [
    Math.min(a.box[3]!, b.box[3]!) - Math.max(a.box[0]!, b.box[0]!),
    Math.min(a.box[4]!, b.box[4]!) - Math.max(a.box[1]!, b.box[1]!),
    Math.min(a.box[5]!, b.box[5]!) - Math.max(a.box[2]!, b.box[2]!),
  ];
}

function checkAvianFootAnchoring(ctx: ValidationContext): void {
  const legs = ctx.parts.filter((p) => p.def.name.includes('leg') || p.def.name.includes('tarsus'));
  const feet = ctx.parts.filter((p) => p.def.name.includes('foot') || p.def.name.includes('talon') || p.def.name.includes('toe'));
  for (const f of feet) {
    const side = f.def.name.includes('left') ? 'left' : f.def.name.includes('right') ? 'right' : '';
    const isToe = f.def.name.includes('toe');
    const candidates = isToe
      ? ctx.parts.filter((q) => q !== f && (!side || q.def.name.includes(side)) && (q.def.name.includes('foot') || q.def.name.includes('leg') || q.def.name.includes('tarsus')))
      : legs.filter((q) => !side || q.def.name.includes(side));
    let bestOv = 0;
    let bestMin = 0;
    let bestCross = false;
    for (const parent of candidates) {
      const rel = ctx.R(f.def.index, parent.def.index);
      const [ox, oy, oz] = boxOverlap(f, parent);
      const minCross = Math.min(ox, oy, oz);
      if (rel.crossing && minCross > 0) {
        bestCross = true;
        bestMin = Math.max(bestMin, minCross);
        bestOv = Math.max(bestOv, isToe ? Math.max(ox, oy, oz) : oz);
      }
    }
    if (!bestCross || bestMin < 0.004 || bestOv < 0.01) {
      ctx.add(
        'error',
        'VERTEBRATE_FOOT_ANCHOR',
        `${f.label} lacks solid >= 1 cm (min >= 4 mm) 3D overlap into its avian leg/foot anchor (overlap ${(bestOv * 100).toFixed(2)} cm, min ${(bestMin * 1000).toFixed(1)} mm).`,
        [f.def.index],
      );
    }
  }
}

function checkLimbJointContinuity(ctx: ValidationContext): void {
  const uppers = ctx.parts.filter((p) => p.def.vertRig?.role === 4);
  const lowers = ctx.parts.filter((p) => p.def.vertRig?.role === 5);
  for (const u of uppers) {
    const l = lowers.find((q) => q.def.vertRig && sameVec3(q.def.vertRig.pivot, u.def.vertRig!.pivot));
    if (!l) continue;
    const rel = ctx.R(u.def.index, l.def.index);
    const [ox, oy, oz] = boxOverlap(u, l);
    const minCross = Math.min(ox, oy, oz);
    if (!rel.crossing || minCross < 0.006) {
      ctx.add(
        'error',
        'VERTEBRATE_LIMB_ANATOMY',
        `${u.label} and ${l.label} lack >= 6 mm solid ball-in-socket joint overlap around elbow/stifle (min ${(minCross * 1000).toFixed(1)} mm).`,
        [u.def.index, l.def.index],
      );
    }
  }
}

function checkMammalSleepPosture(ctx: ValidationContext): void {
  const trunkParts = ctx.parts.filter((p) => p.def.vertRig?.role === 1);
  const limbParts = ctx.parts.filter((p) => {
    const r = p.def.vertRig?.role;
    return r === 4 || r === 5 || r === 6;
  });
  const cfg = (trunkParts[0]?.def.vertConfig ?? ctx.parts.find((p) => p.def.vertConfig)?.def.vertConfig) as VertebrateRigConfig | undefined;
  if (!cfg || cfg.isBird > 0.5 || cfg.sleepDrop <= 0 || trunkParts.length === 0 || limbParts.length === 0) return;

  const sleepPose = { time: 0, walk: 0, run: 0, work: 0, sleep: 1, config: cfg };
  const v = new THREE.Vector3();
  let trunkMinY = Infinity;
  let trunkMaxY = -Infinity;
  let trunkMaxAbsX = 0;
  for (const p of trunkParts) {
    const mat = vertebratePartMatrix(p.def.vertRig!, sleepPose);
    for (let i = 0; i < p.tris.length; i += 3) {
      v.fromArray(p.tris, i).applyMatrix4(mat);
      trunkMinY = Math.min(trunkMinY, v.y);
      trunkMaxY = Math.max(trunkMaxY, v.y);
      trunkMaxAbsX = Math.max(trunkMaxAbsX, Math.abs(v.x));
    }
  }
  if (trunkMinY > 0.048 || trunkMinY < -0.015) {
    ctx.add(
      'error',
      'VERTEBRATE_SLEEP_POSTURE',
      `Sleep pose torso ${trunkMinY > 0.048 ? `hovers ${(trunkMinY * 100).toFixed(1)} cm above ground` : `sinks ${(trunkMinY * 100).toFixed(1)} cm below ground`} (must settle within -1.5..4.8 cm).`,
      trunkParts.map((p) => p.def.index),
    );
  }
  for (const p of limbParts) {
    const restMaxX = Math.max(Math.abs(p.box[0]!), Math.abs(p.box[3]!));
    const mat = vertebratePartMatrix(p.def.vertRig!, sleepPose);
    let sleepMaxX = 0;
    let sleepMinY = Infinity;
    for (let i = 0; i < p.tris.length; i += 3) {
      v.fromArray(p.tris, i).applyMatrix4(mat);
      sleepMaxX = Math.max(sleepMaxX, Math.abs(v.x));
      sleepMinY = Math.min(sleepMinY, v.y);
    }
    const isFore = p.def.vertRig!.pivot[2] >= 0;
    const maxFromTrunk = trunkMaxAbsX + (isFore ? 0.032 : 0.055);
    const maxFromRest = restMaxX + (isFore ? 0.030 : 0.045);
    if (sleepMaxX > maxFromTrunk || sleepMaxX > maxFromRest) {
      ctx.add(
        'error',
        'VERTEBRATE_SLEEP_POSTURE',
        `${p.label} breaks out laterally in sleep pose (|x|=${sleepMaxX.toFixed(3)} m vs trunk ${trunkMaxAbsX.toFixed(3)} m / rest ${restMaxX.toFixed(3)} m).`,
        [p.def.index],
      );
    }
    if (sleepMinY < -0.020) {
      ctx.add(
        'error',
        'VERTEBRATE_SLEEP_POSTURE',
        `${p.label} dips ${(sleepMinY * -100).toFixed(1)} cm below ground in sleep pose.`,
        [p.def.index],
      );
    }
    if (p.def.vertRig!.role === 4) {
      const hipY = new THREE.Vector3(...p.def.vertRig!.pivot).applyMatrix4(mat).y;
      const midY = new THREE.Vector3(...p.def.vertRig!.joint).applyMatrix4(mat).y;
      if (midY > Math.max(hipY + 0.055, trunkMaxY * 0.65)) {
        ctx.add(
          'error',
          'VERTEBRATE_SLEEP_POSTURE',
          `${p.label} joint spikes upward in sleep pose (mid.y=${midY.toFixed(3)} m vs hip.y=${hipY.toFixed(3)} m).`,
          [p.def.index],
        );
      }
    }
  }
}

/**
 * Dedicated vertebrate anatomy & anti-slop stage for mammals (`tissue 6`) and birds (`tissue 7`).
 */
export const vertebrateAnatomyStage: CheckStage = (ctx) => {
  const isVertebrate = ctx.parts.some((p) => p.def.tissue === 6 || p.def.tissue === 7);
  if (!isVertebrate) return;
  if (ctx.n < 7 && !ctx.model.id.startsWith('fauna.') && !ctx.model.id.startsWith('vertebrate.')) return;

  const tissues = new Set<number>();
  const roles = new Map<number, number>();
  let hasFur = false;
  let hasPlumage = false;

  for (const p of ctx.parts) {
    const t = p.def.tissue ?? 0;
    if (t > 0) tissues.add(t);
    if (t === 6) hasFur = true;
    if (t === 7) hasPlumage = true;
    if (!p.def.vertRig || !p.def.vertConfig) {
      ctx.add('error', 'VERTEBRATE_RIG_PARITY', `${p.label} lacks vertebrate closed-form rig metadata (vertRig/vertConfig).`, [p.def.index]);
    } else {
      roles.set(p.def.vertRig.role, (roles.get(p.def.vertRig.role) ?? 0) + 1);
    }

    const col = p.def.color ?? 0;
    const maxCh = Math.max((col >> 16) & 0xff, (col >> 8) & 0xff, col & 0xff);
    if (p.def.emissive <= 0 && maxCh > 218) {
      ctx.add('warn', 'VERTEBRATE_BLOOM_SAFE', `${p.label} albedo channel (${maxCh}) exceeds 218 and will blow out HDR bloom under sunlight.`, [p.def.index]);
    }
  }

  if (ctx.n < 22) {
    ctx.add('error', 'VERTEBRATE_DETAIL_RICHNESS', `Only ${ctx.n} anatomical sub-parts (vertebrate models require >= 22 sculpted sub-parts).`, []);
  }
  if (tissues.size < 3) {
    ctx.add('warn', 'VERTEBRATE_DETAIL_RICHNESS', `Only ${tissues.size} biological tissues (use >= 3 across coat/plumage, keratin claws/beak/hooves, and glossy eyes).`, []);
  }

  const isBird = hasPlumage && !hasFur;
  if (isBird) {
    if ((roles.get(7) ?? 0) < 2 || (roles.get(8) ?? 0) < 6) {
      ctx.add('error', 'VERTEBRATE_WING_ARTICULATION', 'Avian models must separate inner cambered wings (role 7) from articulated outer primary feather assemblies (role 8, >= 6 parts).', []);
    }
    if ((roles.get(9) ?? 0) < 4) {
      ctx.add('error', 'VERTEBRATE_WING_ARTICULATION', 'Avian tails must compose >= 4 layered/fanned rectrix feather parts (role 9), never a single flat disc.', []);
    }
    checkAvianFootAnchoring(ctx);
  } else if (hasFur) {
    if ((roles.get(4) ?? 0) < 4 || (roles.get(5) ?? 0) < 4 || (roles.get(6) ?? 0) < 4) {
      ctx.add('error', 'VERTEBRATE_LIMB_ANATOMY', 'Mammal models must articulate upper limbs (role 4), lower limbs (role 5) and sculpted paws/hooves (role 6) across all 4 legs.', []);
    }
    for (const p of ctx.parts) {
      if (p.def.name.includes('joint') && p.def.tissue === 2) {
        ctx.add('error', 'VERTEBRATE_LIMB_ANATOMY', `${p.label} exposes a mechanical joint ball instead of organic muscle continuity.`, [p.def.index]);
      }
    }
    checkLimbJointContinuity(ctx);
    checkMammalSleepPosture(ctx);
  }

  const cranium = ctx.parts.find((p) => p.def.name.includes('cranium') || p.def.name.includes('head'));
  if (cranium) {
    const cw = Math.max(0.02, boxDim(cranium, 0));
    for (const p of ctx.parts) {
      if (p.def.tissue === 5 && p.def.name.includes('eye')) {
        const ew = Math.max(boxDim(p, 0), boxDim(p, 1));
        if (ew / cw > 0.25) {
          ctx.add('error', 'VERTEBRATE_EYE_PROPORTION', `${p.label} is oversized (${(ew / cw * 100).toFixed(0)}% of cranium width); recess smaller eyes under brow ridges.`, [p.def.index]);
        }
      }
    }
  }
};
