import { describe, expect, it } from 'vitest';
import type { ChainReadPort } from '../application/ports/chain-read.port.js';
import { ChainHealth, ChainReceipt } from '../domain/types.js';

/** What the contract needs from an adapter under test: the port, and a way to put one real receipt on its ledger. */
export interface ChainReadHarness {
  readonly port: ChainReadPort;
  /** Produces a successful receipt that `port.receipt(hash)` must then return. */
  writeReceipt(): Promise<ChainReceipt>;
  /** True for adapters on the mock network (`mock:` hashes, no explorer). */
  readonly mock: boolean;
}

/** Port contract for `ChainReadPort`: runs the same assertions against any adapter. */
export function describeChainReadContract(name: string, makeHarness: () => ChainReadHarness | Promise<ChainReadHarness>): void {
  describe(`ChainReadPort contract: ${name}`, () => {
    it('health() reports ok with a latency', async () => {
      const { port, mock } = await makeHarness();
      const h = await port.health();
      expect(ChainHealth.safeParse(h).success).toBe(true);
      expect(h.ok).toBe(true);
      expect(h.latencyMs).toBeGreaterThanOrEqual(0);
      if (mock) expect(h.network).toBe('mock');
    });

    it('receipt(hash) returns the receipt that was written', async () => {
      const { port, writeReceipt, mock } = await makeHarness();
      const written = await writeReceipt();
      const read = await port.receipt(written.txHash);
      expect(read).not.toBeNull();
      expect(ChainReceipt.safeParse(read).success).toBe(true);
      expect(read).toMatchObject({ txHash: written.txHash, status: 'success', blockHeight: written.blockHeight });
      if (mock) expect(read!.txHash.startsWith('mock:')).toBe(true);
    });

    it('receipt(unknown hash) is null', async () => {
      const { port } = await makeHarness();
      expect(await port.receipt('mock:' + '1'.repeat(44))).toBeNull();
    });

    it('explorerUrl(hash) is a string or null, and null for mock hashes', async () => {
      const { port, mock, writeReceipt } = await makeHarness();
      const { txHash } = await writeReceipt();
      const url = port.explorerUrl(txHash);
      if (mock) expect(url).toBeNull();
      else expect(typeof url).toBe('string');
    });
  });
}
