import type { INestApplication } from '@nestjs/common';
import { newId, parseWaves } from '@terra/contracts';
import { EconomyProfileRepository } from '@terra/db';
import { createTestDatabase, type TestDatabase } from '@terra/db/testing';
import { compileData, compileProfile } from '@terra/sim';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import seed from '../../../../shared/db/seeds/0002_economy_baseline';
import { createApp } from '../../src/app';
import { DEV_ECONOMY_EDIT_TOKEN, DEV_ECONOMY_READ_TOKEN } from '../../src/economy/economy-auth';
import { EconomyProfileService } from '../../src/economy/profile/profile.service';
import { GamePlanets } from '../../src/game/game-planets.service';

let db: TestDatabase;
let app: INestApplication;
let url: string;
const SOURCE = () => ({ NODE_ENV: 'test', SNAPSHOTS: 'on', SIM_THREADS: '1', DATABASE_URL: db.url });
const flags = parseWaves('all').list;

async function boot(): Promise<void> {
  ({ app } = await createApp({ source: SOURCE() }));
  await app.listen(0, '127.0.0.1');
  url = (await app.getUrl()).replace('[::1]', '127.0.0.1');
}

/** Loosely typed JSON body (the assertions below check the shape). */
type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

const call = async (method: string, path: string, body?: unknown, token: string | null = DEV_ECONOMY_EDIT_TOKEN) => {
  const res = await fetch(`${url}/v1/economy${path}`, {
    method,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return { status: res.status, json: (await res.json()) as Json };
};
const patchBody = (requestId: string, expectedVersion: number, ops: unknown[]) => ({ schemaVersion: 1, requestId, expectedVersion, ops });

beforeAll(async () => {
  db = await createTestDatabase();
  await seed({ prisma: db.prisma, log: () => undefined });
  await boot();
}, 120_000);
afterAll(async () => { await app?.close(); await db?.drop(); });

describe('economy API: auth and schema', () => {
  it('requires a token, and the read role cannot edit', async () => {
    expect((await call('GET', '/schema', undefined, null)).status).toBe(401);
    expect((await call('GET', '/schema', undefined, 'wrong')).status).toBe(401);
    const s = await call('GET', '/schema', undefined, DEV_ECONOMY_READ_TOKEN);
    expect(s.status).toBe(200);
    expect(s.json.schemaVersion).toBe(1);
    expect(s.json.properties['market.resource.bio.water.reserveHorizonS']).toBeDefined();
    const denied = await call('POST', '/profiles/baseline/versions/1/clone', { requestId: 'r-denied' }, DEV_ECONOMY_READ_TOKEN);
    expect(denied.status).toBe(403);
  });
});

describe('economy API: clone, patch, validate, export', () => {
  it('lists the seeded baseline and exports its content', async () => {
    const list = await call('GET', '/profiles', undefined, DEV_ECONOMY_READ_TOKEN);
    expect(list.json.profiles.map((p: { id: string }) => p.id)).toContain('baseline');
    const exp = await call('GET', '/profiles/baseline/versions/1/export', undefined, DEV_ECONOMY_READ_TOKEN);
    expect(exp.json.ref).toMatchObject({ id: 'baseline', version: 1 });
    expect(exp.json.content.resourcePolicies).toHaveLength(10);
    expect((await call('GET', '/profiles/baseline/versions/99', undefined, DEV_ECONOMY_READ_TOKEN)).status).toBe(404);
  });

  it('clone → structured patch errors → conflict → patch → replay → validate, all audited', async () => {
    const clone = await call('POST', '/profiles/baseline/versions/1/clone', { requestId: 'req-clone-1' });
    expect(clone.status).toBe(201);
    const draft = clone.json.version;
    expect(draft.version).toMatchObject({ version: 2, status: 'DRAFT', parentId: 'baseline@1' });
    expect(draft.version.contentHash).toBe((await call('GET', '/profiles/baseline/versions/1', undefined, DEV_ECONOMY_READ_TOKEN)).json.version.contentHash);
    expect((await call('POST', '/profiles/baseline/versions/1/clone', { requestId: 'req-clone-1' })).json).toMatchObject({ replayed: true, version: { version: { id: draft.version.id } } });

    const bad = await call('PATCH', '/profiles/baseline/versions/2', patchBody('req-bad', 1, [{ op: 'set', path: 'market.policy.nope', value: 1 }, { op: 'set', path: 'market.policy.platformFeeBp', value: 99999 }, { op: 'set', path: 'market.policy.policyVersion', value: 'x' }]));
    expect(bad.status).toBe(422);
    expect(bad.json.error.details.errors.map((e: { code: string }) => e.code).sort()).toEqual(['not_tunable', 'out_of_bounds', 'unknown_path']);

    const stale = await call('PATCH', '/profiles/baseline/versions/2', patchBody('req-stale', 7, [{ op: 'set', path: 'market.policy.platformFeeBp', value: 80 }]));
    expect(stale.status).toBe(409);
    expect(stale.json.error.details.errors[0].code).toBe('version_conflict');

    const ok = await call('PATCH', '/profiles/baseline/versions/2', patchBody('req-ok', 1, [{ op: 'set', path: 'market.policy.platformFeeBp', value: 80 }]));
    expect(ok.status).toBe(200);
    expect(ok.json.version.revision).toBe(2);
    expect(ok.json.version.content.parameters['market.policy.platformFeeBp']).toBe(80);
    const replay = await call('PATCH', '/profiles/baseline/versions/2', patchBody('req-ok', 1, [{ op: 'set', path: 'market.policy.platformFeeBp', value: 80 }]));
    expect(replay.json).toMatchObject({ replayed: true, version: { revision: 2 } });

    const valid = await call('POST', '/profiles/baseline/versions/2/validate', { requestId: 'req-val' });
    expect(valid.json).toMatchObject({ valid: true, errors: [], version: { version: { status: 'VALIDATED' } } });
    expect((await call('PATCH', '/profiles/baseline/versions/2', patchBody('req-late', 2, [{ op: 'unset', path: 'market.policy.platformFeeBp' }]))).status).toBe(409);

    const audit = await db.prisma.economyAuditEvent.findMany({ orderBy: { id: 'asc' } });
    expect(audit.map((a) => [a.action, a.requestId, a.actor])).toEqual([['clone', 'req-clone-1', 'edit'], ['patch', 'req-ok', 'edit'], ['validate', 'req-val', 'edit']]);
  });

  it('validate reports failures without changing the draft', async () => {
    const draft = (await call('POST', '/profiles/baseline/versions/1/clone', { requestId: 'req-clone-2' })).json.version;
    const bare = await new EconomyProfileRepository(db.prisma).replaceDraftContent(draft.version.id, draft.revision, { parameters: {} });
    const r = await call('POST', `/profiles/baseline/versions/${bare.version.version}/validate`, { requestId: 'req-val-2' });
    expect(r.json.valid).toBe(false);
    expect(r.json.errors.filter((e: { code: string }) => e.code === 'missing_resource_coverage')).toHaveLength(10);
    expect(r.json.version.version.status).toBe('DRAFT');
  });
});

describe('compiled profile: one hash everywhere, no tick reads the DB', () => {
  it('the baseline compiles to the stock data hash; an activated candidate changes the planet hash exactly as compileProfile says', async () => {
    const base = await call('GET', '/resolve', undefined, DEV_ECONOMY_READ_TOKEN);
    expect(base.json.layers.map((l: { scope: string }) => l.scope)).toEqual(['global']);
    expect(base.json.overrides).toEqual({});
    expect(base.json.dataHash).toBe(compileData(new Set(flags)).hash);

    // Approve v2 and activate it globally (activation endpoints arrive with W13-39: direct rows here).
    const repo = new EconomyProfileRepository(db.prisma);
    await repo.markApproved('baseline@2');
    await db.prisma.economyActivation.update({ where: { id: 'act_baseline_1' }, data: { state: 'SUPERSEDED' } });
    await db.prisma.economyActivation.create({ data: { id: 'act_baseline_2', scope: 'global', versionId: 'baseline@2', previousId: 'act_baseline_1', state: 'ACTIVE', operator: 'test' } });

    const expected = compileProfile((await repo.exportVersion('baseline@2')).content, flags);
    expect(expected.overrides).toEqual({ market: { policy: { platformFeeBp: 80 } } });
    const resolved = await call('GET', '/resolve?planetType=dune', undefined, DEV_ECONOMY_READ_TOKEN);
    expect(resolved.json.dataHash).toBe(expected.dataHash);
    expect(resolved.json.dataHash).not.toBe(base.json.dataHash);
    expect(resolved.json.marketPolicyHash).toBe(expected.marketConfig?.policyHash);
    // The snapshot is plain data: it survives structured clone (thread messages) and JSON (welcome.overrides).
    expect(structuredClone(expected)).toEqual(expected);

    // A fresh boot compiles the active version once and hands the thread pool plain overrides; the planet agrees.
    await app.close();
    await boot();
    const planets = app.get(GamePlanets);
    const id = newId('pl');
    await planets.load(id);
    const state = await planets.fullState(id);
    expect(state.dataHash).toBe(expected.dataHash);
    expect(state.overrides).toMatchObject({ market: { policy: { platformFeeBp: 80 } } });
    // Compiled once per version-hash chain: the second call returns the identical frozen snapshot.
    const svc = app.get(EconomyProfileService);
    expect(await svc.compiledFor({})).toBe(await svc.compiledFor({}));
    // The browser (?host=local) compiles the overrides it is sent to the same hash.
    expect(compileData(new Set(flags), JSON.parse(JSON.stringify(state.overrides ?? {}))).hash).toBe(expected.dataHash);
  }, 120_000);
});

describe('GET /resolve with sector scope: regional endowment with provenance (W13-50)', () => {
  const activate = async (id: string, scope: string, regions: unknown) => {
    const repo = new EconomyProfileRepository(db.prisma);
    await db.prisma.economyProfile.create({ data: { id, name: id } });
    const v = await repo.createVersion(id, { author: 'test', content: { regions } });
    await repo.markValidated(v.version.id);
    await repo.markApproved(v.version.id);
    await db.prisma.economyActivation.create({ data: { id: `act_${id}`, scope, versionId: v.version.id, state: 'ACTIVE', operator: 'test' } });
  };

  it('resolves desert crystal 15 vs the ridge archetype 80 per field and reports provenance and hashes', async () => {
    await activate('geo-desert', 'planetType:desert', {
      profiles: [
        { regionProfileId: 'desert', resources: { 'minerals.t3': { occurrenceWeightBp: 1500 } } },
        { regionProfileId: 'ridge', resources: { 'minerals.t3': { occurrenceWeightBp: 8000 } } },
      ],
      bindings: [
        { scopeKind: 'planetType', planetType: 'desert', regionProfileId: 'desert' },
        { scopeKind: 'sectorArchetype', archetype: 'crystal-ridge', regionProfileId: 'ridge' },
      ],
    });
    const plain = await call('GET', '/resolve?planetType=desert&planetId=pl_dune', undefined, DEV_ECONOMY_READ_TOKEN);
    const ridge = await call('GET', '/resolve?planetType=desert&planetId=pl_dune&sectorArchetype=crystal-ridge&sectorId=sec_42', undefined, DEV_ECONOMY_READ_TOKEN);
    const crystal = (j: Json) => j.region.resources.find((r: Json) => r.resource === 'minerals.t3');
    expect(plain.json.regionErrors).toEqual([]);
    expect(crystal(plain.json).fields.occurrenceWeightBp).toBe(1500);
    expect(crystal(plain.json).provenance.occurrenceWeightBp).toBe('planetType');
    expect(crystal(ridge.json).fields.occurrenceWeightBp).toBe(8000);
    expect(crystal(ridge.json).provenance.occurrenceWeightBp).toBe('sectorArchetype');
    expect(crystal(ridge.json).provenance.reserveUnitsMax).toBe('global');
    expect(ridge.json.region.resources).toHaveLength(10);
    expect(ridge.json.region.endowmentHash).not.toBe(plain.json.region.endowmentHash);
    expect(ridge.json.region.runtimeHash).toBe(plain.json.region.runtimeHash);
  });

  it('reports ambiguous bindings as structured errors instead of guessing', async () => {
    await activate('geo-ambiguous', 'planetType:ocean', {
      profiles: [{ regionProfileId: 'a', resources: {} }, { regionProfileId: 'b', resources: {} }],
      bindings: [
        { scopeKind: 'planetType', planetType: 'ocean', regionProfileId: 'a', priority: 3 },
        { scopeKind: 'planetType', planetType: 'ocean', planetId: 'pl_sea', regionProfileId: 'b', priority: 3 },
      ],
    });
    const r = await call('GET', '/resolve?planetType=ocean&planetId=pl_sea', undefined, DEV_ECONOMY_READ_TOKEN);
    expect(r.status).toBe(200);
    expect(r.json.region).toBeNull();
    expect(r.json.regionErrors[0].code).toBe('ambiguous_binding');
  });
});
