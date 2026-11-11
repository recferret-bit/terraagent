import type { SimCommandV1, TradeAllowance } from '@terra/contracts';
import { newId } from '@terra/contracts';
import {
  colonyIsAway,
  colonyTerraformStats,
  getColonyStock,
  getOpenColonyGoals,
  getRivalColonyMeta,
  hasActiveTruce,
  isColonyRaidProtected,
  readDiplomacyBlob,
  resolveColonyAwayRaids,
  type PlanetState,
} from '@terra/sim';
import { z } from 'zod';
import { checkAllowance, type AllowanceUsage } from '../../market/trade/allowance.js';
import type { LlmAttestation } from '../../ports/llm-provider.port.js';

export const AgentDirectiveSchema = z.object({
  action: z.enum([
    'queue_goal',
    'propose_truce',
    'respond_truce',
    'trade',
    'cancel_truce',
    'stake',
    'hold',
  ]),
  goal: z.enum(['grow_economy', 'secure_power', 'defend_colony', 'terraform_zone', 'raid_target']).optional(),
  targetColonyIndex: z.number().int().nonnegative().optional(),
  offerId: z.string().min(1).optional(),
  accept: z.boolean().optional(),
  durationHours: z.union([z.literal(6), z.literal(12), z.literal(24)]).optional(),
  tradePair: z.string().optional(),
  tradeAmount: z.number().int().positive().optional(),
  tradeNotionalAtomic: z.string().regex(/^\d+$/).optional(),
  rationale: z.string().min(1).max(180),
});
export type AgentDirective = z.infer<typeof AgentDirectiveSchema>;

export interface ColonyAgentEvalResult {
  readonly colonyIndex: number;
  readonly colonyId: string;
  readonly governed: boolean;
  readonly reason?: string;
  readonly directive?: AgentDirective;
  readonly guardrailRejected?: string;
  readonly submittedCommand?: SimCommandV1;
  readonly commandOutcome?: { readonly ok: boolean; readonly code?: string };
  readonly model?: string;
  readonly attestation?: LlmAttestation;
}

export interface ColonyObservation {
  readonly colonyIndex: number;
  readonly colonyId: string;
  readonly name: string;
  readonly stage: number;
  readonly away: boolean;
  readonly aiEnabled: boolean;
  readonly persona: 'trader' | 'warlord' | 'player';
  readonly warDiplomacyAllowed: boolean;
  readonly stock: Record<string, number>;
  readonly livingTiles: number;
  readonly openGoals: string[];
  readonly pendingOfferId: string | null;
  readonly unshieldedTargetIndex: number | null;
  readonly truceCandidateIndex: number | null;
}

export const DEFAULT_AGENT_ALLOWANCE: TradeAllowance = {
  allowedPairs: ['metals.t1/minerals.t1', 'metals.t1/bio.water', 'bio.water/minerals.t1', 'bio.biomass/minerals.t1'],
  maxOrderNotional: '500000000',
  maxOpenOrders: 4,
  dailyBudget: '2000000000',
  priceBandBp: 2500,
  killSwitch: false,
};

export function observeColony(state: PlanetState, colonyIndex: number): ColonyObservation {
  const col = state.colonies[colonyIndex]!;
  const meta = getRivalColonyMeta(state, colonyIndex);
  const warDiplomacyAllowed = Boolean(meta?.allowWarDiplomacy || resolveColonyAwayRaids(state, colonyIndex));
  const dip = readDiplomacyBlob(state);
  const pending = Object.values(dip.offers).find(
    (o) => o.status === 'pending' && o.toColonyIndex === colonyIndex && o.expiresAtTick > state.meta.tick,
  );
  let unshieldedTargetIndex: number | null = null;
  let truceCandidateIndex: number | null = null;
  for (const other of state.colonies) {
    if (!other || other.index === colonyIndex || other.status === 'eliminated') continue;
    const truced = hasActiveTruce(state, colonyIndex, other.index, state.meta.tick);
    if (!truced && truceCandidateIndex === null) truceCandidateIndex = other.index;
    if (!truced && !isColonyRaidProtected(state, other.index, state.meta.tick) && unshieldedTargetIndex === null) {
      unshieldedTargetIndex = other.index;
    }
  }
  return {
    colonyIndex,
    colonyId: col.id,
    name: col.name || col.id,
    stage: Math.max(Number(col.stage ?? 0), Number(col.unlockStage ?? 0)),
    away: colonyIsAway(state, colonyIndex),
    aiEnabled: col.aiEnabled === true,
    persona: meta?.persona ?? 'player',
    warDiplomacyAllowed,
    stock: getColonyStock(state, colonyIndex),
    livingTiles: colonyTerraformStats(state, colonyIndex).livingTiles,
    openGoals: getOpenColonyGoals(state, colonyIndex).map((g) => g.goal),
    pendingOfferId: pending?.offerId ?? null,
    unshieldedTargetIndex,
    truceCandidateIndex,
  };
}

export function deterministicDirective(obs: ColonyObservation): AgentDirective {
  if (obs.pendingOfferId) {
    return {
      action: 'respond_truce',
      offerId: obs.pendingOfferId,
      accept: obs.persona !== 'warlord' || !obs.warDiplomacyAllowed,
      rationale: 'Responded to pending diplomatic truce offer.',
    };
  }
  if (obs.openGoals.length > 0) {
    return { action: 'hold', rationale: `Continuing active goal ${obs.openGoals[0]}.` };
  }
  if (obs.persona === 'trader' && obs.truceCandidateIndex !== null) {
    return {
      action: 'propose_truce',
      targetColonyIndex: obs.truceCandidateIndex,
      durationHours: 6,
      rationale: 'Trader colony proposing 6h peace truce to protect trade corridors.',
    };
  }
  if (obs.warDiplomacyAllowed && obs.persona === 'warlord' && obs.stage >= 4 && obs.unshieldedTargetIndex !== null) {
    return {
      action: 'queue_goal',
      goal: 'raid_target',
      targetColonyIndex: obs.unshieldedTargetIndex,
      rationale: `Warlord launching raid against unshielded col_${obs.unshieldedTargetIndex}.`,
    };
  }
  if (obs.stage >= 4 && (obs.stock['bio.water'] ?? 0) >= 35 && (obs.stock['minerals.t1'] ?? 0) >= 20 && obs.livingTiles < 6) {
    return {
      action: 'queue_goal',
      goal: 'terraform_zone',
      rationale: 'Cultivating prepared hexes into Living ground.',
    };
  }
  if (obs.stage >= 3 && (obs.stock['metals.t1'] ?? 0) >= 220 && ((obs.stock['bio.water'] ?? 0) < 35 || (obs.stock['minerals.t1'] ?? 0) < 25)) {
    const scarce = (obs.stock['bio.water'] ?? 0) < 35 ? 'bio.water' : 'minerals.t1';
    return {
      action: 'trade',
      tradePair: `metals.t1/${scarce}`,
      tradeAmount: 25,
      tradeNotionalAtomic: '25000000',
      rationale: `Bartering surplus metals.t1 for scarce ${scarce}.`,
    };
  }
  return {
    action: 'queue_goal',
    goal: 'grow_economy',
    rationale: 'Expanding resource extraction and colony economy.',
  };
}

export function validateAgentGuardrails(
  directive: AgentDirective,
  obs: ColonyObservation,
  allowance: TradeAllowance = DEFAULT_AGENT_ALLOWANCE,
  usage: AllowanceUsage = { outstandingOrders: 0, committedToday: 0n, reference: null },
): string | null {
  if (directive.action === 'cancel_truce') return 'AW-13_CANCEL_TRUCE_FORBIDDEN';
  if (directive.action === 'stake') return 'D-18_STAKING_FORBIDDEN';
  if (directive.action === 'queue_goal' && directive.goal === 'raid_target' && !obs.warDiplomacyAllowed) {
    return 'AW-11_WAR_DIPLOMACY_DISABLED';
  }
  if (directive.action === 'trade') {
    const rej = checkAllowance(
      allowance,
      {
        pair: directive.tradePair ?? 'metals.t1/minerals.t1',
        amount: BigInt(directive.tradeAmount ?? 10),
        notional: BigInt(directive.tradeNotionalAtomic ?? '10000000'),
      },
      usage,
    );
    if (rej) return rej.code;
  }
  return null;
}

export function buildSimCommandFromDirective(obs: ColonyObservation, directive: AgentDirective): SimCommandV1 | null {
  const base = { colonyIndex: obs.colonyIndex, source: 'ai' as const, commandId: newId('cm') };
  if (directive.action === 'propose_truce' && directive.targetColonyIndex !== undefined) {
    return {
      ...base,
      kind: 'diplomacy.proposeTruce',
      args: { targetColonyId: `col_${directive.targetColonyIndex}`, durationHours: directive.durationHours ?? 6 },
    };
  }
  if (directive.action === 'respond_truce' && directive.offerId) {
    return {
      ...base,
      kind: 'diplomacy.respondTruce',
      args: { offerId: directive.offerId, accept: directive.accept !== false },
    };
  }
  if (directive.action === 'queue_goal' && directive.goal) {
    const params =
      directive.goal === 'raid_target' && directive.targetColonyIndex !== undefined
        ? { targetColonyId: directive.targetColonyIndex }
        : directive.goal === 'terraform_zone'
          ? { target: obs.livingTiles + 2 }
          : directive.goal === 'grow_economy'
            ? { resource: 'metals.t1', targetRatePerMin: 24 }
            : directive.goal === 'secure_power'
              ? { targetNetEnergyPerS: 10 }
              : undefined;
    return { ...base, kind: 'queueGoal', args: { goal: directive.goal, ...(params ? { params } : {}) } };
  }
  if (directive.action === 'trade') {
    const [baseRes = 'metals.t1', quoteRes = 'minerals.t1'] = (directive.tradePair ?? 'metals.t1/minerals.t1').split('/');
    const amount = directive.tradeAmount ?? 25;
    return {
      colonyIndex: obs.colonyIndex,
      source: 'player',
      commandId: newId('cm'),
      kind: 'market.placeOrder',
      args: {
        side: 'sell',
        resource: baseRes,
        amount,
        price: { token: quoteRes, amount: String(amount) },
        ttlS: 900,
      },
    };
  }
  return null;
}
