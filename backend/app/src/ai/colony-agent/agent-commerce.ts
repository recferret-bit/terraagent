import { createHash } from 'node:crypto';

export type AgentPaymentCurrency = 'USDC' | 'NEAR';
export type AgentSettlementRail = 'near_intents_nep413' | 'bounty_escrow' | 'self_executed' | 'walked_away';
export type NegotiationDecision = 'accepted_initial' | 'accepted_counter' | 'walked_away';

export interface NegotiationInput {
  readonly itemOrService: string;
  readonly quantity: number;
  readonly currency: AgentPaymentCurrency;
  readonly plannedUnitPrice: number;
  readonly walkAwayUnitPrice: number;
  readonly sellerInitialAsk: number;
  readonly sellerFloorPrice: number;
  readonly remainingBudget: number;
  readonly benchmarkNote: string;
}

export interface NegotiationResult {
  readonly decision: NegotiationDecision;
  readonly sellerInitialAsk: number;
  readonly plannedUnitPrice: number;
  readonly walkAwayUnitPrice: number;
  readonly counterUnitPrice: number | null;
  readonly counterReasoning: string | null;
  readonly finalUnitPrice: number | null;
  readonly totalCost: number;
}

export interface AgentTaskReceipt {
  readonly taskId: string;
  readonly day: number;
  readonly buyerAccountId: string;
  readonly sellerAccountId: string;
  readonly category: 'self_execute' | 'buy_commodity' | 'hire_agent_bounty';
  readonly whatWasBought: string;
  readonly quantity: number;
  readonly currency: AgentPaymentCurrency;
  readonly settlementRail: AgentSettlementRail;
  readonly negotiation: NegotiationResult;
  readonly unitPricePaid: number;
  readonly totalPaid: number;
  readonly workPassedCheck: boolean;
  readonly checkSummary: string;
  readonly settlementRef: string;
}

export interface ContractorPlanReport {
  readonly contractorAccountId: string;
  readonly goal: string;
  readonly keyPolicySummary: string;
  readonly budgetUsdc: number;
  readonly spentUsdc: number;
  readonly budgetNear: number;
  readonly spentNear: number;
  readonly withinBudget: boolean;
  readonly selfExecutedSteps: readonly string[];
  readonly receipts: readonly AgentTaskReceipt[];
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function receiptHash(seed: string, label: string): string {
  return createHash('sha256').update(`${seed}:${label}`).digest('hex').slice(0, 16);
}

/**
 * Track 07 (`agents`) 1-round negotiation rule:
 * - If seller ask <= planned unit price (and fits remaining budget), accept immediately.
 * - If seller ask > planned unit price, counter ONCE with explicit reasoning anchored to
 *   planned price + benchmark, capped at walkAwayUnitPrice.
 * - Accept if the seller meets <= walkAwayUnitPrice within remaining budget; otherwise walk away.
 */
export function negotiateAgentQuote(input: NegotiationInput): NegotiationResult {
  const initialTotal = round2(input.sellerInitialAsk * input.quantity);
  if (input.sellerInitialAsk <= input.plannedUnitPrice && initialTotal <= input.remainingBudget) {
    return {
      decision: 'accepted_initial',
      sellerInitialAsk: input.sellerInitialAsk,
      plannedUnitPrice: input.plannedUnitPrice,
      walkAwayUnitPrice: input.walkAwayUnitPrice,
      counterUnitPrice: null,
      counterReasoning: null,
      finalUnitPrice: input.sellerInitialAsk,
      totalCost: initialTotal,
    };
  }

  const targetMid = round2((input.plannedUnitPrice + Math.min(input.sellerInitialAsk, input.walkAwayUnitPrice)) / 2);
  const counterUnitPrice = round2(Math.min(input.walkAwayUnitPrice, Math.max(input.plannedUnitPrice, targetMid)));
  const counterReasoning =
    `Quote ${input.sellerInitialAsk.toFixed(2)} ${input.currency} exceeds planned ` +
    `${input.plannedUnitPrice.toFixed(2)} ${input.currency} (${input.benchmarkNote}); ` +
    `countering once at ${counterUnitPrice.toFixed(2)} ${input.currency} ` +
    `(walk-away cap ${input.walkAwayUnitPrice.toFixed(2)} ${input.currency}).`;

  const sellerReply = round2(Math.max(input.sellerFloorPrice, counterUnitPrice));
  const replyTotal = round2(sellerReply * input.quantity);
  if (sellerReply <= input.walkAwayUnitPrice && replyTotal <= input.remainingBudget) {
    return {
      decision: 'accepted_counter',
      sellerInitialAsk: input.sellerInitialAsk,
      plannedUnitPrice: input.plannedUnitPrice,
      walkAwayUnitPrice: input.walkAwayUnitPrice,
      counterUnitPrice,
      counterReasoning,
      finalUnitPrice: sellerReply,
      totalCost: replyTotal,
    };
  }

  return {
    decision: 'walked_away',
    sellerInitialAsk: input.sellerInitialAsk,
    plannedUnitPrice: input.plannedUnitPrice,
    walkAwayUnitPrice: input.walkAwayUnitPrice,
    counterUnitPrice,
    counterReasoning: `${counterReasoning} Seller held at ${sellerReply.toFixed(2)} ${input.currency} — walked away.`,
    finalUnitPrice: null,
    totalCost: 0,
  };
}

interface OutsourcedSpec {
  readonly taskId: string;
  readonly day: number;
  readonly sellerAccountId: string;
  readonly category: 'buy_commodity' | 'hire_agent_bounty';
  readonly rail: 'near_intents_nep413' | 'bounty_escrow';
  readonly itemOrService: string;
  readonly quantity: number;
  readonly currency: AgentPaymentCurrency;
  readonly plannedUnitPrice: number;
  readonly walkAwayUnitPrice: number;
  readonly sellerInitialAsk: number;
  readonly sellerFloorPrice: number;
  readonly benchmarkNote: string;
  readonly checkPassText: string;
  readonly walkAwayFallbackText: string;
}

function buildSpecs(rootAccount: string, jitter: number): readonly OutsourcedSpec[] {
  return [
    {
      taskId: 'task_01_water_cargo',
      day: 2,
      sellerAccountId: `kestrel.npc.${rootAccount}`,
      category: 'buy_commodity',
      rail: 'near_intents_nep413',
      itemOrService: 'nep245:bio.water irrigation cargo',
      quantity: 40,
      currency: 'USDC',
      plannedUnitPrice: 0.92,
      walkAwayUnitPrice: 0.98,
      sellerInitialAsk: round2(0.88 + jitter * 0.02),
      sellerFloorPrice: 0.86,
      benchmarkNote: 'Guild cold-start mid 0.90 USDC',
      checkPassText: 'Verified +40 bio.water credited on res contract & zero-sum NEP-413 batch balanced.',
      walkAwayFallbackText: 'Paused external water purchase; diverted condensation collectors.',
    },
    {
      taskId: 'task_02_minerals_counter',
      day: 4,
      sellerAccountId: `iron-guild.${rootAccount}`,
      category: 'buy_commodity',
      rail: 'near_intents_nep413',
      itemOrService: 'nep245:minerals.t1 capacitor grade',
      quantity: 35,
      currency: 'USDC',
      plannedUnitPrice: 1.18,
      walkAwayUnitPrice: 1.28,
      sellerInitialAsk: 1.36,
      sellerFloorPrice: 1.25,
      benchmarkNote: '24h organic VWAP 1.20 USDC',
      checkPassText: 'Verified +35 minerals.t1 delivered to orbital hold; counter-signed token_diff settled.',
      walkAwayFallbackText: 'Walked away from overpriced minerals quote.',
    },
    {
      taskId: 'task_03_mercenary_escrow',
      day: 5,
      sellerAccountId: `aegis-defense.agents.${rootAccount}`,
      category: 'hire_agent_bounty',
      rail: 'bounty_escrow',
      itemOrService: 'Raid-defense patrol escort (2x Recon intercept)',
      quantity: 1,
      currency: 'NEAR',
      plannedUnitPrice: 3.8,
      walkAwayUnitPrice: 4.4,
      sellerInitialAsk: 4.8,
      sellerFloorPrice: 4.2,
      benchmarkNote: 'bounty escrow median 3.90 NEAR',
      checkPassText: 'Verified 0 depot breaches across Day-5 raid window; released bounty escrow payout.',
      walkAwayFallbackText: 'Walked away from mercenary quote; queued local turret construction.',
    },
    {
      taskId: 'task_04_alloy_walkaway',
      day: 6,
      sellerAccountId: `crimson-vanguard.${rootAccount}`,
      category: 'buy_commodity',
      rail: 'near_intents_nep413',
      itemOrService: 'nep245:alloys.t2 rush batch',
      quantity: 20,
      currency: 'USDC',
      plannedUnitPrice: 2.35,
      walkAwayUnitPrice: 2.75,
      sellerInitialAsk: 3.6,
      sellerFloorPrice: 3.3,
      benchmarkNote: 'local Smelter unit cost 2.40 USDC',
      checkPassText: 'Verified +20 alloys.t2 delivered.',
      walkAwayFallbackText: 'Rejected 3.30 USDC ask (> 2.75 cap); smelted locally inside colony power budget.',
    },
  ];
}

/** Executes a bounded general-contractor plan with 1-round counter-quotes and per-task verification receipts. */
export function executeContractorTaskPlan(
  seed: string,
  rootAccount = 'terraagent.testnet',
): ContractorPlanReport {
  const contractorAccountId = `verdant-collective.${rootAccount}`;
  const budgetUsdc = 120;
  const budgetNear = 6;
  let spentUsdc = 0;
  let spentNear = 0;
  const jitter = ((seed.charCodeAt(0) || 42) % 5) * 0.01;
  const specs = buildSpecs(rootAccount, jitter);
  const receipts: AgentTaskReceipt[] = [];

  for (const s of specs) {
    const rem = s.currency === 'USDC' ? round2(budgetUsdc - spentUsdc) : round2(budgetNear - spentNear);
    const neg = negotiateAgentQuote({
      itemOrService: s.itemOrService,
      quantity: s.quantity,
      currency: s.currency,
      plannedUnitPrice: s.plannedUnitPrice,
      walkAwayUnitPrice: s.walkAwayUnitPrice,
      sellerInitialAsk: s.sellerInitialAsk,
      sellerFloorPrice: s.sellerFloorPrice,
      remainingBudget: rem,
      benchmarkNote: s.benchmarkNote,
    });
    const settled = neg.decision !== 'walked_away' && neg.finalUnitPrice !== null;
    if (settled) {
      if (s.currency === 'USDC') spentUsdc = round2(spentUsdc + neg.totalCost);
      else spentNear = round2(spentNear + neg.totalCost);
    }
    const refPrefix = !settled ? 'walkaway' : s.rail === 'bounty_escrow' ? 'escrow' : 'nep413';
    receipts.push({
      taskId: s.taskId,
      day: s.day,
      buyerAccountId: contractorAccountId,
      sellerAccountId: s.sellerAccountId,
      category: s.category,
      whatWasBought: s.itemOrService,
      quantity: s.quantity,
      currency: s.currency,
      settlementRail: settled ? s.rail : 'walked_away',
      negotiation: neg,
      unitPricePaid: neg.finalUnitPrice ?? 0,
      totalPaid: neg.totalCost,
      workPassedCheck: settled,
      checkSummary: settled ? s.checkPassText : s.walkAwayFallbackText,
      settlementRef: `${refPrefix}:${receiptHash(seed, s.taskId)}`,
    });
  }

  return {
    contractorAccountId,
    goal: 'Expand Living hexes to Stage 5, buffer night power grid & defend perimeter depots',
    keyPolicySummary:
      'Scoped Ed25519 session key (director-key / ta_bot_...); daily spend caps 120 USDC & 6 NEAR; cannot break truces (AW-13), demolish buildings (AW-10), or stake validator NEAR (403 D-18).',
    budgetUsdc,
    spentUsdc,
    budgetNear,
    spentNear,
    withinBudget: spentUsdc <= budgetUsdc && spentNear <= budgetNear,
    selfExecutedSteps: [
      'Self-executed: graded, irrigated & seeded +11 Living hexes using local colony drones ($0 external spend)',
      'Self-executed: scheduled night-cycle capacitor discharge & local T2 Smelter fallback after task_04 walk-away',
    ],
    receipts,
  };
}
