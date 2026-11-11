/** What `allowCashBid` needs from the quote. The library's stale and thin rules, plus the cash flag. */
export interface CashBidView {
  readonly cashEnabled: number;
  readonly referenceAgeS: number | null;
  readonly eligibleVolume: number | null;
  readonly referenceMaxAgeS: number;
  readonly minReferenceVolume: number;
}

/**
 * Cash bids pause when cash is off, the reference is older than `referenceMaxAgeS`, or eligible
 * volume is below `minReferenceVolume`. Exact age and exact volume still pass. Inventory quotes do not call this.
 */
export function allowCashBid(view: CashBidView): boolean {
  if (view.cashEnabled !== 1) return false;
  if (!fresh(view.referenceAgeS, view.referenceMaxAgeS)) return false;
  return deepEnough(view.eligibleVolume, view.minReferenceVolume);
}

function fresh(age: number | null, maxAge: number): boolean {
  return age !== null && Number.isFinite(age) && age >= 0 && age <= maxAge;
}

function deepEnough(volume: number | null, minVolume: number): boolean {
  return volume !== null && Number.isFinite(volume) && volume >= minVolume;
}
