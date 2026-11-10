import type { ResourceKey } from '@terra/contracts';
import {
  quoteColonyWithStrategy,
  toPlaceOrderArgs,
  validateAgentStrategy,
  type AgentColonyInput,
  type AgentParams,
  type StrategyValidationErrorCode,
} from '../trade/agent';

export {
  checkDirectorActionPermission,
  evaluateAggressionSkillProposal,
  type AggressionSkillProposalResult,
  type DirectorActionPermissionInput,
  type DirectorActionPermissionResult,
} from './w18-pvp-adapter';

/** Player flags for later-wave strategies. Risk is not a flag and never grants one. */
export interface StrategyPermissions {
  readonly raids: boolean;
  readonly upgrades: boolean;
  readonly launch: boolean;
}

/** True only when that strategy's own flag is on. All false denies diplomacy, technology and settlement. */
export function strategyPermitted(skillId: 'diplomacy' | 'technology' | 'settlement', perms: StrategyPermissions): boolean {
  switch (skillId) {
    case 'diplomacy': return perms.raids;
    case 'technology': return perms.upgrades;
    case 'settlement': return perms.launch;
  }
}

/**
 * Player-set bot key allowances (W16-38, D-45). The trade skill never signs, never holds chain keys,
 * and cannot raise its own allowances.
 */
export interface BotTradeAllowance {
  readonly colonyId: string;
  readonly botKeyId: string;
  readonly killed: boolean;
  readonly allowedPairs: readonly ResourceKey[];
  readonly openOrders: number;
  readonly maxOpenOrders: number;
  readonly maxOrderNotional: bigint;
  readonly remainingDailyBudget: bigint;
  readonly minUnitPrice: bigint;
  readonly maxUnitPrice: bigint;
}

export interface BotTradeOrder {
  readonly source: 'bot';
  readonly actorKind: 'bot';
  readonly colonyId: string;
  readonly botKeyId: string;
  readonly side: 'buy' | 'sell';
  readonly resource: ResourceKey;
  readonly amount: number;
  readonly price: { readonly token: string; readonly amount: string };
  readonly ttlS: number;
}

export type TradeProposalRejectReason =
  | StrategyValidationErrorCode
  | 'allowance_escalation_forbidden'
  | 'bot_key_killed'
  | 'pair_not_allowed'
  | 'max_open_orders'
  | 'no_quote'
  | 'price_out_of_band'
  | 'over_allowance';

export type TradeSkillProposalResult =
  | { readonly ok: true; readonly order: BotTradeOrder }
  | { readonly ok: false; readonly reason: TradeProposalRejectReason };

const ESCALATION_KEYS = new Set([
  'allowances',
  'maxopenorders',
  'maxordernotional',
  'dailyspendbudget',
  'privatekey',
  'secretkey',
  'seedphrase',
]);

function hasEscalationKey(raw: unknown): boolean {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return false;
  return Object.keys(raw as Record<string, unknown>).some((k) => ESCALATION_KEYS.has(k.toLowerCase()));
}

/**
 * Evaluates a W16 trade-skill strategy proposal against the W13 quote library and player-configured
 * bot key allowances (W16-38, D-45). Rejects free prices, allowance escalation, out-of-band prices,
 * and over-allowance notional; returns an in-bounds W13 bot order with `source: 'bot'`.
 */
export function evaluateTradeSkillProposal(
  rawProposal: unknown,
  allowance: BotTradeAllowance,
  colonyInput: AgentColonyInput,
  params: AgentParams,
): TradeSkillProposalResult {
  if (hasEscalationKey(rawProposal)) {
    return { ok: false, reason: 'allowance_escalation_forbidden' };
  }
  const validated = validateAgentStrategy(rawProposal);
  if (!validated.ok) {
    return { ok: false, reason: validated.code };
  }
  if (allowance.killed) return { ok: false, reason: 'bot_key_killed' };
  if (!allowance.allowedPairs.includes(colonyInput.resource)) return { ok: false, reason: 'pair_not_allowed' };
  if (allowance.openOrders >= allowance.maxOpenOrders) return { ok: false, reason: 'max_open_orders' };

  const quotes = quoteColonyWithStrategy(validated.value, colonyInput, params);
  const quote = quotes.bid ?? quotes.ask;
  if (!quote || quote.amount <= 0n) return { ok: false, reason: 'no_quote' };

  const unitPrice = quote.priceAmount / quote.amount;
  if (unitPrice < allowance.minUnitPrice || unitPrice > allowance.maxUnitPrice) {
    return { ok: false, reason: 'price_out_of_band' };
  }
  if (quote.priceAmount > allowance.maxOrderNotional || quote.priceAmount > allowance.remainingDailyBudget) {
    return { ok: false, reason: 'over_allowance' };
  }

  const orderArgs = toPlaceOrderArgs(quote, colonyInput.resource, validated.value.maxOrderTtlS ?? 3600);
  return {
    ok: true,
    order: {
      ...orderArgs,
      source: 'bot',
      actorKind: 'bot',
      colonyId: allowance.colonyId,
      botKeyId: allowance.botKeyId,
    },
  };
}
