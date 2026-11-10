import { expect } from 'vitest';
import type { AgentWalletPort, KeyStatus } from '../application/ports/agent-wallet.port';
import type { ChainReceipt } from '../domain/types';
import { defineNearContract, type AdapterUnderTest, type MakeAdapter, type NearContractApi } from './harness';

type Wallet = AdapterUnderTest<AgentWalletPort>;
type ReceiptCheck = NearContractApi<AgentWalletPort>['expectReceipt'];

/** Gas allowance of a function-call key. It is not principal and these methods do not spend it. */
const GAS = '1000000000000000000000000';
const TOKEN = 'metals.t1';
const PARENT = 'npc.terraagent.mock';

const uid = (): string => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

interface Opened {
  readonly accountId: string;
  readonly publicKey: string;
  readonly keyReceipt: ChainReceipt;
}

function tokenOf(status: KeyStatus, token = TOKEN): KeyStatus['tokens'][number] {
  const row = status.tokens.find((item) => item.token === token);
  if (!row) throw new Error(`missing ${token}`);
  return row;
}

async function openKey(port: AgentWalletPort, tag: string, allowance = '600'): Promise<Opened> {
  const name = `${tag}${uid()}`;
  const created = await port.createSubAccount({ opId: `acct:${name}`, parent: PARENT, name });
  const publicKey = `ed25519:${name}`;
  const keyReceipt = await port.addLimitedKey({
    opId: `key:${name}`,
    accountId: created.accountId,
    publicKey,
    allowance: GAS,
    receiverId: 'intents.near',
    methodNames: ['execute_intents'],
    tokens: [{ token: TOKEN, allowance }],
  });
  return { accountId: created.accountId, publicKey, keyReceipt };
}

function allowanceOp(opened: Opened, opId: string, amount: string) {
  return { opId, accountId: opened.accountId, publicKey: opened.publicKey, token: TOKEN, amount };
}

/** `{name}.{parent}`, same opId replays, a second name is `NEAR_ACCOUNT_EXISTS`. */
async function testSubAccountNaming(a: Wallet, expectReceipt: ReceiptCheck): Promise<void> {
  const name = `g${uid()}`;
  const opId = `sub:${name}`;
  const first = await a.port.createSubAccount({ opId, parent: PARENT, name });
  expect(first.accountId).toBe(`${name}.${PARENT}`);
  expectReceipt(first.receipt, a, 'success');

  const replay = await a.port.createSubAccount({ opId, parent: PARENT, name });
  expect(replay.accountId).toBe(first.accountId);
  expect(replay.receipt.txHash).toBe(first.receipt.txHash);

  await expect(a.port.createSubAccount({ opId: `sub2:${name}`, parent: PARENT, name })).rejects.toMatchObject({
    errorCode: 'NEAR_ACCOUNT_EXISTS',
  });
  const again = await a.port.createSubAccount({ opId, parent: PARENT, name });
  expect(again.accountId).toBe(first.accountId);
  expect(again.receipt.txHash).toBe(first.receipt.txHash);
}

/** `addLimitedKey` records token principal and gas. It does not spend either. */
async function testLimitedKeyStatus(a: Wallet, expectReceipt: ReceiptCheck): Promise<void> {
  const opened = await openKey(a.port, 'k');
  expectReceipt(opened.keyReceipt, a, 'success');
  const status = await a.port.keyStatus({ accountId: opened.accountId, publicKey: opened.publicKey });
  expect(status.revoked).toBe(false);
  expect(status.receiverId).toBe('intents.near');
  expect(status.methodNames).toEqual(['execute_intents']);
  expect(status.gasAllowance).toBe(GAS);
  expect(status.gasSpent).toBe('0');
  expect(tokenOf(status)).toEqual({ token: TOKEN, allowance: '600', reserved: '0', spent: '0', available: '600' });
}

/** 600 allowance: reserve 300, consume 200, release 100 → spent 200, available 400. Gas stays put. */
async function testAllowanceDecrement(a: Wallet, expectReceipt: ReceiptCheck): Promise<void> {
  const opened = await openKey(a.port, 'd');
  const reserved = await a.port.reserveAllowance(allowanceOp(opened, `hold:${opened.publicKey}`, '300'));
  expectReceipt(reserved.receipt, a, 'success');
  expect(tokenOf(reserved.status)).toMatchObject({ allowance: '600', reserved: '300', spent: '0', available: '300' });
  expect(reserved.status.gasSpent).toBe('0');

  const settled = await a.port.consumeAllowance(allowanceOp(opened, `settle:${opened.publicKey}`, '200'));
  expectReceipt(settled.receipt, a, 'success');
  expect(tokenOf(settled.status)).toMatchObject({ reserved: '100', spent: '200', available: '300' });

  const released = await a.port.releaseAllowance(allowanceOp(opened, `cancel:${opened.publicKey}`, '100'));
  expectReceipt(released.receipt, a, 'success');
  expect(tokenOf(released.status)).toEqual({
    token: TOKEN,
    allowance: '600',
    reserved: '0',
    spent: '200',
    available: '400',
  });
  expect(released.status.gasAllowance).toBe(GAS);
  expect(released.status.gasSpent).toBe('0');

  const status = await a.port.keyStatus({ accountId: opened.accountId, publicKey: opened.publicKey });
  expect(tokenOf(status)).toEqual(tokenOf(released.status));
  expect(status.gasSpent).toBe('0');
}

/** Past available throws `NEAR_ALLOWANCE_EXHAUSTED` and writes nothing. The exact remainder succeeds at 0. */
async function testAllowanceExhaustion(a: Wallet, expectReceipt: ReceiptCheck): Promise<void> {
  const opened = await openKey(a.port, 'x');
  const before = await a.port.keyStatus({ accountId: opened.accountId, publicKey: opened.publicKey });
  await expect(a.port.reserveAllowance(allowanceOp(opened, `over:${opened.publicKey}`, '601'))).rejects.toMatchObject({
    errorCode: 'NEAR_ALLOWANCE_EXHAUSTED',
  });
  const afterFail = await a.port.keyStatus({ accountId: opened.accountId, publicKey: opened.publicKey });
  expect(tokenOf(afterFail)).toEqual(tokenOf(before));
  expect(afterFail.gasAllowance).toBe(before.gasAllowance);
  expect(afterFail.gasSpent).toBe(before.gasSpent);

  const exact = await a.port.reserveAllowance(allowanceOp(opened, `all:${opened.publicKey}`, '600'));
  expectReceipt(exact.receipt, a, 'success');
  expect(tokenOf(exact.status)).toEqual({
    token: TOKEN,
    allowance: '600',
    reserved: '600',
    spent: '0',
    available: '0',
  });
  await expect(a.port.reserveAllowance(allowanceOp(opened, `more:${opened.publicKey}`, '1'))).rejects.toMatchObject({
    errorCode: 'NEAR_ALLOWANCE_EXHAUSTED',
  });
  expect(tokenOf(await a.port.keyStatus({ accountId: opened.accountId, publicKey: opened.publicKey })).available).toBe(
    '0',
  );
}

/** Revoke keeps the pool. A later reserve throws the adapter's revoke code. */
async function testRevokeBlocksReserve(a: Wallet, expectReceipt: ReceiptCheck): Promise<void> {
  const opened = await openKey(a.port, 'v');
  const receipt = await a.port.revokeKey({
    opId: `revoke:${opened.publicKey}`,
    accountId: opened.accountId,
    publicKey: opened.publicKey,
  });
  expectReceipt(receipt, a, 'success');
  const status = await a.port.keyStatus({ accountId: opened.accountId, publicKey: opened.publicKey });
  expect(status.revoked).toBe(true);
  expect(tokenOf(status).available).toBe('600');
  expect(status.gasSpent).toBe('0');
  await expect(a.port.reserveAllowance(allowanceOp(opened, `again:${opened.publicKey}`, '1'))).rejects.toMatchObject({
    errorCode: 'NEAR_KEY_REVOKED',
  });
  expect(tokenOf(await a.port.keyStatus({ accountId: opened.accountId, publicKey: opened.publicKey }))).toEqual(
    tokenOf(status),
  );
}

/** Only `intents.near` and `res.*` may be named. `guild.near` and an empty receiver are rejected. */
async function testReceiverScoping(a: Wallet, expectReceipt: ReceiptCheck): Promise<void> {
  const name = `rx${uid()}`;
  const created = await a.port.createSubAccount({ opId: `acct:${name}`, parent: PARENT, name });
  const accountId = created.accountId;
  const rejected = async (suffix: string, receiverId: string): Promise<void> => {
    await expect(
      a.port.addLimitedKey({
        opId: `bad-${suffix}:${name}`,
        accountId,
        publicKey: `ed25519:${suffix}${name}`,
        allowance: GAS,
        receiverId,
        methodNames: ['mt_transfer'],
        tokens: [{ token: TOKEN, allowance: '600' }],
      }),
    ).rejects.toMatchObject({ errorCode: 'NEAR_RELAY_RECEIVER_NOT_ALLOWED' });
    await expect(a.port.keyStatus({ accountId, publicKey: `ed25519:${suffix}${name}` })).rejects.toMatchObject({
      errorCode: 'NEAR_ACCOUNT_NOT_FOUND',
    });
  };
  await rejected('g', 'guild.near');
  await rejected('e', '');

  const accept = async (suffix: string, receiverId: string): Promise<void> => {
    const publicKey = `ed25519:${suffix}${name}`;
    const receipt = await a.port.addLimitedKey({
      opId: `ok-${suffix}:${name}`,
      accountId,
      publicKey,
      allowance: GAS,
      receiverId,
      methodNames: ['mt_transfer'],
      tokens: [{ token: TOKEN, allowance: '600' }],
    });
    expectReceipt(receipt, a, 'success');
    const status = await a.port.keyStatus({ accountId, publicKey });
    expect(status.receiverId).toBe(receiverId);
    expect(tokenOf(status).allowance).toBe('600');
    expect(status.gasSpent).toBe('0');
  };
  await accept('i', 'intents.near');
  await accept('r', 'res.terraagent.mock');
}

/** The same reserve opId returns the first receipt and does not hold twice. */
async function testReserveReplay(a: Wallet): Promise<void> {
  const opened = await openKey(a.port, 'p');
  const opId = `replay:${opened.publicKey}`;
  const first = await a.port.reserveAllowance(allowanceOp(opened, opId, '300'));
  const replay = await a.port.reserveAllowance(allowanceOp(opened, opId, '300'));
  expect(replay.receipt.txHash).toBe(first.receipt.txHash);
  expect(tokenOf(replay.status)).toMatchObject({ allowance: '600', reserved: '300', spent: '0', available: '300' });
  const status = await a.port.keyStatus({ accountId: opened.accountId, publicKey: opened.publicKey });
  expect(tokenOf(status)).toEqual({ token: TOKEN, allowance: '600', reserved: '300', spent: '0', available: '300' });
  expect(status.gasSpent).toBe('0');
}

/**
 * Port contract for `AgentWalletPort` (W15-04).
 * Sub-account naming, per-token principal, gas left unspent, exhaustion, revoke, and receiver scope.
 */
export const contract = defineNearContract<AgentWalletPort>({
  port: 'AgentWallet',
  helpers: () => ({}),
  suite: ({ test, expectReceipt }) => {
    test('createSubAccount names name.parent, replays opId, and rejects a second name with NEAR_ACCOUNT_EXISTS', (a) =>
      testSubAccountNaming(a, expectReceipt));
    test('addLimitedKey then keyStatus shows the token allowance and gas without spending principal', (a) =>
      testLimitedKeyStatus(a, expectReceipt));
    test('reserve 300, consume 200, release 100 leaves spent 200 and available 400; gas stays 0', (a) =>
      testAllowanceDecrement(a, expectReceipt));
    test('reserve past available throws NEAR_ALLOWANCE_EXHAUSTED unchanged; the exact remainder goes to 0', (a) =>
      testAllowanceExhaustion(a, expectReceipt));
    test('revoke then reserve throws NEAR_KEY_REVOKED and leaves the pool', (a) =>
      testRevokeBlocksReserve(a, expectReceipt));
    test('rejects guild.near and an empty receiver; accepts intents.near and res.terraagent.mock', (a) =>
      testReceiverScoping(a, expectReceipt));
    test('replaying the same reserve opId does not double-hold', testReserveReplay);
  },
});

/** Runs the agent-wallet suite against any adapter factory. */
export const describeAgentWalletPortContract = (label: string, make: MakeAdapter<AgentWalletPort>): void =>
  contract.run(label, make);
