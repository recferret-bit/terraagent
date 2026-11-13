import { expect } from 'vitest';
import type { EscrowPort } from '../application/ports/escrow.port';
import type { AdapterUnderTest, NearContractApi, NearContractSuite } from './harness';

/** Fund and read cargo. The runner only injects `EscrowPort`; the mock seam supplies both. */
export interface EscrowContractHelpers {
  /** Raises the account up to `amount` of `tokenId`. A second call does not add. */
  fund(accountId: string, tokenId: string, amount: string): Promise<void>;
  balance(accountId: string, tokenId: string): Promise<string>;
}

type A = AdapterUnderTest<EscrowPort, EscrowContractHelpers>;
type ReceiptCheck = NearContractApi<EscrowPort, EscrowContractHelpers>['expectReceipt'];

const TOKEN = 'metals.t1';
const OPEN_AMOUNT = '200';
const FUNDED = '500';

const uid = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
const acc = (prefix: string) => `${prefix}-${uid()}.terraagent.mock`;

function openOf(funder: string, opId: string, beneficiary: string, amount = OPEN_AMOUNT) {
  return { opId, funder, beneficiary, tokenId: TOKEN, amount, expiresAtMs: 1_700_000_000_000 };
}

/** Funder + hold + claimer (and any other named account). A missing row counts as 0. */
async function total(a: A, accounts: readonly string[]): Promise<bigint> {
  let sum = 0n;
  for (const accountId of accounts) sum += BigInt(await a.balance(accountId, TOKEN));
  return sum;
}

async function openCreditsHold(a: A, expectReceipt: ReceiptCheck): Promise<void> {
  const funder = acc('funder');
  const claimer = acc('claimer');
  const beneficiary = acc('benef');
  await a.fund(funder, TOKEN, FUNDED);
  const before = await total(a, [funder, claimer, beneficiary]);

  const opened = await a.port.open(openOf(funder, `open:${uid()}`, beneficiary));
  expectReceipt(opened.receipt, a, 'success');
  expect(await a.balance(funder, TOKEN)).toBe('300');
  expect(await a.balance(opened.escrowId, TOKEN)).toBe(OPEN_AMOUNT);
  expect(await a.balance(beneficiary, TOKEN)).toBe('0');

  const view = await a.port.get({ escrowId: opened.escrowId });
  expect(view).toMatchObject({
    escrowId: opened.escrowId,
    status: 'open',
    funder,
    beneficiary,
    tokenId: TOKEN,
    amount: OPEN_AMOUNT,
    expiresAtMs: 0,
  });
  expect(await total(a, [funder, opened.escrowId, claimer, beneficiary])).toBe(before);
}

async function overdraftChangesNothing(a: A, expectReceipt: ReceiptCheck): Promise<void> {
  const funder = acc('poor');
  const beneficiary = acc('benef');
  const opId = `open-poor:${uid()}`;
  await a.fund(funder, TOKEN, '100');
  await expect(a.port.open(openOf(funder, opId, beneficiary))).rejects.toMatchObject({
    errorCode: 'NEAR_INSUFFICIENT_BALANCE',
  });
  expect(await a.balance(funder, TOKEN)).toBe('100');
  expect(await a.balance(beneficiary, TOKEN)).toBe('0');

  // The failed opId did not debit and did not stick, so the same open works once the poster can pay.
  await a.fund(funder, TOKEN, OPEN_AMOUNT);
  const opened = await a.port.open(openOf(funder, opId, beneficiary));
  expectReceipt(opened.receipt, a, 'success');
  expect(await a.balance(funder, TOKEN)).toBe('0');
  expect(await a.balance(opened.escrowId, TOKEN)).toBe(OPEN_AMOUNT);
}

async function secondPayoutThrows(a: A, expectReceipt: ReceiptCheck): Promise<void> {
  const funder = acc('funder');
  const claimer = acc('claimer');
  const beneficiary = acc('benef');
  await a.fund(funder, TOKEN, FUNDED);
  const parties = [funder, claimer, beneficiary];
  const before = await total(a, parties);
  const opened = await a.port.open(openOf(funder, `open-claim:${uid()}`, beneficiary));
  const claimOp = `claim:${uid()}`;
  const claim = await a.port.claim({ opId: claimOp, escrowId: opened.escrowId, caller: claimer });
  expectReceipt(claim, a, 'success');
  const replay = await a.port.claim({ opId: claimOp, escrowId: opened.escrowId, caller: claimer });
  expect(replay.txHash).toBe(claim.txHash);

  await expect(
    a.port.claim({ opId: `claim-again:${uid()}`, escrowId: opened.escrowId, caller: claimer }),
  ).rejects.toMatchObject({ errorCode: 'NEAR_ESCROW_STATE' });
  await expect(
    a.port.refund({ opId: `refund-claimed:${uid()}`, escrowId: opened.escrowId, caller: funder }),
  ).rejects.toMatchObject({ errorCode: 'NEAR_ESCROW_STATE' });

  expect(await a.balance(claimer, TOKEN)).toBe(OPEN_AMOUNT);
  expect(await a.balance(funder, TOKEN)).toBe('300');
  expect(await a.balance(opened.escrowId, TOKEN)).toBe('0');
  expect(await a.balance(beneficiary, TOKEN)).toBe('0');
  expect((await a.port.get({ escrowId: opened.escrowId })).status).toBe('claimed');
  expect(await total(a, [funder, opened.escrowId, claimer, beneficiary])).toBe(before);
}

async function missingEscrowThrows(a: A): Promise<void> {
  await expect(a.port.get({ escrowId: `escrow:missing:${uid()}` })).rejects.toMatchObject({
    errorCode: 'NEAR_ESCROW_NOT_FOUND',
  });
}

async function openReplayKeepsBalances(a: A, expectReceipt: ReceiptCheck): Promise<void> {
  const funder = acc('funder');
  const beneficiary = acc('benef');
  await a.fund(funder, TOKEN, FUNDED);
  const input = openOf(funder, `open-idem:${uid()}`, beneficiary);
  const first = await a.port.open(input);
  expectReceipt(first.receipt, a, 'success');
  const second = await a.port.open(input);
  expect(second.escrowId).toBe(first.escrowId);
  expect(second.receipt.txHash).toBe(first.receipt.txHash);
  expect(await a.balance(funder, TOKEN)).toBe('300');
  expect(await a.balance(first.escrowId, TOKEN)).toBe(OPEN_AMOUNT);
  expect((await a.port.get({ escrowId: second.escrowId })).status).toBe('open');
}

async function refundRestoresOpener(a: A, expectReceipt: ReceiptCheck): Promise<void> {
  const funder = acc('funder');
  const beneficiary = acc('benef');
  await a.fund(funder, TOKEN, FUNDED);
  const before = await a.balance(funder, TOKEN);
  const opened = await a.port.open(openOf(funder, `open-refund:${uid()}`, beneficiary));
  const refundOp = `refund:${uid()}`;
  const refunded = await a.port.refund({ opId: refundOp, escrowId: opened.escrowId, caller: funder });
  expectReceipt(refunded, a, 'success');
  const replay = await a.port.refund({ opId: refundOp, escrowId: opened.escrowId, caller: funder });
  expect(replay.txHash).toBe(refunded.txHash);

  expect((await a.port.get({ escrowId: opened.escrowId })).status).toBe('refunded');
  expect(await a.balance(funder, TOKEN)).toBe(before);
  expect(await a.balance(opened.escrowId, TOKEN)).toBe('0');
  expect(await a.balance(beneficiary, TOKEN)).toBe('0');
}

/** One escrow claimed and one refunded: the two payouts equal the cargo taken from the poster. */
async function payoutsSumToDebit(a: A, expectReceipt: ReceiptCheck): Promise<void> {
  const funder = acc('funder');
  const claimer = acc('claimer');
  const beneficiary = acc('benef');
  await a.fund(funder, TOKEN, '400');
  const parties = [funder, claimer, beneficiary];
  const before = await total(a, parties);
  const claimed = await a.port.open(openOf(funder, `open-pay:${uid()}`, beneficiary));
  const refunded = await a.port.open(openOf(funder, `open-back:${uid()}`, beneficiary));
  const claim = await a.port.claim({ opId: `claim-sum:${uid()}`, escrowId: claimed.escrowId, caller: claimer });
  const refund = await a.port.refund({ opId: `refund-sum:${uid()}`, escrowId: refunded.escrowId, caller: funder });
  expectReceipt(claim, a, 'success');
  expectReceipt(refund, a, 'success');

  const claimPaid = BigInt(await a.balance(claimer, TOKEN));
  const refundPaid = BigInt(await a.balance(funder, TOKEN));
  expect(claimPaid).toBe(200n);
  expect(refundPaid).toBe(200n);
  expect(claimPaid + refundPaid).toBe(400n);
  expect(await a.balance(claimed.escrowId, TOKEN)).toBe('0');
  expect(await a.balance(refunded.escrowId, TOKEN)).toBe('0');
  expect(await a.balance(beneficiary, TOKEN)).toBe('0');
  expect(await total(a, [...parties, claimed.escrowId, refunded.escrowId])).toBe(before);
}

async function slashSplits90ToVictimAnd10ToProtocol(a: A, expectReceipt: ReceiptCheck): Promise<void> {
  const funder = acc('attacker');
  const victim = acc('defender');
  const protocol = acc('protocol');
  const beneficiary = acc('benef');
  await a.fund(funder, TOKEN, FUNDED);
  const parties = [funder, victim, protocol, beneficiary];
  const before = await total(a, parties);

  const opened = await a.port.open(openOf(funder, `open-slash:${uid()}`, beneficiary));
  await expect(
    a.port.slash({
      opId: `slash-self:${uid()}`,
      escrowId: opened.escrowId,
      victimAccountId: funder,
      protocolAccountId: protocol,
      protocolFeeBp: 1_000,
    }),
  ).rejects.toMatchObject({ errorCode: 'NEAR_ESCROW_STATE' });

  const slashOp = `slash:${uid()}`;
  const slashed = await a.port.slash({
    opId: slashOp,
    escrowId: opened.escrowId,
    victimAccountId: victim,
    protocolAccountId: protocol,
    protocolFeeBp: 1_000,
  });
  expectReceipt(slashed, a, 'success');

  const replay = await a.port.slash({
    opId: slashOp,
    escrowId: opened.escrowId,
    victimAccountId: victim,
    protocolAccountId: protocol,
    protocolFeeBp: 1_000,
  });
  expect(replay.txHash).toBe(slashed.txHash);

  await expect(
    a.port.claim({ opId: `claim-after-slash:${uid()}`, escrowId: opened.escrowId, caller: victim }),
  ).rejects.toMatchObject({ errorCode: 'NEAR_ESCROW_STATE' });

  expect(await a.balance(victim, TOKEN)).toBe('180');
  expect(await a.balance(protocol, TOKEN)).toBe('20');
  expect(await a.balance(opened.escrowId, TOKEN)).toBe('0');
  expect((await a.port.get({ escrowId: opened.escrowId })).status).toBe('slashed');
  expect(await total(a, [...parties, opened.escrowId])).toBe(before);
}

export const escrowSuite: NearContractSuite<EscrowPort, EscrowContractHelpers> = ({ test, expectReceipt }) => {
  test('open 200 of metals.t1 debits the funder, credits the hold, and get is open', (a) => openCreditsHold(a, expectReceipt));
  test('open above the balance throws NEAR_INSUFFICIENT_BALANCE and changes nothing', (a) => overdraftChangesNothing(a, expectReceipt));
  test('a second claim with a new opId throws NEAR_ESCROW_STATE and refund after claim throws', (a) => secondPayoutThrows(a, expectReceipt));
  test('get of a missing id throws NEAR_ESCROW_NOT_FOUND', missingEscrowThrows);
  test('the same open opId returns the same escrow and the same balances', (a) => openReplayKeepsBalances(a, expectReceipt));
  test('refund then get is refunded and the opener is whole again', (a) => refundRestoresOpener(a, expectReceipt));
  test('claim and refund payouts sum to the original debit', (a) => payoutsSumToDebit(a, expectReceipt));
  test('slash splits 90% to victim and 10% to TerraAgent Protocol idempotently', (a) => slashSplits90ToVictimAnd10ToProtocol(a, expectReceipt));
};
