// Stage 2: floating parts. Everything must be reachable from the ground through touching parts.
import { at, fmt, type CheckStage } from '../context';

export const floatingStage: CheckStage = (ctx) => {
  const { parts: P_, n: N, o, add, R, minY } = ctx;
  let roots = o.grounded ? P_.filter((p) => p.box[1] <= minY + o.groundTol).map((p) => p.def.index) : [];
  if (!roots.length) roots = [P_.reduce((m, p) => ((p.box[3] - p.box[0]) * (p.box[4] - p.box[1]) * (p.box[5] - p.box[2]) > (m.box[3] - m.box[0]) * (m.box[4] - m.box[1]) * (m.box[5] - m.box[2]) ? p : m)).def.index];
  const reach = new Set<number>(roots), queue = [...roots];
  while (queue.length) {
    const a = queue.pop()!;
    // A cable can be held by the body but cannot hold anything up: it draped over a part is not a mount for it.
    for (let b = 0; b < N; b++) if (!reach.has(b) && R(a, b).dist <= o.contactTol) { reach.add(b); if (P_[b].def.kind !== 'TubeGeometry') queue.push(b); }
  }
  const lost = P_.filter((p) => !reach.has(p.def.index)).map((p) => p.def.index);
  // group loose parts into touching islands, then report the minimal set of MISSING LINKS: repeatedly take the island nearest to the
  // supported body, report its one gap, and treat it as attached for the next round (so a dish on a mast on a cabin gives two
  // short, fixable gaps instead of one confusing blob).
  const islands: number[][] = []; const seen = new Set<number>();
  for (const s0 of lost) {
    if (seen.has(s0)) continue;
    const island = [s0]; seen.add(s0);
    for (let k = 0; k < island.length; k++) for (const b of lost) if (!seen.has(b) && R(island[k], b).dist <= o.contactTol) { seen.add(b); island.push(b); }
    islands.push(island);
  }
  const supported = new Set<number>([...reach].filter((b) => P_[b].def.kind !== 'TubeGeometry'));
  const pending = islands.slice();
  while (pending.length) {
    let best = Infinity, bk = 0, bi = -1, bj = -1;
    pending.forEach((island, k) => { for (const a of island) for (const b of supported) { const d = R(a, b).dist; if (d < best) { best = d; bk = k; bi = a; bj = b; } } });
    const island = pending.splice(bk, 1)[0];
    const head = bi >= 0 ? bi : island.slice().sort((a, b) => P_[b].n - P_[a].n)[0];
    const names = island.length > 1 ? ` (together with ${island.length - 1} part${island.length > 2 ? 's' : ''} attached to it)` : '';
    if (best <= o.nearMiss) add('error', 'HAIRLINE_GAP', `${P_[head].label}${names} stops ${fmt(best)} short of ${P_[bj].label}. It reads as attached but does not touch.`, island.includes(head) ? [head, ...island.filter((x) => x !== head)] : island, at(P_[head].box), `Extend it ≥ ${fmt(o.contactTol * 3)} into the neighbour (a ≥1 cm overlap hides inside the hull) or add a strut/joint between them.`);
    else add('error', 'FLOATING_PART', `${P_[head].label}${names} is not connected to the body: ${best === Infinity ? 'nothing is nearby' : `nearest part is ${P_[bj].label}, ${fmt(best)} away`}.`, island, at(P_[head].box), 'Mount it on a strut, bracket or the hull, or move it so it overlaps its support.');
    for (const a of island) if (P_[a].def.kind !== 'TubeGeometry') supported.add(a);
  }
};
