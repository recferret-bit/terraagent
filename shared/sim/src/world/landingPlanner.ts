import { dataRow } from '../data';
import { ENTITY_KIND } from '../ecs/columns';
import { getSpawnSlots, type SpawnSlot } from '../gen/spawnSlots';
import { starterHubSiteBlocked } from '../gen/starterSpace';
import { HEX_DIRS, hexDistance, hexIndex, inHex } from '../grid/hex';
import { DEPOSIT, TERRAIN } from '../grid/layers';
import { sectorIndex } from '../grid/sectors';
import type { CompiledDataLike } from '../kernel/config';
import type { SimState } from '../kernel/state';
import { defaultW01Data } from '../systems/hq';
import { colonyPresence, faunaPositions, getLandingHistory } from './presence';

/**
 * Landing planner (D-39): the one function that says where the next colony lands, and the one rule that a landing
 * position is never used twice. Both read the presence model (landing history + live entities), so the server seat
 * flow, the local host, dev tools and a future AI orchestrator all get the same answer for the same state.
 *
 * A site is free when it is on land inside the map, no other colony owns the tile or every starter Hub site around
 * it, and it keeps `hq.startingKit.minLandingSeparation` (hex distance) from every landing ever made (any colony,
 * alive or gone), every live pod, HQ and structure of another colony.
 */

export type LandingSource = 'explicit' | 'slot' | 'search';

export interface LandingSite {
  q: number;
  r: number;
  source: LandingSource;
  /** The spawn slot this site is (when it is one). */
  slot?: SpawnSlot;
}

export type LandingBlock = 'already_landed' | 'landing_site_taken' | 'invalid_args';

/** Minimum hex distance between two landings (`hq.startingKit.minLandingSeparation`, default 6). */
export function minLandingSeparation(data?: CompiledDataLike): number {
  const src = data?.tables.hq ? data : defaultW01Data();
  const kit = dataRow(src, 'hq', 'startingKit');
  const v = Number(kit.minLandingSeparation);
  return Number.isFinite(v) && v >= 0 ? v : 6;
}

/** Points a new landing must keep its distance from (for `colony`): history + other colonies' live presence. */
function blockers(s: SimState, colony: number, relocate = false): Array<{ q: number; r: number }> {
  const hist = getLandingHistory(s);
  // A relocating colony's own latest landing is the one that moves; every earlier landing still blocks.
  const own = relocate ? hist.map((h, i) => (h.colony === colony ? i : -1)).filter((i) => i >= 0).pop() : undefined;
  const out: Array<{ q: number; r: number }> = hist.filter((_, i) => i !== own).map((h) => ({ q: h.q, r: h.r }));
  for (const p of colonyPresence(s)) {
    if (p.colony === colony) continue;
    for (const e of [...p.pods, ...p.structures, ...(p.hq ? [p.hq] : [])]) out.push({ q: e.q, r: e.r });
  }
  for (const f of faunaPositions(s)) {
    if (
      f.kind === ENTITY_KIND.hiveBlackAnt ||
      f.kind === ENTITY_KIND.hiveBlueBeetle ||
      f.kind === ENTITY_KIND.hiveGreenSpitter
    ) {
      out.push({ q: f.q, r: f.r });
    }
  }
  return out;
}

const isWater = (t: number) => t === TERRAIN.shallow || t === TERRAIN.deep;

/** Why (q, r) cannot take `colony`'s landing, or null when it can. The "never twice" rule lives here. */
export function landingBlock(
  s: SimState,
  colony: number,
  q: number,
  r: number,
  data?: CompiledDataLike,
  opts: { relocate?: boolean } = {},
): LandingBlock | null {
  // `relocate`: the colony's own pod is still descending and moves (dev.land): its own landing does not count.
  if (!opts.relocate && getLandingHistory(s).some((h) => h.colony === colony)) return 'already_landed';
  if (!Number.isInteger(q) || !Number.isInteger(r) || !inHex(q, r, s.grid.radius)) return 'invalid_args';
  const i = hexIndex(s.grid.radius).indexOf(q, r);
  if (isWater(s.grid.layers.terrain[i])) return 'landing_site_taken';
  const owner = s.grid.layers.owner[i];
  if (owner >= 0 && owner !== colony) return 'landing_site_taken';
  const slot = getSpawnSlots(s).find((sl) => sl.q === q && sl.r === r);
  if (slot && slot.claimedBy !== undefined && slot.claimedBy !== colony) return 'landing_site_taken';
  const sep = minLandingSeparation(data);
  if (blockers(s, colony, opts.relocate).some((b) => hexDistance(b.q, b.r, q, r) < sep)) return 'landing_site_taken';
  // The starter Hub site must not take another colony's territory (WE-23).
  if (starterHubSiteBlocked(s, q, r, colony)) return 'landing_site_taken';
  return null;
}

/** Search beyond the spawn slots: one candidate per sector, scored by distance to everything already on the planet. */
function searchSite(s: SimState, colony: number, data?: CompiledDataLike): LandingSite | null {
  const hex = hexIndex(s.grid.radius), sectors = sectorIndex(s.grid.radius);
  const { terrain, height, deposit } = s.grid.layers;
  const bs = blockers(s, colony);
  const sep = minLandingSeparation(data);
  // Candidates: the planet centre, then each sector's centre-most tile (kept 6 tiles inside the rim for the zone).
  const cands: number[] = [hex.indexOf(0, 0)];
  for (const sec of sectors.sectors) {
    const cq = sec.sq * sectors.size + (sectors.size >> 1), cr = sec.sr * sectors.size + (sectors.size >> 1);
    let pick = -1, pd = Infinity;
    for (const t of sec.tiles) {
      const d = hexDistance(cq, cr, hex.q[t], hex.r[t]);
      if (d < pd) { pd = d; pick = t; }
    }
    cands.push(pick);
  }
  let best: { q: number; r: number; score: number } | null = null;
  for (const pick of cands) {
    const q = hex.q[pick], r = hex.r[pick];
    if (hexDistance(0, 0, q, r) > Math.max(0, s.grid.radius - 6)) continue;
    if (landingBlock(s, colony, q, r, data)) continue;
    if ((terrain[pick] !== TERRAIN.flat && terrain[pick] !== TERRAIN.slope) || deposit[pick] !== DEPOSIT.none) continue;
    let rough = 0;
    for (const [dq, dr] of HEX_DIRS) {
      const j = hex.indexOf(q + dq, r + dr);
      if (j >= 0) rough = Math.max(rough, Math.abs(height[j] - height[pick]));
    }
    const nearest = bs.reduce((m, b) => Math.min(m, hexDistance(b.q, b.r, q, r)), sep * 4);
    // Spread colonies out (far from everything, capped), prefer level ground, then the planet centre.
    const flatBonus = terrain[pick] === TERRAIN.flat ? 2 : 0;
    const score = nearest * 10 + flatBonus - rough * 8 - hexDistance(0, 0, q, r) * 0.1;
    if (!best || score > best.score) best = { q, r, score };
  }
  return best ? { q: best.q, r: best.r, source: 'search' } : null;
}

/**
 * Where `colony` lands next. Explicit `(q, r)` is checked against the rules; otherwise its preferred spawn slot
 * (`slotIndex ?? colony`) if free, else the first free slot, else (no slots, or `beyondSlots`) the best free site
 * anywhere on the planet.
 * Pure: the same state gives the same answer; `null` + reason when the colony cannot land.
 */
export function nextLandingSite(
  s: SimState,
  colony: number,
  opts: { slotIndex?: number; q?: number; r?: number; data?: CompiledDataLike; beyondSlots?: boolean } = {},
): { ok: true; site: LandingSite } | { ok: false; code: LandingBlock } {
  if (getLandingHistory(s).some((h) => h.colony === colony)) return { ok: false, code: 'already_landed' };
  const slots = getSpawnSlots(s);
  if (opts.q !== undefined || opts.r !== undefined) {
    const q = opts.q as number, r = opts.r as number;
    const why = landingBlock(s, colony, q, r, opts.data);
    if (why) return { ok: false, code: why };
    const slot = slots.find((sl) => sl.q === q && sl.r === r);
    return { ok: true, site: { q, r, source: 'explicit', ...(slot ? { slot } : {}) } };
  }
  const preferred = slots[opts.slotIndex ?? colony];
  const order = preferred ? [preferred, ...slots.filter((sl) => sl !== preferred)] : slots;
  for (const slot of order) {
    if (!landingBlock(s, colony, slot.q, slot.r, opts.data)) return { ok: true, site: { q: slot.q, r: slot.r, source: 'slot', slot } };
  }
  // A planet with spawn slots seats exactly its slots (capacity, D-12) unless the caller asks to search beyond them
  // (`beyondSlots`, e.g. an AI orchestrator or a re-establish flow); a planet without slots always searches.
  if (slots.length > 0 && !opts.beyondSlots) return { ok: false, code: 'landing_site_taken' };
  const found = searchSite(s, colony, opts.data);
  return found ? { ok: true, site: found } : { ok: false, code: 'landing_site_taken' };
}
