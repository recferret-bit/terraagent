import { describe, expect, it } from 'vitest';
import {
  colonyPresence,
  createPlanet,
  entitiesNear,
  faunaPositions,
  getLandingHistory,
  getSpawnSlots,
  hexDistance,
  hexIndex,
  insertRow,
  landingBlock,
  minLandingSeparation,
  nearestEntity,
  nextLandingSite,
  presenceView,
  recordLanding,
  registerPresenceRole,
  restore,
  snapshot,
  spawnHqUnit,
  TERRAIN,
  type PlanetState,
} from '../../src';

const FAKE_FAUNA = 200; // a kind id no system uses: stands in for the first fauna archetype

function planet(type: 'desert' | 'temperate' = 'desert'): PlanetState {
  return createPlanet({ id: 'p', seed: `presence-${type}`, type: 'temperate', planetType: type, radius: 56 });
}

function addFauna(s: PlanetState, q: number, r: number): number {
  const id = s.meta.nextEntityId++;
  const row = insertRow(s.entities, id, 0);
  const c = s.entities.cols;
  c.kind[row] = FAKE_FAUNA; c.owner[row] = -1; c.q[row] = q; c.r[row] = r; c.x[row] = q; c.y[row] = r; c.hp[row] = 50; c.hpMax[row] = 50;
  return id;
}

describe('planet presence (D-39)', () => {
  registerPresenceRole(FAKE_FAUNA, 'fauna');

  it('knows every colony entity and every fauna position; spatial queries are nearest-first', () => {
    const s = planet();
    const hq = spawnHqUnit(s, { owner: 0, q: 3, r: 0 });
    const f1 = addFauna(s, 5, 0);
    const f2 = addFauna(s, -10, 4);
    expect(faunaPositions(s).map((e) => e.id).sort()).toEqual([f1, f2].sort());
    expect(colonyPresence(s)[0].hq?.id).toBe(hq);
    expect(entitiesNear(s, 4, 0, 3).map((e) => e.id)).toEqual([hq, f1].sort((a, b) => a - b));
    expect(nearestEntity(s, -9, 4, (e) => e.role === 'fauna')?.id).toBe(f2);
    expect(entitiesNear(s, 40, 0, 2)).toEqual([]);
  });

  it('the spatial index follows entity moves (rebuilt when the store changes)', () => {
    const s = planet();
    const id = addFauna(s, 0, 0);
    expect(entitiesNear(s, 0, 0, 1).map((e) => e.id)).toEqual([id]);
    const row = s.entities.count - 1;
    s.entities.cols.q[row] = 20; s.entities.cols.changedAt[row] = 5;
    expect(entitiesNear(s, 0, 0, 1)).toEqual([]);
    expect(entitiesNear(s, 20, 0, 1).map((e) => e.id)).toEqual([id]);
  });

  it('presenceView is plain data and survives snapshot/restore (landing history is state)', () => {
    const s = planet();
    recordLanding(s, { colony: 0, q: 1, r: 2, tick: 3 }, 3);
    const v = presenceView(restore(snapshot(s)));
    expect(JSON.parse(JSON.stringify(v))).toEqual(v);
    expect(v.landings).toEqual([{ colony: 0, q: 1, r: 2, tick: 3 }]);
  });
});

describe('landing planner: next landing site, never the same position twice (D-39)', () => {
  it('takes the preferred spawn slot, then the next free one, deterministically', () => {
    const s = planet();
    const slots = getSpawnSlots(s);
    const a = nextLandingSite(s, 0);
    const b = nextLandingSite(planet(), 0);
    expect(a).toEqual(b);
    expect(a.ok && a.site).toMatchObject({ q: slots[0].q, r: slots[0].r, source: 'slot' });
    expect(nextLandingSite(s, 2).ok && (nextLandingSite(s, 2) as { site: { q: number } }).site.q).toBe(slots[2].q);
  });

  it('rejects a site within minLandingSeparation of any landing ever made, also after that colony is gone', () => {
    const s = planet();
    const sep = minLandingSeparation();
    const slot = getSpawnSlots(s)[1];
    recordLanding(s, { colony: 1, q: slot.q, r: slot.r, tick: 1 }, 1);
    s.colonies[1] = { index: 1, id: 'col_1', name: 'gone', color: 1, status: 'eliminated', changedAt: 1 };
    expect(landingBlock(s, 4, slot.q, slot.r)).toBe('landing_site_taken'); // same position: never twice
    expect(landingBlock(s, 4, slot.q + sep - 1, slot.r)).toBe('landing_site_taken');
    const res = nextLandingSite(s, 4, { slotIndex: 1 });
    expect(res.ok).toBe(true);
    if (res.ok) expect(hexDistance(res.site.q, res.site.r, slot.q, slot.r)).toBeGreaterThanOrEqual(sep);
    expect(nextLandingSite(s, 1)).toEqual({ ok: false, code: 'already_landed' });
  });

  it('when every slot is used it searches the planet for a free, level site far from everyone', () => {
    const s = planet();
    const sep = minLandingSeparation();
    for (const [i, slot] of getSpawnSlots(s).entries()) recordLanding(s, { colony: i, q: slot.q, r: slot.r, tick: i }, i);
    expect(nextLandingSite(s, 9)).toEqual({ ok: false, code: 'landing_site_taken' }); // capacity: slots only
    const res = nextLandingSite(s, 9, { beyondSlots: true });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.site.source).toBe('search');
    for (const h of getLandingHistory(s)) expect(hexDistance(h.q, h.r, res.site.q, res.site.r)).toBeGreaterThanOrEqual(sep);
    expect(landingBlock(s, 9, res.site.q, res.site.r)).toBeNull();
  });

  it('a hundred colonies landing one after another never share or crowd a position', () => {
    const s = planet('temperate');
    const sep = minLandingSeparation();
    const landed: Array<{ q: number; r: number }> = [];
    for (let c = 0; c < 100; c++) {
      const res = nextLandingSite(s, c, { beyondSlots: true });
      if (!res.ok) { expect(res.code).toBe('landing_site_taken'); break; } // the planet is full
      for (const p of landed) expect(hexDistance(p.q, p.r, res.site.q, res.site.r)).toBeGreaterThanOrEqual(sep);
      landed.push(res.site);
      recordLanding(s, { colony: c, q: res.site.q, r: res.site.r, tick: c }, c);
    }
    expect(landed.length).toBeGreaterThan(5); // more than the spawn slots
  });

  it('explicit coordinates obey the same rules (off map, water, foreign land)', () => {
    const s = planet('temperate');
    const hx = hexIndex(s.grid.radius);
    expect(nextLandingSite(s, 0, { q: 999, r: 0 })).toEqual({ ok: false, code: 'invalid_args' });
    const water = Array.from(s.grid.layers.terrain).findIndex((t) => t === TERRAIN.deep);
    expect(water).toBeGreaterThanOrEqual(0);
    expect(nextLandingSite(s, 0, { q: hx.q[water], r: hx.r[water] })).toEqual({ ok: false, code: 'landing_site_taken' });
    const land = Array.from(s.grid.layers.terrain).findIndex((t) => t === TERRAIN.flat);
    s.grid.layers.owner[land] = 3;
    expect(nextLandingSite(s, 0, { q: hx.q[land], r: hx.r[land] })).toEqual({ ok: false, code: 'landing_site_taken' });
  });
});
