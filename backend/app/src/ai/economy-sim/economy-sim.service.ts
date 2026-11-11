import { Inject, Injectable } from '@nestjs/common';
import { LlmProviderPort } from '../../ports/llm-provider.port.js';
import { runDeterministic7DaySim, type EconomySimReport } from './economy-sim-runner.js';

export interface RunEconomySimInput {
  readonly seed?: string;
  readonly days?: number;
  readonly useLiveLlm?: boolean;
}

@Injectable()
export class EconomySimService {
  private latest: EconomySimReport | null = null;

  constructor(@Inject(LlmProviderPort) private readonly llm: LlmProviderPort) {}

  getLatest(): EconomySimReport {
    if (this.latest) return this.latest;
    const base = runDeterministic7DaySim('near-hackathon-7d', 7);
    const report: EconomySimReport = {
      ...base,
      durationMs: 0,
      ai: {
        providerModel: 'deterministic-preview',
        summary: buildFallbackSummary(base),
      },
    };
    this.latest = report;
    return report;
  }

  async run(input: RunEconomySimInput = {}): Promise<EconomySimReport> {
    const t0 = Date.now();
    const seed = (input.seed?.trim() || 'near-hackathon-7d').slice(0, 64);
    const days = input.days ?? 7;
    const base = runDeterministic7DaySim(seed, days);

    let providerModel = 'deterministic-policy';
    let summary = buildFallbackSummary(base);
    let attestation: EconomySimReport['ai']['attestation'];

    if (input.useLiveLlm !== false) {
      try {
        const res = await this.llm.complete({
          system: 'Summarize this 7-day TerraAgent multi-agent economy, terraforming, war & peace simulation in 2 crisp sentences. Plain text or JSON { "summary": "..." }.',
          messages: [
            {
              role: 'user',
              content: JSON.stringify({
                seed: base.seed,
                days: base.days,
                colonies: base.colonies.map((c) => ({
                  name: c.name,
                  persona: c.persona,
                  livingTiles: c.livingTiles,
                  trades: c.tradesExecuted,
                  raids: c.raidsLaunched,
                  truces: c.trucesSigned,
                })),
                finalDay: base.dailySeries[base.dailySeries.length - 1],
                guardrails: base.guardrails,
              }),
            },
          ],
          maxTokens: 160,
          temperature: 0.2,
        });
        providerModel = res.model;
        attestation = res.attestation;
        const extracted = extractSummaryText(res.text);
        if (extracted) summary = extracted;
      } catch {
        // Preserve deterministic summary on provider failure
      }
    }

    const report: EconomySimReport = {
      ...base,
      durationMs: Math.max(1, Date.now() - t0),
      ai: {
        providerModel,
        summary,
        ...(attestation ? { attestation } : {}),
      },
    };
    this.latest = report;
    return report;
  }
}

function buildFallbackSummary(base: Omit<EconomySimReport, 'durationMs' | 'ai'>): string {
  const last = base.dailySeries[base.dailySeries.length - 1];
  const totalTrades = base.colonies.reduce((s, c) => s + c.tradesExecuted, 0);
  return `Across ${base.days} simulated planetary days, 3 autonomous colonies cultivated ${last?.totalLivingTiles ?? 0} Living hexes, settled ${totalTrades} market legs, weathered Crimson Vanguard depot raids (Metals peaked during conflict), and stabilized prices via bilateral peace truces while enforcing AW-13, D-18, and trade-cap guardrails.`;
}

function extractSummaryText(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith('{')) {
    try {
      const parsed = JSON.parse(trimmed) as { summary?: unknown; rationale?: unknown };
      if (typeof parsed.summary === 'string' && parsed.summary.trim()) return parsed.summary.trim();
      if (typeof parsed.rationale === 'string' && parsed.rationale.trim()) return parsed.rationale.trim();
    } catch {
      // Fall through to raw text
    }
  }
  return trimmed.slice(0, 420);
}
