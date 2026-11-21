// Night lights: an emissive bulb must bite a structural part, and a copied corner stamp is not a design.
import { embed } from '../relation';
import { at, fmt, type CheckStage } from '../context';
import type { P } from '../types';

const EMISSIVE = new Set(['energyCyan', 'warningAmber', 'dangerCrimson', 'terraformEmerald']);
const LIGHT_NAME = /light|lamp|beacon|bulb/i;
/** Mesh overlap (embed depth, either way) that counts as a socket seating the bulb. */
const MIN_OVERLAP = 0.01;
const SEAT_FIX = 'Seat the bulb in a gunmetal socket/bezel that overlaps both the bulb and the mast, column, housing, or door it belongs to.';
const STAMP_FIX = 'This shared four-corner stamp is not a light design; delete it and add only the fixtures this building actually needs.';

const isEmissive = (p: P) => EMISSIVE.has(p.def.zone);
/** Whip antennas are exempt: a free end is the point, not a missing socket. */
const isBulb = (p: P) => p.def.role !== 'whip' && isEmissive(p) && LIGHT_NAME.test(p.def.name);
const isMount = (p: P) => !isEmissive(p) && !LIGHT_NAME.test(p.def.name);

/** Deepest sample of one closed mesh inside the other. A ring or strip that cuts its frame reports that bite here. */
function overlapDepth(a: P, b: P): number {
  return Math.max(embed(a, b).depth, embed(b, a).depth);
}

export const lightStage: CheckStage = (ctx) => {
  const { parts, add, model, R } = ctx;
  for (let i = 0; i < parts.length; i++) {
    const bulb = parts[i];
    if (!isBulb(bulb)) continue;
    let held = false;
    for (let j = 0; j < parts.length && !held; j++) {
      if (i === j || !isMount(parts[j])) continue;
      // relate() already ran: Infinity means the boxes are farther than nearMiss, so they cannot overlap.
      const rel = R(i, j);
      if (!rel.crossing && rel.dist === Infinity) continue;
      if (overlapDepth(bulb, parts[j]) >= MIN_OVERLAP) held = true;
    }
    if (!held) add('error', 'LIGHT_UNMOUNTED', `${bulb.label} does not overlap a non-emissive structural part by ≥ ${fmt(MIN_OVERLAP)}. Open space, or a glow that only meets another emissive part, is not a mount.`, [bulb.def.index], at(bulb.box), SEAT_FIX);
  }
  if (!model.id.startsWith('building.')) return;
  const stamps = parts.filter((p) => p.def.name === 'plinth corner light');
  if (stamps.length >= 4) add('error', 'LIGHT_CORNER_STAMP', `${stamps.length} parts are named "plinth corner light".`, stamps.map((p) => p.def.index), at(stamps[0].box), STAMP_FIX);
};
