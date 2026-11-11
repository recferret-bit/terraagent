// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import {
  renderAiBanner,
  renderColonyCards,
  renderDailySeriesTable,
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
  });
});
