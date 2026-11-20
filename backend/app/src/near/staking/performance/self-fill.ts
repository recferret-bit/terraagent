/** The parties of one fill (`chain.intent_trade`). */
export interface FillParties {
  readonly buyerAccountId: string;
  readonly sellerAccountId: string;
  readonly stallAccountId: string;
  readonly buyerColonyId: string;
  readonly sellerColonyId: string;
  readonly stallColonyId: string;
}

/** A `chain.near_colony_account` row's ownership columns. */
export interface AccountOwnerRow {
  readonly accountId: string;
  readonly playerId?: string | null;
  readonly ownerAccountId?: string | null;
  readonly claimedByAccountId?: string | null;
}

/** Every identity an account answers to: itself, its owner / claimant wallet and its player. */
export type IdentitiesOf = (accountId: string) => ReadonlySet<string>;

export function identityResolver(rows: readonly AccountOwnerRow[]): IdentitiesOf {
  const byAccount = new Map(rows.map((r) => [r.accountId, r]));
  return (accountId) => {
    const ids = new Set<string>([`owner:${accountId}`]);
    const r = byAccount.get(accountId);
    if (r) {
      if (r.playerId) ids.add(`player:${r.playerId}`);
      if (r.ownerAccountId) ids.add(`owner:${r.ownerAccountId}`);
      if (r.claimedByAccountId) ids.add(`owner:${r.claimedByAccountId}`);
    }
    return ids;
  };
}

const overlap = (a: ReadonlySet<string>, b: ReadonlySet<string>): boolean => {
  for (const x of a) if (b.has(x)) return true;
  return false;
};

/**
 * A self-fill earns nothing real: `buyerOwner == sellerOwner` or `buyerOwner == stallOwner` (same owner behind
 * both accounts, or the same colony on both sides). Such fills are wash trades and never count as fee savings or
 * stall royalties.
 */
export function isSelfFill(f: FillParties, identitiesOf: IdentitiesOf): boolean {
  if (f.buyerColonyId === f.sellerColonyId || f.buyerColonyId === f.stallColonyId) return true;
  const buyer = identitiesOf(f.buyerAccountId);
  return overlap(buyer, identitiesOf(f.sellerAccountId)) || overlap(buyer, identitiesOf(f.stallAccountId));
}
