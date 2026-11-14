import { describe, expect, it } from 'vitest';
import { executeContractorTaskPlan, negotiateAgentQuote } from '../../src/ai/colony-agent/agent-commerce.js';
import { EconomySimService } from '../../src/ai/economy-sim/economy-sim.service.js';
import { runScriptedSwarmRounds } from '../../src/ai/economy-sim/swarm-rounds.js';
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
    expect(report.colonies.every((c) => c.accountId.endsWith('.terraagent.testnet'))).toBe(true);
    expect(report.swarm.buyerSubAccounts).toBe(20);
    expect(report.swarm.sellerSubAccounts).toBe(5);
    expect(report.swarm.zeroLlmCalls).toBe(true);
    expect(report.swarm.rounds).toHaveLength(7);
    expect(report.swarm.rounds.every((r) => r.zeroSumVerified && r.clearedUnits > 0)).toBe(true);
    expect(report.agentCommerce.withinBudget).toBe(true);
    expect(report.agentCommerce.receipts).toHaveLength(4);
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
    expect(a.swarm).toEqual(b.swarm);
    expect(a.agentCommerce).toEqual(b.agentCommerce);
  });
});

describe('Track 05 Swarms & Track 07 Agent Commerce modules', () => {
  it('enforces 1-round agent negotiation (accept initial, counter once & accept, or walk away above cap) within budget', () => {
    const initial = negotiateAgentQuote({
      itemOrService: 'bio.water',
      quantity: 20,
      currency: 'USDC',
      plannedUnitPrice: 0.95,
      walkAwayUnitPrice: 1.05,
      sellerInitialAsk: 0.9,
      sellerFloorPrice: 0.88,
      remainingBudget: 50,
      benchmarkNote: 'VWAP 0.90',
    });
    expect(initial.decision).toBe('accepted_initial');
    expect(initial.counterUnitPrice).toBeNull();
    expect(initial.totalCost).toBe(18);

    const countered = negotiateAgentQuote({
      itemOrService: 'minerals.t1',
      quantity: 10,
      currency: 'USDC',
      plannedUnitPrice: 1.1,
      walkAwayUnitPrice: 1.25,
      sellerInitialAsk: 1.35,
      sellerFloorPrice: 1.2,
      remainingBudget: 50,
      benchmarkNote: 'VWAP 1.15',
    });
    expect(countered.decision).toBe('accepted_counter');
    expect(countered.counterUnitPrice).not.toBeNull();
    expect(countered.counterReasoning).toContain('countering once');
    expect(countered.finalUnitPrice).toBe(1.2);

    const walked = negotiateAgentQuote({
      itemOrService: 'alloys.t2',
      quantity: 10,
      currency: 'NEAR',
      plannedUnitPrice: 2.0,
      walkAwayUnitPrice: 2.4,
      sellerInitialAsk: 3.2,
      sellerFloorPrice: 2.9,
      remainingBudget: 50,
      benchmarkNote: 'Smelter cost 2.05',
    });
    expect(walked.decision).toBe('walked_away');
    expect(walked.totalCost).toBe(0);

    const plan = executeContractorTaskPlan('track-07-seed');
    expect(plan.withinBudget).toBe(true);
    expect(plan.spentUsdc).toBeLessThanOrEqual(plan.budgetUsdc);
    expect(plan.spentNear).toBeLessThanOrEqual(plan.budgetNear);
    expect(plan.receipts.map((r) => r.negotiation.decision)).toEqual([
      'accepted_initial',
      'accepted_counter',
      'accepted_counter',
      'walked_away',
    ]);
  });

  it('clears 20 scripted buyer sub-accounts against 5 seller sub-accounts with zero-sum conservation', () => {
    const swarm = runScriptedSwarmRounds('track-05-seed', 4);
    expect(swarm.rounds).toHaveLength(4);
    for (const r of swarm.rounds) {
      expect(r.bidsSubmitted).toBe(20);
      expect(r.asksSubmitted).toBe(5);
      expect(r.zeroSumVerified).toBe(true);
      const allocatedSum = r.allocations.reduce((s, a) => s + a.unitsReceived, 0);
      expect(allocatedSum).toBe(r.clearedUnits);
      expect(r.allocations[0]?.buyerAccountId).toMatch(/^buyer-\d{2}\.swarm\.terraagent\.testnet$/);
    }
  });
});
