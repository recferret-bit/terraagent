import { BountyTarget } from '@terra/contracts';
import type { PrismaClient } from '@terra/db';
import { toCargoBaseUnits } from '../application/ports/cargo-token.port.js';
import type { BountyRow } from './view.js';

const ACTIVE = ['open', 'claimed'] as const;

/** Active `deliver_units` rows this sender may fill by paying this poster account. */
export function deliverCandidates(prisma: PrismaClient, to: string, from: string, now: Date): Promise<BountyRow[]> {
  return prisma.chainBounty.findMany({
    where: {
      accountId: to,
      claimerAccountId: from,
      state: { in: [...ACTIVE] },
      expiresAt: { gt: now },
    },
  });
}

/** Base units still required, or null when this transfer is not that bounty's resource. */
export function deliverNeed(row: BountyRow, tokenId: string): bigint | null {
  const parsed = BountyTarget.safeParse(row.target);
  if (!parsed.success || parsed.data.kind !== 'deliver_units' || parsed.data.resource !== tokenId) return null;
  return BigInt(toCargoBaseUnits(parsed.data.amount));
}

/** Insert is a no-op when this op was already counted for the bounty. */
export async function recordDelivery(prisma: PrismaClient, bountyId: string, opId: string, amount: string): Promise<void> {
  try {
    await prisma.chainBountyDelivery.create({ data: { bountyId, opId, amount } });
  } catch (err) {
    if (!isUnique(err)) throw err;
  }
}

export async function deliveredBase(prisma: PrismaClient, bountyId: string): Promise<bigint> {
  const rows = await prisma.chainBountyDelivery.findMany({ where: { bountyId }, select: { amount: true } });
  let total = 0n;
  for (const row of rows) total += BigInt(row.amount.toFixed(0));
  return total;
}

/** One transition to `completed`. A later call, or an expired row, returns false. */
export async function completeOnce(prisma: PrismaClient, id: string, now: Date): Promise<boolean> {
  const result = await prisma.chainBounty.updateMany({
    where: { id, state: { in: [...ACTIVE] }, expiresAt: { gt: now } },
    data: { state: 'completed' },
  });
  return result.count === 1;
}

function isUnique(err: unknown): boolean {
  return typeof err === 'object' && err !== null && 'code' in err && (err as { code: string }).code === 'P2002';
}
