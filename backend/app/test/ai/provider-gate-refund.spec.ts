import { MANAGED_AI_MODEL, SCRIPT_AI_MODEL } from '@terra/contracts';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ColonyAgentLoopService } from '../../src/ai/colony-agent/colony-agent-loop.service.js';
import type { ManagedAiAccess } from '../../src/ai/colony-agent/managed-ai-gate.js';
import type { AppEnv } from '../../src/core/tokens.js';
import { LlmProviderError, type LlmProviderPort } from '../../src/ports/llm-provider.port.js';
import { createFakePlanetHarness } from './fake-planet-harness.js';

const gate = vi.hoisted(() => ({ admit: vi.fn(), cooldownMsOf: vi.fn(), refund: vi.fn() }));
vi.mock('../../src/ai/colony-agent/managed-ai-gate.js', () => ({
  ManagedAiGate: class {
    admit = gate.admit;
    cooldownMsOf = gate.cooldownMsOf;
    refund = gate.refund;
  },
}));

const W28_ON = { NODE_ENV: 'test', TA_WAVES: 'all' } as unknown as AppEnv;
const tee: ManagedAiAccess = { mode: 'tee', model: MANAGED_AI_MODEL };

function setup(fail: LlmProviderError | null) {
  const h = createFakePlanetHarness();
  h.host.state.colonies[0]!.aiEnabled = true;
  const llm: LlmProviderPort = {
    complete: vi.fn(async () => {
      if (fail) throw fail;
      return { text: JSON.stringify({ action: 'hold', rationale: 'ok' }), usage: { inputTokens: 1, outputTokens: 1 }, model: MANAGED_AI_MODEL };
    }),
  };
  const svc = new ColonyAgentLoopService(h.planets, llm, undefined, undefined, W28_ON);
  return { svc, llm };
}

beforeEach(() => {
  gate.admit.mockReset();
  gate.refund.mockReset();
  gate.refund.mockResolvedValue(true);
  gate.admit.mockResolvedValue(tee);
});

describe('managed turn charge vs provider failure', () => {
  it('a failed provider call refunds the managed turn and downshifts with the provider reason', async () => {
    const { svc } = setup(new LlmProviderError('unfunded', 'NEAR AI Cloud HTTP 402', 402));
    const col0 = (await svc.tickPlanetAgents('pl_loop', { playerAiByColony: {} })).find((e) => e.colonyIndex === 0)!;
    expect(gate.refund).toHaveBeenCalledTimes(1);
    expect(gate.refund).toHaveBeenCalledWith(tee);
    expect(col0.model).toBe(SCRIPT_AI_MODEL);
    expect(col0.aiAccess).toMatchObject({ mode: 'script', reason: 'provider_unfunded' });
  });

  it('a timeout is provider_unavailable and is refunded too', async () => {
    const { svc } = setup(new LlmProviderError('timeout', 'timed out'));
    const col0 = (await svc.tickPlanetAgents('pl_loop', { playerAiByColony: {} })).find((e) => e.colonyIndex === 0)!;
    expect(gate.refund).toHaveBeenCalledTimes(1);
    expect(col0.aiAccess?.reason).toBe('provider_unavailable');
  });

  it('a successful call keeps the charge', async () => {
    const { svc } = setup(null);
    const col0 = (await svc.tickPlanetAgents('pl_loop', { playerAiByColony: {} })).find((e) => e.colonyIndex === 0)!;
    expect(gate.refund).not.toHaveBeenCalled();
    expect(col0.aiAccess).toEqual(tee);
  });

  it('a gate refusal for an open circuit makes no LLM call for that colony', async () => {
    gate.admit.mockResolvedValue({ mode: 'script', model: SCRIPT_AI_MODEL, reason: 'provider_unfunded' });
    const { svc, llm } = setup(null);
    const col0 = (await svc.tickPlanetAgents('pl_loop', { playerAiByColony: {} })).find((e) => e.colonyIndex === 0)!;
    expect(col0.aiAccess?.reason).toBe('provider_unfunded');
    const asked = vi.mocked(llm.complete).mock.calls.map(([req]) => req.messages[0]!.content);
    expect(asked.every((c) => !c.includes('"colonyIndex":0'))).toBe(true);
    expect(gate.refund).not.toHaveBeenCalled();
  });

  it('a gate that cannot be read (database blip) drops that colony to rules and the sweep still finishes', async () => {
    gate.admit.mockRejectedValue(new Error('P1001: database unreachable'));
    const { svc } = setup(null);
    const results = await svc.tickPlanetAgents('pl_loop', { playerAiByColony: {} });
    const col0 = results.find((e) => e.colonyIndex === 0)!;
    expect(col0.model).toBe(SCRIPT_AI_MODEL);
    expect(col0.aiAccess).toMatchObject({ mode: 'script', reason: 'no_database' });
    expect(gate.refund).not.toHaveBeenCalled();
  });

  it('a refund whose write fails is retried once and never aborts the sweep', async () => {
    gate.refund.mockRejectedValueOnce(new Error('P1001')).mockResolvedValueOnce(true);
    const { svc } = setup(new LlmProviderError('unfunded', 'NEAR AI Cloud HTTP 402', 402));
    const col0 = (await svc.tickPlanetAgents('pl_loop', { playerAiByColony: {} })).find((e) => e.colonyIndex === 0)!;
    expect(gate.refund).toHaveBeenCalledTimes(2);
    expect(col0.aiAccess?.reason).toBe('provider_unfunded');
    gate.refund.mockReset();
    gate.refund.mockRejectedValue(new Error('P1001'));
    const again = setup(new LlmProviderError('unfunded', 'NEAR AI Cloud HTTP 402', 402));
    await expect(again.svc.tickPlanetAgents('pl_loop', { playerAiByColony: {} })).resolves.toBeTruthy();
    expect(gate.refund).toHaveBeenCalledTimes(2);
  });
});
