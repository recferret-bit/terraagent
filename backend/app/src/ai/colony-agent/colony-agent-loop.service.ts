import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { newId, SCRIPT_AI_MODEL, type AgentDecisionFeedItemV1, type MarketTokenKey, type TradeAllowance } from '@terra/contracts';
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
import { evaluateTradeGovernance, shouldAutoFundTradeAccount } from './colony-agent-governance.js';
import {
  buildSimCommandFromDirective,
  DEFAULT_AGENT_ALLOWANCE,
  deterministicDirective,
  observeColony,
  type AgentDirective,
  type ColonyAgentEvalResult,
  type ColonyObservation,
} from './colony-agent-types.js';
import type { ResolvedDecision } from './batch-llm.js';
import { decisionFeedItem } from './colony-decision-feed.js';
import { ColonyDecisionResolver, type PlayerColonyAiOverride } from './colony-decision-resolver.js';
import { humanConnectedNow, PlanetHumanActivity, withPlanetClock, type PlanetActivity, type PlanetSeenClock } from './planet-activity.js';
import { TeeAttestationStore } from './tee-attestation.store.js';
import { PlanetJobsService } from '../../game/lifecycle/planet-jobs.service.js';
import type { JobRegistration } from '../../jobs/recurring.js';

export { COLONY_DECISION_COOLDOWN_MS, type PlayerColonyAiOverride } from './colony-decision-resolver.js';

export interface TickPlanetAgentsOptions {
  readonly allowanceByColony?: Record<number, TradeAllowance>;
  readonly usageByColony?: Record<number, AllowanceUsage>;
  readonly playerAiByColony?: Record<number, PlayerColonyAiOverride>;
  readonly stakedByColony?: Record<number, boolean>;
  readonly useCache?: boolean;
  readonly nowMs?: number;
  /** Sweep of a planet with no human for 24 h: rules only unless this tick sees a human on it. */
  readonly idleUnlessHumanPresent?: boolean;
}

/** Background sweep interval: 3 minutes so NEAR.AI is called infrequently and in batches. */
export const COLONY_AGENT_LOOP_MS = 180_000;

@Injectable()
export class ColonyAgentLoopService {
  private timer: ReturnType<typeof setInterval> | null = null;
  private job: JobRegistration | null = null;
  private readonly log = new Logger(ColonyAgentLoopService.name);
  private readonly resolver: ColonyDecisionResolver;
  private activity: PlanetActivity;
  private decisionRecorder?: (item: Omit<AgentDecisionFeedItemV1, 'id'>) => void;

  constructor(
    private readonly planets: GamePlanets,
    @Inject(LlmProviderPort) private readonly llm: LlmProviderPort,
    @Optional() private readonly digests?: AwayDigestService,
    @Optional() @Inject(PRISMA) private readonly prisma?: PrismaClient,
    @Optional() @Inject(APP_ENV) private readonly env?: AppEnv,
    @Optional() private readonly playerAiStore?: PlayerAiSettingsStore,
    @Optional() private readonly teeStore?: TeeAttestationStore,
    @Optional() @Inject(PlanetJobsService) private readonly planetJobs?: PlanetJobsService,
  ) {
    this.resolver = new ColonyDecisionResolver(llm, prisma, env);
    this.activity = new PlanetHumanActivity(prisma, env);
  }

  start(intervalMs?: number): void {
    if (this.timer || this.job) return;
    const ms = intervalMs ?? (isW28Enabled(this.envBag()) ? 30_000 : COLONY_AGENT_LOOP_MS);
    // One sweep per planet at a time, on its lease holder, with retries (3.7); the timer is the no-queue fallback.
    if (intervalMs === undefined && this.planetJobs?.enabled) {
      this.job = this.planetJobs.register({ name: 'ai.colony-sweep', everyMs: ms, concurrency: 2, run: (id) => this.sweepPlanet(id) });
      return;
    }
    this.timer = setInterval(() => {
      void this.sweepLoadedPlanets();
    }, ms);
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    void this.job?.stop();
    this.job = null;
  }

  clearCache(): void {
    this.resolver.clear();
  }

  clearPlanetCache(planetId: string): void {
    this.resolver.clearPlanet(planetId);
  }

  setDecisionRecorder(fn: (item: Omit<AgentDecisionFeedItemV1, 'id'>) => void): void {
    this.decisionRecorder = fn;
  }

  /** Replaces the "human on this planet in the last 24 h" source of the background sweep. */
  setPlanetActivity(activity: PlanetActivity): void {
    this.activity = activity;
  }

  /** Adds the persisted planet clock (the idle unload's) to the idle rule, so both features agree on "a human was here". */
  usePlanetClock(clock: PlanetSeenClock): void {
    this.activity = withPlanetClock(this.activity, clock);
  }

  async sweepLoadedPlanets(): Promise<void> {
    for (const planetId of this.planets.loadedIds()) {
      try {
        await this.sweepPlanet(planetId);
      } catch {
        // Non-fatal background agent sweep error
      }
    }
  }

  /**
   * One background sweep of `planetId` (the `setInterval` today; a job queue may drive it later). A planet with no
   * human for 24 h runs every colony on the rule-based policy: no LLM call and no managed charge.
   */
  async sweepPlanet(planetId: string): Promise<ColonyAgentEvalResult[]> {
    const recent = await this.activity.recentlyActive(planetId, Date.now());
    return this.tickPlanetAgents(planetId, { useCache: true, idleUnlessHumanPresent: !recent });
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
    const humanHere = humanConnectedNow(state);
    if (humanHere) this.activity.noteHumanPresent?.(planetId, nowMs);
    const decisions = await this.resolver.resolveAll(planetId, governedObs, {
      rulesOnly: Boolean(opts.idleUnlessHumanPresent) && !humanHere,
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
      try {
        resultsByIndex.set(obs.colonyIndex, await this.applyColonyDecision(planetId, col, obs, decision, opts, state.meta.tick));
      } catch (err) {
        // The decision was cached before it was applied: forget it, or the next sweeps would skip this colony as
        // "cached" without ever submitting its command. The other colonies still get theirs.
        this.resolver.clearColony(planetId, obs.colonyIndex);
        this.log.warn(`colony decision not applied (${planetId} #${obs.colonyIndex}): ${err instanceof Error ? err.message : String(err)}`);
        resultsByIndex.set(obs.colonyIndex, { colonyIndex: obs.colonyIndex, colonyId: col.id, governed: true, isBot: obs.isBot, directive: decision.directive, model: decision.model });
      }
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
    let fromStore: Record<number, PlayerColonyAiOverride> = {};
    try {
      if (this.playerAiStore) fromStore = await this.playerAiStore.resolvePlanetPlayerAiConfigs(planetId, stateColonies);
    } catch (err) {
      // One unreadable saved key (a rotated KEK, a damaged envelope) must not stop the whole planet's sweeps.
      this.log.warn(`player AI settings unreadable for ${planetId}: ${err instanceof Error ? err.message : String(err)}`);
    }
    return { ...fromStore, ...(overrides ?? {}) };
  }

  private envBag(): Record<string, string | undefined> {
    return (this.env ?? process.env) as unknown as Record<string, string | undefined>;
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
      await this.teeStore.record({ colonyId: col.id, planetId, model: model ?? this.resolver.botModel(), directive, attestation });
    }

    if (guardrailRejected) {
      // a managed turn whose answer was blocked by the attestation check is given back
      if (guardrailRejected === 'TEE_ATTESTATION_FAILED' && !cached) await this.resolver.refundTurn(aiAccess);
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
    this.decisionRecorder?.(decisionFeedItem({ planetId, col, obs, decision, cmd, outcome, summary, atTick, nowMs, extra }));
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
