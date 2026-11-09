import type { RecipeDef } from '@terra/contracts';
import { metricOf, nullMetric, type FlowScope, type FlowWindow, type Metric } from './metric';
import { addRatio, divRatio, mulRatio, ratio, sumRatios, ZERO, type Ratio } from './ratio';

/** One activity's use of a resource: `count` runs of an activity that takes `inputPerRun` units each. */
export interface ActivityUse {
  readonly count: bigint;
  readonly inputPerRun: bigint;
}

/** `consumption_r = sum(activity_count_a * input_r_a) - recovered_r` (whole units, never below zero). */
export function consumption(activities: readonly ActivityUse[], recovered = 0n): bigint {
  const gross = activities.reduce((a, u) => a + u.count * u.inputPerRun, 0n);
  return gross > recovered ? gross - recovered : 0n;
}

/** `potential_buy_r = max(0, planned_consumption + desired_reserve - available_stock - expected_own_production)`. */
export function potentialBuy(o: { planned: bigint; reserve: bigint; available: bigint; expectedOwn: bigint }): bigint {
  const need = o.planned + o.reserve - o.available - o.expectedOwn;
  return need > 0n ? need : 0n;
}

/**
 * `days_of_inventory_r = available_inventory / mean_daily_consumption`, with the mean taken over the window:
 * `available * windowTicks / (windowConsumption * ticksPerDay)`. Zero consumption is `null` / `no_consumption`
 * (never infinity); an empty window or a zero day length is `null` / `insufficient_data`.
 */
export function daysOfInventory(
  o: { available: bigint; windowConsumption: bigint; window: FlowWindow; ticksPerDay: bigint; scope: FlowScope },
): Metric<Ratio> {
  const ticks = BigInt(o.window.endTick - o.window.startTick);
  if (ticks <= 0n || o.ticksPerDay <= 0n) return nullMetric('insufficient_data', 'days', o.window, o.scope);
  if (o.windowConsumption <= 0n) return nullMetric('no_consumption', 'days', o.window, o.scope);
  return metricOf(ratio(o.available * ticks, o.windowConsumption * o.ticksPerDay), 'days', o.window, o.scope);
}

/** A priced input: `units` of a resource at `price` quote-atomic per unit; `price: null` is an unknown price. */
export interface ValuedInput {
  readonly units: bigint;
  readonly price: Ratio | null;
}

/** Costs in quote-atomic units; `null` is "not measured", never zero. */
export interface UnitCostInputs {
  readonly inputs: readonly ValuedInput[];
  readonly amortization: Ratio | null;
  readonly transport: Ratio | null;
  readonly expectedLosses: Ratio | null;
  readonly saleableOutput: bigint;
}

/**
 * `unit_cost_r = (valued_inputs + equipment_amortization + transport + expected_losses) / saleable_output`, exact.
 * A used input without a price is `null` / `uncertain_price`; a missing amortization, transport or loss term, or no
 * saleable output, is `null` / `insufficient_data`. Costs guide decisions; they are not a price floor.
 */
export function unitCost(i: UnitCostInputs, window: FlowWindow, scope: FlowScope): Metric<Ratio> {
  const unit = 'quote_atomic_per_unit';
  if (i.inputs.some((x) => x.units > 0n && x.price === null)) return nullMetric('uncertain_price', unit, window, scope);
  if (i.amortization === null || i.transport === null || i.expectedLosses === null || i.saleableOutput <= 0n) {
    return nullMetric('insufficient_data', unit, window, scope);
  }
  const valued = sumRatios(i.inputs.map((x) => (x.price ? mulRatio(ratio(x.units), x.price) : ZERO)));
  const total = addRatio(addRatio(valued, i.amortization), addRatio(i.transport, i.expectedLosses));
  return metricOf(divRatio(total, ratio(i.saleableOutput)), unit, window, scope);
}

/**
 * Production minutes per unit of a recipe: `durationTicks * tickMs / 60000 / outputAmount`. A recipe whose output is
 * not a resource, or whose amount is zero, is `null` (`no_resource_output` / `insufficient_data`).
 */
export function recipeMinutesPerUnit(recipe: RecipeDef, tickMs: number, window: FlowWindow, scope: FlowScope): Metric<Ratio> {
  if (recipe.output.kind !== 'resource') return nullMetric('no_resource_output', 'minutes_per_unit', window, scope);
  const amount = BigInt(recipe.output.amount);
  if (amount <= 0n) return nullMetric('insufficient_data', 'minutes_per_unit', window, scope);
  return metricOf(ratio(BigInt(recipe.durationTicks) * BigInt(tickMs), 60_000n * amount), 'minutes_per_unit', window, scope);
}

/** Production minutes per unit of a rate source (an extractor): `unitsPerSecond` as a rational, e.g. 1/1 or 7/8. */
export function rateMinutesPerUnit(unitsPerSecond: Ratio, window: FlowWindow, scope: FlowScope): Metric<Ratio> {
  if (unitsPerSecond.num <= 0n) return nullMetric('insufficient_data', 'minutes_per_unit', window, scope);
  return metricOf(divRatio(ratio(1n, 60n), unitsPerSecond), 'minutes_per_unit', window, scope);
}

/** An amount split into what is already realized (cash/ledger) and what is only estimated; both in quote-atomic. */
export interface RealizedEstimated {
  readonly realized: bigint;
  readonly estimated: bigint;
}

export interface PlatformContributionInput {
  /** Eligible quote volume (nominal quote atomic) of settled / of modelled trades. */
  readonly eligibleQuoteVolume: RealizedEstimated;
  readonly platformFeeBp: number;
  readonly treasuryAllocations: RealizedEstimated;
  readonly executionCosts: RealizedEstimated;
  readonly subsidies: RealizedEstimated;
  readonly attributedOperatingCosts: RealizedEstimated;
}

export interface PlatformContribution {
  readonly realized: Ratio;
  readonly estimated: Ratio;
  /** `realized + estimated`: only for display, never a settled figure. */
  readonly combined: Ratio;
}

/**
 * `platform_contribution = eligible_quote_volume * platform_fee_rate - treasury_allocations - execution_costs -
 * subsidies - attributed_operating_costs`, exact, with realized and estimated kept apart (an estimate never turns
 * into a realized figure by being added).
 */
export function platformContribution(i: PlatformContributionInput): PlatformContribution {
  const part = (k: keyof RealizedEstimated): Ratio => {
    const fee = ratio(i.eligibleQuoteVolume[k] * BigInt(i.platformFeeBp), 10_000n);
    const costs = i.treasuryAllocations[k] + i.executionCosts[k] + i.subsidies[k] + i.attributedOperatingCosts[k];
    return addRatio(fee, ratio(-costs));
  };
  const realized = part('realized'), estimated = part('estimated');
  return { realized, estimated, combined: addRatio(realized, estimated) };
}
