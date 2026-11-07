import { defineTable } from './_define';

/**
 * W13 market bootstrap defaults (D-44, ECONOMY §3, NEAR §12). Production pins a database profile version (W13-03,
 * W13-38); these rows are the bootstrap/seed values and what `?host=local`, tests and experiments compile.
 *  - `policy`: buyer-paid platform fee 100 bp, stall fee 0–100 bp (default 100), W22 treasury share of the platform
 *    fee (applied only while W22 is on), TTL options, open-order limit per colony, base lot (whole units).
 *  - `resource.<ResourceKey>` (all ten): per-resource policy defaults (reserve horizon, target inventory band as bp of
 *    the family storage cap, lot, tradable flag); ECONOMY §2. Calibration hypotheses, not facts.
 *  - `board`: price-board limits (window, candle size, thin-data minimums, counterparty weight cap, outlier move, staleness).
 *  - `supply`: weight thresholds of the abundant / scarce resource badges.
 *  - `quote.<token>`: minimum notional and price tick per quote token, market atomic units as decimal strings
 *    (USDC micro, NEAR yocto, resources whole units). A resource quote (barter) uses `quote.resource`.
 */
export default defineTable({
  name: 'market',
  summary: 'W13 market policy bootstrap: buyer-paid platform/stall fees, TTL options, order limit, lot, minimum notional per quote token.',
  units: { reserveHorizonS: 'seconds' },
  fixed: { fields: ['policyVersion'], why: 'identifies the pinned policy; a new version is a new profile (W13-03)' },
  rows: [
    {
      id: 'policy',
      wave: 'W13',
      policyVersion: 'bootstrap-1',
      platformFeeBp: 100,
      stallFeeMinBp: 0,
      stallFeeMaxBp: 100,
      stallFeeDefaultBp: 100,
      treasuryShareBp: 2000,
      ttlOptionsS: [900, 3600, 21600, 86400],
      openOrderLimit: 20,
      baseLotUnits: 1,
      bookDepthLevels: 10,
      bookPushHz: 1,
    },
    // Dev only (`market.seed`, W13-30): fixture bot ladder around a mid price. `mid*Atomic` is quote atomic per whole base unit
    // (USDC micro, NEAR yocto, resource whole units); each level moves `stepBp` away from mid; every order is `sizeUnits` big.
    { id: 'dev.seed', wave: 'W13', levels: 5, stepBp: 500, sizeUnits: 100, midUsdcAtomic: '400000', midNearAtomic: '100000000000000000000000', midResourceAtomic: '2', ttlS: 86400 },
    // Price board (W13-18): what counts as an organic reference price. Calibration hypotheses.
    { id: 'board', wave: 'W13', windowS: 86400, candleS: 3600, minEligibleTrades: 3, minEligibleVolume: 10, minCounterparties: 3, counterpartyWeightCapBp: 4000, maxMoveBp: 5000, stalenessS: 3600 },
    // Supply & trade panel (W13-55): regional abundance badges from the pinned endowment weight (10000 = reference weight).
    { id: 'supply', wave: 'W13', abundantWeightBp: 12000, scarceWeightBp: 5000 },
    // Quote agent (ECONOMY section 4, `systems/trade/agent/`): the mid-price exponent k = Num/Den, the inventory-scarcity clamp and
    // epsilon, half-spreads, the saving a bid must promise and the margin an ask keeps over own cost, per-order size and
    // quote budget, and when a reference price is too old or too thin to bid on. Calibration hypotheses, not facts.
    {
      id: 'agent', wave: 'W13', scarcityExponentNum: 1, scarcityExponentDen: 2, epsilonUnits: 10, clampLowBp: 5000, clampHighBp: 20000,
      bidHalfSpreadBp: 200, askHalfSpreadBp: 200, minSavingBp: 200, reserveMarginBp: 500, maxOrderUnits: 100,
      maxOrderQuoteAtomic: '1000000000', referenceMaxAgeS: 3600, minReferenceVolume: 10,
    },
    { id: 'quote.USDC', wave: 'W13', minNotionalAtomic: '100000', tickAtomic: '1' },
    { id: 'quote.NEAR', wave: 'W13', minNotionalAtomic: '10000000000000000000000', tickAtomic: '1' },
    { id: 'quote.resource', wave: 'W13', minNotionalAtomic: '1', tickAtomic: '1' },
    { id: 'resource.metals.t1', wave: 'W13', reserveHorizonS: 3600, targetBandLoBp: 1000, targetBandHiBp: 8000, lotUnits: 1, tradable: true },
    { id: 'resource.metals.t2', wave: 'W13', reserveHorizonS: 3600, targetBandLoBp: 1000, targetBandHiBp: 8000, lotUnits: 1, tradable: true },
    { id: 'resource.metals.t3', wave: 'W13', reserveHorizonS: 3600, targetBandLoBp: 1000, targetBandHiBp: 8000, lotUnits: 1, tradable: true },
    { id: 'resource.minerals.t1', wave: 'W13', reserveHorizonS: 3600, targetBandLoBp: 1000, targetBandHiBp: 8000, lotUnits: 1, tradable: true },
    { id: 'resource.minerals.t2', wave: 'W13', reserveHorizonS: 3600, targetBandLoBp: 1000, targetBandHiBp: 8000, lotUnits: 1, tradable: true },
    { id: 'resource.minerals.t3', wave: 'W13', reserveHorizonS: 3600, targetBandLoBp: 1000, targetBandHiBp: 8000, lotUnits: 1, tradable: true },
    { id: 'resource.bio.water', wave: 'W13', reserveHorizonS: 3600, targetBandLoBp: 1000, targetBandHiBp: 8000, lotUnits: 1, tradable: true },
    { id: 'resource.bio.biomass', wave: 'W13', reserveHorizonS: 3600, targetBandLoBp: 1000, targetBandHiBp: 8000, lotUnits: 1, tradable: true },
    { id: 'resource.bio.t2', wave: 'W13', reserveHorizonS: 3600, targetBandLoBp: 1000, targetBandHiBp: 8000, lotUnits: 1, tradable: true },
    { id: 'resource.bio.t3', wave: 'W13', reserveHorizonS: 3600, targetBandLoBp: 1000, targetBandHiBp: 8000, lotUnits: 1, tradable: true },
  ],
});
