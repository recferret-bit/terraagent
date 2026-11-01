import { describe, expect, it } from 'vitest';
import { parseWaves } from '@terra/contracts';
import {
  ENTITY_KIND,
  SimHost,
  checkColonyLanding,
  createPlanet,
  getColonyStock,
  getLandingPods,
  getSpawnSlots,
  hexDistance,
  resolveMinLandingSeparation,
  resolveStartingCargo,
  rowOf,
  setBlob,
  spawnColonyLanding,
  type PlanetState,
  type SimCommand,
  type SpawnColonyLandingResult,
} from '../../src';
import { fullStock } from '../economy/helpers';

const CARGO = fullStock(resolveStartingCargo());
const SEP = resolveMinLandingSeparation();

let seq = 0;
const mk = (kind: string, args: unknown, colonyIndex: number | null): SimCommand => ({
  colonyIndex,
  source: 'dev',
  commandId: `lr_${++seq}`,
  kind,
  args,
});

/** Temperate radius 28 has 5 spawn slots, ≥ 26 hexes apart; flat planets have none (fallback lands at 0,0). */
function host(type: 'temperate' | 'flat' = 'temperate', radius = 28): SimHost {
  const h = new SimHost({ flags: parseWaves('..01') });
  h.load(createPlanet({ type, seed: 'landing-rules', radius }));
  return h;
}

/** Submits one command, steps, and returns its reject code plus the step's postings. */
function run(h: SimHost, kind: string, args: unknown, colonyIndex: number | null = null): { code?: string; reasons: string[] } {
  const c = mk(kind, args, colonyIndex);
  h.submit(c);
  const res = h.step(1);
  return { code: res.outcomes.find((o) => o.commandId === c.commandId)?.code, reasons: res.postings.map((p) => p.reason) };
}

function landed(res: SpawnColonyLandingResult): { podEntityId: number; q: number; r: number } {
  if (!res.ok) throw new Error(`expected a landing, got ${res.code}`);
  return res;
}

function claimSlots(state: PlanetState, by: number, indices: number[]): void {
  const slots = getSpawnSlots(state).map((s) => (indices.includes(s.index) ? { ...s, claimedBy: by } : s));
  setBlob(state, 'spawnSlots', slots, state.meta.tick);
}

/** A rejected landing must leave the state deep-equal to before. */
function expectRejectedUnchanged(state: PlanetState, attempt: () => SpawnColonyLandingResult, code: string): void {
  const before = structuredClone(state);
  expect(attempt()).toEqual({ ok: false, code });
  expect(state).toEqual(before);
}

describe('landing rules: a colony lands once', () => {
  it('a second system.spawnColony for the same colony is already_landed and credits no second cargo', () => {
    const h = host();
    expect(run(h, 'system.spawnColony', { colonyIndex: 0 }).code).toBeUndefined();
    const second = run(h, 'system.spawnColony', { colonyIndex: 0, slotIndex: 2 });
    expect(second).toEqual({ code: 'already_landed', reasons: [] });
    expect(getColonyStock(h.state, 0)).toEqual(CARGO);
    expect(getLandingPods(h.state)).toHaveLength(1);
    expect(getSpawnSlots(h.state)[2].claimedBy).toBeUndefined();
  });

  it('dev.land with (q, r) for a deployed colony is already_landed; without (q, r) it is a no-op', () => {
    const h = host();
    expect(run(h, 'system.spawnColony', { colonyIndex: 0 }).code).toBeUndefined();
    expect(run(h, 'dev.land', { colonyId: 0 }).code).toBeUndefined();
    expect(getLandingPods(h.state)[0].deployed).toBe(true);
    const entities = h.state.entities.count;

    const slot2 = getSpawnSlots(h.state)[2];
    expect(run(h, 'dev.land', { colonyId: 0, q: slot2.q, r: slot2.r })).toEqual({ code: 'already_landed', reasons: [] });
    expect(run(h, 'dev.land', { colonyId: 0 })).toEqual({ code: undefined, reasons: [] });
    expect(getColonyStock(h.state, 0)).toEqual(CARGO);
    expect(h.state.entities.count).toBe(entities);
    expect(getLandingPods(h.state)).toHaveLength(1);
  });

  it('spawnColonyLanding validates first: a rejected second landing changes nothing', () => {
    const h = host();
    landed(spawnColonyLanding(h.state, { colonyId: 0 }));
    expectRejectedUnchanged(h.state, () => spawnColonyLanding(h.state, { colonyId: 0, slotIndex: 3 }), 'already_landed');
    expect(checkColonyLanding(h.state, { colonyId: 0 })).toEqual({ ok: false, code: 'already_landed' });
  });
});

describe('landing rules: landing_site_taken', () => {
  it("explicit (q, r) on another colony's claimed slot is taken; the claiming colony itself may land there", () => {
    const h = host();
    claimSlots(h.state, 5, [1]);
    const slot1 = getSpawnSlots(h.state)[1];
    expectRejectedUnchanged(h.state, () => spawnColonyLanding(h.state, { colonyId: 1, q: slot1.q, r: slot1.r }), 'landing_site_taken');
    expect(run(h, 'system.spawnColony', { colonyIndex: 1, q: slot1.q, r: slot1.r }).code).toBe('landing_site_taken');
    expect(landed(spawnColonyLanding(h.state, { colonyId: 5, q: slot1.q, r: slot1.r }))).toMatchObject({ q: slot1.q, r: slot1.r });
    expect(getSpawnSlots(h.state)[1].claimedBy).toBe(5);
  });

  it(`a spot within ${SEP} hexes of another colony's pod is taken; exactly ${SEP} away is allowed`, () => {
    const h = host();
    const pod0 = landed(spawnColonyLanding(h.state, { colonyId: 0 }));
    const slot0 = getSpawnSlots(h.state)[0];
    expect(pod0).toMatchObject({ q: slot0.q, r: slot0.r });
    expect(SEP).toBe(6);
    const near = { q: slot0.q + SEP - 1, r: slot0.r };
    const edge = { q: slot0.q + SEP, r: slot0.r };
    expect(hexDistance(slot0.q, slot0.r, near.q, near.r)).toBe(SEP - 1);
    expectRejectedUnchanged(h.state, () => spawnColonyLanding(h.state, { colonyId: 1, ...near }), 'landing_site_taken');
    expect(run(h, 'system.spawnColony', { colonyIndex: 1, ...near }).code).toBe('landing_site_taken');
    expect(getColonyStock(h.state, 1)).toEqual(fullStock());
    expect(landed(spawnColonyLanding(h.state, { colonyId: 1, ...edge }))).toMatchObject(edge);
    expect(getColonyStock(h.state, 1)).toEqual(CARGO);
  });

  it('on a planet without slots every colony defaults to (0,0), so the second one is taken', () => {
    const h = host('flat', 12);
    expect(landed(spawnColonyLanding(h.state, { colonyId: 0 }))).toMatchObject({ q: 0, r: 0 });
    expectRejectedUnchanged(h.state, () => spawnColonyLanding(h.state, { colonyId: 1 }), 'landing_site_taken');
  });

  it("dev.land refuses to relocate an undeployed pod within the separation of another colony's pod", () => {
    const h = host();
    expect(run(h, 'system.spawnColony', { colonyIndex: 0 }).code).toBeUndefined();
    expect(run(h, 'system.spawnColony', { colonyIndex: 1 }).code).toBeUndefined();
    const [p0, p1] = getLandingPods(h.state);
    const home1 = { q: p1.q, r: p1.r };
    const entities = h.state.entities.count;

    expect(run(h, 'dev.land', { colonyId: 1, q: p0.q + SEP - 1, r: p0.r }).code).toBe('landing_site_taken');
    const after = getLandingPods(h.state)[1];
    expect(after).toMatchObject({ ...home1, deployed: false });
    const row = rowOf(h.state.entities, p1.podEntityId);
    expect([h.state.entities.cols.q[row], h.state.entities.cols.r[row]]).toEqual([home1.q, home1.r]);
    expect(h.state.entities.count).toBe(entities);

    expect(run(h, 'dev.land', { colonyId: 1, q: p0.q + SEP, r: p0.r }).code).toBeUndefined();
    expect(getLandingPods(h.state)[1]).toMatchObject({ q: p0.q + SEP, r: p0.r, deployed: true });
    expect(getColonyStock(h.state, 1)).toEqual(CARGO);
  });
});

describe('landing rules: slot choice', () => {
  it('falls back to the first free slot when the preferred slot is taken', () => {
    const h = host();
    claimSlots(h.state, 7, [0, 1]);
    const slots = getSpawnSlots(h.state);
    const res = landed(spawnColonyLanding(h.state, { colonyId: 1 }));
    expect(res).toMatchObject({ q: slots[2].q, r: slots[2].r });
    expect(getSpawnSlots(h.state)[2].claimedBy).toBe(1);
    expect(getSpawnSlots(h.state)[1].claimedBy).toBe(7);
    const viaCmd = run(h, 'system.spawnColony', { colonyIndex: 3, slotIndex: 2 });
    expect(viaCmd).toEqual({ code: undefined, reasons: ['landing.cargo'] });
    expect(getLandingPods(h.state)[1]).toMatchObject({ colonyId: 3, q: slots[3].q, r: slots[3].r });
  });

  it('takes its preferred slot (slotIndex ?? colonyId) when free, also one it already claimed', () => {
    const h = host();
    const slots = getSpawnSlots(h.state);
    expect(landed(spawnColonyLanding(h.state, { colonyId: 0, slotIndex: 4 }))).toMatchObject({ q: slots[4].q, r: slots[4].r });
    claimSlots(h.state, 2, [2]);
    expect(landed(spawnColonyLanding(h.state, { colonyId: 2 }))).toMatchObject({ q: slots[2].q, r: slots[2].r });
  });

  it('rejects landing_site_taken when every slot is claimed by other colonies, changing nothing', () => {
    const h = host();
    claimSlots(h.state, 9, [0, 1, 2, 3, 4]);
    expect(getSpawnSlots(h.state)).toHaveLength(5);
    expectRejectedUnchanged(h.state, () => spawnColonyLanding(h.state, { colonyId: 0 }), 'landing_site_taken');
    expect(run(h, 'system.spawnColony', { colonyIndex: 0 })).toEqual({ code: 'landing_site_taken', reasons: [] });
    expect(h.state.entities.count).toBe(0);
  });
});

describe('landing rules: invalid_args', () => {
  it('an explicit (q, r) off the map is invalid_args (spawnColonyLanding, system.spawnColony and dev.land)', () => {
    const h = host();
    const off = { q: h.state.grid.radius + 5, r: 0 };
    expectRejectedUnchanged(h.state, () => spawnColonyLanding(h.state, { colonyId: 0, ...off }), 'invalid_args');
    expect(run(h, 'system.spawnColony', { colonyIndex: 0, ...off })).toEqual({ code: 'invalid_args', reasons: [] });
    expect(run(h, 'dev.land', { colonyId: 0, ...off })).toEqual({ code: 'invalid_args', reasons: [] });
    expect(getLandingPods(h.state)).toEqual([]);
    expect(h.state.entities.count).toBe(0);
    expect(getColonyStock(h.state, 0)).toEqual(fullStock());
  });

  it('dev.land refuses to relocate an undeployed pod off the map', () => {
    const h = host();
    expect(run(h, 'system.spawnColony', { colonyIndex: 0 }).code).toBeUndefined();
    const pod = { ...getLandingPods(h.state)[0] };
    const entities = h.state.entities.count;
    expect(run(h, 'dev.land', { colonyId: 0, q: h.state.grid.radius + 12, r: 0 }).code).toBe('invalid_args');
    expect(getLandingPods(h.state)[0]).toMatchObject({ q: pod.q, r: pod.r, deployed: false });
    expect(h.state.entities.count).toBe(entities);
  });

  it('dev.land without a pod lands and deploys at once at a free spot', () => {
    const h = host();
    const slot0 = getSpawnSlots(h.state)[0];
    expect(run(h, 'dev.land', { colonyId: 0 })).toEqual({ code: undefined, reasons: ['landing.cargo'] });
    expect(getLandingPods(h.state)[0]).toMatchObject({ colonyId: 0, q: slot0.q, r: slot0.r, deployed: true });
    const cols = h.state.entities.cols;
    expect([...cols.kind.slice(0, h.state.entities.count)].sort()).toEqual([ENTITY_KIND.pod, ENTITY_KIND.hq].sort());
  });
});
