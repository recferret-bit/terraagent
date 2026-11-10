import type { EscrowPort } from '../application/ports/escrow.port';
import { escrowSuite, type EscrowContractHelpers } from './escrow.suite';
import { defineNearContract, describeNearPortContract, type MakeAdapter } from './harness';

interface BalanceRow {
  amount: { toFixed(digits?: number): string };
}

/** The mock exposes these. A real adapter (W23-40) will not, until it grows the same seam. */
interface TestableEscrow {
  creditCargo?(accountId: string, tokenId: string, amount: string): Promise<void>;
  prisma?: {
    mockChainBalance: {
      findUnique(args: {
        where: { accountId_tokenId: { accountId: string; tokenId: string } };
      }): Promise<BalanceRow | null>;
    };
  };
}

function helpers(port: EscrowPort): EscrowContractHelpers {
  const testable = port as unknown as TestableEscrow;
  return {
    fund: async (accountId, tokenId, amount) => {
      if (!testable.creditCargo) throw new Error('Escrow adapter has no creditCargo seam; cannot fund a poster');
      await testable.creditCargo(accountId, tokenId, amount);
    },
    balance: async (accountId, tokenId) => {
      const db = testable.prisma;
      if (!db) throw new Error('Escrow adapter has no prisma client; cannot read a cargo balance');
      const row = await db.mockChainBalance.findUnique({
        where: { accountId_tokenId: { accountId, tokenId } },
      });
      return row?.amount.toFixed(0) ?? '0';
    },
  };
}

export const contract = defineNearContract<EscrowPort, EscrowContractHelpers>({
  port: 'Escrow',
  helpers,
  suite: escrowSuite,
});

export const describeEscrowPortContract = (
  label: string,
  make: MakeAdapter<EscrowPort, EscrowContractHelpers>,
): void => describeNearPortContract('Escrow', label, make, escrowSuite);
