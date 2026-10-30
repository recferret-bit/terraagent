// Stage 4: animated parts. Sweep every pose of the shader's motion against everything else.
import { boxGap, expandBox, trisBox } from '../math';
import type { Box } from '../math';
import { embed, prepare, relate } from '../relation';
import { poses, type Pose } from '../poses';
import { at, fmt, type CheckStage, type ValidationContext } from '../context';
import type { P } from '../types';

interface Sweep { poses: Pose[]; box: Box }

/** Poses of every animated part plus the box swept by all of them. */
function buildSweeps(ctx: ValidationContext, anim: P[]): Map<number, Sweep> {
  const sweeps = new Map<number, Sweep>();
  for (const a of anim) {
    const ps = poses(a.def); const box = expandBox(a.box, 0);
    for (const pose of ps) { const b = trisBox(pose.tris); for (let k = 0; k < 3; k++) { box[k] = Math.min(box[k], b[k]); box[k + 3] = Math.max(box[k + 3], b[k + 3]); } }
    sweeps.set(a.def.index, { poses: ps, box });
    if (a.def.animType === 2 && box[1] < -0.02) ctx.add('warn', 'ANIM_BELOW_GROUND', `${a.label} dips ${fmt(-box[1])} below the ground while bobbing.`, [a.def.index], at(a.box));
  }
  return sweeps;
}

/** Sweeps animated part `a` against part `b`: collisions with neighbours, deeper overlap into its mount. */
function sweepAgainst(ctx: ValidationContext, sweeps: Map<number, Sweep>, reported: Set<string>, a: P, b: number, isMount: boolean) {
  const { parts: P_, o, add, R } = ctx;
  const sw = sweeps.get(a.def.index)!;
  const other = P_[b];
  const otherSw = other.def.animType > 0 ? sweeps.get(b) : undefined;
  // The shader gives every spinner the same angle, and bobbers/recoilers with the same pivot.x the same phase: those move in lockstep.
  const lock = !!otherSw && other.def.animType === a.def.animType && (a.def.animType === 1 || Math.abs(other.def.pivot[0] - a.def.pivot[0]) < 1e-4);
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
        if (d > restDepth + 0.025 && !reported.has(k)) { reported.add(k); add(a.def.animType === 3 ? 'info' : 'warn', 'ANIM_DEEPENS_OVERLAP', `${a.label} pushes ${fmt(d - restDepth)} deeper into its mount ${other.label} at ${pose.label}.`, [a.def.index, b], r.at); }
      }
    } else if (r.dist <= o.clearance && !reported.has(k)) {
      reported.add(k);
      add('error', 'ANIM_COLLISION', `${a.label} ${r.crossing ? 'cuts through' : `comes within ${fmt(r.dist)} of`} ${po === other ? other.label : other.label + ' (also animated)'} at ${pose.label}.`, [a.def.index, b], r.at, 'Re-route the sweep: shorten the part, move its pivot, or lift/shift the neighbour by ≥ 1 cm.');
    }
  }
}

/** Does a bob / recoil open a visible gap to the mount? Reports the worst pose. */
function checkDetach(ctx: ValidationContext, a: P, sw: Sweep, mounts: number[]) {
  const { parts: P_, o, add } = ctx;
  let detached: { pose: string; d: number } | null = null;
  for (const pose of sw.poses) {
    const pa = prepare(a.def, pose.tris);
    let dMin = Infinity;
    for (const m of mounts) dMin = Math.min(dMin, relate(pa, P_[m], 0.2).dist);
    if (dMin > o.contactTol && (!detached || dMin > detached.d)) detached = { pose: pose.label, d: dMin };
  }
  if (detached) add(detached.d > 0.03 && a.def.animType === 2 ? 'warn' : 'info', 'ANIM_DETACH', `${a.label} lifts ${fmt(detached.d)} off its mount at ${detached.pose}${detached.d > 0.03 ? ' and reads as detached' : ''}.`, [a.def.index, mounts[0]], at(a.box), 'Intentional for hover glows; otherwise overlap it deeper into the mount so it stays attached through the whole motion.');
}

export const animationStage: CheckStage = (ctx) => {
  const { parts: P_, n: N, o, R } = ctx;
  const anim = P_.filter((p) => p.def.animType > 0);
  const sweeps = buildSweeps(ctx, anim);
  const reported = new Set<string>();
  for (const a of anim) {
    const sw = sweeps.get(a.def.index)!;
    const mounts: number[] = []; // parts it rests against at rest: its mount, allowed to stay in contact
    for (let b = 0; b < N; b++) if (b !== a.def.index && R(a.def.index, b).dist <= o.contactTol) mounts.push(b);
    for (let b = 0; b < N; b++) {
      if (b === a.def.index) continue;
      if (boxGap(sw.box, P_[b].box) > o.clearance + 0.02) continue;
      const isMount = mounts.includes(b);
      if (!isMount && R(a.def.index, b).dist <= o.clearance) continue; // already too tight at rest: a static problem, reported above
      sweepAgainst(ctx, sweeps, reported, a, b, isMount);
    }
    if (mounts.length && a.def.animType >= 2) checkDetach(ctx, a, sw, mounts);
  }
};
