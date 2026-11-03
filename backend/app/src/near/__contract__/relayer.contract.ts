import { expect } from 'vitest';
import type { RelayerPort, SubmitMetaTxInput } from '../application/ports/relayer.port';
import { defineNearContract } from './harness';

const delegate = 'delegate-bytes';

function submit(opId: string, receiverId: string): SubmitMetaTxInput {
  return { opId, signerId: 'alice.near', receiverId, signedDelegate: delegate };
}

/** Port contract for `RelayerPort`. The same caller `opId` must come back as the same receipt. */
export const contract = defineNearContract<RelayerPort>({
  port: 'Relayer',
  helpers: () => ({}),
  suite: ({ test, expectReceipt }) => {
    test('submitMetaTx to evil.near throws NEAR_RELAY_RECEIVER_NOT_ALLOWED', async ({ port }) => {
      const attempt = port.submitMetaTx(submit('relay:evil', 'evil.near'));
      await expect(attempt).rejects.toMatchObject({ errorCode: 'NEAR_RELAY_RECEIVER_NOT_ALLOWED' });
    });

    test('a valid submit is a success receipt, and the same opId returns that txHash', async (a) => {
      const input = submit('relay:once', 'res.terraagent.mock');
      const first = await a.port.submitMetaTx(input);
      expectReceipt(first, a, 'success');
      const second = await a.port.submitMetaTx(input);
      expect(second.txHash).toBe(first.txHash);
    });

    test('a distinct opId still relays, even with the same delegate', async (a) => {
      const first = await a.port.submitMetaTx(submit('relay:distinct-a', 'res.terraagent.mock'));
      const second = await a.port.submitMetaTx(submit('relay:distinct-b', 'res.terraagent.mock'));
      expectReceipt(second, a, 'success');
      expect(second.txHash).not.toBe(first.txHash);
    });
  },
});
