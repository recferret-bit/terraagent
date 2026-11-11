import { describe, expect, it } from 'vitest';
import { EconomySimService } from '../../src/ai/economy-sim/economy-sim.service.js';
import { DevEconomySimController, PublicEconomySimController } from '../../src/dev/economy-sim.controller.js';
import type { LlmProviderPort } from '../../src/ports/llm-provider.port.js';

describe('EconomySimService & controllers — 7-day multi-agent fast-forward', () => {
  it('runs a deterministic 7-day multi-agent simulation in < 5s with terraforming, trades, raids, truces & guardrails', async () => {
    const llm: LlmProviderPort = {
      complete: async () => ({
        text: JSON.stringify({ summary: 'Verified 7-day swarm equilibrium with NEAR AI TEE.' }),
        usage: { inputTokens: 80, outputTokens: 20 },
        model: 'deepseek-ai/DeepSeek-V3.1',
        attestation: {
          chatId: 'chat_7d_sim',
          requestHash: '1'.repeat(64),
          responseHash: '2'.repeat(64),
          signingAddress: '0xnearai',
          verified: true,
        },
      }),
    };
    const svc = new EconomySimService(llm);
    const devCtl = new DevEconomySimController(svc);
    const pubCtl = new PublicEconomySimController(svc);

    const report = await devCtl.run({ seed: 'judge-demo-seed', days: 7 });
    expect(report.days).toBe(7);
    expect(report.durationMs).toBeLessThan(5000);
    expect(report.colonies).toHaveLength(3);
    expect(report.dailySeries).toHaveLength(7);
    expect(report.dailySeries[6]!.totalLivingTiles).toBeGreaterThan(0);
    expect(report.timeline.some((e) => e.kind === 'war_raid')).toBe(true);
    expect(report.timeline.some((e) => e.kind === 'peace_truce')).toBe(true);
    expect(report.timeline.some((e) => e.kind === 'trade' && Boolean(e.guildReason))).toBe(true);
    expect(report.guardrails.cancelTruceBlocked).toBeGreaterThanOrEqual(1);
    expect(report.guardrails.stakingBlocked).toBeGreaterThanOrEqual(1);
    expect(report.guardrails.allowanceEnforced).toBeGreaterThanOrEqual(1);
    expect(report.ai.attestation?.verified).toBe(true);
    expect(pubCtl.latest().seed).toBe('judge-demo-seed');
  });

  it('produces identical deterministic trajectories for identical seeds when LLM is disabled', async () => {
    const llm: LlmProviderPort = {
      complete: async () => ({ text: '', usage: { inputTokens: 0, outputTokens: 0 }, model: 'mock' }),
    };
    const svc = new EconomySimService(llm);
    const a = await svc.run({ seed: 'repro-seed-42', days: 5, useLiveLlm: false });
    const b = await svc.run({ seed: 'repro-seed-42', days: 5, useLiveLlm: false });
    expect(a.dailySeries).toEqual(b.dailySeries);
    expect(a.colonies).toEqual(b.colonies);
  });
});
