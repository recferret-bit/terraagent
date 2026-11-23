import { SCRIPT_AI_MODEL, type AgentDecisionFeedItemV1 } from '@terra/contracts';
import { describe, expect, it, vi } from 'vitest';
import { NearAiLlmAdapter, type FetchLike } from '../../src/ai/adapters/nearai-llm.adapter.js';
import { ColonyAgentLoopService } from '../../src/ai/colony-agent/colony-agent-loop.service.js';
import { ManagedAiGate } from '../../src/ai/colony-agent/managed-ai-gate.js';
import { humanConnectedNow, IDLE_PLANET_AFTER_MS, PlanetHumanActivity } from '../../src/ai/colony-agent/planet-activity.js';
import { GuardedLlmProvider } from '../../src/ai/provider/guarded-llm.js';
import { ProviderHealth } from '../../src/ai/provider/provider-health.js';
import type { AppEnv } from '../../src/core/tokens.js';
import { createFakePlanetHarness } from './fake-planet-harness.js';

/** `AI_PROVIDER=nearai` against a fake NEAR AI Cloud (never the real API). */
const ENV = {
  NODE_ENV: 'test',
  TA_WAVES: '..27',
  AI_PROVIDER: 'nearai',
  AI_LIVE: '1',
  NEAR_AI_API_KEY: 'protocol-key',
  NEAR_AI_ATTEST: '0',
  NEAR_AI_STRICT_CRYPTO_VERIFY: '1',
} as unknown as AppEnv;
const NO_CREDITS = JSON.stringify({ error: { message: 'No credits available.', type: 'no_credits' } });

function directivesFor(body: string): string {
  const req = JSON.parse(body) as { messages: Array<{ content: string }> };
  const colonies = (JSON.parse(req.messages.at(-1)!.content) as { colonies?: Array<{ colonyIndex: number }> }).colonies ?? [];
  return JSON.stringify({ directives: colonies.map((c) => ({ colonyIndex: c.colonyIndex, action: 'hold', rationale: 'llm' })) });
}

function setup(statusByKey: Record<string, number>) {
  const calls: Record<string, number> = {};
  const fetchImpl: FetchLike = async (_url, init) => {
    const key = String((init?.headers as Record<string, string>).Authorization).replace('Bearer ', '');
    calls[key] = (calls[key] ?? 0) + 1;
    if ((statusByKey[key] ?? 200) === 402) return new Response(NO_CREDITS, { status: 402 });
    const content = directivesFor(String(init?.body));
    return new Response(JSON.stringify({ id: '', model: 'z-ai/glm-5.3-flash', choices: [{ message: { content } }], usage: { prompt_tokens: 1, completion_tokens: 1 } }));
  };
  const health = new ProviderHealth({ failuresToOpen: 5, openMs: 60_000 });
  const llm = new GuardedLlmProvider(new NearAiLlmAdapter(fetchImpl, ENV), health);
  const h = createFakePlanetHarness();
  h.host.state.colonies[0]!.playerId = 'pl_human'; // a seated player's colony, as `system.spawnColony` lands it
  const svc = new ColonyAgentLoopService(h.planets, llm, undefined, undefined, ENV);
  const feed: Array<Omit<AgentDecisionFeedItemV1, 'id'>> = [];
  svc.setDecisionRecorder((d) => feed.push(d));
  const total = (): number => Object.values(calls).reduce((a, b) => a + b, 0);
  return { ...h, svc, calls, health, feed, total };
}

const awayHuman = (h: ReturnType<typeof createFakePlanetHarness>) => {
  h.host.submit({ colonyIndex: 0, source: 'system', commandId: 'away_0', kind: 'system.presence', args: { colonyId: 'col_0', away: true } });
  h.host.step(1);
};

describe('NEAR AI zero balance: colonies keep playing on rules', () => {
  it('protocol key 402: one HTTP call, then rules-only decisions are still applied (commands submitted)', async () => {
    const s = setup({ 'protocol-key': 402 });
    const applied: string[] = [];
    for (let i = 0; i < 3; i++) {
      const bots = (await s.svc.tickPlanetAgents('pl_loop')).filter((e) => e.isBot);
      expect(bots).toHaveLength(2);
      for (const b of bots) {
        expect(b.governed).toBe(true);
        expect(b.model).toBe(SCRIPT_AI_MODEL);
        expect(b.aiAccess).toMatchObject({ mode: 'script', reason: 'provider_unfunded' });
        expect(b.guardrailRejected).toBeUndefined(); // no attestation is not a TEE rejection, even in strict mode
        if (b.commandOutcome?.ok) applied.push(b.submittedCommand!.kind);
      }
    }
    expect(s.calls['protocol-key']).toBe(1);
    expect(applied).toContain('queueGoal');
    expect(s.submitted.some((c) => c.colonyIndex === 5 && c.kind === 'queueGoal')).toBe(true);
    const botFeed = s.feed.filter((f) => f.isBot);
    expect(botFeed).toHaveLength(6);
    expect(botFeed.every((f) => (f.payload as Record<string, unknown>).downshiftReason === 'provider_unfunded')).toBe(true);
    expect(botFeed.some((f) => f.outcome === 'applied')).toBe(true);
  });

  it('a drained BYOK key falls back for that player only and the card says so', async () => {
    const s = setup({ 'sk-drained': 402 });
    s.host.state.colonies[0]!.aiEnabled = true;
    const evals = await s.svc.tickPlanetAgents('pl_loop', { playerAiByColony: { 0: { playerId: 'p0', apiKey: 'sk-drained' } } });
    const human = evals.find((e) => e.colonyIndex === 0)!;
    expect(human.model).toBe(SCRIPT_AI_MODEL);
    expect(human.aiAccess).toMatchObject({ mode: 'byok', reason: 'provider_unfunded' });
    expect(human.submittedCommand).toBeDefined();
    expect(evals.filter((e) => e.isBot).every((e) => e.model === 'z-ai/glm-5.3-flash')).toBe(true);
    expect(s.calls).toEqual({ 'protocol-key': 1, 'sk-drained': 1 });

    const gate = new ManagedAiGate(undefined, ENV, undefined, undefined, s.health);
    expect(await gate.view({ id: 'col_0' }, { byok: true, byokKey: 'sk-drained' })).toMatchObject({ mode: 'byok', downshiftReason: 'provider_unfunded' });
    expect((await gate.view({ id: 'col_0' }, { byok: true, byokKey: 'sk-fine' })).downshiftReason).toBeUndefined();
    expect((await gate.view({ id: 'col_0' })).downshiftReason).toBeUndefined();
  });

  it('the AI access card shows the protocol provider reason while its circuit is open', async () => {
    const s = setup({ 'protocol-key': 402 });
    await s.svc.tickPlanetAgents('pl_loop');
    const gate = new ManagedAiGate(undefined, ENV, undefined, undefined, s.health);
    expect(await gate.view({ id: 'col_0' })).toMatchObject({ mode: 'script', model: SCRIPT_AI_MODEL, downshiftReason: 'provider_unfunded' });
    // a BYOK colony is not told "your key has no balance" because the protocol key is out
    expect((await gate.view({ id: 'col_0' }, { byok: true })).downshiftReason).toBeUndefined();
  });
});

describe('idle planets sweep on rules only', () => {
  it('no human for 24 h: zero LLM calls, rules still applied', async () => {
    const s = setup({});
    awayHuman(s);
    s.svc.setPlanetActivity({ recentlyActive: () => false });
    const evals = await s.svc.sweepPlanet('pl_loop');
    expect(s.total()).toBe(0);
    expect(evals.filter((e) => e.governed).every((e) => e.aiAccess?.reason === 'planet_idle' && e.model === SCRIPT_AI_MODEL)).toBe(true);
    expect(s.submitted.length).toBeGreaterThan(0);
  });

  it('default activity source (no injection, no database): a planet whose only human is away sweeps with zero LLM calls', async () => {
    const s = setup({});
    awayHuman(s);
    const evals = await s.svc.sweepPlanet('pl_loop');
    expect(s.total()).toBe(0);
    expect(evals.filter((e) => e.isBot).every((e) => e.aiAccess?.reason === 'planet_idle')).toBe(true);
  });

  it('humanConnectedNow: seated players only; this process holding the socket beats a stale away flag', () => {
    const h = createFakePlanetHarness();
    const none = { isConnected: () => false };
    expect(humanConnectedNow(h.host.state, none)).toBe(false); // col_0 has no player yet; Rival AIs and empty slots never count
    h.host.state.colonies[0]!.playerId = 'pl_human';
    expect(humanConnectedNow(h.host.state, none)).toBe(true);
    awayHuman(h);
    expect(humanConnectedNow(h.host.state, none)).toBe(false);
    expect(humanConnectedNow(h.host.state, { isConnected: (id) => id === 'col_0' })).toBe(true);
    h.host.state.colonies[0]!.status = 'eliminated';
    expect(humanConnectedNow(h.host.state, { isConnected: () => true })).toBe(false);
  });

  it('a human seen in the window keeps LLM decisions', async () => {
    const s = setup({});
    awayHuman(s);
    s.svc.setPlanetActivity({ recentlyActive: () => true });
    await s.svc.sweepPlanet('pl_loop');
    expect(s.total()).toBeGreaterThan(0);
  });

  it('a human connected right now overrides a stale idle answer and is remembered', async () => {
    const s = setup({});
    const noteHumanPresent = vi.fn();
    s.svc.setPlanetActivity({ recentlyActive: () => false, noteHumanPresent });
    await s.svc.sweepPlanet('pl_loop'); // col_0 is online on manual control
    expect(s.total()).toBeGreaterThan(0);
    expect(noteHumanPresent).toHaveBeenCalledWith('pl_loop', expect.any(Number));
  });

  it('direct tickPlanetAgents (dev tools) is not idle-gated', async () => {
    const s = setup({});
    awayHuman(s);
    s.svc.setPlanetActivity({ recentlyActive: () => false });
    await s.svc.tickPlanetAgents('pl_loop');
    expect(s.total()).toBeGreaterThan(0);
  });

  it('PlanetHumanActivity: memory window, then the colony last_seen_at row', async () => {
    const mem = new PlanetHumanActivity();
    expect(await mem.recentlyActive('pl', 0)).toBe(false);
    mem.noteHumanPresent('pl', 1_000);
    expect(await mem.recentlyActive('pl', 1_000 + IDLE_PLANET_AFTER_MS - 1)).toBe(true);
    expect(await mem.recentlyActive('pl', 1_000 + IDLE_PLANET_AFTER_MS)).toBe(false);

    const findFirst = vi.fn(async (q: { where: { lastSeenAt: { gte: Date } } }) => (q.where.lastSeenAt.gte.getTime() <= 50 ? { lastSeenAt: new Date(50) } : null));
    const db = new PlanetHumanActivity({ colony: { findFirst } } as never, { DATABASE_URL: 'x', NODE_ENV: 'test' } as never);
    expect(await db.recentlyActive('pl', IDLE_PLANET_AFTER_MS)).toBe(true);
    expect(await db.recentlyActive('pl2', IDLE_PLANET_AFTER_MS + 100)).toBe(false);
    expect(findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ planetId: 'pl' }) }));
  });
});
