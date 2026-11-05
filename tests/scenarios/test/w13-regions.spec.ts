import { RegionsContent } from '@terra/contracts';
import {
  activateRegionRuntime, createPlanet, ENTITY_KIND, ENTITY_STATE, getLogisticsView, getRegionPin, insertRow, placeSpawnedEntity, regionForNewPlanet,
  regionViewOf, resolvePlanetRegion, SimHost, snapshot, startBuildingConstruction, writeRegionPin, type LedgerPosting, type PlanetState, type ResolvedRegion,
} from '@terra/sim';
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { createScenarioPlanet } from '../_loader';

/** W13-57 integration acceptance: only enabled waves execute; no terrain rewrite, unexplained surcharge or duplicate supply after reconnect. */
const WINDOW = 300;
const PRE_W13 = ['W00', 'W01', 'W02', 'W03', 'W04', 'W05', 'W06', 'W07', 'W08', 'W09', 'W10', 'W11', 'W12'];
const ok = (r: ReturnType<typeof resolvePlanetRegion>): ResolvedRegion => { if (!r.ok) throw new Error(JSON.stringify(r.errors)); return r.region; };

/** Hash of every generated ground layer: what "the terrain was not rewritten" means. */
function terrainHash(s: PlanetState): string {
  const h = createHash('sha256');
  for (const name of ['terrain', 'height', 'deposit', 'richness', 'depositTier'] as const) h.update(Buffer.from((s.grid.layers[name] as ArrayBufferView).buffer as ArrayBuffer));
  return h.digest('hex');
}

/** The logistics bill of a colony's window: summary plus the water its entities are charged, as integers (micro-units). */
function bill(host: SimHost, colony = 0): { K: number; L: string; M: string; entities: number; waterMicro: number } {
  const v = getLogisticsView(host.state, colony);
  const water = Object.values(v.entities).reduce((a, e) => a + (e.need['bio.water'] ?? 0), 0);
  return { K: v.summary!.K, L: v.summary!.L, M: v.summary!.M!, entities: Object.keys(v.entities).length, waterMicro: water };
}

function addUnits(host: SimHost, n: number, st: number): void {
  const s = host.state;
  for (let i = 0; i < n; i++) {
    const row = insertRow(s.entities, s.meta.nextEntityId++, host.tick);
    const c = s.entities.cols;
    c.kind[row] = ENTITY_KIND.builder; c.owner[row] = 0; c.tier[row] = 1;
    placeSpawnedEntity(s.entities, row, -13 + (i % 6), 5 + Math.floor(i / 6), host.tick);
    c.hp[row] = 100; c.hpMax[row] = 100; c.state[row] = st;
  }
}

const collect = (host: SimHost): { postings: LedgerPosting[]; stop: () => void } => {
  const postings: LedgerPosting[] = [];
  const stop = host.onPostings((p) => { postings.push(...p); });
  return { postings, stop };
};

describe('W13-57 regions and logistics integration (waves ..12 change nothing)', () => {
  it('with W13 off the planet has no pin, no logistics state and no logistics postings, and its ground equals a region-less planet', () => {
    const { host } = createScenarioPlanet('w13r', { flags: PRE_W13 });
    const plain = createPlanet({ type: 'desert', planetType: 'desert', seed: 'w13-regions', radius: 16 });
    expect(regionForNewPlanet({ flags: PRE_W13, planetType: 'desert' })).toBeUndefined();
    expect(getRegionPin(host.state)).toBeUndefined();
    expect(regionViewOf(host.state)).toBeUndefined();
    const seen = collect(host);
    host.step(WINDOW * 2 + 5);
    seen.stop();
    expect(host.state.blobs.logistics).toBeUndefined();
    expect(seen.postings.filter((p) => p.reason.startsWith('logistics.'))).toEqual([]);
    // the scenario builds on flattened boxes; compare a far corner: generation is the legacy one
    const far = (s: PlanetState): number[] => [...(s.grid.layers.deposit as Uint8Array).slice(0, 200)];
    expect(far(host.state)).toEqual(far(plain));
  });
});

describe('W13-57 region pin at creation (single region, pre-W11)', () => {
  it('pins the one planet region of the planet type at creation; the pin carries no sector', () => {
    const { host } = createScenarioPlanet('w13r', { planetId: 'pl_a' });
    const pin = getRegionPin(host.state)!;
    expect(pin.context).toEqual({ planetType: 'desert', planetId: 'pl_a' });
    expect(pin.endowmentHash).toBe(ok(resolvePlanetRegion({}, { planetType: 'desert', planetId: 'pl_a' })).endowmentHash);
    expect(pin.regionGenVersion).toBe(1);
    // same planet type, another planet id: the same endowment (no planet-id binding)
    const other = getRegionPin(createScenarioPlanet('w13r', { planetId: 'pl_b' }).host.state)!;
    expect(other.endowmentHash).toBe(pin.endowmentHash);
  });

  it('a profile region passed by the host wins over the bootstrap one; a planet that has run is never pinned afterwards', () => {
    const content = { regions: RegionsContent.parse({
      profiles: [{ regionProfileId: 'rich', resources: { 'metals.t1': { occurrenceWeightBp: 20000 } } }],
      bindings: [{ scopeKind: 'planetId', planetId: 'pl_rich', regionProfileId: 'rich' }],
    }) };
    const region = regionForNewPlanet({ flags: ['W13'], planetType: 'desert', planetId: 'pl_rich', content })!;
    const { host } = createScenarioPlanet('w13r', { planetId: 'pl_rich', region });
    expect(getRegionPin(host.state)!.endowmentHash).toBe(region.endowmentHash);
    expect(region.endowmentHash).not.toBe(ok(resolvePlanetRegion({}, { planetType: 'desert', planetId: 'pl_rich' })).endowmentHash);
    const legacy = createPlanet({ type: 'desert', planetType: 'desert', seed: 'x', radius: 8 });
    legacy.meta.tick = 5;
    expect(writeRegionPin(legacy, region)).toBeUndefined();
  });
});

describe('W13-57 operator edits', () => {
  const { host } = createScenarioPlanet('w13r', { planetId: 'pl_edit' });
  const pin = getRegionPin(host.state)!;
  const base = terrainHash(host.state);

  it('a runtime edit (yield) changes future production only; the world hash is unchanged', () => {
    const edit = ok(resolvePlanetRegion({ regions: RegionsContent.parse({
      profiles: [{ regionProfileId: 'y', resources: { 'metals.t1': { extractionYieldBp: 5000 } } }],
      bindings: [{ scopeKind: 'planetId', planetId: 'pl_edit', regionProfileId: 'y' }],
    }) }, { planetType: 'desert', planetId: 'pl_edit' }));
    expect(edit.endowmentHash).toBe(pin.endowmentHash);
    expect(edit.runtimeHash).not.toBe(pin.runtimeHash);
    const before = regionViewOf(host.state)!.resources.find((r) => r.resource === 'metals.t1')!.fields.extractionYieldBp;
    activateRegionRuntime(host.state, edit, host.tick + 100);
    expect(regionViewOf(host.state)!.resources.find((r) => r.resource === 'metals.t1')!.fields.extractionYieldBp).toBe(before); // not effective yet
    host.step(101);
    expect(regionViewOf(host.state)!.resources.find((r) => r.resource === 'metals.t1')!.fields.extractionYieldBp).toBe(5000);
    expect(terrainHash(host.state)).toBe(base);
    expect(getRegionPin(host.state)!.endowmentHash).toBe(pin.endowmentHash);
  });

  it('an endowment edit never rewrites an existing world, also across snapshot and reload', () => {
    const edit = ok(resolvePlanetRegion({ regions: RegionsContent.parse({
      profiles: [{ regionProfileId: 'e', depositDensityPer1000Tiles: 5, resources: { 'minerals.t3': { occurrenceWeightBp: 9000 } } }],
      bindings: [{ scopeKind: 'planetType', planetType: 'desert', regionProfileId: 'e' }],
    }) }, { planetType: 'desert', planetId: 'pl_edit' }));
    expect(edit.endowmentHash).not.toBe(pin.endowmentHash);
    expect(writeRegionPin(host.state, edit)!.endowmentHash).toBe(pin.endowmentHash); // the existing pin is returned, nothing rewritten
    const reloaded = new SimHost(host.pipeline);
    reloaded.load(snapshot(host.state));
    expect(terrainHash(reloaded.state)).toBe(base);
    expect(getRegionPin(reloaded.state)!.endowmentHash).toBe(pin.endowmentHash);
    // a NEW world made with the edited profile does differ
    const fresh = createScenarioPlanet('w13r', { planetId: 'pl_edit', region: edit }).host.state;
    expect(getRegionPin(fresh)!.endowmentHash).toBe(edit.endowmentHash);
  });
});

describe('W13-57 logistics bill (owner story: desert metal specialist with a growing army at fixed capacity)', () => {
  it('starts as the story says: Dune Works (hub only, K 100) carries 24 units; the bill is explained by u and M', () => {
    const { host } = createScenarioPlanet('w13r');
    host.step(2);
    const b = bill(host);
    expect(b).toMatchObject({ K: 100, L: '210/1', M: '521/400', entities: 24 });
    // M = 1 + alpha * (u - 1)^2 with alpha 0.25 and u = 2.1: the whole surcharge, nothing else
    expect(521 / 400).toBeCloseTo(1 + 0.25 * (2.1 - 1) ** 2, 10);
    // the supplier colony has no army and no bill; the capital's comparison colony stays below capacity
    expect(getLogisticsView(host.state, 1).summary).toBeNull();
    expect(getLogisticsView(host.state, 2).summary!.M).toBe('1/1');
  });

  it('the bill rises with the army at fixed capacity, drops after a Supply Depot, and reserve mode stops it', () => {
    const { host } = createScenarioPlanet('w13r');
    host.step(2);
    const start = bill(host);
    addUnits(host, 10, ENTITY_STATE.working);
    host.step(WINDOW + 1);
    const grown = bill(host);
    expect(grown.K).toBe(100);
    expect(grown.entities).toBe(34);
    expect(grown.waterMicro).toBeGreaterThan(start.waterMicro * 2); // more units and a higher M
    const out = startBuildingConstruction(host.state, { owner: 0, building: 'supplyDepot', q: -14, r: -2, instant: true, costOverride: {}, tick: host.tick });
    expect(out.ok).toBe(true);
    host.step(WINDOW + 1);
    const withDepot = bill(host);
    expect(withDepot.K).toBe(160);
    expect(withDepot.entities).toBe(34);
    expect(withDepot.waterMicro).toBeLessThan(grown.waterMicro);
    const ids = Object.keys(getLogisticsView(host.state, 0).entities).map(Number);
    host.submit({ colonyIndex: 0, source: 'player', commandId: 'reserve-all', kind: 'unitReserve', args: { entityIds: ids, reserve: true } });
    host.step(WINDOW + 1);
    expect(bill(host).waterMicro).toBe(0);
  });
});

describe('W13-57 dev.spawnunit grows the load', () => {
  it('spawns own idle builders with a logistics row; the bill follows', () => {
    const { host } = createScenarioPlanet('w13r');
    host.step(2);
    const before = bill(host);
    host.submit({ colonyIndex: 0, source: 'dev', commandId: 'su', kind: 'dev.spawnunit', args: { unit: 'builder', q: -13, r: 5, count: 8 } });
    expect(host.step(1).outcomes.find((o) => o.commandId === 'su')?.code).toBeUndefined();
    host.step(WINDOW + 1);
    const after = bill(host);
    expect(after.entities).toBe(before.entities + 8);
    expect(after.waterMicro).toBeGreaterThan(before.waterMicro);
  });
});

describe('W13-57 reconnect: snapshot restore repeats nothing', () => {
  it('a restored host posts exactly what the live host posts (no duplicate supply posting, no extra surcharge) and ends equal', () => {
    const { host: live } = createScenarioPlanet('w13r');
    live.step(WINDOW + 7);
    const bytes = snapshot(live.state);
    const restored = new SimHost(live.pipeline);
    restored.load(bytes);
    const a = collect(live), b = collect(restored);
    live.step(WINDOW * 3);
    restored.step(WINDOW * 3);
    a.stop(); b.stop();
    const supply = a.postings.filter((p) => p.reason.startsWith('logistics.'));
    expect(supply.length).toBeGreaterThan(0);
    expect(JSON.stringify(b.postings)).toBe(JSON.stringify(a.postings));
    // every (colony, window) is settled once: no window key repeats among the supply postings of one colony
    const keys = supply.filter((p) => p.reason === 'logistics.supply').map((p) => `${p.legs[0]!.account}|${p.at}`);
    expect(new Set(keys).size).toBe(keys.length);
    expect(terrainHash(restored.state)).toBe(terrainHash(live.state));
    expect(Buffer.from(snapshot(restored.state)).equals(Buffer.from(snapshot(live.state)))).toBe(true);
  });
});

/**
 * Counterfactual fixtures of waves that are NOT in this tree. They are labelled `future` and skipped from every gate:
 * a green run proves nothing about W11 sectors or W27 lazy regeneration, and nothing here may be cited as evidence for them.
 */
const FUTURE = [
  { future: 'W11', title: 'canonical sector fixture: a crystal-ridge sector binds the crystal-rich region of ECONOMY 2.2' },
  { future: 'W27', title: 'lazy-materialized sector contract: a sector materialized later reads its pinned region, never a regenerated one' },
] as const;
describe('W13-57 future integration fixtures (counterfactual, not gates)', () => {
  const ridge = RegionsContent.parse({
    profiles: [{ regionProfileId: 'crystal-ridge', resources: { 'minerals.t3': { occurrenceWeightBp: 8000 } } }],
    bindings: [{ scopeKind: 'sectorArchetype', archetype: 'crystal-ridge', regionProfileId: 'crystal-ridge' }],
  });
  it.skip.each(FUTURE)('[future: $future counterfactual] $title', ({ future }) => {
    const ctx = { planetType: 'desert', planetId: 'pl_future', sectorArchetype: 'crystal-ridge', sectorId: `sec_${future}` };
    const sector = ok(resolvePlanetRegion({ regions: ridge }, ctx));
    const planet = ok(resolvePlanetRegion({ regions: ridge }, { planetType: 'desert', planetId: 'pl_future' }));
    expect(sector.endowmentHash).not.toBe(planet.endowmentHash);
  });

  it('every future fixture is labelled with a wave this tree does not contain', () => {
    for (const f of FUTURE) expect(['W11', 'W27']).toContain(f.future);
    expect(createScenarioPlanet('w13r').host.pipeline.config.flags.has('W11')).toBe(true); // W11 flag exists in `..13`, but no sector code runs:
    expect(getRegionPin(createScenarioPlanet('w13r').host.state)!.context.sectorId).toBeUndefined(); // the pin is the one planet region
  });
});
