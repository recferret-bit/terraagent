/** Pause when a reserve would pass the per-NPC cap or the global cap. Not a new NEAR error code. */
export const FUNDING_CAP = 'funding_cap' as const;

export type FundingBucket = 'cash' | 'inventory';

/** Open reservation plus what settlement already consumed, against one cap. */
export interface ExposureSide {
  readonly reserved: bigint;
  readonly spent: bigint;
  readonly cap: bigint;
}

/** The npc's book and the guild-wide book. A reserve has to fit both. */
export interface ExposureBook {
  readonly npc: ExposureSide;
  readonly global: ExposureSide;
}

export interface StoredBook {
  readonly cash: ExposureSide;
  readonly inventory: ExposureSide;
  readonly killed: boolean;
}

export interface FundingPair {
  readonly npc: StoredBook;
  readonly global: StoredBook;
}

export type ReserveResult =
  | { readonly ok: true; readonly book: ExposureBook }
  | { readonly ok: false; readonly reason: typeof FUNDING_CAP | 'killed'; readonly book: ExposureBook };

/** Cash columns or inventory columns. The arithmetic is the same. */
export function bookOf(pair: FundingPair, bucket: FundingBucket): ExposureBook {
  return bucket === 'cash'
    ? { npc: pair.npc.cash, global: pair.global.cash }
    : { npc: pair.npc.inventory, global: pair.global.inventory };
}

/**
 * Hold `amount` on both books. Over either cap, or a negative amount, leaves the books untouched
 * and returns `funding_cap`. Zero always fits.
 */
export function reserveExposure(book: ExposureBook, amount: bigint): ReserveResult {
  if (amount === 0n) return { ok: true, book };
  if (amount < 0n || !fits(book.npc, amount) || !fits(book.global, amount)) {
    return { ok: false, reason: FUNDING_CAP, book };
  }
  return { ok: true, book: { npc: addReserved(book.npc, amount), global: addReserved(book.global, amount) } };
}

/** Give back a reservation. Each side stops at zero; spent and cap stay put. */
export function releaseExposure(book: ExposureBook, amount: bigint): ExposureBook {
  const n = amount > 0n ? amount : 0n;
  return { npc: subReserved(book.npc, n), global: subReserved(book.global, n) };
}

/**
 * Turn a reservation into spent exposure (a fill). Only reserved units move, so reserved cannot
 * go negative and a consume cannot spend more than was held.
 */
export function consumeExposure(book: ExposureBook, amount: bigint): ExposureBook {
  const n = amount > 0n ? amount : 0n;
  return { npc: consumeSide(book.npc, n), global: consumeSide(book.global, n) };
}

function fits(side: ExposureSide, amount: bigint): boolean {
  return side.reserved + side.spent + amount <= side.cap;
}

function addReserved(side: ExposureSide, amount: bigint): ExposureSide {
  return { ...side, reserved: side.reserved + amount };
}

function subReserved(side: ExposureSide, amount: bigint): ExposureSide {
  const take = amount > side.reserved ? side.reserved : amount;
  return { ...side, reserved: side.reserved - take };
}

function consumeSide(side: ExposureSide, amount: bigint): ExposureSide {
  const take = amount > side.reserved ? side.reserved : amount;
  return { ...side, reserved: side.reserved - take, spent: side.spent + take };
}
