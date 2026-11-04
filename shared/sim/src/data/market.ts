import { defineTable } from './_define';

/**
 * W13 market bootstrap defaults (D-44, ECONOMY §3, NEAR §12). Production pins a database profile version (W13-03,
 * W13-38); these rows are the bootstrap/seed values and what `?host=local`, tests and experiments compile.
 *  - `policy`: buyer-paid platform fee 100 bp, stall fee 0–100 bp (default 100), W22 treasury share of the platform
 *    fee (applied only while W22 is on), TTL options, open-order limit per colony, base lot (whole units).
 *  - `quote.<token>`: minimum notional and price tick per quote token, market atomic units as decimal strings
 *    (USDC micro, NEAR yocto, resources whole units). A resource quote (barter) uses `quote.resource`.
 */
export default defineTable({
  name: 'market',
  summary: 'W13 market policy bootstrap: buyer-paid platform/stall fees, TTL options, order limit, lot, minimum notional per quote token.',
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
    { id: 'quote.USDC', wave: 'W13', minNotionalAtomic: '100000', tickAtomic: '1' },
    { id: 'quote.NEAR', wave: 'W13', minNotionalAtomic: '10000000000000000000000', tickAtomic: '1' },
    { id: 'quote.resource', wave: 'W13', minNotionalAtomic: '1', tickAtomic: '1' },
  ],
});
