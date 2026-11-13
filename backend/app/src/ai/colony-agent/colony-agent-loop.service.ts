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
import type { LlmAttestation } from '../../ports/llm-provider.port.js';
import { LlmProviderPort } from '../../ports/llm-provider.port.js';
import { PlayerAiSettingsStore } from '../../profile/player-ai-settings.store.js';
import { resolvePlanetStakedColonies } from '../../near/staking/staker-perks.js';
import { DEFAULT_NEAR_AI_MODEL, normalizeNearAiModel } from '../nearai-models.js';
import {
  buildSimCommandFromDirective,
  DEFAULT_AGENT_ALLOWANCE,
  deterministicDirective,
  observationDigest,
  observeColony,
  parseBatchedDirectivesJson,
  parseDirectiveJson,
  validateAgentGuardrails,
  type AgentDirective,
  type ColonyAgentEvalResult,
  type ColonyObservation,
} from './colony-agent-types.js';

const BATCH_SYSTEM_PROMPT = [
  'You are the TerraAgent NEAR.AI Decision Manager (z-ai/glm-5.3-flash) governing autonomous colonies.',
  'Given { colonies: ColonyObservation[] }, reply with strict JSON: { "directives": [ { "colonyIndex": number, "action": "queue_goal"|"propose_truce"|"respond_truce"|"declare_war"|"raid"|"trade"|"accept_guild_offer"|"hold", "goal"?: "grow_economy"|"secure_power"|"defend_colony"|"terraform_zone"|"raid_target", "targetColonyIndex"?: number, "offerId"?: string, "accept"?: boolean, "durationHours"?: 6|12|24, "tradeSide"?: "buy"|"sell", "tradePair"?: string, "tradeAmount"?: number, "tradeNotionalAtomic"?: string, "rationale": string (<=160 chars) } ] }.',
  'Optimize economy, power grid, Living terraforming, NEAR Intents trading (allowedPairs: metals.t1/minerals.t1, metals.t1/bio.water, bio.water/minerals.t1, bio.biomass/minerals.t1, metals.t1/USDC, minerals.t1/USDC, bio.water/USDC, bio.biomass/USDC), war raids against unshielded rivals, and peace truces.',
  'Hard guardrails: NEVER output cancel_truce (Oathbreaker is human-only) and NEVER output stake.',
].join(' ');

export interface PlayerColonyAiOverride {
  readonly playerId?: string;
  readonly apiKey?: string | null;
  readonly model?: string;
}

export interface TickPlanetAgentsOptions {
  readonly allowanceByColony?: Record<number, TradeAllowance>;
  readonly usageByColony?: Record<number, AllowanceUsage>;
  readonly playerAiByColony?: Record<number, PlayerColonyAiOverride>;
  readonly stakedByColony?: Record<number, boolean>;
  readonly useCache?: boolean;
  readonly nowMs?: number;
}

interface ResolvedDecision {
  readonly directive: AgentDirective;
  readonly model?: string;
  readonly attestation?: LlmAttestation;
  readonly usedPlayerKey?: boolean;
  readonly cached?: boolean;
}

interface CachedColonyDecision {
  readonly digest: string;
  readonly atMs: number;
  readonly decision: ResolvedDecision;
}

/** Background sweep interval: 3 minutes so NEAR.AI is called infrequently and in batches. */
export const COLONY_AGENT_LOOP_MS = 180_000;
/** Minimum cooldown before re-querying NEAR.AI for an unchanged colony state during background sweeps. */
export const COLONY_DECISION_COOLDOWN_MS = 120_000;

@Injectable()
export class ColonyAgentLoopService {
  private timer: ReturnType<typeof setInterval> | null = null;
  private readonly decisionCache = new Map<string, CachedColonyDecision>();

  constructor(
    private readonly planets: GamePlanets,
    @Inject(LlmProviderPort) private readonly llm: LlmProviderPort,
    @Optional() private readonly digests?: AwayDigestService,
    @Optional() @Inject(PRISMA) private readonly prisma?: PrismaClient,
    @Optional() @Inject(APP_ENV) private readonly env?: AppEnv,
    @Optional() private readonly playerAiStore?: PlayerAiSettingsStore,
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

  clearCache(): void {
    this.decisionCache.clear();
  }

  async sweepLoadedPlanets(): Promise<void> {
    for (const planetId of this.planets.loadedIds()) {
      try {
        await this.tickPlanetAgents(planetId, { useCache: true });
      } catch {
        // Non-fatal background agent sweep error
      }
    }
  }

  /** Seeds 2 Stage-4 unshielded Rival AI Colonies (`Iron Guild Outpost` + `Crimson Vanguard`) on `planetId`. */
  async seedRivalsOnPlanet(
    planetId: string,
    count: 1 | 2 = 2,
  ): Promise<{ ok: boolean; planetId: string; appliedAtTick?: number; code?: string }> {
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

  /**
   * Evaluates one batched LLM / policy decision turn across every colony on `planetId`:
   * - Non-player AI bots (`obs.isBot === true`) are batched into a single NEAR.AI (`z-ai/glm-5.3-flash`) completion call.
   * - Human player colonies with AI enabled use the player's connected NEAR.AI API key + selected model (batched per player);
   *   if the player has not connected a personal NEAR.AI API key, deterministic policy is used without consuming the server key.
   */
  async tickPlanetAgents(planetId: string, opts: TickPlanetAgentsOptions = {}): Promise<ColonyAgentEvalResult[]> {
    const snap = await this.planets.fullState(planetId);
    const state = restore(snap.bytes);
    const nowMs = opts.nowMs ?? Date.now();
    const [playerConfigs, dbStaked] = await Promise.all([
      this.resolvePlayerAiMap(planetId, state.colonies, opts.playerAiByColony),
      resolvePlanetStakedColonies(this.prisma, this.env, state.colonies),
    ]);
    const stakedColonies = { ...dbStaked, ...(opts.stakedByColony ?? {}) };
    const enforcePlayerKeyGate = Boolean(this.playerAiStore || opts.playerAiByColony || opts.stakedByColony);

    const governedObs: ColonyObservation[] = [];
    const resultsByIndex = new Map<number, ColonyAgentEvalResult>();

    for (const col of state.colonies) {
      if (!col || col.status === 'eliminated') continue;
      if (!shouldAiGovernColony(state, col.index)) {
        resultsByIndex.set(col.index, {
          colonyIndex: col.index,
          colonyId: col.id,
          governed: false,
          reason: 'manual_human_control',
        });
        continue;
      }
      governedObs.push(observeColony(state, col.index));
    }

    const decisions = await this.resolveAllDecisions(
      planetId,
      governedObs,
      playerConfigs,
      stakedColonies,
      enforcePlayerKeyGate,
      Boolean(opts.useCache),
      nowMs,
    );

    for (const obs of governedObs) {
      const col = state.colonies[obs.colonyIndex]!;
      const decision = decisions.get(obs.colonyIndex) ?? {
        directive: deterministicDirective(obs),
        model: 'deterministic-policy',
      };
      const evalRes = await this.applyColonyDecision(planetId, col, obs, decision, opts);
      resultsByIndex.set(obs.colonyIndex, evalRes);
    }

    return state.colonies
      .filter((c): c is NonNullable<typeof c> => Boolean(c && c.status !== 'eliminated'))
      .map((c) => resultsByIndex.get(c.index)!)
      .filter(Boolean);
  }

  private async resolvePlayerAiMap(
    planetId: string,
    stateColonies: ReadonlyArray<{ readonly index: number; readonly playerId?: unknown } | undefined>,
    overrides?: Record<number, PlayerColonyAiOverride>,
  ): Promise<Record<number, PlayerColonyAiOverride>> {
    const fromStore = this.playerAiStore
      ? await this.playerAiStore.resolvePlanetPlayerAiConfigs(planetId, stateColonies)
      : {};
    return { ...fromStore, ...(overrides ?? {}) };
  }

  private botModel(): string {
    const raw =
      (this.env?.NEAR_AI_MODEL as string | undefined) ||
      (this.env?.NEARAI_MODEL as string | undefined) ||
      (this.env?.AI_MODEL as string | undefined) ||
      DEFAULT_NEAR_AI_MODEL;
    return normalizeNearAiModel(raw);
  }

  private cacheDigestFor(
    obs: ColonyObservation,
    playerCfg: PlayerColonyAiOverride | undefined,
    hasStakerAutopilot: boolean,
    enforcePlayerKeyGate: boolean,
  ): string {
    if (obs.isBot) return `${observationDigest(obs)}|bot:${this.botModel()}`;
    const apiKey = playerCfg?.apiKey?.trim();
    if (apiKey) {
      const model = normalizeNearAiModel(playerCfg?.model || DEFAULT_NEAR_AI_MODEL);
      return `${observationDigest(obs)}|player:${apiKey.slice(-4)}:${model}`;
    }
    if (hasStakerAutopilot || !enforcePlayerKeyGate) {
      return `${observationDigest(obs)}|bot:${this.botModel()}`;
    }
    return `${observationDigest(obs)}|det`;
  }

  private async resolveAllDecisions(
    planetId: string,
    observations: readonly ColonyObservation[],
    playerConfigs: Record<number, PlayerColonyAiOverride>,
    stakedColonies: Record<number, boolean>,
    enforcePlayerKeyGate: boolean,
    useCache: boolean,
    nowMs: number,
  ): Promise<Map<number, ResolvedDecision>> {
    const out = new Map<number, ResolvedDecision>();
    const botBatch: ColonyObservation[] = [];
    const playerBatches = new Map<string, { apiKey: string; model: string; list: ColonyObservation[] }>();

    for (const obs of observations) {
      const cacheKey = `${planetId}:${obs.colonyIndex}`;
      const playerCfg = playerConfigs[obs.colonyIndex];
      const hasStakerAutopilot = Boolean(stakedColonies[obs.colonyIndex]);
      const digest = this.cacheDigestFor(obs, playerCfg, hasStakerAutopilot, enforcePlayerKeyGate);
      const cached = this.decisionCache.get(cacheKey);
      if (
        useCache &&
        cached &&
        nowMs - cached.atMs < COLONY_DECISION_COOLDOWN_MS &&
        cached.digest === digest &&
        !obs.pendingOfferId
      ) {
        out.set(obs.colonyIndex, { ...cached.decision, cached: true });
        continue;
      }

      if (obs.isBot) {
        botBatch.push(obs);
        continue;
      }

      const apiKey = playerCfg?.apiKey?.trim();
      if (apiKey) {
        const model = normalizeNearAiModel(playerCfg?.model || DEFAULT_NEAR_AI_MODEL);
        const groupKey = `${apiKey}::${model}`;
        const existing = playerBatches.get(groupKey);
        if (existing) existing.list.push(obs);
        else playerBatches.set(groupKey, { apiKey, model, list: [obs] });
      } else if (hasStakerAutopilot || !enforcePlayerKeyGate) {
        botBatch.push(obs);
      } else {
        const fallback: ResolvedDecision = {
          directive: deterministicDirective(obs),
          model: 'deterministic-policy',
          usedPlayerKey: false,
        };
        out.set(obs.colonyIndex, fallback);
        this.decisionCache.set(cacheKey, { digest, atMs: nowMs, decision: fallback });
      }
    }

    if (botBatch.length > 0) {
      const batchOut = await this.evaluateBatchWithLlm(botBatch, {
        model: this.botModel(),
        usedPlayerKey: false,
      });
      for (const obs of botBatch) {
        const dec = batchOut.get(obs.colonyIndex)!;
        out.set(obs.colonyIndex, dec);
        this.decisionCache.set(`${planetId}:${obs.colonyIndex}`, {
          digest: this.cacheDigestFor(obs, playerConfigs[obs.colonyIndex], Boolean(stakedColonies[obs.colonyIndex]), enforcePlayerKeyGate),
          atMs: nowMs,
          decision: dec,
        });
      }
    }

    for (const group of playerBatches.values()) {
      const batchOut = await this.evaluateBatchWithLlm(group.list, {
        apiKey: group.apiKey,
        model: group.model,
        usedPlayerKey: true,
      });
      for (const obs of group.list) {
        const dec = batchOut.get(obs.colonyIndex)!;
        out.set(obs.colonyIndex, dec);
        this.decisionCache.set(`${planetId}:${obs.colonyIndex}`, {
          digest: this.cacheDigestFor(obs, playerConfigs[obs.colonyIndex], Boolean(stakedColonies[obs.colonyIndex]), enforcePlayerKeyGate),
          atMs: nowMs,
          decision: dec,
        });
      }
    }

    return out;
  }

  private async evaluateBatchWithLlm(
    observations: readonly ColonyObservation[],
    creds: { apiKey?: string; model: string; usedPlayerKey: boolean },
  ): Promise<Map<number, ResolvedDecision>> {
    const out = new Map<number, ResolvedDecision>();
    if (observations.length === 0) return out;
    try {
      const res = await this.llm.complete({
        system: BATCH_SYSTEM_PROMPT,
        messages: [{ role: 'user', content: JSON.stringify({ colonies: observations }) }],
        maxTokens: Math.min(1200, observations.length * 240 + 120),
        temperature: 0.2,
        json: true,
        model: creds.model,
        ...(creds.apiKey ? { apiKey: creds.apiKey } : {}),
      });
      const parsed = parseBatchedDirectivesJson(res.text, observations);
      if (parsed?.isBatchedPayload) {
        for (const obs of observations) {
          out.set(obs.colonyIndex, {
            directive: parsed.map.get(obs.colonyIndex) ?? deterministicDirective(obs),
            model: res.model,
            attestation: res.attestation,
            usedPlayerKey: creds.usedPlayerKey,
          });
        }
        return out;
      }
      if (!parsed) {
        for (const obs of observations) {
          out.set(obs.colonyIndex, {
            directive: deterministicDirective(obs),
            model: 'deterministic-policy',
            attestation: res.attestation,
            usedPlayerKey: creds.usedPlayerKey,
          });
        }
        return out;
      }
      const first = observations[0]!;
      out.set(first.colonyIndex, {
        directive: parsed.map.get(first.colonyIndex) ?? deterministicDirective(first),
        model: res.model,
        attestation: res.attestation,
        usedPlayerKey: creds.usedPlayerKey,
      });
      for (const obs of observations.slice(1)) {
        out.set(obs.colonyIndex, await this.askSingleDirective(obs, creds));
      }
      return out;
    } catch {
      for (const obs of observations) {
        out.set(obs.colonyIndex, {
          directive: deterministicDirective(obs),
          model: 'deterministic-policy',
          usedPlayerKey: creds.usedPlayerKey,
        });
      }
      return out;
    }
  }

  private async askSingleDirective(
    obs: ColonyObservation,
    creds: { apiKey?: string; model: string; usedPlayerKey: boolean },
  ): Promise<ResolvedDecision> {
    try {
      const res = await this.llm.complete({
        system: BATCH_SYSTEM_PROMPT,
        messages: [{ role: 'user', content: JSON.stringify(obs) }],
        maxTokens: 320,
        temperature: 0.2,
        json: true,
        model: creds.model,
        ...(creds.apiKey ? { apiKey: creds.apiKey } : {}),
      });
      return {
        directive: parseDirectiveJson(res.text) ?? deterministicDirective(obs),
        model: res.model,
        attestation: res.attestation,
        usedPlayerKey: creds.usedPlayerKey,
      };
    } catch {
      return { directive: deterministicDirective(obs), model: 'deterministic-policy', usedPlayerKey: creds.usedPlayerKey };
    }
  }

  private async applyColonyDecision(
    planetId: string,
    col: { id: string; index: number; playerId?: string },
    obs: ColonyObservation,
    decision: ResolvedDecision,
    opts: TickPlanetAgentsOptions,
  ): Promise<ColonyAgentEvalResult> {
    const { directive, model, attestation, usedPlayerKey, cached } = decision;
    const allowance = opts.allowanceByColony?.[col.index] ?? DEFAULT_AGENT_ALLOWANCE;
    const usage = opts.usageByColony?.[col.index] ?? { outstandingOrders: 0, committedToday: 0n, reference: null };
    const guardrailRejected = validateAgentGuardrails(directive, obs, allowance, usage);

    if (guardrailRejected) {
      return {
        colonyIndex: col.index,
        colonyId: col.id,
        governed: true,
        isBot: obs.isBot,
        usedPlayerKey,
        cached,
        directive,
        guardrailRejected,
        model,
        attestation,
      };
    }

    const cmd = cached ? null : buildSimCommandFromDirective(obs, directive);
    let commandOutcome: { ok: boolean; code?: string } | undefined;
    if (cmd) {
      if (directive.action === 'trade') {
        await this.ensureTradeAccountFunded(planetId, col, directive);
      }
      const out = await this.planets.submit(planetId, cmd);
      commandOutcome = out.ok ? { ok: true } : { ok: false, code: out.code };
    }
    if (obs.away && !cached && this.digests && directive.action !== 'hold') {
      await this.digests.noteHighlight(col.id, new Date(), `AI Governor: ${directive.rationale}`);
    }
    return {
      colonyIndex: col.index,
      colonyId: col.id,
      governed: true,
      isBot: obs.isBot,
      usedPlayerKey,
      cached,
      directive,
      submittedCommand: cmd ?? undefined,
      commandOutcome,
      model,
      attestation,
    };
  }

  private async ensureTradeAccountFunded(
    planetId: string,
    col: { id: string; index: number; playerId?: string },
    directive: AgentDirective,
  ): Promise<void> {
    if (!this.prisma || !this.env || !databaseEnabled(this.env)) return;
    const [baseRes = 'metals.t1', quoteRes = 'minerals.t1'] = (directive.tradePair ?? 'metals.t1/minerals.t1').split('/');
    const amount = BigInt(directive.tradeAmount ?? 25);
    const spendToken = (directive.tradeSide ?? 'sell') === 'buy' ? quoteRes : baseRes;
    const spendUnits =
      spendToken === 'USDC' || spendToken === 'NEAR'
        ? BigInt(directive.tradeNotionalAtomic ?? String(Number(amount) * 1_000_000))
        : amount;
    const accountId = await resolveMarketAccountId(this.prisma, col.id, col.playerId ?? null, planetId, col.index);
    await ensureMockSigners(this.env, this.prisma, [accountId]);
    await ensureVerifierBalance(this.prisma, accountId, spendToken as MarketTokenKey, spendUnits * 2n);
  }
}
