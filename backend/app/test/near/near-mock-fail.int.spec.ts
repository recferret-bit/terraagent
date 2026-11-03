import { createTestDatabase, type TestDatabase } from '@terra/db/testing';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { NearException } from '../../src/near/domain/errors';
import { MockRelayerAdapter } from '../../src/near/infrastructure/adapters/relayer/mock-relayer.adapter';
import { mockChainControls } from '../../src/near/infrastructure/mock/mock-controls';
import { MOCK_HASH_RE } from '../../src/near/infrastructure/mock/tx-hash';

let db: TestDatabase;

beforeAll(async () => { db = await createTestDatabase(); });
afterAll(async () => { mockChainControls.reset(); await db?.drop(); });
afterEach(() => { mockChainControls.reset(); });

describe('near.mock.fail relayer', () => {
  it('rate 1 ends as NEAR_RELAY_FAILED; rate 0 returns a mock: receipt', async () => {
    const relayer = new MockRelayerAdapter(
      db.prisma,
      { latencyMinMs: 0, latencyMaxMs: 0, failRate: 0 },
      { sleep: async () => undefined },
    );
    const submit = (signedDelegate: string) => relayer.submitMetaTx({
      opId: 'relay:w06-25',
      signerId: 'alice.near',
      receiverId: 'res.terraagent.mock',
      signedDelegate,
    });

    mockChainControls.setFail('relayer', 1);
    const before = await db.prisma.mockChainReceipt.count();
    const err = await submit('delegate-bytes-fail').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(NearException);
    expect(err).toMatchObject({ errorCode: 'NEAR_RELAY_FAILED' });
    expect(await db.prisma.mockChainReceipt.count()).toBe(before);

    mockChainControls.setFail('relayer', 0);
    const receipt = await submit('delegate-bytes-ok');
    expect(receipt.txHash).toMatch(MOCK_HASH_RE);
    expect(receipt).toMatchObject({ status: 'success', network: 'mock' });
  });
});
