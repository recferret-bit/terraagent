import type { SimCommandV1, TradeAllowance } from '@terra/contracts';
import { newId } from '@terra/contracts';
import {
  colonyIsAway,
  colonyTerraformStats,
  ENTITY_KIND,
  ENTITY_STATE,
  getColonyPower,
  getColonyStock,
  getOpenColonyGoals,
  getRivalColonyMeta,
  hasActiveTruce,
  isColonyRaidProtected,
  isRivalAiColony,
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
    'declare_war',
    'raid',
    'trade',
    'accept_guild_offer',
    'cancel_truce',
    'stake',
    'hold',
  ]),
  goal: z.enum(['grow_economy', 'secure_power', 'defend_colony', 'terraform_zone', 'raid_target']).optional(),
  targetColonyIndex: z.number().int().nonnegative().optional(),
  offerId: z.string().min(1).optional(),
  accept: z.boolean().optional(),
  durationHours: z.union([z.literal(2), z.literal(6), z.literal(12), z.literal(24), z.literal(72)]).optional(),
  tradeSide: z.enum(['buy', 'sell']).optional(),
  tradePair: z.string().optional(),
  tradeAmount: z.number().int().positive().optional(),
  tradeNotionalAtomic: z.string().regex(/^\d+$/).optional(),
  rationale: z.string().min(1).max(180),
});
export type AgentDirective = z.infer<typeof AgentDirectiveSchema>;

export const BatchedAgentDirectiveItemSchema = AgentDirectiveSchema.extend({
  colonyIndex: z.number().int().nonnegative(),
});
export type BatchedAgentDirectiveItem = z.infer<typeof BatchedAgentDirectiveItemSchema>;

export const BatchedAgentDirectivesSchema = z.object({
  directives: z.array(BatchedAgentDirectiveItemSchema),
});

export interface ColonyAgentEvalResult {
  readonly colonyIndex: number;
  readonly colonyId: string;
  readonly governed: boolean;
  readonly isBot?: boolean;
  readonly usedPlayerKey?: boolean;
  readonly cached?: boolean;
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
  readonly isBot: boolean;
  readonly stage: number;
  readonly away: boolean;
  readonly aiEnabled: boolean;
  readonly persona: 'trader' | 'warlord' | 'player';
  readonly warDiplomacyAllowed: boolean;
  readonly stock: Record<string, number>;
  readonly inOrbit?: Record<string, number>;
  readonly hasTradeHub?: boolean;
  readonly powerNetPerS: number;
  readonly brownout: boolean;
  readonly combatUnits: number;
  readonly turrets: number;
  readonly livingTiles: number;
  readonly openGoals: string[];
  readonly pendingOfferId: string | null;
  readonly unshieldedTargetIndex: number | null;
  readonly truceCandidateIndex: number | null;
  readonly activeTruces: number[];
}

export const DEFAULT_AGENT_ALLOWANCE: TradeAllowance = {
  allowedPairs: [
    'metals.t1/minerals.t1',
    'metals.t1/bio.water',
    'bio.water/minerals.t1',
    'bio.biomass/minerals.t1',
    'metals.t1/USDC',
    'minerals.t1/USDC',
    'bio.water/USDC',
    'bio.biomass/USDC',
  ],
  maxOrderNotional: '500000000',
  maxOpenOrders: 4,
  dailyBudget: '2000000000',
  priceBandBp: 2500,
  killSwitch: false,
};

function countColonyDefense(
  state: PlanetState,
  colonyIndex: number,
): { combatUnits: number; turrets: number; hasTradeHub: boolean } {
  const { count, cols } = state.entities;
  let combatUnits = 0;
  let turrets = 0;
  let hasTradeHub = false;
  for (let r = 0; r < count; r++) {
    if (cols.owner[r] !== colonyIndex || cols.hp[r]! <= 0) continue;
    const st = cols.state[r]!;
    if (st === ENTITY_STATE.inert || st === ENTITY_STATE.descending) continue;
    const k = cols.kind[r]!;
    if (k === ENTITY_KIND.recon || k === ENTITY_KIND.demoTank || k === ENTITY_KIND.demoArtillery) combatUnits++;
    if (k === ENTITY_KIND.autocannon || k === ENTITY_KIND.laserTower) turrets++;
    if (k === ENTITY_KIND.tradeHub) hasTradeHub = true;
  }
  return { combatUnits, turrets, hasTradeHub };
}

export function observeColony(state: PlanetState, colonyIndex: number): ColonyObservation {
  const col = state.colonies[colonyIndex]!;
  const meta = getRivalColonyMeta(state, colonyIndex);
  const isBot = isRivalAiColony(state, colonyIndex);
  const warDiplomacyAllowed = Boolean(meta?.allowWarDiplomacy || resolveColonyAwayRaids(state, colonyIndex));
  const dip = readDiplomacyBlob(state);
  const pending = Object.values(dip.offers).find(
    (o) => o.status === 'pending' && o.toColonyIndex === colonyIndex && o.expiresAtTick > state.meta.tick,
  );
  let unshieldedTargetIndex: number | null = null;
  let truceCandidateIndex: number | null = null;
  const activeTruces: number[] = [];
  for (const other of state.colonies) {
    if (!other || other.index === colonyIndex || other.status === 'eliminated') continue;
    const truced = hasActiveTruce(state, colonyIndex, other.index, state.meta.tick);
    if (truced) {
      activeTruces.push(other.index);
      continue;
    }
    if (truceCandidateIndex === null) truceCandidateIndex = other.index;
    if (!isColonyRaidProtected(state, other.index, state.meta.tick) && unshieldedTargetIndex === null) {
      unshieldedTargetIndex = other.index;
    }
  }
  const { combatUnits, turrets, hasTradeHub } = countColonyDefense(state, colonyIndex);
  const rawCargo = (col as { cargo?: { inOrbit?: Record<string, number> } }).cargo;
  const inOrbit = rawCargo?.inOrbit ? { ...rawCargo.inOrbit } : {};
  const pwr = getColonyPower(state, colonyIndex);
  const powerNetPerS = Math.round((pwr?.net ?? 0) * 10) / 10;
  const brownout = Boolean(pwr?.brownout) || Boolean((col as { brownout?: boolean }).brownout) || powerNetPerS < 0;
  return {
    colonyIndex,
    colonyId: col.id,
    name: col.name || col.id,
    isBot,
    stage: Math.max(Number(col.stage ?? 0), Number(col.unlockStage ?? 0)),
    away: colonyIsAway(state, colonyIndex),
    aiEnabled: col.aiEnabled === true,
    persona: meta?.persona ?? 'player',
    warDiplomacyAllowed,
    stock: getColonyStock(state, colonyIndex),
    inOrbit,
    hasTradeHub,
    powerNetPerS,
    brownout,
    combatUnits,
    turrets,
    livingTiles: colonyTerraformStats(state, colonyIndex).livingTiles,
    openGoals: getOpenColonyGoals(state, colonyIndex).map((g) => g.goal),
    pendingOfferId: pending?.offerId ?? null,
    unshieldedTargetIndex,
    truceCandidateIndex,
    activeTruces,
  };
}

export function observationDigest(obs: ColonyObservation): string {
  return [
    obs.colonyIndex,
    obs.stage,
    obs.persona,
    obs.brownout ? 1 : 0,
    obs.pendingOfferId ?? '-',
    obs.unshieldedTargetIndex ?? '-',
    obs.truceCandidateIndex ?? '-',
  ].join('|');
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
  if (obs.powerNetPerS < 0) {
    return {
      action: 'queue_goal',
      goal: 'secure_power',
      rationale: 'Restoring colony power grid balance during energy deficit.',
    };
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
  const canTradeMetalsInOrbit =
    obs.hasTradeHub !== false &&
    (obs.inOrbit === undefined || Object.keys(obs.inOrbit).length === 0
      ? obs.hasTradeHub === true && (obs.inOrbit?.['metals.t1'] ?? 0) >= 25
      : (obs.inOrbit['metals.t1'] ?? 0) >= 25);
  if (
    obs.stage >= 3 &&
    canTradeMetalsInOrbit &&
    (obs.stock['metals.t1'] ?? 0) >= 220 &&
    ((obs.stock['bio.water'] ?? 0) < 35 || (obs.stock['minerals.t1'] ?? 0) < 25)
  ) {
    const scarce = (obs.stock['bio.water'] ?? 0) < 35 ? 'bio.water' : 'minerals.t1';
    return {
      action: 'trade',
      tradeSide: 'sell',
      tradePair: `metals.t1/${scarce}`,
      tradeAmount: 25,
      tradeNotionalAtomic: '25000000',
      rationale: `Bartering surplus metals.t1 for scarce ${scarce} via NEAR Intents.`,
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
  const isWarAction =
    directive.action === 'declare_war' ||
    directive.action === 'raid' ||
    (directive.action === 'queue_goal' && directive.goal === 'raid_target');
  if (isWarAction && !obs.warDiplomacyAllowed) {
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
  if (directive.action === 'propose_truce') {
    const target = directive.targetColonyIndex ?? obs.truceCandidateIndex;
    if (target === null || target === undefined) return null;
    const rawHours = directive.durationHours ?? 6;
    const validHours = rawHours === 2 || rawHours === 6 || rawHours === 24 || rawHours === 72 ? rawHours : 6;
    return {
      ...base,
      kind: 'diplomacy.proposeTruce',
      args: { targetColonyId: `col_${target}`, durationHours: validHours },
    };
  }
  if (directive.action === 'respond_truce') {
    const offerId = directive.offerId ?? obs.pendingOfferId;
    if (!offerId) return null;
    return {
      ...base,
      kind: 'diplomacy.respondTruce',
      args: { offerId, accept: directive.accept !== false },
    };
  }
  if (directive.action === 'declare_war' || directive.action === 'raid') {
    const target = directive.targetColonyIndex ?? obs.unshieldedTargetIndex;
    if (target === null || target === undefined) return null;
    if (obs.combatUnits > 0) {
      return {
        ...base,
        kind: 'raid',
        args: { targetColonyId: `col_${target}`, targetColonyIndex: target },
      };
    }
    return {
      ...base,
      kind: 'queueGoal',
      args: { goal: 'raid_target', params: { targetColonyId: target } },
    };
  }
  if (directive.action === 'queue_goal' && directive.goal) {
    const target = directive.targetColonyIndex ?? obs.unshieldedTargetIndex ?? undefined;
    const params =
      directive.goal === 'raid_target' && target !== undefined
        ? { targetColonyId: target }
        : directive.goal === 'terraform_zone'
          ? { target: obs.livingTiles + 2 }
          : directive.goal === 'grow_economy'
            ? { resource: 'metals.t1', targetRatePerMin: 24 }
            : directive.goal === 'secure_power'
              ? { targetNetEnergyPerS: 10 }
              : undefined;
    return { ...base, kind: 'queueGoal', args: { goal: directive.goal, ...(params ? { params } : {}) } };
  }
  if (directive.action === 'accept_guild_offer' && directive.offerId) {
    return {
      colonyIndex: obs.colonyIndex,
      source: 'player',
      commandId: newId('cm'),
      kind: 'market.acceptGuildOffer',
      args: { offerId: directive.offerId },
    };
  }
  if (directive.action === 'trade') {
    const [baseRes = 'metals.t1', quoteRes = 'minerals.t1'] = (directive.tradePair ?? 'metals.t1/minerals.t1').split('/');
    const amount = directive.tradeAmount ?? 25;
    const side = directive.tradeSide ?? 'sell';
    const quoteAmount =
      quoteRes === 'USDC' || quoteRes === 'NEAR'
        ? directive.tradeNotionalAtomic ?? String(amount * 1_000_000)
        : String(amount);
    return {
      colonyIndex: obs.colonyIndex,
      source: 'player',
      commandId: newId('cm'),
      kind: 'market.placeOrder',
      args: {
        side,
        resource: baseRes,
        amount,
        price: { token: quoteRes, amount: quoteAmount },
        ttlS: 900,
      },
    };
  }
  return null;
}

function stripJsonFence(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.startsWith('```')) {
    return trimmed.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
  }
  return trimmed;
}

export function parseDirectiveJson(raw: string): AgentDirective | null {
  try {
    const obj = JSON.parse(stripJsonFence(raw)) as unknown;
    const res = AgentDirectiveSchema.safeParse(obj);
    return res.success ? res.data : null;
  } catch {
    return null;
  }
}

export function parseBatchedDirectivesJson(
  raw: string,
  observations: readonly ColonyObservation[],
): { readonly map: Map<number, AgentDirective>; readonly isBatchedPayload: boolean } | null {
  try {
    const obj = JSON.parse(stripJsonFence(raw)) as unknown;
    const batched = BatchedAgentDirectivesSchema.safeParse(obj);
    if (batched.success) {
      const map = new Map<number, AgentDirective>();
      for (const item of batched.data.directives) {
        const { colonyIndex, ...directive } = item;
        map.set(colonyIndex, directive);
      }
      return { map, isBatchedPayload: true };
    }
    if (Array.isArray(obj)) {
      const map = new Map<number, AgentDirective>();
      obj.forEach((entry, idx) => {
        const withIdx = BatchedAgentDirectiveItemSchema.safeParse(entry);
        if (withIdx.success) {
          const { colonyIndex, ...directive } = withIdx.data;
          map.set(colonyIndex, directive);
          return;
        }
        const single = AgentDirectiveSchema.safeParse(entry);
        const obs = observations[idx];
        if (single.success && obs) map.set(obs.colonyIndex, single.data);
      });
      if (map.size > 0) return { map, isBatchedPayload: true };
    }
    const single = AgentDirectiveSchema.safeParse(obj);
    if (single.success && observations[0]) {
      const map = new Map<number, AgentDirective>();
      map.set(observations[0].colonyIndex, single.data);
      return { map, isBatchedPayload: false };
    }
    return null;
  } catch {
    return null;
  }
}
