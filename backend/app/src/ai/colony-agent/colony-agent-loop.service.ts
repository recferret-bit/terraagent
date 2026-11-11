import { Inject, Injectable, Optional } from '@nestjs/common';
import { newId, type MarketTokenKey, type TradeAllowance } from '@terra/contracts';
import type { PrismaClient } from '@terra/db';
import { restore, shouldAiGovernColony } from '@terra/sim';
import { databaseEnabled } from '../../core/persistence.js';
import { APP_ENV, type AppEnv } from '../../core/tokens.js';
import { PRISMA } from '../../db/db.module.js';
import { AwayDigestService } from '../../game/digest/index.js';
import { GamePlanets } from '../../game/game-planets.service.js';
import { ensureMockSigners, ensureVerifierBalance } from '../../market/guild/offers/signers.js';
import { resolveMarketAccountId } from '../../market/orders/colony-account.js';
import type { AllowanceUsage } from '../../market/trade/allowance.js';
import { LlmProviderPort } from '../../ports/llm-provider.port.js';
import {
  AgentDirectiveSchema,
  buildSimCommandFromDirective,
  DEFAULT_AGENT_ALLOWANCE,
  deterministicDirective,
  observeColony,
  validateAgentGuardrails,
  type AgentDirective,
  type ColonyAgentEvalResult,
  type ColonyObservation,
} from './colony-agent-types.js';

const SYSTEM_PROMPT = [
  'You are a TerraAgent autonomous colony AI governor on a live planet.',
  'Reply with strict JSON matching AgentDirectiveSchema: { action, goal?, targetColonyIndex?, offerId?, accept?, durationHours?, tradePair?, tradeAmount?, tradeNotionalAtomic?, rationale }.',
  'Hard guardrails: NEVER output cancel_truce (Oathbreaker is human-only) and NEVER output stake.',
].join(' ');

export interface TickPlanetAgentsOptions {
  readonly allowanceByColony?: Record<number, TradeAllowance>;
  readonly usageByColony?: Record<number, AllowanceUsage>;
}

export const COLONY_AGENT_LOOP_MS = 45_000;

@Injectable()
export class ColonyAgentLoopService {
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly planets: GamePlanets,
    @Inject(LlmProviderPort) private readonly llm: LlmProviderPort,
    @Optional() private readonly digests?: AwayDigestService,
    @Optional() @Inject(PRISMA) private readonly prisma?: PrismaClient,
    @Optional() @Inject(APP_ENV) private readonly env?: AppEnv,
  ) {}

  start(intervalMs = COLONY_AGENT_LOOP_MS): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      void this.sweepLoadedPlanets();
    }, intervalMs);
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async sweepLoadedPlanets(): Promise<void> {
    for (const planetId of this.planets.loadedIds()) {
      try {
        await this.tickPlanetAgents(planetId);
      } catch {
        // Non-fatal background agent sweep error
      }
    }
  }

  /** Seeds 2 Stage-4 unshielded Rival AI Colonies (`Iron Guild Outpost` + `Crimson Vanguard`) on `planetId`. */
  async seedRivalsOnPlanet(planetId: string, count: 1 | 2 = 2): Promise<{ ok: boolean; planetId: string; appliedAtTick?: number; code?: string }> {
    const out = await this.planets.submit(planetId, {
      colonyIndex: 0,
      source: 'system',
      commandId: newId('cm'),
      kind: 'system.seedRivalAi',
      args: { count },
    });
    return out.ok
      ? { ok: true, planetId, appliedAtTick: out.appliedAtTick }
      : { ok: false, planetId, code: out.code };
  }

  /** Evaluates one LLM / policy decision turn across every colony on `planetId`, respecting human manual control and all 3 Track 07 guardrails. */
  async tickPlanetAgents(planetId: string, opts: TickPlanetAgentsOptions = {}): Promise<ColonyAgentEvalResult[]> {
    const snap = await this.planets.fullState(planetId);
    const state = restore(snap.bytes);
    const results: ColonyAgentEvalResult[] = [];

    for (const col of state.colonies) {
      if (!col || col.status === 'eliminated') continue;
      if (!shouldAiGovernColony(state, col.index)) {
        results.push({
          colonyIndex: col.index,
          colonyId: col.id,
          governed: false,
          reason: 'manual_human_control',
        });
        continue;
      }
      const obs = observeColony(state, col.index);
      const { directive, model, attestation } = await this.askDirective(obs);
      const allowance = opts.allowanceByColony?.[col.index] ?? DEFAULT_AGENT_ALLOWANCE;
      const usage = opts.usageByColony?.[col.index] ?? { outstandingOrders: 0, committedToday: 0n, reference: null };
      const guardrailRejected = validateAgentGuardrails(directive, obs, allowance, usage);

      if (guardrailRejected) {
        results.push({
          colonyIndex: col.index,
          colonyId: col.id,
          governed: true,
          directive,
          guardrailRejected,
          model,
          attestation,
        });
        continue;
      }

      const cmd = buildSimCommandFromDirective(obs, directive);
      let commandOutcome: { ok: boolean; code?: string } | undefined;
      if (cmd) {
        if (directive.action === 'trade') {
          await this.ensureTradeAccountFunded(planetId, col, directive);
        }
        const out = await this.planets.submit(planetId, cmd);
        commandOutcome = out.ok ? { ok: true } : { ok: false, code: out.code };
      }
      if (obs.away && this.digests && directive.action !== 'hold') {
        await this.digests.noteHighlight(col.id, new Date(), `AI Governor: ${directive.rationale}`);
      }
      results.push({
        colonyIndex: col.index,
        colonyId: col.id,
        governed: true,
        directive,
        submittedCommand: cmd ?? undefined,
        commandOutcome,
        model,
        attestation,
      });
    }
    return results;
  }

  private async ensureTradeAccountFunded(
    planetId: string,
    col: { id: string; index: number; playerId?: string },
    directive: AgentDirective,
  ): Promise<void> {
    if (!this.prisma || !this.env || !databaseEnabled(this.env)) return;
    const [baseRes = 'metals.t1'] = (directive.tradePair ?? 'metals.t1/minerals.t1').split('/');
    const amount = BigInt(directive.tradeAmount ?? 25);
    const accountId = await resolveMarketAccountId(this.prisma, col.id, col.playerId ?? null, planetId, col.index);
    await ensureMockSigners(this.env, this.prisma, [accountId]);
    await ensureVerifierBalance(this.prisma, accountId, baseRes as MarketTokenKey, amount * 2n);
  }

  private async askDirective(obs: ColonyObservation): Promise<{
    directive: AgentDirective;
    model?: string;
    attestation?: ColonyAgentEvalResult['attestation'];
  }> {
    try {
      const res = await this.llm.complete({
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: JSON.stringify(obs) }],
        maxTokens: 220,
        temperature: 0.2,
        json: true,
      });
      const parsed = parseDirectiveJson(res.text);
      return {
        directive: parsed ?? deterministicDirective(obs),
        model: res.model,
        attestation: res.attestation,
      };
    } catch {
      return { directive: deterministicDirective(obs) };
    }
  }
}

function parseDirectiveJson(raw: string): AgentDirective | null {
  try {
    const obj = JSON.parse(raw) as unknown;
    const res = AgentDirectiveSchema.safeParse(obj);
    return res.success ? res.data : null;
  } catch {
    return null;
  }
}
