import { defineTable } from './_define';

/**
 * Bounty target kinds and posting bounds (W22-02, NEAR-110, D-35).
 * `policy` is the wave's stated limit: at most 3 active bounties per colony, expiry 2–48 h.
 * Kind rows hold the params tracking reads, so they are not constants in system code.
 * `clear_nest` uses `damageWindowTicks` (300 raw ticks = 60 s). It is not listed in `units`:
 * compileData would turn a seconds field into ticks, and this value must stay 300.
 * `damageWindowS` is that same window in design seconds and is not compiled.
 * `defend_area` radius is 1..8 tiles and presence must cover 8 000 bp (80 %) of the duration (W22-21);
 * `deliver_units` amount is at least 1. Hours stay in design units (the server converts those).
 * Rows drop out when flag W22 is off.
 */
export default defineTable({
  name: 'bounty',
  summary: 'Bounty target kinds and the per-colony active and expiry bounds (W22, NEAR-110).',
  rows: [
    { id: 'clear_nest', wave: 'W22', damageWindowS: 60, damageWindowTicks: 300 },
    { id: 'defend_area', wave: 'W22', radiusMin: 1, radiusMax: 8, presenceMinBp: 8000 },
    { id: 'deliver_units', wave: 'W22', amountMin: 1 },
    { id: 'policy', wave: 'W22', maxActive: 3, expiryMinH: 2, expiryMaxH: 48 },
  ],
});
