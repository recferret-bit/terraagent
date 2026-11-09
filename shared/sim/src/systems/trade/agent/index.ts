import type { ResourceKey } from '@terra/contracts';
import type { SideQuote } from './types';

/** Need / value quote library (ECONOMY section 4): pure, deterministic, bigint, no floats, no model output. */
export { WAD, integerRoot, powRatioWad } from './fixed-point';
export { agentParamsFromData, parseAgentParams, type AgentParams } from './params';
export { desiredBuyQty, sellableQty, targetFromBand, wholeLots } from './need';
export { minAskUnitPrice, walkAwayUnitPrice, validRatio, type Valued } from './value';
export { askTotal, bidTotal, midPrice, referenceReasons, scarcityRatio, type MidPrice } from './quote';
export { ceilTimes, floorTimes, principalForSpend, fitBid, type BidFit, type BidLimits } from './limits';
export { quoteAsk, quoteBid, quoteColony } from './decide';
export {
  AGENT_GOALS, AGENT_RISK_POSTURES, AGENT_SPECIALISATIONS, SCRIPTED_STRATEGIES, applyStrategyToColonyInput,
  findForbiddenPriceField, quoteColonyWithStrategy, resolveStrategyArg, validateAgentStrategy, type AgentGoal,
  type AgentResourceTarget, type AgentRiskPosture, type AgentSpecialisation, type AgentStrategyInput,
  type StrategyValidationErrorCode, type StrategyValidationResult,
} from './strategy';
export type {
  AgentColonyInput, AgentQuotes, AgentReason, ReferenceBasis, ReferenceInput, SideQuote, WalkAwayInputs,
} from './types';

/** `market.placeOrder` args of a side quote (the price is the order TOTAL); `amount` is safe because `maxOrderUnits` is bounded. */
export function toPlaceOrderArgs(q: SideQuote, resource: ResourceKey, ttlS: number): { side: 'buy' | 'sell'; resource: ResourceKey; amount: number; price: { token: string; amount: string }; ttlS: number } {
  if (q.amount > BigInt(Number.MAX_SAFE_INTEGER)) throw new RangeError('quote amount exceeds the safe integer range');
  return { side: q.side, resource, amount: Number(q.amount), price: { token: q.token, amount: q.priceAmount.toString() }, ttlS };
}
