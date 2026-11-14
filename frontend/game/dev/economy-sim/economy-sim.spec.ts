// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import {
  renderAiBanner,
  renderColonyCards,
  renderContractorReceiptsSection,
  renderDailySeriesTable,
  renderSwarmRoundsSection,
  renderTimeline,
  type EconomySimUiReport,
} from './renderReport';

const SAMPLE: EconomySimUiReport = {
  seed: 'near-hackathon-7d',
  days: 2,
  durationMs: 42,
  generatedAt: '2026-11-11T12:00:00Z',
  colonies: [
    {
      colonyIndex: 0,
      colonyId: 'col_0',
      accountId: 'verdant-collective.terraagent.testnet',
      name: 'Verdant Collective',
      persona: 'eco_terraformer',
      initialStock: { 'metals.t1': 340, 'bio.biomass': 200 },
      finalStock: { 'metals.t1': 360, 'bio.biomass': 254 },
      livingTiles: 3,
      tradesExecuted: 2,
      raidsLaunched: 0,
      trucesSigned: 1,
    },
  ],
  dailySeries: [
    { day: 1, prices: { 'metals.t1': 1.0, 'minerals.t1': 1.22, 'bio.water': 0.91, 'bio.biomass': 1.25 }, totalLivingTiles: 2, tradeVolumeUsdc: 87.5, activeTruces: 0 },
    { day: 2, prices: { 'metals.t1': 1.02, 'minerals.t1': 1.24, 'bio.water': 0.93, 'bio.biomass': 1.24 }, totalLivingTiles: 3, tradeVolumeUsdc: 98.4, activeTruces: 1 },
  ],
  timeline: [
    {
      day: 1,
      kind: 'guild_quote',
      actor: 'NPC Merchant Guild',
      summary: 'Reference board active.',
      guildReason: 'Cold-start anchor (< 3 organic settlements); 8% Guild spread.',
    },
  ],
  guardrails: { cancelTruceBlocked: 1, stakingBlocked: 1, allowanceEnforced: 1 },
  ai: {
    providerModel: 'deepseek-ai/DeepSeek-V3.1',
    summary: 'Swarm economy balanced.',
    attestation: { chatId: 'chat_abc123456789', verified: true },
  },
};

describe('/dev/economy-sim UI renderers', () => {
  it('renders TEE attestation banner, colony cards, 7-day price table, and Guild reason tooltips', () => {
    const banner = renderAiBanner(SAMPLE);
    expect(banner.textContent).toContain('NEAR AI TEE VERIFIED');
    expect(banner.textContent).toContain('AW-13 Oathbreaker Blocked: 1');

    const cards = renderColonyCards(SAMPLE);
    expect(cards.textContent).toContain('Verdant Collective');
    expect(cards.textContent).toContain('200 → 254');

    const table = renderDailySeriesTable(SAMPLE);
    expect(table.querySelectorAll('tbody tr')).toHaveLength(2);

    const timeline = renderTimeline(SAMPLE);
    expect(timeline.textContent).toContain('Cold-start anchor');

    const swarmEl = renderSwarmRoundsSection({
      parentAccount: 'swarm.terraagent.testnet',
      buyerSubAccounts: 20,
      sellerSubAccounts: 5,
      zeroLlmCalls: true,
      rounds: [
        {
          round: 1,
          day: 1,
          resource: 'metals.t1',
          buyerCount: 20,
          sellerCount: 5,
          bidsSubmitted: 20,
          asksSubmitted: 5,
          totalBidUnits: 260,
          totalAskUnits: 190,
          clearingPriceUsdc: 1.02,
          clearedUnits: 165,
          totalNotionalUsdc: 168.3,
          zeroSumVerified: true,
          intentBatchHash: 'nep413:abcd1234',
          topBids: [],
          allocations: [{ buyerAccountId: 'buyer-01.swarm.terraagent.testnet', cohort: 'terraformer', unitsReceived: 12, sharePaidUsdc: 12.24 }],
        },
      ],
    });
    expect(swarmEl.textContent).toContain('20 BUYER + 5 SELLER SUB-ACCOUNTS');
    expect(swarmEl.textContent).toContain('buyer-01: +12u');

    const receiptsEl = renderContractorReceiptsSection({
      contractorAccountId: 'verdant-collective.terraagent.testnet',
      goal: 'Expand Living hexes',
      keyPolicySummary: 'Scoped session key',
      budgetUsdc: 120,
      spentUsdc: 78.95,
      budgetNear: 6,
      spentNear: 4.2,
      withinBudget: true,
      selfExecutedSteps: ['Self-executed hex grading'],
      receipts: [
        {
          taskId: 'task_02',
          day: 4,
          buyerAccountId: 'verdant-collective.terraagent.testnet',
          sellerAccountId: 'iron-guild.terraagent.testnet',
          category: 'buy_commodity',
          whatWasBought: 'nep245:minerals.t1',
          quantity: 35,
          currency: 'USDC',
          settlementRail: 'near_intents_nep413',
          negotiation: {
            decision: 'accepted_counter',
            sellerInitialAsk: 1.36,
            plannedUnitPrice: 1.18,
            walkAwayUnitPrice: 1.28,
            counterUnitPrice: 1.23,
            counterReasoning: 'Countering once',
            finalUnitPrice: 1.25,
            totalCost: 43.75,
          },
          unitPricePaid: 1.25,
          totalPaid: 43.75,
          workPassedCheck: true,
          checkSummary: 'Verified +35 minerals.t1',
          settlementRef: 'nep413:1234abcd',
        },
      ],
    });
    expect(receiptsEl.textContent).toContain('Counter 1.23 -> Settled 1.25 USDC');
    expect(receiptsEl.textContent).toContain('PASS');
  });
});
