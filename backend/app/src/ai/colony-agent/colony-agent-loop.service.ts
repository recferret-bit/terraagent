import { Inject, Injectable, Optional } from '@nestjs/common';
import { MANAGED_AI_MODEL, newId, SCRIPT_AI_MODEL, type AgentDecisionFeedItemV1, type MarketTokenKey, type TradeAllowance } from '@terra/contracts';
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
import { PlayerAiSettingsStore } from '../../profile/player-ai-settings.store.js';
import { isW28Enabled } from '../../near/staking/perks/legacy-ladder.js';
import { resolvePlanetStakedColonies } from '../../near/staking/staker-perks.js';
import { isTeeAttestationRejected } from '../adapters/nearai-signature.js';
import { DEFAULT_NEAR_AI_MODEL, normalizeNearAiModel } from '../nearai-models.js';
import { evaluateTradeGovernance, shouldAutoFundTradeAccount } from './colony-agent-governance.js';
import {
  buildSimCommandFromDirective,
  DEFAULT_AGENT_ALLOWANCE,
  deterministicDirective,
  observationDigest,
  observeColony,
  type AgentDirective,
  type ColonyAgentEvalResult,
  type ColonyObservation,
} from './colony-agent-types.js';
import { evaluateBatchWithLlm, type ResolvedDecision } from './batch-llm.js';
import { ManagedAiGate, type ManagedAiAccess } from './managed-ai-gate.js';
import { TeeAttestationStore } from './tee-attestation.store.js';
import { stakingNowMs } from '../../near/staking/perks/perks-deps.js';

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

interface DecisionCtx {
  readonly playerConfigs: Record<number, PlayerColonyAiOverride>;
  readonly stakedColonies: Record<number, boolean>;
  /** Test/dev override (`opts.stakedByColony`): forces the managed path past the wallet gate. */
  readonly stakedOverride: Record<number, boolean>;
  readonly enforcePlayerKeyGate: boolean;
  readonly useCache: boolean;
  readonly nowMs: number;
  /** The caller's explicit clock (tests); `undefined` = the gate reads the staking clock. */
  readonly pinnedNowMs?: number;
  readonly w28: boolean;
  readonly playerIdByIndex: Record<number, string | undefined>;
}

interface CachedColonyDecision {
  readonly digest: string;
  readonly atMs: number;
  readonly cooldownMs?: number;
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
  private managedGate: ManagedAiGate | null = null;
  private decisionRecorder?: (item: Omit<AgentDecisionFeedItemV1, 'id'>) => void;

  constructor(
    private readonly planets: GamePlanets,
    @Inject(LlmProviderPort) private readonly llm: LlmProviderPort,
    @Optional() private readonly digests?: AwayDigestService,
    @Optional() @Inject(PRISMA) private readonly prisma?: PrismaClient,
    @Optional() @Inject(APP_ENV) private readonly env?: AppEnv,
    @Optional() private readonly playerAiStore?: PlayerAiSettingsStore,
    @Optional() private readonly teeStore?: TeeAttestationStore,
  ) {}

  start(intervalMs?: number): void {
    if (this.timer) return;
    const ms = intervalMs ?? (isW28Enabled(this.envBag()) ? 30_000 : COLONY_AGENT_LOOP_MS);
    this.timer = setInterval(() => {
      void this.sweepLoadedPlanets();
    }, ms);
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  clearCache(): void {
    this.decisionCache.clear();
  }

  clearPlanetCache(planetId: string): void {
    const prefix = `${planetId}:`;
    for (const k of [...this.decisionCache.keys()]) {
      if (k.startsWith(prefix)) this.decisionCache.delete(k);
    }
  }

  setDecisionRecorder(fn: (item: Omit<AgentDecisionFeedItemV1, 'id'>) => void): void {
    this.decisionRecorder = fn;
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
   * - Non-player AI bots (`obs.isBot === true`) and human colonies staking `>= 10 NEAR` without a custom BYOK key
   *   are batched into the server-sponsored Managed NEAR.AI (`z-ai/glm-5.3-flash`) completion call.
   * - Human player colonies with a saved `/me.html` BYOK NEAR.AI key use their chosen custom model (batched per player).
   * - Unstaked human colonies without a personal BYOK key use deterministic policy without consuming the server key.
   */
  async tickPlanetAgents(planetId: string, opts: TickPlanetAgentsOptions = {}): Promise<ColonyAgentEvalResult[]> {
    const snap = await this.planets.fullState(planetId);
    const state = restore(snap.bytes);
    const nowMs = opts.nowMs ?? Date.now();
    const [playerConfigs, dbStaked] = await Promise.all([
      this.resolvePlayerAiMap(planetId, state.colonies, opts.playerAiByColony),
      resolvePlanetStakedColonies(this.prisma, this.env, state.colonies, planetId),
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

    const playerIdByIndex: Record<number, string | undefined> = {};
    for (const c of state.colonies) if (c) playerIdByIndex[c.index] = c.playerId as string | undefined;
    const decisions = await this.resolveAllDecisions(planetId, governedObs, {
      playerConfigs,
      stakedColonies,
      stakedOverride: opts.stakedByColony ?? {},
      enforcePlayerKeyGate,
      useCache: Boolean(opts.useCache),
      nowMs,
      pinnedNowMs: opts.nowMs,
      w28: isW28Enabled(this.envBag()),
      playerIdByIndex,
    });

    for (const obs of governedObs) {
      const col = state.colonies[obs.colonyIndex]!;
      const decision = decisions.get(obs.colonyIndex) ?? {
        directive: deterministicDirective(obs),
        model: SCRIPT_AI_MODEL,
      };
      const evalRes = await this.applyColonyDecision(planetId, col, obs, decision, opts, state.meta.tick);
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

  private envBag(): Record<string, string | undefined> {
    return (this.env ?? process.env) as unknown as Record<string, string | undefined>;
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
      return `${observationDigest(obs)}|staker:${MANAGED_AI_MODEL}`;
    }
    return `${observationDigest(obs)}|det`;
  }

  /** Stakers' managed turn (`W28`: through the wallet gate; `W20` or a test override: unconditional `z-ai/glm-5.3-flash`). */
  private async resolveManagedSingle(
    planetId: string,
    obs: ColonyObservation,
    ctx: DecisionCtx,
    override: boolean,
  ): Promise<ResolvedDecision> {
    if (!ctx.w28 || override) {
      return (await evaluateBatchWithLlm(this.llm, [obs], { model: MANAGED_AI_MODEL, usedPlayerKey: false })).get(obs.colonyIndex)!;
    }
    // the gate runs on the staking clock (fee warmup, AI day, slot ledger), like its `view()`; `ctx.nowMs` stays the
    // wall clock of the decision-cache cooldown, unless a caller pinned it (tests)
    const access = await this.gate().admit(
      { id: obs.colonyId, planetId, colonyIndex: obs.colonyIndex, playerId: ctx.playerIdByIndex[obs.colonyIndex] },
      ctx.pinnedNowMs ?? stakingNowMs(),
    );
    if (access.mode === 'script') {
      return { directive: deterministicDirective(obs), model: SCRIPT_AI_MODEL, usedPlayerKey: false, aiAccess: access };
    }
    const res = (await evaluateBatchWithLlm(this.llm, [obs], { model: access.model, usedPlayerKey: false })).get(obs.colonyIndex)!;
    return { ...res, aiAccess: access };
  }

  private gate(): ManagedAiGate {
    this.managedGate ??= new ManagedAiGate(this.prisma, this.env);
    return this.managedGate;
  }

  private async resolveAllDecisions(
    planetId: string,
    observations: readonly ColonyObservation[],
    ctx: DecisionCtx,
  ): Promise<Map<number, ResolvedDecision>> {
    const { playerConfigs, enforcePlayerKeyGate, useCache, nowMs } = ctx;
    const out = new Map<number, ResolvedDecision>();
    const botBatch: ColonyObservation[] = [];
    const stakerSingles: ColonyObservation[] = [];
    const playerBatches = new Map<string, { apiKey: string; model: string; list: ColonyObservation[] }>();

    for (const obs of observations) {
      const cacheKey = `${planetId}:${obs.colonyIndex}`;
      const playerCfg = playerConfigs[obs.colonyIndex];
      const hasStakerAutopilot = this.isManagedCandidate(obs, ctx);
      const digest = this.cacheDigestFor(obs, playerCfg, hasStakerAutopilot, enforcePlayerKeyGate);
      const cached = this.decisionCache.get(cacheKey);
      const cooldownMs = cached?.cooldownMs ?? COLONY_DECISION_COOLDOWN_MS;
      if (useCache && cached && nowMs - cached.atMs < cooldownMs && cached.digest === digest && !obs.pendingOfferId) {
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
        stakerSingles.push(obs);
      } else {
        const fallback: ResolvedDecision = { directive: deterministicDirective(obs), model: SCRIPT_AI_MODEL, usedPlayerKey: false };
        out.set(obs.colonyIndex, fallback);
        this.decisionCache.set(cacheKey, { digest, atMs: nowMs, decision: fallback });
      }
    }

    const saveBatch = (list: readonly ColonyObservation[], resMap: Map<number, ResolvedDecision>) => {
      for (const obs of list) {
        const dec = resMap.get(obs.colonyIndex)!;
        const w28Managed = ctx.w28 && !obs.isBot && !ctx.stakedOverride[obs.colonyIndex];
        out.set(obs.colonyIndex, dec);
        this.decisionCache.set(`${planetId}:${obs.colonyIndex}`, {
          digest: this.cacheDigestFor(obs, playerConfigs[obs.colonyIndex], this.isManagedCandidate(obs, ctx), enforcePlayerKeyGate),
          atMs: nowMs,
          cooldownMs: (w28Managed ? this.managedGate?.cooldownMsOf(obs.colonyId) : undefined) ?? COLONY_DECISION_COOLDOWN_MS,
          decision: dec,
        });
      }
    };

    if (botBatch.length > 0) saveBatch(botBatch, await evaluateBatchWithLlm(this.llm, botBatch, { model: this.botModel(), usedPlayerKey: false }));
    for (const obs of stakerSingles) {
      const dec = await this.resolveManagedSingle(
        planetId,
        obs,
        ctx,
        Boolean(ctx.stakedOverride[obs.colonyIndex] || !enforcePlayerKeyGate),
      );
      saveBatch([obs], new Map([[obs.colonyIndex, dec]]));
    }
    for (const group of playerBatches.values()) {
      const res = await evaluateBatchWithLlm(this.llm, group.list, { apiKey: group.apiKey, model: group.model, usedPlayerKey: true });
      const byok: ManagedAiAccess = { mode: 'byok', model: group.model };
      saveBatch(group.list, new Map([...res].map(([idx, d]) => [idx, { ...d, aiAccess: byok }])));
    }

    return out;
  }

  /**
   * A human colony without a BYOK key may use managed AI. `W20`: only wallets staking `>= 10 NEAR` (`stakedColonies`).
   * `W28`: every such colony asks the wallet gate (stake budget, slots, or the verified-pilot free trial); a test
   * override in `stakedByColony` still forces the managed path.
   */
  private isManagedCandidate(obs: ColonyObservation, ctx: DecisionCtx): boolean {
    if (ctx.stakedColonies[obs.colonyIndex]) return true;
    return ctx.w28 && ctx.enforcePlayerKeyGate && !obs.isBot && !ctx.playerConfigs[obs.colonyIndex]?.apiKey?.trim();
  }

  private async applyColonyDecision(
    planetId: string,
    col: { id: string; index: number; playerId?: string },
    obs: ColonyObservation,
    decision: ResolvedDecision,
    opts: TickPlanetAgentsOptions,
    stateTick = 0,
  ): Promise<ColonyAgentEvalResult> {
    const { directive, model, attestation, usedPlayerKey, cached, aiAccess } = decision;
    const allowance = opts.allowanceByColony?.[col.index] ?? DEFAULT_AGENT_ALLOWANCE;
    const usage = opts.usageByColony?.[col.index] ?? { outstandingOrders: 0, committedToday: 0n, reference: null };
    const envRecord = (this.env ?? process.env) as unknown as Readonly<Record<string, unknown>>;
    const guardrailRejected = isTeeAttestationRejected(attestation, envRecord)
      ? 'TEE_ATTESTATION_FAILED'
      : await evaluateTradeGovernance(this.prisma, this.env, {
          planetId,
          colonyId: col.id,
          obs,
          directive,
          baseAllowance: allowance,
          baseUsage: usage,
          nowMs: opts.nowMs,
        });

    if (!cached && attestation && this.teeStore) {
      await this.teeStore.record({ colonyId: col.id, planetId, model: model ?? this.botModel(), directive, attestation });
    }

    if (guardrailRejected) {
      this.emitRecordedDecision(planetId, col, obs, decision, null, 'rejected', `${directive.action} (blocked: ${guardrailRejected})`, stateTick, opts.nowMs, { guardrailRejected });
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
        aiAccess,
      };
    }

    const cmd = cached ? null : buildSimCommandFromDirective(obs, directive);
    let commandOutcome: { ok: boolean; code?: string } | undefined;
    if (cmd) {
      if (directive.action === 'trade' && shouldAutoFundTradeAccount(obs, this.env)) {
        await this.ensureTradeAccountFunded(planetId, col, directive);
      }
      const out = await this.planets.submit(planetId, cmd);
      commandOutcome = out.ok ? { ok: true } : { ok: false, code: out.code };
    }
    const outcome = cached ? 'skipped' : commandOutcome ? (commandOutcome.ok ? 'applied' : 'rejected') : 'emitted';
    this.emitRecordedDecision(planetId, col, obs, decision, cmd, outcome, `${directive.action}: ${directive.rationale.slice(0, 120)}`, stateTick, opts.nowMs);
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
      aiAccess,
    };
  }

  private emitRecordedDecision(
    planetId: string,
    col: { id: string; index: number; playerId?: string },
    obs: ColonyObservation,
    decision: ResolvedDecision,
    cmd: { commandId: string; kind: string } | null,
    outcome: AgentDecisionFeedItemV1['outcome'],
    summary: string,
    atTick: number,
    nowMs?: number,
    extra?: Record<string, unknown>,
  ): void {
    this.decisionRecorder?.({
      planetId,
      sectorId: obs.sectorId ?? 'sec_0_0',
      colonyId: col.id,
      colonyIndex: col.index,
      actorId: obs.isBot ? `bot:${col.id}` : col.playerId ?? null,
      isBot: obs.isBot,
      actorSource: 'colony_agent',
      decisionKind: decision.directive.action,
      summary,
      rationale: decision.directive.rationale,
      commandId: cmd?.commandId ?? null,
      commandKind: cmd?.kind ?? null,
      payload: { model: decision.model, directive: decision.directive, usedPlayerKey: decision.usedPlayerKey, ...(extra ?? {}) },
      outcome,
      atTick,
      createdAtMs: nowMs ?? Date.now(),
    });
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
    await ensureVerifierBalance(this.prisma, accountId, spendToken as MarketTokenKey, spendUnits * 2n, this.env);
  }
}
