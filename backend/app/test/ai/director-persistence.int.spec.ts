import { DEFAULT_DIRECTOR_POLICY, type DirectorPolicyV1 } from '@terra/contracts';
import { createTestDatabase, type TestDatabase } from '@terra/db/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaDirectorStore } from '../../src/ai/audit/prisma-store.js';
import { openPlayerApiKey, PlayerAiSettingsStore } from '../../src/profile/player-ai-settings.store.js';

let db: TestDatabase;
let store: PrismaDirectorStore;

beforeAll(async () => {
  db = await createTestDatabase();
  store = new PrismaDirectorStore(db.prisma);
});

afterAll(async () => {
  await db.drop();
});

const policy: DirectorPolicyV1 = {
  ...DEFAULT_DIRECTOR_POLICY,
  revision: 3,
  risk: 'risky',
  preset: 'resources',
  note: 'durable policy check',
};

describe('W16-15 Postgres director policy, context & decision expiry', () => {
  it('round-trips versioned policy, context, and decisions and expires context without deleting durable policy', async () => {
    await store.savePolicy('col_pg_1', 'pl_pg_1', policy);
    await store.saveContext({
      id: 'ctx_expired',
      colonyId: 'col_pg_1',
      epoch: 1,
      revision: 3,
      document: { brief: 'expired' },
      expiresAtMs: 1_000,
    });
    await store.saveContext({
      id: 'ctx_live',
      colonyId: 'col_pg_1',
      epoch: 1,
      revision: 3,
      document: { brief: 'live' },
      expiresAtMs: 9_000,
    });
    await store.saveDecision({
      id: 'dec_expired',
      colonyId: 'col_pg_1',
      requestId: 'req_0',
      outcome: 'proposed',
      summary: 'old decision',
      expiresAtMs: 2_000,
    });

    const expired = await store.expire(5_000);
    expect(expired).toEqual({ contexts: 1, decisions: 1 });

    const savedPolicy = await store.readPolicy('col_pg_1');
    expect(savedPolicy?.policy.risk).toBe('risky');
    expect(savedPolicy?.revision).toBe(3);

    const remainingCtx = await db.prisma.directorContextSnapshot.findMany({ where: { colonyId: 'col_pg_1' } });
    expect(remainingCtx.map((r) => r.id)).toEqual(['ctx_live']);
  });
});

describe('W16-12 Postgres proposal outbox & action results', () => {
  it('dedupes duplicate proposal delivery and rejects stale fences and older intent revisions', async () => {
    const first = await store.acceptProposal({
      requestId: 'req_pg_1',
      jobId: 'job_pg_1',
      colonyId: 'col_pg_2',
      fence: 5,
      epoch: 1,
      intentRevision: 2,
      actions: [
        { actionId: 'grow-economy', state: 'applied' },
        { actionId: 'raid-1', state: 'rejected', reason: 'away_raids' },
      ],
    });
    expect(first).toEqual({ ok: true });

    const duplicate = await store.acceptProposal({
      requestId: 'req_pg_1',
      jobId: 'job_pg_1',
      colonyId: 'col_pg_2',
      fence: 5,
      epoch: 1,
      intentRevision: 2,
      actions: [{ actionId: 'extra', state: 'applied' }],
    });
    expect(duplicate).toEqual({ ok: true, duplicate: true });

    const staleFence = await store.acceptProposal({
      requestId: 'req_pg_stale_fence',
      jobId: 'job_pg_2',
      colonyId: 'col_pg_2',
      fence: 4,
      epoch: 1,
      intentRevision: 2,
      actions: [{ actionId: 'a1', state: 'applied' }],
    });
    expect(staleFence).toEqual({ ok: false, outcome: 'superseded' });

    const staleIntent = await store.acceptProposal(
      {
        requestId: 'req_pg_stale_intent',
        jobId: 'job_pg_3',
        colonyId: 'col_pg_2',
        fence: 6,
        epoch: 1,
        intentRevision: 1,
        actions: [{ actionId: 'a2', state: 'applied' }],
      },
      3,
    );
    expect(staleIntent).toEqual({ ok: false, outcome: 'superseded' });

    const actions = await db.prisma.directorActionResult.findMany({
      where: { requestId: 'req_pg_1' },
      orderBy: { actionId: 'asc' },
    });
    expect(actions).toHaveLength(2);
    expect(actions.map((a) => ({ actionId: a.actionId, state: a.state, reason: a.reason }))).toEqual([
      { actionId: 'grow-economy', state: 'applied', reason: null },
      { actionId: 'raid-1', state: 'rejected', reason: 'away_raids' },
    ]);
  });
});

describe('W16-44 Postgres multiworker token budget & kill switch integration', () => {
  it('enforces atomic daily token caps across concurrent workers and reconciles by attemptId without cross-closing', async () => {
    const day = '2026-11-09';
    const [w1, w2, w3] = await Promise.all([
      store.reserveAttemptBudget({
        id: 'att_w1',
        jobId: 'job_w1',
        colonyId: 'col_pg_3',
        model: 'glm-5.3',
        day,
        reservedTokens: 600,
        dailyCap: 1_000,
      }),
      store.reserveAttemptBudget({
        id: 'att_w2',
        jobId: 'job_w2',
        colonyId: 'col_pg_3',
        model: 'glm-5.3',
        day,
        reservedTokens: 600,
        dailyCap: 1_000,
      }),
      store.reserveAttemptBudget({
        id: 'att_w3',
        jobId: 'job_w3',
        colonyId: 'col_pg_3',
        model: 'glm-5.3',
        day,
        reservedTokens: 400,
        dailyCap: 1_000,
      }),
    ]);

    expect([w1, w2].filter((r) => r.ok)).toHaveLength(1);
    expect([w1, w2].filter((r) => !r.ok)).toHaveLength(1);
    expect(w3.ok).toBe(true);

    const winnerId = w1.ok ? 'att_w1' : 'att_w2';
    expect(await store.reconcileAttemptBudget(winnerId, day, { inputTokens: 200, outputTokens: 50 })).toBe(true);
    expect(await store.reconcileAttemptBudget(winnerId, day, { inputTokens: 200, outputTokens: 50 })).toBe(false);
    expect(await store.reconcileAttemptBudget('att_w3', day, null, 'timeout')).toBe(true);

    const budgetRow = await db.prisma.directorBudgetDay.findUniqueOrThrow({ where: { id: `global:${day}` } });
    expect(budgetRow.reservedTokens).toBe(0);
    expect(budgetRow.spentTokens).toBe(650);

    const nextDay = await store.reserveAttemptBudget({
      id: 'att_next_day',
      jobId: 'job_next',
      colonyId: 'col_pg_3',
      model: 'glm-5.3',
      day: '2026-11-10',
      reservedTokens: 1_000,
      dailyCap: 1_000,
    });
    expect(nextDay.ok).toBe(true);
  });

  it('persists scoped and global kill switches in Postgres', async () => {
    expect(await store.isKilled('colony:col_pg_9')).toBe(false);
    await store.setKillSwitch('colony:col_pg_9', true, 'manual stop');
    expect(await store.isKilled('colony:col_pg_9')).toBe(true);
    expect(await store.isKilled('colony:col_pg_10')).toBe(false);

    await store.setKillSwitch('global', true, 'emergency');
    expect(await store.isKilled('colony:col_pg_10')).toBe(true);
  });
});

describe('PlayerAiSettingsStore Postgres persistence (0032_player_nearai_settings)', () => {
  it('persists NEAR.AI API key and model in core.player across store restarts, preserves handle, and resolves planet colonies', async () => {
    const store1 = new PlayerAiSettingsStore(db.prisma);
    const updated = await store1.updateSettings(
      { id: 'pl_nearai_pg_1', handle: 'commander_nova' },
      { apiKey: 'sk-nearai-live-pg-9876', model: 'deepseek/deepseek-v3.2' },
    );
    expect(updated.hasApiKey).toBe(true);
    expect(updated.apiKeyPreview).toBe('sk-n••••9876');
    expect(updated.model).toBe('deepseek/deepseek-v3.2');

    // Verify raw Postgres row in core.player stores encrypted envelope, never plaintext
    const row = await db.prisma.player.findUniqueOrThrow({ where: { id: 'pl_nearai_pg_1' } });
    expect(row.handle).toBe('commander_nova');
    expect(row.nearAiApiKey?.startsWith('enc:v1:1:')).toBe(true);
    expect(row.nearAiApiKey).not.toContain('sk-nearai-live-pg-9876');
    expect(openPlayerApiKey(row.nearAiApiKey)).toBe('sk-nearai-live-pg-9876');
    expect(row.nearAiModel).toBe('deepseek/deepseek-v3.2');

    // Fresh store instance without in-memory state reads from Postgres
    const store2 = new PlayerAiSettingsStore(db.prisma);
    const loaded = await store2.getSettings('pl_nearai_pg_1');
    expect(loaded.hasApiKey).toBe(true);
    expect(loaded.apiKeyPreview).toBe('sk-n••••9876');
    expect(loaded.model).toBe('deepseek/deepseek-v3.2');

    // Resolve planet colony ownership from core.colony in Postgres
    await db.prisma.colony.create({
      data: {
        id: 'col_nearai_pg_0',
        playerId: 'pl_nearai_pg_1',
        planetId: 'planet_nearai_pg',
        colonyIndex: 0,
        name: 'Nova Prime',
      },
    });
    const map = await store2.resolvePlanetPlayerAiConfigs('planet_nearai_pg');
    expect(map[0]).toEqual({
      playerId: 'pl_nearai_pg_1',
      apiKey: 'sk-nearai-live-pg-9876',
      model: 'deepseek/deepseek-v3.2',
    });

    // Clearing key in store2 updates Postgres and invalidates store1's in-memory entry on next DB read
    await store2.updateSettings(
      { id: 'pl_nearai_pg_1', handle: 'commander_nova' },
      { model: 'deepseek/deepseek-v3.2', apiKey: null },
    );
    const afterClear = await store1.getCredentials('pl_nearai_pg_1');
    expect(afterClear.apiKey).toBeNull();
    expect(afterClear.model).toBe('deepseek/deepseek-v3.2');
  });
});
