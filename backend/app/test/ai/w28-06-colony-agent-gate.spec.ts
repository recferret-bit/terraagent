import { MANAGED_AI_MODEL, SCRIPT_AI_MODEL } from '@terra/contracts';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ColonyAgentLoopService } from '../../src/ai/colony-agent/colony-agent-loop.service.js';
import type { ManagedAiAccess } from '../../src/ai/colony-agent/managed-ai-gate.js';
import type { AppEnv } from '../../src/core/tokens.js';
import type { LlmProviderPort, LlmResponse } from '../../src/ports/llm-provider.port.js';
import { createFakePlanetHarness } from './fake-planet-harness.js';

const gate = vi.hoisted(() => ({ admit: vi.fn() }));
vi.mock('../../src/ai/colony-agent/managed-ai-gate.js', () => ({
  ManagedAiGate: class {
    admit = gate.admit;
  },
}));

const W28_OFF = { NODE_ENV: 'test', TA_WAVES: '..27' } as unknown as AppEnv;
const W28_ON = { NODE_ENV: 'test', TA_WAVES: 'all' } as unknown as AppEnv;

function fakeLlm(): { llm: LlmProviderPort; models: Array<string | undefined>; batches: number[][] } {
  const models: Array<string | undefined> = [];
  const batches: number[][] = [];
  const llm: LlmProviderPort = {
    complete: async (req): Promise<LlmResponse> => {
      const body = JSON.parse(req.messages[0]?.content ?? '{}') as { colonies?: Array<{ colonyIndex: number }>; colonyIndex?: number };
      const indices = body.colonies?.map((c) => c.colonyIndex) ?? (body.colonyIndex === undefined ? [] : [body.colonyIndex]);
      models.push(req.model);
      batches.push(indices);
      return {
        text: JSON.stringify({ directives: indices.map((colonyIndex) => ({ colonyIndex, action: 'hold', rationale: 'managed' })) }),
        usage: { inputTokens: 1, outputTokens: 1 },
        model: req.model ?? MANAGED_AI_MODEL,
      };
    },
  };
  return { llm, models, batches };
}

function setup(env: AppEnv) {
  const h = createFakePlanetHarness();
  h.host.state.colonies[0]!.aiEnabled = true;
  const fake = fakeLlm();
  const svc = new ColonyAgentLoopService(h.planets, fake.llm, undefined, undefined, env);
  const human = (evals: Awaited<ReturnType<typeof svc.tickPlanetAgents>>) => evals.find((e) => e.colonyIndex === 0)!;
  return { svc, fake, human };
}

const trial: ManagedAiAccess = { mode: 'trial', model: MANAGED_AI_MODEL, trialTurnsLeft: 4 };
const tee: ManagedAiAccess = { mode: 'tee', model: MANAGED_AI_MODEL };
const guest: ManagedAiAccess = { mode: 'script', model: SCRIPT_AI_MODEL, reason: 'guest' };

beforeEach(() => gate.admit.mockReset());

describe('W28-06 ColonyAgentLoopService managed-AI gate', () => {
  it('a trial grant runs the managed TEE model and reports mode trial with the turns left', async () => {
    gate.admit.mockResolvedValue(trial);
    const { svc, fake, human } = setup(W28_ON);
    const col0 = human(await svc.tickPlanetAgents('pl_loop', { playerAiByColony: {} }));
    expect(gate.admit).toHaveBeenCalledTimes(1);
    expect(gate.admit).toHaveBeenCalledWith(
      expect.objectContaining({ planetId: 'pl_loop', colonyIndex: 0 }),
      expect.any(Number),
    );
    expect(col0.model).toBe(MANAGED_AI_MODEL);
    expect(col0.aiAccess).toEqual(trial);
    expect(fake.batches.some((b) => b.includes(0))).toBe(true);
  });

  it('a staked-wallet grant reports mode tee', async () => {
    gate.admit.mockResolvedValue(tee);
    const { svc, human } = setup(W28_ON);
    expect(human(await svc.tickPlanetAgents('pl_loop', { playerAiByColony: {} })).aiAccess?.mode).toBe('tee');
  });

  it('a refused grant (guest / budget / slot / trial) downshifts to deterministic-policy with the reason and no LLM call for it', async () => {
    gate.admit.mockResolvedValue(guest);
    const { svc, fake, human } = setup(W28_ON);
    const col0 = human(await svc.tickPlanetAgents('pl_loop', { playerAiByColony: {} }));
    expect(col0.model).toBe(SCRIPT_AI_MODEL);
    expect(col0.aiAccess).toEqual(guest);
    expect(col0.governed).toBe(true);
    expect(fake.batches.every((b) => !b.includes(0))).toBe(true);
  });

  it('BYOK colonies never reach the gate (protocol cost 0) and report mode byok', async () => {
    const { svc, human } = setup(W28_ON);
    const col0 = human(await svc.tickPlanetAgents('pl_loop', { playerAiByColony: { 0: { playerId: 'p', apiKey: 'sk-own', model: 'deepseek-ai/DeepSeek-V3.1' } } }));
    expect(gate.admit).not.toHaveBeenCalled();
    expect(col0.usedPlayerKey).toBe(true);
    expect(col0.aiAccess?.mode).toBe('byok');
  });

  it('a cached decision inside the cooldown does not spend another turn', async () => {
    gate.admit.mockResolvedValue(trial);
    const { svc } = setup(W28_ON);
    await svc.tickPlanetAgents('pl_loop', { playerAiByColony: {}, useCache: true, nowMs: 1_000_000 });
    await svc.tickPlanetAgents('pl_loop', { playerAiByColony: {}, useCache: true, nowMs: 1_010_000 });
    expect(gate.admit).toHaveBeenCalledTimes(1);
  });

  it('bots stay on the server key and are never gated', async () => {
    gate.admit.mockResolvedValue(guest);
    const { svc, fake } = setup(W28_ON);
    const evals = await svc.tickPlanetAgents('pl_loop', { playerAiByColony: {} });
    expect(evals.some((e) => e.isBot && e.model !== SCRIPT_AI_MODEL)).toBe(true);
    expect(fake.batches.length).toBeGreaterThan(0);
  });

  it('W28 off keeps the W20 rule: unstaked stays script without a gate call, a staked colony runs the managed model', async () => {
    const { svc, human } = setup(W28_OFF);
    const unstaked = human(await svc.tickPlanetAgents('pl_loop', { stakedByColony: { 0: false } }));
    expect(unstaked.model).toBe(SCRIPT_AI_MODEL);
    expect(unstaked.aiAccess).toBeUndefined();
    const staked = human(await svc.tickPlanetAgents('pl_loop', { stakedByColony: { 0: true } }));
    expect(staked.model).toBe(MANAGED_AI_MODEL);
    expect(gate.admit).not.toHaveBeenCalled();
  });
});
