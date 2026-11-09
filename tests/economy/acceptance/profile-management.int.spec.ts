import 'reflect-metadata';
import type { INestApplication } from '@nestjs/common';
import { newId, parseWaves } from '@terra/contracts';
import { createTestDatabase, type TestDatabase } from '@terra/db/testing';
import { compileData, compileProfile } from '@terra/sim';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import seed from '../../../shared/db/seeds/0002_economy_baseline';
import { createApp } from '../../../backend/app/src/app';
import { DEV_ECONOMY_ACTIVATE_TOKEN, DEV_ECONOMY_EDIT_TOKEN, DEV_ECONOMY_READ_TOKEN } from '../../../backend/app/src/economy/economy-auth';
import { EconomyProfileService } from '../../../backend/app/src/economy/profile/profile.service';
import { GamePlanets } from '../../../backend/app/src/game/game-planets.service';

/**
 * W13-49 acceptance (1), server half: clone the baseline, patch a prestige recipe input and the platform fee, validate, approve,
 * activate (non-production sandbox), see the new data on a freshly loaded planet, roll back. The pinned-job half (a started
 * prestige job keeps its data hash) is `recipe-pinning.spec.ts`.
 */
type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
let db: TestDatabase;
let app: INestApplication;
let url: string;
const flags = parseWaves('all').list;

const call = async (method: string, path: string, body?: unknown, token: string | null = DEV_ECONOMY_ACTIVATE_TOKEN) => {
  const res = await fetch(`${url}/v1/economy${path}`, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  return { status: res.status, json: (await res.json()) as Json };
};
async function waitFor<T>(fn: () => Promise<T | false | undefined>, ms = 20_000): Promise<T> {
  for (const end = Date.now() + ms; ; await new Promise((r) => setTimeout(r, 100))) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > end) throw new Error('waitFor timed out');
  }
}
const activeVersion = async () => (await call('GET', '/activations?scope=global')).json.activations.find((a: Json) => a.state === 'ACTIVE')?.versionId as string | undefined;
const dataHashOf = async (planetId: string) => (await app.get(GamePlanets).fullState(planetId)).dataHash;
const freshPlanetHash = async () => { const id = newId('pl'); await app.get(GamePlanets).load(id); return dataHashOf(id); };

beforeAll(async () => {
  db = await createTestDatabase();
  await seed({ prisma: db.prisma, log: () => undefined });
  ({ app } = await createApp({ source: { NODE_ENV: 'test', SNAPSHOTS: 'on', SIM_THREADS: '1', DATABASE_URL: db.url } }));
  await app.listen(0, '127.0.0.1');
  url = (await app.getUrl()).replace('[::1]', '127.0.0.1');
}, 120_000);
afterAll(async () => { await app?.close(); await db?.drop(); });

describe('profile and recipe management', () => {
  it('clone -> patch (prestige recipe + market fee) -> validate -> approve -> activate -> new data live -> rollback', async () => {
    const baseHash = await freshPlanetHash();
    expect(await activeVersion()).toBe('baseline@1');

    const clone = await call('POST', '/profiles/baseline/versions/1/clone', { requestId: 'acc-clone' }, DEV_ECONOMY_EDIT_TOKEN);
    const v = clone.json.version.version.version as number;
    const patch = await call('PATCH', `/profiles/baseline/versions/${v}`, {
      schemaVersion: 1, requestId: 'acc-patch', expectedVersion: 1,
      ops: [
        { op: 'set', path: 'prestige.project.survey_array.cost', value: { 'metals.t1': 100, 'minerals.t1': 40, 'bio.water': 30, 'minerals.t2': 8 } },
        { op: 'set', path: 'market.policy.platformFeeBp', value: 80 },
      ],
    }, DEV_ECONOMY_EDIT_TOKEN);
    expect(patch.status).toBe(200);
    expect((await call('POST', `/profiles/baseline/versions/${v}/validate`, { requestId: 'acc-val' }, DEV_ECONOMY_EDIT_TOKEN)).json.valid).toBe(true);
    // an editor cannot approve or activate; the baseline itself stays immutable
    expect((await call('POST', `/profiles/baseline/versions/${v}/approve`, { requestId: 'acc-noappr' }, DEV_ECONOMY_EDIT_TOKEN)).status).toBe(403);
    expect((await call('PATCH', '/profiles/baseline/versions/1', { schemaVersion: 1, requestId: 'acc-imm', expectedVersion: 1, ops: [{ op: 'set', path: 'market.policy.platformFeeBp', value: 1 }] }, DEV_ECONOMY_EDIT_TOKEN)).status).toBeGreaterThanOrEqual(400);
    expect((await call('POST', `/profiles/baseline/versions/${v}/approve`, { requestId: 'acc-appr' })).status).toBe(200);

    const candidate = `baseline@${v}`;
    const want = compileProfile((await app.get(EconomyProfileService).get('baseline', v)).content, flags).dataHash;
    expect(want).not.toBe(baseHash);
    const act = await call('POST', '/activations', { requestId: 'acc-act', versionId: candidate, expectedPreviousVersionId: 'baseline@1', nonProduction: true, effectiveTick: 0 });
    expect(act.status).toBe(202);
    await waitFor(async () => (await activeVersion()) === candidate);
    await waitFor(async () => (await freshPlanetHash()) === want);
    const prestige = compileData(new Set(flags), compileProfile((await app.get(EconomyProfileService).get('baseline', v)).content, flags).overrides).tables.prestige as unknown as Record<string, { cost: Record<string, number> }>;
    expect(prestige['project.survey_array']!.cost['metals.t1']).toBe(100);
    expect((await call('GET', '/resolve', undefined, DEV_ECONOMY_READ_TOKEN)).json.marketPolicyHash).toBeTruthy();

    const rb = await call('POST', `/activations/${act.json.activation.id}/rollback`, { requestId: 'acc-rb', effectiveTick: 0 });
    expect(rb.status).toBe(202);
    await waitFor(async () => (await activeVersion()) === 'baseline@1');
    await waitFor(async () => (await freshPlanetHash()) === baseHash);
  }, 180_000);

  it('a production activation without evidence is refused: no cash path in W13', async () => {
    const r = await call('POST', '/activations', { requestId: 'acc-noev', versionId: 'baseline@1', expectedPreviousVersionId: 'baseline@1' });
    expect(r.status).toBe(422);
  });
});
