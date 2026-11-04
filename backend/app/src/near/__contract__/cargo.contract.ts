import { expect } from 'vitest';
import {
  CARGO_MINTER_ACCOUNT,
  CargoTokenPort,
  toCargoBaseUnits,
} from '../application/ports/cargo-token.port';
import { defineNearContract, type AdapterUnderTest, type MakeAdapter, type NearContractApi } from './harness';

type CargoAdapter = AdapterUnderTest<CargoTokenPort>;
type ReceiptCheck = NearContractApi<CargoTokenPort>['expectReceipt'];

const uid = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
const acc = (p: string) => `${p}-${uid()}.terraagent.mock`;

async function testMintTransferBurn(a: CargoAdapter, expectReceipt: ReceiptCheck): Promise<void> {
  const alice = acc('alice');
  const bob = acc('bob');
  const token = 'metals.t1';

  expect(await a.port.balanceOf({ accountId: alice, tokenId: token })).toBe('0');
  expect(await a.port.balanceOf({ accountId: bob, tokenId: token })).toBe('0');

  const m = await a.port.mint({
    opId: `mint:${uid()}`,
    to: alice,
    tokenId: token,
    amount: toCargoBaseUnits(300),
  });
  expectReceipt(m, a, 'success');
  expect(await a.port.balanceOf({ accountId: alice, tokenId: token })).toBe(toCargoBaseUnits(300));

  const t = await a.port.transfer({
    opId: `xfer:${uid()}`,
    from: alice,
    to: bob,
    tokenId: token,
    amount: toCargoBaseUnits(120),
  });
  expectReceipt(t, a, 'success');
  expect(await a.port.balanceOf({ accountId: alice, tokenId: token })).toBe(toCargoBaseUnits(180));
  expect(await a.port.balanceOf({ accountId: bob, tokenId: token })).toBe(toCargoBaseUnits(120));

  const b = await a.port.burn({
    opId: `burn:${uid()}`,
    from: alice,
    tokenId: token,
    amount: toCargoBaseUnits(180),
  });
  expectReceipt(b, a, 'success');
  expect(await a.port.balanceOf({ accountId: alice, tokenId: token })).toBe('0');
  expect(await a.port.balanceOf({ accountId: bob, tokenId: token })).toBe(toCargoBaseUnits(120));
}

async function testIdempotency(a: CargoAdapter, expectReceipt: ReceiptCheck): Promise<void> {
  const alice = acc('alice');
  const bob = acc('bob');
  const token = 'minerals.t1';

  const mintOp = `mint-idemp:${uid()}`;
  const mint1 = await a.port.mint({
    opId: mintOp,
    to: alice,
    tokenId: token,
    amount: toCargoBaseUnits(100),
  });
  expectReceipt(mint1, a, 'success');

  const mint2 = await a.port.mint({
    opId: mintOp,
    to: alice,
    tokenId: token,
    amount: toCargoBaseUnits(100),
  });
  expect(mint2.txHash).toBe(mint1.txHash);
  expect(await a.port.balanceOf({ accountId: alice, tokenId: token })).toBe(toCargoBaseUnits(100));

  const transferOp = `xfer-idemp:${uid()}`;
  const xfer1 = await a.port.transfer({
    opId: transferOp,
    from: alice,
    to: bob,
    tokenId: token,
    amount: toCargoBaseUnits(40),
  });
  expectReceipt(xfer1, a, 'success');

  const xfer2 = await a.port.transfer({
    opId: transferOp,
    from: alice,
    to: bob,
    tokenId: token,
    amount: toCargoBaseUnits(40),
  });
  expect(xfer2.txHash).toBe(xfer1.txHash);
  expect(await a.port.balanceOf({ accountId: alice, tokenId: token })).toBe(toCargoBaseUnits(60));
  expect(await a.port.balanceOf({ accountId: bob, tokenId: token })).toBe(toCargoBaseUnits(40));

  const burnOp = `burn-idemp:${uid()}`;
  const burn1 = await a.port.burn({
    opId: burnOp,
    from: bob,
    tokenId: token,
    amount: toCargoBaseUnits(30),
  });
  expectReceipt(burn1, a, 'success');

  const burn2 = await a.port.burn({
    opId: burnOp,
    from: bob,
    tokenId: token,
    amount: toCargoBaseUnits(30),
  });
  expect(burn2.txHash).toBe(burn1.txHash);
  expect(await a.port.balanceOf({ accountId: bob, tokenId: token })).toBe(toCargoBaseUnits(10));
}

async function testInsufficientBalance(a: CargoAdapter, expectReceipt: ReceiptCheck): Promise<void> {
  const alice = acc('alice');
  const bob = acc('bob');
  const token = 'bio.water';

  await a.port.mint({
    opId: `mint:${uid()}`,
    to: alice,
    tokenId: token,
    amount: toCargoBaseUnits(50),
  });
  expect(await a.port.balanceOf({ accountId: alice, tokenId: token })).toBe(toCargoBaseUnits(50));
  expect(await a.port.balanceOf({ accountId: bob, tokenId: token })).toBe('0');

  const failTransferOp = `xfer-fail:${uid()}`;
  await expect(
    a.port.transfer({
      opId: failTransferOp,
      from: alice,
      to: bob,
      tokenId: token,
      amount: toCargoBaseUnits(60),
    }),
  ).rejects.toMatchObject({ errorCode: 'NEAR_INSUFFICIENT_BALANCE' });

  expect(await a.port.balanceOf({ accountId: alice, tokenId: token })).toBe(toCargoBaseUnits(50));
  expect(await a.port.balanceOf({ accountId: bob, tokenId: token })).toBe('0');

  await expect(
    a.port.burn({
      opId: `burn-fail:${uid()}`,
      from: alice,
      tokenId: token,
      amount: toCargoBaseUnits(60),
    }),
  ).rejects.toMatchObject({ errorCode: 'NEAR_INSUFFICIENT_BALANCE' });

  expect(await a.port.balanceOf({ accountId: alice, tokenId: token })).toBe(toCargoBaseUnits(50));

  await expect(
    a.port.transfer({
      opId: `xfer-zero:${uid()}`,
      from: bob,
      to: alice,
      tokenId: token,
      amount: toCargoBaseUnits(1),
    }),
  ).rejects.toMatchObject({ errorCode: 'NEAR_INSUFFICIENT_BALANCE' });

  await expect(
    a.port.burn({
      opId: `burn-zero:${uid()}`,
      from: bob,
      tokenId: token,
      amount: toCargoBaseUnits(1),
    }),
  ).rejects.toMatchObject({ errorCode: 'NEAR_INSUFFICIENT_BALANCE' });

  // Retrying the failed transfer opId after funding succeeds (failures do not poison an opId)
  await a.port.mint({
    opId: `mint-more:${uid()}`,
    to: alice,
    tokenId: token,
    amount: toCargoBaseUnits(20),
  });
  const retriedXfer = await a.port.transfer({
    opId: failTransferOp,
    from: alice,
    to: bob,
    tokenId: token,
    amount: toCargoBaseUnits(60),
  });
  expectReceipt(retriedXfer, a, 'success');
  expect(await a.port.balanceOf({ accountId: alice, tokenId: token })).toBe(toCargoBaseUnits(10));
  expect(await a.port.balanceOf({ accountId: bob, tokenId: token })).toBe(toCargoBaseUnits(60));
}

async function testMinterAccessControl(a: CargoAdapter): Promise<void> {
  const alice = acc('alice');
  const token = 'metals.t1';
  const intruder = 'intruder.near';

  await expect(
    a.port.mint({
      opId: `mint-intruder:${uid()}`,
      to: alice,
      tokenId: token,
      amount: toCargoBaseUnits(10),
      caller: intruder,
    }),
  ).rejects.toMatchObject({ errorCode: 'NEAR_NOT_OWNER' });

  expect(await a.port.balanceOf({ accountId: alice, tokenId: token })).toBe('0');

  await a.port.mint({
    opId: `mint-authorized:${uid()}`,
    to: alice,
    tokenId: token,
    amount: toCargoBaseUnits(10),
    caller: CARGO_MINTER_ACCOUNT,
  });
  expect(await a.port.balanceOf({ accountId: alice, tokenId: token })).toBe(toCargoBaseUnits(10));

  await expect(
    a.port.burn({
      opId: `burn-intruder:${uid()}`,
      from: alice,
      tokenId: token,
      amount: toCargoBaseUnits(10),
      caller: intruder,
    }),
  ).rejects.toMatchObject({ errorCode: 'NEAR_NOT_OWNER' });

  expect(await a.port.balanceOf({ accountId: alice, tokenId: token })).toBe(toCargoBaseUnits(10));
}

/**
 * Port contract for `CargoTokenPort` (NEP-245 multi-token cargo).
 * Exercises mint, burn, transfer, balanceOf, idempotency by opId,
 * minter access control, and receipt verification.
 */
export const contract = defineNearContract<CargoTokenPort>({
  port: 'CargoToken',
  helpers: () => ({}),
  suite: ({ test, expectReceipt }) => {
    test(
      'mint credits balanceOf, transfer moves balance, and burn debits balance with valid receipts',
      (a) => testMintTransferBurn(a, expectReceipt),
    );
    test(
      'mint, transfer, and burn are idempotent by opId (replay returns same txHash without double-applying)',
      (a) => testIdempotency(a, expectReceipt),
    );
    test(
      'burn or transfer above balance fails with NEAR_INSUFFICIENT_BALANCE without changing balance',
      (a) => testInsufficientBalance(a, expectReceipt),
    );
    test(
      'non-minter caller on mint or burn is rejected with NEAR_NOT_OWNER',
      testMinterAccessControl,
    );
  },
});

/** Runs the Cargo suite against any adapter factory. */
export const describeCargoPortContract = (label: string, make: MakeAdapter<CargoTokenPort>): void =>
  contract.run(label, make);
