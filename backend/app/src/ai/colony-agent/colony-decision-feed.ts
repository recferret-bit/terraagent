import type { AgentDecisionFeedItemV1 } from '@terra/contracts';
import type { ResolvedDecision } from './batch-llm.js';
import type { ColonyObservation } from './colony-agent-types.js';

export interface FeedEntry {
  readonly planetId: string;
  readonly col: { id: string; index: number; playerId?: string };
  readonly obs: ColonyObservation;
  readonly decision: ResolvedDecision;
  readonly cmd: { commandId: string; kind: string } | null;
  readonly outcome: AgentDecisionFeedItemV1['outcome'];
  readonly summary: string;
  readonly atTick: number;
  readonly nowMs?: number;
  readonly extra?: Record<string, unknown>;
}

/**
 * One colony-agent decision for the decision feed. The payload names the access mode and, for a rule-based
 * fallback, the `downshiftReason` (`provider_unfunded`, `provider_unavailable`, `planet_idle`, …).
 */
export function decisionFeedItem(e: FeedEntry): Omit<AgentDecisionFeedItemV1, 'id'> {
  const { decision, obs, col } = e;
  const access = decision.aiAccess;
  return {
    planetId: e.planetId,
    sectorId: obs.sectorId ?? 'sec_0_0',
    colonyId: col.id,
    colonyIndex: col.index,
    actorId: obs.isBot ? `bot:${col.id}` : col.playerId ?? null,
    isBot: obs.isBot,
    actorSource: 'colony_agent',
    decisionKind: decision.directive.action,
    summary: e.summary,
    rationale: decision.directive.rationale,
    commandId: e.cmd?.commandId ?? null,
    commandKind: e.cmd?.kind ?? null,
    payload: {
      model: decision.model,
      directive: decision.directive,
      usedPlayerKey: decision.usedPlayerKey,
      ...(access ? { aiMode: access.mode } : {}),
      ...(access?.reason ? { downshiftReason: access.reason } : {}),
      ...(decision.providerFailure ? { providerFailure: decision.providerFailure } : {}),
      ...(e.extra ?? {}),
    },
    outcome: e.outcome,
    atTick: e.atTick,
    createdAtMs: e.nowMs ?? Date.now(),
  };
}
