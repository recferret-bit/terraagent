import { Logger } from '@nestjs/common';
import { MANAGED_AI_MODEL, SCRIPT_AI_MODEL, type AiDownshiftReason } from '@terra/contracts';
import type { PrismaClient } from '@terra/db';
import type { AppEnv } from '../../core/tokens.js';
import { stakingNowMs } from '../../near/staking/perks/perks-deps.js';
import type { LlmProviderPort } from '../../ports/llm-provider.port.js';
import { DEFAULT_NEAR_AI_MODEL, normalizeNearAiModel } from '../nearai-models.js';
import { downshiftForFailure } from '../provider/fallback-reason.js';
import { healthOf } from '../provider/guarded-llm.js';
import { evaluateBatchWithLlm, fallbackDecision, type ResolvedDecision } from './batch-llm.js';
import { observationDigest, type ColonyObservation } from './colony-agent-types.js';
import { ManagedAiGate, type ManagedAiAccess } from './managed-ai-gate.js';

export interface PlayerColonyAiOverride {
  readonly playerId?: string;
  readonly apiKey?: string | null;
  readonly model?: string;
}

export interface DecisionCtx {
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
  /** No human on the planet for 24 h: every colony uses the rule-based policy (no LLM call, no charge). */
  readonly rulesOnly?: boolean;
}

interface CachedColonyDecision {
  readonly digest: string;
  readonly atMs: number;
  readonly cooldownMs?: number;
  readonly decision: ResolvedDecision;
}

interface Batches {
  readonly bots: ColonyObservation[];
  readonly stakers: ColonyObservation[];
  readonly players: Map<string, { apiKey: string; model: string; list: ColonyObservation[] }>;
}

/** Minimum cooldown before re-querying NEAR.AI for an unchanged colony state during background sweeps. */
export const COLONY_DECISION_COOLDOWN_MS = 120_000;

const scriptAccess = (reason: AiDownshiftReason): ManagedAiAccess => ({ mode: 'script', model: SCRIPT_AI_MODEL, reason });

/**
 * Turns colony observations into decisions: cache, then bot batch (protocol key), staker / trial singles through the
 * wallet gate, and BYOK batches per player key. A provider failure (or an open circuit) yields the rule-based
 * directive with a `provider_*` reason; a managed turn charged for a failed call is refunded.
 */
export class ColonyDecisionResolver {
  private readonly cache = new Map<string, CachedColonyDecision>();
  private readonly log = new Logger(ColonyDecisionResolver.name);
  private managedGate: ManagedAiGate | null = null;

  constructor(
    private readonly llm: LlmProviderPort,
    private readonly prisma?: PrismaClient,
    private readonly env?: AppEnv,
  ) {}

  clear(): void {
    this.cache.clear();
  }

  /** Forgets one colony's cached decision (its command was not submitted: the next sweep decides again). */
  clearColony(planetId: string, colonyIndex: number): void {
    this.cache.delete(`${planetId}:${colonyIndex}`);
  }

  /**
   * Gives a managed turn back when its decision was not used (the provider call failed, or a guardrail blocked the
   * answer). Tries twice; a refund that still fails is logged and never aborts the sweep.
   */
  async refundTurn(access: ManagedAiAccess | undefined): Promise<void> {
    if (!access || access.mode === 'script' || access.mode === 'byok') return;
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        await this.gate().refund(access);
        return;
      } catch (err) {
        if (attempt === 2) this.log.warn(`managed AI turn not refunded (${access.mode}): ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }

  clearPlanet(planetId: string): void {
    const prefix = `${planetId}:`;
    for (const k of [...this.cache.keys()]) if (k.startsWith(prefix)) this.cache.delete(k);
  }

  botModel(): string {
    const raw =
      (this.env?.NEAR_AI_MODEL as string | undefined) ||
      (this.env?.NEARAI_MODEL as string | undefined) ||
      (this.env?.AI_MODEL as string | undefined) ||
      DEFAULT_NEAR_AI_MODEL;
    return normalizeNearAiModel(raw);
  }

  async resolveAll(planetId: string, observations: readonly ColonyObservation[], ctx: DecisionCtx): Promise<Map<number, ResolvedDecision>> {
    const out = new Map<number, ResolvedDecision>();
    const batches: Batches = { bots: [], stakers: [], players: new Map() };
    for (const obs of observations) {
      const cached = this.cachedFor(planetId, obs, ctx);
      if (cached) out.set(obs.colonyIndex, { ...cached.decision, cached: true });
      else this.route(planetId, obs, ctx, batches, out);
    }
    const save = (list: readonly ColonyObservation[], res: Map<number, ResolvedDecision>): void => this.save(planetId, list, res, ctx, out);
    if (batches.bots.length > 0) save(batches.bots, this.tagProvider(await evaluateBatchWithLlm(this.llm, batches.bots, { model: this.botModel(), usedPlayerKey: false })));
    for (const obs of batches.stakers) {
      const override = Boolean(ctx.stakedOverride[obs.colonyIndex] || !ctx.enforcePlayerKeyGate);
      save([obs], new Map([[obs.colonyIndex, await this.resolveManagedSingle(planetId, obs, ctx, override)]]));
    }
    for (const group of batches.players.values()) {
      const res = await evaluateBatchWithLlm(this.llm, group.list, { apiKey: group.apiKey, model: group.model, usedPlayerKey: true });
      save(group.list, this.tagProvider(res, { mode: 'byok', model: group.model }));
    }
    return out;
  }

  private cachedFor(planetId: string, obs: ColonyObservation, ctx: DecisionCtx): CachedColonyDecision | undefined {
    const cached = this.cache.get(`${planetId}:${obs.colonyIndex}`);
    if (!ctx.useCache || !cached || obs.pendingOfferId) return undefined;
    const fresh = ctx.nowMs - cached.atMs < (cached.cooldownMs ?? COLONY_DECISION_COOLDOWN_MS);
    return fresh && cached.digest === this.digestFor(obs, ctx) ? cached : undefined;
  }

  private route(planetId: string, obs: ColonyObservation, ctx: DecisionCtx, b: Batches, out: Map<number, ResolvedDecision>): void {
    const apiKey = ctx.playerConfigs[obs.colonyIndex]?.apiKey?.trim();
    if (ctx.rulesOnly) {
      const idle: ResolvedDecision = { ...fallbackDecision(obs, false), aiAccess: scriptAccess('planet_idle') };
      healthOf(this.llm).noteFallback('planet_idle');
      out.set(obs.colonyIndex, idle);
      this.cache.set(`${planetId}:${obs.colonyIndex}`, { digest: this.digestFor(obs, ctx), atMs: ctx.nowMs, decision: idle });
    } else if (obs.isBot) {
      b.bots.push(obs);
    } else if (apiKey) {
      const model = normalizeNearAiModel(ctx.playerConfigs[obs.colonyIndex]?.model || DEFAULT_NEAR_AI_MODEL);
      const group = b.players.get(`${apiKey}::${model}`);
      if (group) group.list.push(obs);
      else b.players.set(`${apiKey}::${model}`, { apiKey, model, list: [obs] });
    } else if (this.isManagedCandidate(obs, ctx) || !ctx.enforcePlayerKeyGate) {
      b.stakers.push(obs);
    } else {
      const fallback = fallbackDecision(obs, false);
      out.set(obs.colonyIndex, fallback);
      this.cache.set(`${planetId}:${obs.colonyIndex}`, { digest: this.digestFor(obs, ctx), atMs: ctx.nowMs, decision: fallback });
    }
  }

  private save(planetId: string, list: readonly ColonyObservation[], res: Map<number, ResolvedDecision>, ctx: DecisionCtx, out: Map<number, ResolvedDecision>): void {
    for (const obs of list) {
      const dec = res.get(obs.colonyIndex)!;
      const w28Managed = this.isW28Managed(obs, ctx);
      out.set(obs.colonyIndex, dec);
      this.cache.set(`${planetId}:${obs.colonyIndex}`, {
        digest: this.digestFor(obs, ctx),
        atMs: ctx.nowMs,
        cooldownMs: (w28Managed ? this.managedGate?.cooldownMsOf(obs.colonyId) : undefined) ?? COLONY_DECISION_COOLDOWN_MS,
        decision: dec,
      });
    }
  }

  /** Adds the access record (`byok` stays `byok` with a `provider_*` reason) and counts provider fallbacks once. */
  private tagProvider(res: Map<number, ResolvedDecision>, access?: ManagedAiAccess): Map<number, ResolvedDecision> {
    const out = new Map<number, ResolvedDecision>();
    const fallbacks = new Map<AiDownshiftReason, number>();
    for (const [idx, d] of res) {
      if (!d.providerFailure) {
        out.set(idx, access ? { ...d, aiAccess: access } : d);
        continue;
      }
      const reason = downshiftForFailure(d.providerFailure);
      fallbacks.set(reason, (fallbacks.get(reason) ?? 0) + 1);
      out.set(idx, { ...d, aiAccess: access ? { ...access, reason } : scriptAccess(reason) });
    }
    for (const [reason, n] of fallbacks) healthOf(this.llm).noteFallback(reason, n);
    return out;
  }

  /** Stakers' managed turn (`W28`: through the wallet gate; `W20` or a test override: unconditional `z-ai/glm-5.3-flash`). */
  private async resolveManagedSingle(planetId: string, obs: ColonyObservation, ctx: DecisionCtx, override: boolean): Promise<ResolvedDecision> {
    if (!ctx.w28 || override) {
      return this.tagProvider(await evaluateBatchWithLlm(this.llm, [obs], { model: MANAGED_AI_MODEL, usedPlayerKey: false })).get(obs.colonyIndex)!;
    }
    // the gate runs on the staking clock (fee warmup, AI day, slot ledger), like its `view()`; `ctx.nowMs` stays the
    // wall clock of the decision-cache cooldown, unless a caller pinned it (tests)
    let access: ManagedAiAccess;
    try {
      access = await this.gate().admit(
        { id: obs.colonyId, planetId, colonyIndex: obs.colonyIndex, playerId: ctx.playerIdByIndex[obs.colonyIndex] },
        ctx.pinnedNowMs ?? stakingNowMs(),
      );
    } catch (err) {
      // The gate could not be read (database blip): this colony plays by rules now; the rest of the sweep goes on.
      this.log.warn(`managed AI gate failed for ${obs.colonyId}: ${err instanceof Error ? err.message : String(err)}`);
      return { ...fallbackDecision(obs, false), aiAccess: scriptAccess('no_database') };
    }
    if (access.mode === 'script') {
      if (access.reason?.startsWith('provider_')) healthOf(this.llm).noteFallback(access.reason);
      return { ...fallbackDecision(obs, false), aiAccess: access };
    }
    const res = (await evaluateBatchWithLlm(this.llm, [obs], { model: access.model, usedPlayerKey: false })).get(obs.colonyIndex)!;
    if (!res.providerFailure) return { ...res, aiAccess: access };
    await this.refundTurn(access);
    return this.tagProvider(new Map([[obs.colonyIndex, res]])).get(obs.colonyIndex)!;
  }

  private gate(): ManagedAiGate {
    this.managedGate ??= new ManagedAiGate(this.prisma, this.env, undefined, undefined, healthOf(this.llm));
    return this.managedGate;
  }

  private isW28Managed(obs: ColonyObservation, ctx: DecisionCtx): boolean {
    return ctx.w28 && !obs.isBot && !ctx.stakedOverride[obs.colonyIndex];
  }

  private digestFor(obs: ColonyObservation, ctx: DecisionCtx): string {
    const base = observationDigest(obs);
    if (ctx.rulesOnly) return `${base}|idle`;
    if (obs.isBot) return `${base}|bot:${this.botModel()}`;
    const playerCfg = ctx.playerConfigs[obs.colonyIndex];
    const apiKey = playerCfg?.apiKey?.trim();
    if (apiKey) return `${base}|player:${apiKey.slice(-4)}:${normalizeNearAiModel(playerCfg?.model || DEFAULT_NEAR_AI_MODEL)}`;
    if (this.isManagedCandidate(obs, ctx) || !ctx.enforcePlayerKeyGate) return `${base}|staker:${MANAGED_AI_MODEL}`;
    return `${base}|det`;
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
}
