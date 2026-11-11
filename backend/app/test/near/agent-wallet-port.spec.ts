import { describe, expect, it } from 'vitest';
import {
  AgentWalletPort,
  agentWalletReceiverAllowed,
  type AddLimitedKeyInput,
  type AllowanceOpInput,
  type CreateSubAccountInput,
  type KeyStatus,
  type KeyStatusQuery,
  type RevokeKeyInput,
} from '../../src/near/application/ports/agent-wallet.port';
import { NEAR_ERROR_CODES, NearException } from '../../src/near/domain/errors';
import type { ChainReceipt } from '../../src/near/domain/types';

const receipt: ChainReceipt = { txHash: 'mock:1', status: 'success', network: 'mock', at: 1 };

const status: KeyStatus = {
  accountId: 'guild-1.npc.terraagent.mock',
  publicKey: 'ed25519:abc',
  revoked: false,
  receiverId: 'intents.near',
  methodNames: ['mt_transfer'],
  tokens: [{ token: 'metals.t1', allowance: '600', reserved: '0', spent: '200', available: '400' }],
  gasAllowance: '100000000000000000000000',
  gasSpent: '0',
};

/** Proves the W15-01 methods are part of the port: a subclass that omits one does not typecheck. */
class FakeAgentWallet extends AgentWalletPort {
  createSubAccount(input: CreateSubAccountInput) {
    return Promise.resolve({ accountId: `${input.name}.${input.parent}`, receipt });
  }
  addLimitedKey(_input: AddLimitedKeyInput) { return Promise.resolve(receipt); }
  revokeKey(_input: RevokeKeyInput) { return Promise.resolve(receipt); }
  keyStatus(_input: KeyStatusQuery) { return Promise.resolve(status); }
  reserveAllowance(_input: AllowanceOpInput): Promise<never> {
    return Promise.reject(new NearException('NEAR_ALLOWANCE_EXHAUSTED'));
  }
  consumeAllowance(_input: AllowanceOpInput) { return Promise.resolve({ status, receipt }); }
  releaseAllowance(_input: AllowanceOpInput) { return Promise.resolve({ status, receipt }); }
}

describe('W15-01 AgentWalletPort.keyStatus and NEAR_ALLOWANCE_EXHAUSTED', () => {
  it('keyStatus reports the principal ledger on the port', async () => {
    const port: AgentWalletPort = new FakeAgentWallet();
    const got = await port.keyStatus({ accountId: status.accountId, publicKey: status.publicKey });
    expect(got.tokens[0]).toMatchObject({ allowance: '600', spent: '200', available: '400' });
    expect(got.gasSpent).toBe('0');
  });

  it('reserve throws NEAR_ALLOWANCE_EXHAUSTED as 409 when available is short', async () => {
    const port: AgentWalletPort = new FakeAgentWallet();
    await expect(port.reserveAllowance({
      opId: 'reserve:1', accountId: status.accountId, publicKey: status.publicKey, token: 'metals.t1', amount: '500',
    })).rejects.toMatchObject({ errorCode: 'NEAR_ALLOWANCE_EXHAUSTED', status: 409 });
    expect(NEAR_ERROR_CODES.NEAR_ALLOWANCE_EXHAUSTED.status).toBe(409);
  });

  it('allows only intents.near and res.* receivers, including the empty and near-miss cases', () => {
    expect(agentWalletReceiverAllowed('intents.near')).toBe(true);
    expect(agentWalletReceiverAllowed('res.terraagent.mock')).toBe(true);
    expect(agentWalletReceiverAllowed('res.')).toBe(true);
    expect(agentWalletReceiverAllowed('guild.near')).toBe(false);
    expect(agentWalletReceiverAllowed('intent.near')).toBe(false);
    expect(agentWalletReceiverAllowed('')).toBe(false);
  });
});
