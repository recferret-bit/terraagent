import { Inject, Injectable, Optional } from '@nestjs/common';
import { RESOURCE_KEYS, toChainUnits, type ResourceKey } from '@terra/contracts';
import type { PrismaClient } from '@terra/db';
import { PRISMA } from '../../db/db.module.js';
import { IntentsBalanceReadPort } from '../application/ports/intents-balance-read.port.js';

/** Order states whose `reservedPrincipal` still locks funds (closed orders carry no reservation). */
const OPEN_ORDER_STATES = ['PENDING', 'OPEN', 'PARTIAL', 'MATCHED'];

/**
 * Free verifier balance of a colony account (W13-16): verifier (`intents.near`) balance minus the principal that open market sell orders
 * reserve. In-orbit cargo is account + free verifier; an import withdraws only free funds, never reserved ones. All amounts are chain base units.
 */
@Injectable()
export class FreeVerifierService {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    @Optional() private readonly verifier?: IntentsBalanceReadPort,
  ) {}

  /** Sum of `reservedPrincipal` (whole units) of the account's open sell orders of `resource`, in chain base units. */
  async reservedChain(accountId: string, resource: ResourceKey): Promise<bigint> {
    const agg = await this.prisma.marketOrder.aggregate({
      where: { accountId, base: resource, side: 'sell', state: { in: OPEN_ORDER_STATES } },
      _sum: { reservedPrincipal: true },
    });
    return toChainUnits(resource, agg._sum.reservedPrincipal?.toFixed() ?? '0');
  }

  async totalChain(accountId: string, resource: ResourceKey): Promise<bigint> {
    return this.verifier ? this.verifier.verifierChainBalance(accountId, resource) : 0n;
  }

  /** Verifier balance minus reservations, never negative. */
  async freeChain(accountId: string, resource: ResourceKey): Promise<bigint> {
    const [total, reserved] = await Promise.all([this.totalChain(accountId, resource), this.reservedChain(accountId, resource)]);
    return total > reserved ? total - reserved : 0n;
  }

  /** Free and reserved chain amounts for every resource where either is non-zero. */
  async snapshot(accountId: string): Promise<Partial<Record<ResourceKey, { free: bigint; reserved: bigint }>>> {
    const out: Partial<Record<ResourceKey, { free: bigint; reserved: bigint }>> = {};
    await Promise.all(RESOURCE_KEYS.map(async (key) => {
      const [total, reserved] = await Promise.all([this.totalChain(accountId, key), this.reservedChain(accountId, key)]);
      const free = total > reserved ? total - reserved : 0n;
      if (free > 0n || reserved > 0n) out[key] = { free, reserved };
    }));
    return out;
  }
}
