import { expect } from 'vitest';
import type { ChainReadPort } from '../application/ports/chain-read.port';
import { ChainHealth, ChainReceipt } from '../domain/types';
import { defineNearContract, type MakeAdapter } from './harness';

/** Helper every ChainRead adapter under test gets: a way to put one successful receipt on its ledger. */
export interface ChainReadHelpers {
  /** Produces a successful receipt that `port.receipt(hash)` must then return. */
  writeReceipt(): Promise<ChainReceipt>;
}

/**
 * Mocks and fakes expose `ping()` (a write through the mock chain). A real adapter has no write, so it reads a receipt
 * that already exists on the network: `CONTRACT_CHAIN_READ_TX` (hash of any successful tx on the selected network).
 */
async function helpers(port: ChainReadPort, kind: string, env: Readonly<Record<string, string | undefined>>): Promise<ChainReadHelpers> {
  const ping = (port as Partial<{ ping(): Promise<ChainReceipt> }>).ping?.bind(port);
  if (ping) return { writeReceipt: () => ping() };
  const hash = env.CONTRACT_CHAIN_READ_TX;
  if (!hash) throw new Error(`ChainRead contract on ${kind}: set CONTRACT_CHAIN_READ_TX to the hash of a successful ${kind} transaction`);
  return { writeReceipt: async () => (await port.receipt(hash))! };
}

/** Port contract for `ChainReadPort`: runs the same assertions against any adapter. */
export const contract = defineNearContract<ChainReadPort, ChainReadHelpers>({
  port: 'ChainRead',
  helpers,
  suite: ({ test, mockOnly, expectReceipt }) => {
    test('health() reports ok with a latency', async (a) => {
      const h = await a.port.health();
      expect(ChainHealth.safeParse(h).success).toBe(true);
      expect(h.ok).toBe(true);
      expect(h.latencyMs).toBeGreaterThanOrEqual(0);
      expect(h.network).toBe(a.kind);
    });

    test('receipt(hash) returns the receipt that was written', async (a) => {
      const written = await a.writeReceipt();
      const read = await a.port.receipt(written.txHash);
      expect(read).not.toBeNull();
      expect(ChainReceipt.safeParse(read).success).toBe(true);
      expect(read).toMatchObject({ txHash: written.txHash, status: 'success', blockHeight: written.blockHeight });
      expectReceipt(read!, a, 'success');
    });

    mockOnly('receipt(unknown hash) is null', async (a) => {
      expect(await a.port.receipt('mock:' + '1'.repeat(44))).toBeNull();
    });

    test('receipt(unknown real-shaped hash) is null', async (a) => {
      expect(await a.port.receipt('1'.repeat(44))).toBeNull();
    });

    test('explorerUrl(hash) is a string or null, and null for mock hashes', async (a) => {
      const { txHash } = await a.writeReceipt();
      const url = a.port.explorerUrl(txHash);
      if (a.kind === 'mock') expect(url).toBeNull();
      else expect(typeof url).toBe('string');
    });
  },
});

/** Runs the ChainRead suite against any adapter factory (kept for the specs that name their adapter). */
export const describeChainReadContract = (label: string, make: MakeAdapter<ChainReadPort, ChainReadHelpers>): void => contract.run(label, make);
