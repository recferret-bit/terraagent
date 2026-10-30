// Colour rules: inset plates must contrast with their base, functional groups must not share one colour, and a part's zone must fit its name.
import { at, type AppearanceContext } from './context';
import { BIOMES, deltaE, type Role } from './color';
import type { Stat } from './measure';

export interface RoleSummary { role: Role; area: number; share: number; lightness: number; zone: string }
interface Group { area: number; lab: [number, number, number]; zones: Map<string, number>; shown: [number, number, number][] }

const faceAt = (s: Stat) => at(s.faces[0]?.c ?? [0, 0, 0]);
const topZone = (g: Group) => [...g.zones].sort((x, y) => y[1] - x[1])[0][0];

/** Inset plates must contrast with what they sit on. */
export function checkInsetContrast(ctx: AppearanceContext) {
  const { S, o, add } = ctx;
  const lab = (x: Stat) => x.lab;
  for (const s of S) {
    if (!s.plate || s.faceMax < o.insetMin || s.emissive) continue;
    const bigger = ctx.nearOf(s).filter((q) => q.area >= s.area && !q.tube);
    if (!bigger.length) continue;
    const best = Math.max(...bigger.map((q) => deltaE(lab(s), lab(q))));
    if (best < o.insetContrast) {
      const q = bigger.sort((a, b) => deltaE(lab(s), lab(b)) - deltaE(lab(s), lab(a)))[0];
      add('warn', 'LOW_CONTRAST_INSET', `${s.p.label} is a ${s.faceMax.toFixed(2)} m² plate on ${q.p.label} with almost the same colour (ΔE ${best.toFixed(0)} < ${o.insetContrast}): it disappears into it.`, [s.i, q.i], faceAt(s), 'Give it a zone that differs in lightness or hue (hullSecondary, solarCell, glassVisor, hullPrimary vs frameGunmetal), or drop the plate.');
    }
  }
}

const VARIANTS = ['raw', ...BIOMES];

/** Area-weighted mean colour (raw zone colour and per biome) and zone mix of every functional role. */
function groupByRole(ctx: AppearanceContext): Map<Role, Group> {
  const groups = new Map<Role, Group>();
  for (const s of ctx.S) {
    const g = groups.get(s.role) ?? { area: 0, lab: [0, 0, 0] as [number, number, number], zones: new Map<string, number>(), shown: VARIANTS.map(() => [0, 0, 0] as [number, number, number]) };
    g.area += s.area; for (let k = 0; k < 3; k++) { g.lab[k] += s.lab[k] * s.area; VARIANTS.forEach((_, v) => { g.shown[v][k] += s.shown[v][k] * s.area; }); }
    g.zones.set(s.zone, (g.zones.get(s.zone) ?? 0) + s.area); groups.set(s.role, g);
  }
  return groups;
}

const worstOf = (x: number[][], y: number[][]) => { let w = { de: Infinity, v: 0 }; x.forEach((l, v) => { const de = deltaE(l, y[v]); if (de < w.de) w = { de, v }; }); return w; };

/** Reports one pair of main groups that read alike, by group mean and by the worst pair of touching parts. */
function checkGroupPair(ctx: AppearanceContext, groups: Map<Role, Group>, ra: Role, rb: Role) {
  const { S, o, add, total } = ctx;
  const A = groups.get(ra), B = groups.get(rb);
  if (!A || !B || A.area / total < o.groupShare || B.area / total < o.groupShare) return;
  const za = topZone(A), zb = topZone(B);
  const mean = { de: deltaE(A.shown[0], B.shown[0]), v: 0 }; // group means: raw zone colours (dust is judged on touching parts below)
  // touching parts of the two groups, each at least 2.5 % of the surface
  let pair: { de: number; v: number; s: Stat; q: Stat } | null = null;
  for (const s of S) if (s.role === ra && s.area / total >= o.groupShare * 0.6) for (const q of ctx.nearOf(s)) if (q.role === rb && q.area / total >= o.groupShare * 0.6) {
    const w = worstOf(s.shown, q.shown); if (!pair || w.de < pair.de) pair = { ...w, s, q };
  }
  const lowMean = mean.de < o.groupContrast, lowPair = !!pair && pair.de < o.groupContrast;
  if (!lowMean && !lowPair) return;
  const pa = pair?.s ?? S.filter((s) => s.role === ra).sort((x, y) => y.area - x.area)[0], pb = pair?.q ?? S.filter((s) => s.role === rb).sort((x, y) => y.area - x.area)[0];
  const why = lowPair && (!lowMean || pair!.de <= mean.de)
    ? `${pa.p.label} touches ${pb.p.label} and the two look alike${pair!.v ? ` on ${VARIANTS[pair!.v]} (dust blends the low parts to one tint)` : ''} (ΔE ${pair!.de.toFixed(0)} < ${o.groupContrast})`
    : `the ${ra} (${Math.round((A.area / total) * 100)} % of the surface, mostly ${za}) and the ${rb} (${Math.round((B.area / total) * 100)} %, mostly ${zb}) read as one colour${mean.v ? ` on ${VARIANTS[mean.v]}` : ''} (ΔE ${mean.de.toFixed(0)} < ${o.groupContrast})`;
  add('warn', 'GROUP_SAME_COLOR', `${why[0].toUpperCase()}${why.slice(1)}: the player cannot tell the parts of the machine apart.`, [pa.i, pb.i], faceAt(pa), 'Separate them in LIGHTNESS (dark vs light/orange), not just hue: two dark zones both turn the same sand colour near the ground. E.g. rubberDark tyres + hullPrimary rims, an orange chassis, hullPrimary body, hullSecondary arm.');
}

/** Functional groups must not share one colour (wheels vs platform vs manipulator), judged as the player sees them: raw zone
 *  colour, and for touching parts also dust-blended on each biome (two dark zones both turn the same sand colour low on a dune). Two tests
 *  per pair of groups: the area-weighted mean zone colour of the groups, and the worst pair of touching parts across the two groups. */
export function checkGroupContrast(ctx: AppearanceContext): RoleSummary[] {
  const groups = groupByRole(ctx);
  const roles: RoleSummary[] = [];
  for (const [role, g] of groups) {
    for (let k = 0; k < 3; k++) { g.lab[k] /= g.area || 1; g.shown.forEach((v) => { v[k] /= g.area || 1; }); }
    roles.push({ role, area: g.area, share: g.area / ctx.total, lightness: g.lab[0], zone: topZone(g) });
  }
  const main: Role[] = ['locomotion', 'platform', 'manipulator'];
  for (let a = 0; a < main.length; a++) for (let b = a + 1; b < main.length; b++) checkGroupPair(ctx, groups, main[a], main[b]);
  return roles;
}

/** A part's zone must fit its name. */
export function checkZoneFitsName(ctx: AppearanceContext) {
  const { S, add } = ctx;
  for (const s of S) {
    const n = s.name;
    if (/light|\bled\b|beacon|lamp|glow|laser|plasma|flare/i.test(n) && !/housing|mount|bracket|frame/i.test(n)) { if (s.emissive === false || s.p.def.emissive < 3) add('warn', 'ROLE_ZONE', `${s.p.label} is named like a light but is not an emissive zone with intensity ≥ 3 (it will not glow or bloom).`, [s.i], undefined, 'Use energyCyan / warningAmber / dangerCrimson / terraformEmerald with emissiveIntensity ≥ 3.'); }
    else if (/solar|photovolt/i.test(n) && !/frame|rib|bracket|mount|strut|bar|support|arm|joint|hinge|post|boom/i.test(n) && s.zone !== 'solarCell') add('warn', 'ROLE_ZONE', `${s.p.label} is named like a solar cell but uses zone ${s.zone}: use solarCell.`, [s.i]);
    else if (/visor|glass|window|canopy|cockpit|windshield/i.test(n) && !/frame|rim|bracket|mount|light|wiper/i.test(n) && s.zone !== 'glassVisor' && !s.emissive) add('warn', 'ROLE_ZONE', `${s.p.label} is named like glass but uses zone ${s.zone}: use glassVisor.`, [s.i]);
  }
}
