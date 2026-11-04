import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDatabase, type TestDatabase } from '../src/testing';
import { EconomyProfileRepository, contentHashOf } from '../src/economy';

let db: TestDatabase;
let repo: EconomyProfileRepository;
beforeAll(async () => {
  db = await createTestDatabase();
  repo = new EconomyProfileRepository(db.prisma);
  await db.prisma.economyProfile.create({ data: { id: 'geo', name: 'geo' } });
}, 90_000);
afterAll(async () => { await db?.drop(); });

const sql = (q: string) => db.prisma.$executeRawUnsafe(q);
const rejects = (p: Promise<unknown>, re: RegExp) => expect(p).rejects.toThrow(re);

const content = () => ({
  regions: {
    profiles: [
      { regionProfileId: 'desert', depositDensityPer1000Tiles: 30, resources: { 'minerals.t3': { occurrenceWeightBp: 1500, reserveUnitsMin: 50, reserveUnitsMax: 200 }, 'bio.biomass': { occurrenceWeightBp: 0, renewableUnitsPerSimHour: 0 } } },
      { regionProfileId: 'crystal-ridge', sectorArchetype: 'crystal-ridge', mainResource: 'minerals.t3', resources: { 'minerals.t3': { occurrenceWeightBp: 80000, extractionYieldBp: 12000 } } },
    ],
    bindings: [
      { scopeKind: 'planetType', planetType: 'desert', regionProfileId: 'desert', priority: 0 },
      { scopeKind: 'sectorArchetype', archetype: 'crystal-ridge', regionProfileId: 'crystal-ridge', priority: 0 },
      { scopeKind: 'sectorId', sectorId: 'sec_42', planetId: 'pl_dune', regionProfileId: 'crystal-ridge', priority: 7 },
    ],
  },
  logistics: {
    entries: [
      { kind: 'node', subjectId: 'supply-depot', tier: 1, loadWeightMilli: 0, throughputMilli: 100000, reachTiles: 60, baseConsumption: {} },
      { kind: 'unit', subjectId: 'robot-basic', tier: 1, loadWeightMilli: 2000, baseConsumption: { 'metals.t1': 1, 'bio.water': 2 } },
      { kind: 'building', subjectId: 'extractor', tier: 2, loadWeightMilli: 5000, baseConsumption: {} },
    ],
  },
});

describe('W13-50 region and logistics tables', () => {
  it('regions/logistics round-trip through the tables with an unchanged content hash, explicit zero kept', async () => {
    const v = await repo.createVersion('geo', { author: 'ai', content: content() });
    expect(contentHashOf(v.content)).toBe(v.version.contentHash);
    expect(v.content.regions.profiles.map((p) => p.regionProfileId)).toEqual(['crystal-ridge', 'desert']);
    const desert = v.content.regions.profiles.find((p) => p.regionProfileId === 'desert')!;
    expect(desert.resources['bio.biomass']).toEqual({ occurrenceWeightBp: 0, renewableUnitsPerSimHour: 0 });
    expect(desert.resources['minerals.t3']).toEqual({ occurrenceWeightBp: 1500, reserveUnitsMin: 50, reserveUnitsMax: 200 });
    expect(v.content.regions.bindings).toHaveLength(3);
    expect(v.content.logistics.entries.map((e) => e.subjectId).sort()).toEqual(['extractor', 'robot-basic', 'supply-depot']);
    expect(v.content.logistics.entries.find((e) => e.kind === 'node')).toMatchObject({ throughputMilli: 100000, reachTiles: 60 });
    const clone = await repo.cloneVersion(v.version.id, { author: 'ai2' });
    expect(clone.version.contentHash).toBe(v.version.contentHash);
    expect(clone.content.regions).toEqual(v.content.regions);
    // editing the draft replaces the rows
    const edited = await repo.replaceDraftContent(clone.version.id, clone.revision, { ...clone.content, regions: { profiles: [], bindings: [] } });
    expect(edited.content.regions).toEqual({ profiles: [], bindings: [] });
    expect(edited.version.contentHash).not.toBe(v.version.contentHash);
  });

  it('CHECK constraints reject bad rows', async () => {
    const v = await repo.createVersion('geo', { author: 'ai', content: content() });
    const id = v.version.id;
    await rejects(sql(`INSERT INTO economy.region_resource (version_id, region_profile_id, resource_key) VALUES ('${id}', 'desert', 'gold')`), /23514|check/i);
    await rejects(sql(`INSERT INTO economy.region_resource (version_id, region_profile_id, resource_key, occurrence_weight_bp) VALUES ('${id}', 'desert', 'metals.t1', -1)`), /23514|check/i);
    await rejects(sql(`INSERT INTO economy.region_resource (version_id, region_profile_id, resource_key, reserve_units_min, reserve_units_max) VALUES ('${id}', 'desert', 'metals.t1', 10, 5)`), /23514|check/i);
    await rejects(sql(`INSERT INTO economy.scope_binding (version_id, scope_kind, planet_type, priority, region_profile_id) VALUES ('${id}', 'bogus', 'x', 0, 'desert')`), /23514|check/i);
    await rejects(sql(`INSERT INTO economy.scope_binding (version_id, scope_kind, planet_type, priority, region_profile_id) VALUES ('${id}', 'sectorId', 'desert', 0, 'desert')`), /23514|check/i);
    await rejects(sql(`INSERT INTO economy.logistics_policy (version_id, kind, subject_id, tier, load_weight_milli) VALUES ('${id}', 'node', 'n', 1, 0)`), /23514|check/i);
    await rejects(sql(`INSERT INTO economy.logistics_policy (version_id, kind, subject_id, tier, load_weight_milli, throughput_milli, reach_tiles) VALUES ('${id}', 'unit', 'u', 1, 0, 5, 5)`), /23514|check/i);
    await rejects(sql(`UPDATE economy.region_profile SET main_resource = 'gold' WHERE version_id = '${id}'`), /23514|check/i);
  });

  it('rejects two bindings with the same scope key and priority, and a binding to a missing profile', async () => {
    const v = await repo.createVersion('geo', { author: 'ai', content: content() });
    await rejects(sql(`INSERT INTO economy.scope_binding (version_id, scope_kind, planet_type, priority, region_profile_id) VALUES ('${v.version.id}', 'planetType', 'desert', 0, 'crystal-ridge')`), /23505|unique|duplicate/i);
    await rejects(sql(`INSERT INTO economy.scope_binding (version_id, scope_kind, planet_type, priority, region_profile_id) VALUES ('${v.version.id}', 'planetType', 'ocean', 0, 'ghost')`), /23503|foreign key|violates/i);
    await sql(`INSERT INTO economy.scope_binding (version_id, scope_kind, planet_type, priority, region_profile_id) VALUES ('${v.version.id}', 'planetType', 'desert', 1, 'crystal-ridge')`);
  });

  it('the new tables are immutable once the version is validated', async () => {
    const v = await repo.createVersion('geo', { author: 'ai', content: content() });
    await repo.markValidated(v.version.id);
    const id = v.version.id;
    await rejects(sql(`UPDATE economy.region_resource SET occurrence_weight_bp = 5 WHERE version_id = '${id}'`), /immutable/);
    await rejects(sql(`DELETE FROM economy.region_profile WHERE version_id = '${id}'`), /immutable/);
    await rejects(sql(`DELETE FROM economy.scope_binding WHERE version_id = '${id}'`), /immutable/);
    await rejects(sql(`UPDATE economy.logistics_policy SET load_weight_milli = 1 WHERE version_id = '${id}'`), /immutable/);
    await rejects(sql(`INSERT INTO economy.logistics_policy (version_id, kind, subject_id, tier, load_weight_milli) VALUES ('${id}', 'unit', 'new', 1, 1)`), /immutable/);
    expect((await repo.exportVersion(id)).content.regions.bindings).toHaveLength(3);
  });
});
