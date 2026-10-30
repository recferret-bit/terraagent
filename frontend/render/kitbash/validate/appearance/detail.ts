// Surface-detail rules: role rules (solar panel, wheel, vent) and the generic "big faces carry features" check.
import { boxGap, pointInsideMesh } from '../math';
import { at, dirName, needFor, type AppearanceContext } from './context';
import type { Face, Stat } from './measure';

type RoleRule = (ctx: AppearanceContext, s: Stat) => void;

const faceAt = (s: Stat) => at(s.faces[0]?.c ?? [0, 0, 0]);

const solarRule: RoleRule = (ctx, s) => {
  const { S, o, add, flagged } = ctx;
  if (s.zone !== 'solarCell' || flagged.has(s.i)) return;
  // a panel = the solar cells within 3 cm of each other (cell gaps are 1 to 2 cm) and the frame they sit on
  const panel = new Set<Stat>([s]);
  for (const q of panel) for (const r of S) if (r.zone === 'solarCell' && !panel.has(r) && boxGap(q.p.box, r.p.box) <= 0.03) panel.add(r);
  const siblings = [...panel];
  const near = ctx.nearOf(s);
  const frame = near.filter((q) => q.zone !== 'solarCell' && /solar|frame|panel|wing/i.test(q.name)).sort((a, b) => b.area - a.area)[0] ?? near.filter((q) => q.zone !== 'solarCell').sort((a, b) => a.area - b.area)[0];
  const slab = siblings.find((q) => q.faceMax >= o.cellMaxFace);
  if (slab || siblings.length < o.minCells) {
    for (const q of siblings) flagged.add(q.i);
    if (frame) flagged.add(frame.i);
    add('warn', 'ROLE_DETAIL', `${s.p.label} ${slab ? `is one ${slab.faceMax.toFixed(2)} m² slab` : `has only ${siblings.length} cell part${siblings.length === 1 ? '' : 's'}`}: a solar panel needs a visible cell grid (≥ ${o.minCells} cells ≤ ${Math.sqrt(o.cellMaxFace).toFixed(2)} m wide, 1 to 2 cm gaps that show the dark backing, a bus bar) or it reads as a plain dark plate.`, [s.i, ...(frame ? [frame.i] : [])], faceAt(s), 'Use the `solarPanel()` greeble (frontend/render/kitbash/greebles/unitParts.ts) or build a cell grid yourself; add 2 ribs on the back of the frame.');
  }
};

const wheelRule: RoleRule = (ctx, s) => {
  const { add, flagged } = ctx;
  if (!(/wheel|tyre|tire/i.test(s.name) && !/hub|rim|bolt/i.test(s.name) && !flagged.has(s.i))) return;
  const feats = ctx.nearOf(s).filter((q) => q.area < s.area && q.zone !== s.zone);
  if (!feats.length) { flagged.add(s.i); add('warn', 'ROLE_DETAIL', `${s.p.label} is a bare cylinder: a wheel needs a rim or hub of another colour on its outer face, or it reads as a black puck.`, [s.i], faceAt(s), 'Add a hub/rim part (a smaller cylinder in hullSecondary/hullPrimary, standing ≥ 5 mm proud of the tyre).'); }
};

const ventRule: RoleRule = (ctx, s) => {
  const { add, flagged } = ctx;
  if (!(/vent|radiator|grille|louver/i.test(s.name) && !flagged.has(s.i))) return;
  const slats = ctx.nearOf(s).filter((q) => q.area < s.area);
  if (slats.length < 3) { flagged.add(s.i); add('warn', 'ROLE_DETAIL', `${s.p.label} has ${slats.length} slat part${slats.length === 1 ? '' : 's'}: a vent needs ≥ 3 louvres standing proud of its plate.`, [s.i], faceAt(s), 'Add 3+ thin slats (rbox(w,0.015,d,0.005,1)) across the opening.'); }
};

/** Role rules, applied in this order to each part: things that must look like what they are. */
const ROLE_RULES: RoleRule[] = [solarRule, wheelRule, ventRule];

export function checkRoleDetail(ctx: AppearanceContext) {
  for (const s of ctx.S) for (const rule of ROLE_RULES) rule(ctx, s);
}

/** The visible face of `s` with the biggest shortfall of mounted features, if any is short. */
function worstFlatFace(ctx: AppearanceContext, s: Stat): { f: Face; have: number; need: number } | null {
  const { o } = ctx;
  const near = ctx.nearOf(s);
  const cands: Face[] = s.faces.filter((f) => f.area >= o.flatFace && f.n[1] > -0.5);
  if (!cands.length && s.curved && s.area * 0.5 >= o.flatFace) cands.push({ n: [0, 0, 0], area: s.area * 0.5, c: [(s.p.box[0] + s.p.box[3]) / 2, (s.p.box[1] + s.p.box[4]) / 2, (s.p.box[2] + s.p.box[5]) / 2] });
  let worst: { f: Face; have: number; need: number } | null = null;
  for (const f of cands) {
    const need = needFor(f.area, o); if (!need) continue;
    const isCurvedFace = f.n[0] === 0 && f.n[1] === 0 && f.n[2] === 0;
    if (!isCurvedFace) {
      const pt: [number, number, number] = [f.c[0] + f.n[0] * 0.006, f.c[1] + f.n[1] * 0.006, f.c[2] + f.n[2] * 0.006];
      if (near.some((q) => q.p.closed && pointInsideMesh(pt[0], pt[1], pt[2], q.p.tris))) continue; // covered by a neighbour: not visible
    }
    const have = near.filter((q) => q.area < s.area && (isCurvedFace || ((q.p.box[0] + q.p.box[3]) / 2 - f.c[0]) * f.n[0] + ((q.p.box[1] + q.p.box[4]) / 2 - f.c[1]) * f.n[1] + ((q.p.box[2] + q.p.box[5]) / 2 - f.c[2]) * f.n[2] >= -0.02)).length;
    if (have < need && (!worst || f.area > worst.f.area)) worst = { f, have, need };
  }
  return worst;
}

/** Generic: every large visible face carries features. */
export function checkFlatSurfaces(ctx: AppearanceContext) {
  for (const s of ctx.S) {
    if (ctx.flagged.has(s.i) || s.tube || s.emissive || s.zone === 'glassVisor') continue;
    const worst = worstFlatFace(ctx, s);
    if (worst) {
      const { f, have, need } = worst; const isCurved = f.n[0] === 0 && f.n[1] === 0 && f.n[2] === 0;
      ctx.add('warn', 'FLAT_SURFACE', `${s.p.label} has a ${f.area.toFixed(2)} m² ${isCurved ? 'curved' : `${dirName(f.n)}-facing`} surface with ${have} feature${have === 1 ? '' : 's'} on it (needs ≥ ${need}): it reads as a blank plate.`, [s.i], at(f.c), 'Mount detail on that face: panel lines (thin proud plates), vents, bolts/hatches, a stripe or an emissive strip; each ≥ 5 mm proud and overlapping the face by ≥ 1 cm.');
    }
  }
}
