import { classifyInsectPart } from '../../../animation/insects/rig';
// Stage 4: animated parts. Sweep every pose of the shader's motion against everything else.
import { boxGap, expandBox, trisBox } from '../math';
import type { Box } from '../math';
import { embed, prepare, relate } from '../relation';
import { poses, type Pose } from '../poses';
import { at, fmt, type CheckStage, type ValidationContext } from '../context';
import type { P } from '../types';

interface Sweep { poses: Pose[]; box: Box }

const samePivot = (a: [number, number, number], b: [number, number, number]) =>
  Math.abs(a[0] - b[0]) < 1e-4 && Math.abs(a[1] - b[1]) < 1e-4 && Math.abs(a[2] - b[2]) < 1e-4;
const sameSpinAxis = (a: [number, number, number], b: [number, number, number]) =>
  Math.abs(a[0] - b[0]) < 1e-4 && Math.abs(a[2] - b[2]) < 1e-4;
// Bob (2) and recoil (3) phases both depend on pivot.x (shader: sin(t + pivot.x * k)), so equal pivot.x = one rig.
const phaseByPivotX = (t: number) => t % 10 === 2 || t % 10 === 3;
const sameInsectRig = (a: P, b: P) => {
  const ga = classifyInsectPart(a.def.name, a.def.animType, a.def.pivot).group;
  const gb = classifyInsectPart(b.def.name, b.def.animType, b.def.pivot).group;
  return ga === gb && (ga < 4 || samePivot(a.def.pivot, b.def.pivot));
};
const sameRig = (a: P, b: P) => a.def.insectSpecies !== undefined && b.def.insectSpecies !== undefined ? sameInsectRig(a, b) :
  a.def.animType === b.def.animType &&
  (a.def.animType === 8 || a.def.animType === 9 ||
    (phaseByPivotX(a.def.animType) ? Math.abs(a.def.pivot[0] - b.def.pivot[0]) < 1e-4 :
      a.def.animType % 10 === 1 ? sameSpinAxis(a.def.pivot, b.def.pivot) : samePivot(a.def.pivot, b.def.pivot)));
const isGait = (t: number) => { const b = t % 10; return (b >= 4 && b <= 6) || b === 8 || b === 9; };
const inSync = (a: P, b: P) =>
  (a.def.insectSpecies !== undefined && b.def.insectSpecies !== undefined) ||
  (a.def.animType === 1 && b.def.animType === 1) ||
  (a.def.animType === 7 && b.def.animType === 7) ||
  (isGait(a.def.animType) && isGait(b.def.animType)) ||
  (a.def.animType === b.def.animType && Math.abs(a.def.pivot[0] - b.def.pivot[0]) < 1e-4);

function coupledPair(ta: number, tb: number, pa: [number, number, number], pb: [number, number, number]): boolean {
  const lo = Math.min(ta, tb), hi = Math.max(ta, tb);
  if (lo === 8 && (hi === 18 || hi === 28 || hi === 38)) return true;
  if (hi === 8 && (lo === 4 || lo === 5)) return true;
  if (lo === 9 && (hi === 19 || hi === 29 || hi === 39 || hi === 49 || hi === 59 || hi === 69)) return true;
  if (hi === 9 && lo === 6) return true;
  if (samePivot(pa, pb) && (((lo === 4 || lo === 14) && (hi === 14 || hi === 24)) || (lo === 6 && hi === 16))) return true;
  return false;
}

function validMount(a: P, b: P, tol: number): boolean {
  if (a.def.insectSpecies !== undefined && b.def.insectSpecies !== undefined) return true;
  if (sameRig(a, b)) return true;
  if (b.def.kind === 'TubeGeometry' && b.def.animType !== a.def.animType && b.def.role !== 'whip') return false;
  if (b.def.animType > 0) return coupledPair(a.def.animType, b.def.animType, a.def.pivot, b.def.pivot);
  if (a.def.animType === 1) {
    const [px, , pz] = a.def.pivot;
    return px >= b.box[0] - tol - 0.02 && px <= b.box[3] + tol + 0.02 && pz >= b.box[2] - tol - 0.02 && pz <= b.box[5] + tol + 0.02;
  }
  return true;
}

function maxEdgeDrift(rest: Float32Array, posed: Float32Array): number {
  let max = 0;
  for (let i = 0; i < rest.length; i += 9) {
    const r0 = Math.hypot(rest[i + 3] - rest[i], rest[i + 4] - rest[i + 1], rest[i + 5] - rest[i + 2]);
    const p0 = Math.hypot(posed[i + 3] - posed[i], posed[i + 4] - posed[i + 1], posed[i + 5] - posed[i + 2]);
    const d = Math.abs(p0 - r0);
    if (d > max) max = d;
  }
  return max;
}

/** Poses of every animated part plus the box swept by all of them. */
function buildSweeps(ctx: ValidationContext, anim: P[]): Map<number, Sweep> {
  const sweeps = new Map<number, Sweep>();
  for (const a of anim) {
    const ps = poses(a.def); const box = expandBox(a.box, 0);
    let maxDrift = 0;
    for (const pose of ps) {
      const b = trisBox(pose.tris);
      for (let k = 0; k < 3; k++) { box[k] = Math.min(box[k], b[k]); box[k + 3] = Math.max(box[k + 3], b[k + 3]); }
      maxDrift = Math.max(maxDrift, maxEdgeDrift(a.def.tris, pose.tris));
    }
    sweeps.set(a.def.index, { poses: ps, box });
    const flexible = a.def.tissue === 3 && (a.def.animType === 60 || a.def.animType === 69);
    const maxEdge = a.def.tris.reduce((m, _, i, t) => i % 9 === 0 ? Math.max(m, Math.hypot(t[i + 3] - t[i], t[i + 4] - t[i + 1], t[i + 5] - t[i + 2])) : m, 0);
    if (maxDrift > (flexible ? maxEdge * (a.def.insectSpecies === 2 && classifyInsectPart(a.def.name, a.def.animType, a.def.pivot).group === 6 ? 0.206 : 0.019) + 0.000001 : 0.0005)) ctx.add('error', 'ANIM_DISTORTION', `${a.label} distorts/resizes by ${fmt(maxDrift)} while animating (moving parts must be 100% rigid bodies).`, [a.def.index], at(a.box), 'Use pure rigid-body rotations and translations per part; never scale or blend per-vertex coordinates.');
    if (ctx.o.grounded && a.def.animType >= 2 && box[1] < -0.02) ctx.add('warn', 'ANIM_BELOW_GROUND', `${a.label} dips ${fmt(-box[1])} below the ground while animating.`, [a.def.index], at(a.box));
  }
  return sweeps;
}

/** Sweeps animated part `a` against part `b`: collisions with neighbours, deeper overlap into its mount. */
function sweepAgainst(ctx: ValidationContext, sweeps: Map<number, Sweep>, reported: Set<string>, a: P, b: number, isMount: boolean) {
  const { parts: P_, o, add } = ctx;
  const sw = sweeps.get(a.def.index)!;
  const other = P_[b];
  if (sameRig(a, other)) return;
  const otherSw = other.def.animType > 0 ? sweeps.get(b) : undefined;
  // Spinners, wheels, gait channels, and bobbers/recoilers with equal pivot.x share a single shader clock.
  const lock = !!otherSw && inSync(a, other) && sw.poses.length === otherSw.poses.length;
  const otherPosesFor = (k: number): (Pose | null)[] => (!otherSw ? [null] : lock ? [otherSw.poses[k]] : [null, ...otherSw.poses]);
  const restDepth = isMount ? Math.max(embed(a, other).depth, embed(other, a).depth) : 0;
  for (let pk = 0; pk < sw.poses.length; pk++) for (const op of otherPosesFor(pk)) {
    const pose = sw.poses[pk];
    const pa = prepare(a.def, pose.tris); pa.closed = a.closed;
    const po = op ? prepare(other.def, op.tris) : other; if (op) po.closed = other.closed;
    const r = relate(pa, po, o.clearance + 0.01);
    const k = `${a.def.index}:${b}`;
    if (isMount) {
      if (r.crossing) {
        const d = Math.max(embed(pa, po).depth, embed(po, pa).depth);
        if (d > restDepth + 0.025 && !reported.has(k)) { reported.add(k); add(a.def.animType >= 3 ? 'info' : 'warn', 'ANIM_DEEPENS_OVERLAP', `${a.label} pushes ${fmt(d - restDepth)} deeper into its mount ${other.label} at ${pose.label}.`, [a.def.index, b], r.at); }
      }
    } else if (r.dist <= o.clearance && !reported.has(k)) {
      reported.add(k);
      add('error', 'ANIM_COLLISION', `${a.label} ${r.crossing ? 'cuts through' : `comes within ${fmt(r.dist)} of`} ${po === other ? other.label : other.label + ' (also animated)'} at ${pose.label}.`, [a.def.index, b], r.at, 'Re-route the sweep: shorten the part, move its pivot, or lift/shift the neighbour by ≥ 1 cm.');
    }
  }
}

/** Does a bob / recoil / limb swing open a visible gap to its external mount? Reports the worst pose. */
function checkDetach(ctx: ValidationContext, sweeps: Map<number, Sweep>, a: P, sw: Sweep, mounts: number[]) {
  const { parts: P_, o, add } = ctx;
  const extMounts = mounts.filter((m) => !sameRig(a, P_[m]));
  if (!extMounts.length) return;
  let detached: { pose: string; d: number } | null = null;
  for (let pk = 0; pk < sw.poses.length; pk++) {
    const pose = sw.poses[pk];
    const pa = prepare(a.def, pose.tris);
    let dMin = Infinity;
    for (const m of extMounts) {
      const mSw = sweeps.get(m);
      const pm = mSw && inSync(a, P_[m]) && mSw.poses.length === sw.poses.length ? prepare(P_[m].def, mSw.poses[pk].tris) : P_[m];
      dMin = Math.min(dMin, relate(pa, pm, 0.2).dist);
    }
    if (dMin > o.contactTol && (!detached || dMin > detached.d)) detached = { pose: pose.label, d: dMin };
  }
  const isRecoil = a.def.animType === 3 || Math.floor(a.def.animType / 10) === 3;
  if (detached) add(detached.d > 0.03 && !isRecoil ? 'warn' : 'info', 'ANIM_DETACH', `${a.label} lifts ${fmt(detached.d)} off its mount at ${detached.pose}${detached.d > 0.03 ? ' and reads as detached' : ''}.`, [a.def.index, extMounts[0]], at(a.box), 'Intentional for hover glows; otherwise overlap it deeper into the mount so it stays attached through the whole motion.');
}

export const animationStage: CheckStage = (ctx) => {
  const { parts: P_, n: N, o, R } = ctx;
  const anim = P_.filter((p) => p.def.animType > 0);
  const sweeps = buildSweeps(ctx, anim);
  const reported = new Set<string>();
  for (const a of anim) {
    const sw = sweeps.get(a.def.index)!;
    const mounts: number[] = []; // valid mounts it rests against at rest: allowed to stay in contact
    for (let b = 0; b < N; b++) if (b !== a.def.index && R(a.def.index, b).dist <= o.contactTol && validMount(a, P_[b], o.contactTol)) mounts.push(b);
    for (let b = 0; b < N; b++) {
      if (b === a.def.index) continue;
      if (boxGap(sw.box, P_[b].box) > o.clearance + 0.02) continue;
      const isMount = mounts.includes(b);
      if (!isMount && R(a.def.index, b).dist > o.contactTol && R(a.def.index, b).dist <= o.clearance) continue;
      sweepAgainst(ctx, sweeps, reported, a, b, isMount);
    }
    if (mounts.length && a.def.animType >= 1) checkDetach(ctx, sweeps, a, sw, mounts);
  }
};
