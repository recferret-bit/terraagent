import { describe, expect, it } from 'vitest';
import { PROTOCOL_ACCOUNT_ID } from '../../src/market/orders/market-policy.provider.js';
import { escrowHoldAccount, escrowIdFromOp } from '../../src/near/application/escrow-id.js';
import {
  DEFAULT_ESCROW_SLASH_PROTOCOL_BP,
  EscrowActionInput,
  EscrowGetInput,
  EscrowOpenInput,
  EscrowOpenResult,
  EscrowPort,
  EscrowSlashInput,
  EscrowView,
} from '../../src/near/application/ports/escrow.port.js';
import {
  DiplomacyEscrowService,
  bondToBaseUnits,
  truceEscrowOpenOpId,
  warEscrowOpenOpId,
} from '../../src/near/diplomacy/diplomacy-escrow.service.js';
import { NearException } from '../../src/near/domain/errors.js';
import type { ChainReceipt } from '../../src/near/domain/types.js';
import { ONE_NEAR_YOCTO } from '../../src/near/staking/yocto.js';

class InMemoryEscrowPort extends EscrowPort {
  readonly balances = new Map<string, bigint>();
  private readonly rows = new Map<string, { funder: string; beneficiary: string; tokenId: string; amount: bigint; status: 'open' | 'claimed' | 'refunded' | 'slashed' }>();
  private readonly ops = new Set<string>();

  key(accountId: string, tokenId: string): string {
    return `${accountId}::${tokenId}`;
  }

  seed(accountId: string, tokenId: string, amount: bigint): void {
    this.balances.set(this.key(accountId, tokenId), amount);
  }

  balance(accountId: string, tokenId: string): bigint {
    return this.balances.get(this.key(accountId, tokenId)) ?? 0n;
  }

  private receipt(opId: string): ChainReceipt {
    return { txHash: `mock:${opId}`, status: 'success', network: 'mock', at: 1_700_000_000_000 };
  }

  async open(raw: EscrowOpenInput): Promise<EscrowOpenResult> {
    const input = EscrowOpenInput.parse(raw);
    const escrowId = escrowIdFromOp(input.opId);
    if (this.ops.has(input.opId)) return { escrowId, receipt: this.receipt(input.opId) };
    const amt = BigInt(input.amount);
    const cur = this.balance(input.funder, input.tokenId);
    if (cur < amt) throw new NearException('NEAR_INSUFFICIENT_BALANCE', { details: { accountId: input.funder } });
    this.balances.set(this.key(input.funder, input.tokenId), cur - amt);
    const hold = escrowHoldAccount(escrowId);
    this.balances.set(this.key(hold, input.tokenId), this.balance(hold, input.tokenId) + amt);
    this.rows.set(escrowId, { funder: input.funder, beneficiary: input.beneficiary, tokenId: input.tokenId, amount: amt, status: 'open' });
    this.ops.add(input.opId);
    return { escrowId, receipt: this.receipt(input.opId) };
  }

  async claim(raw: EscrowActionInput): Promise<ChainReceipt> {
    const input = EscrowActionInput.parse(raw);
    return this.receipt(input.opId);
  }

  async refund(raw: EscrowActionInput): Promise<ChainReceipt> {
    const input = EscrowActionInput.parse(raw);
    if (this.ops.has(input.opId)) return this.receipt(input.opId);
    const row = this.rows.get(input.escrowId);
    if (!row) throw new NearException('NEAR_ESCROW_NOT_FOUND', { details: { escrowId: input.escrowId } });
    row.status = 'refunded';
    const hold = escrowHoldAccount(input.escrowId);
    this.balances.set(this.key(hold, row.tokenId), this.balance(hold, row.tokenId) - row.amount);
    this.balances.set(this.key(row.funder, row.tokenId), this.balance(row.funder, row.tokenId) + row.amount);
    this.ops.add(input.opId);
    return this.receipt(input.opId);
  }

  async slash(raw: EscrowSlashInput): Promise<ChainReceipt> {
    const input = EscrowSlashInput.parse(raw);
    if (this.ops.has(input.opId)) return this.receipt(input.opId);
    const row = this.rows.get(input.escrowId);
    if (!row) throw new NearException('NEAR_ESCROW_NOT_FOUND', { details: { escrowId: input.escrowId } });
    row.status = 'slashed';
    const protocolCut = (row.amount * BigInt(input.protocolFeeBp ?? DEFAULT_ESCROW_SLASH_PROTOCOL_BP)) / 10_000n;
    const victimCut = row.amount - protocolCut;
    const hold = escrowHoldAccount(input.escrowId);
    this.balances.set(this.key(hold, row.tokenId), this.balance(hold, row.tokenId) - row.amount);
    this.balances.set(this.key(input.victimAccountId, row.tokenId), this.balance(input.victimAccountId, row.tokenId) + victimCut);
    this.balances.set(this.key(input.protocolAccountId, row.tokenId), this.balance(input.protocolAccountId, row.tokenId) + protocolCut);
    this.ops.add(input.opId);
    return this.receipt(input.opId);
  }

  async get(raw: EscrowGetInput): Promise<EscrowView> {
    const input = EscrowGetInput.parse(raw);
    const row = this.rows.get(input.escrowId);
    if (!row) throw new NearException('NEAR_ESCROW_NOT_FOUND', { details: { escrowId: input.escrowId } });
    return { escrowId: input.escrowId, status: row.status, funder: row.funder, beneficiary: row.beneficiary, tokenId: row.tokenId, amount: row.amount.toString(), expiresAtMs: 0 };
  }
}

describe('DiplomacyEscrowService — Bonded Peace Treaties', () => {
  it('locks matching NEAR bonds and slashes breaker 90% to partner + 10% to TerraAgent Protocol on early cancel', async () => {
    const port = new InMemoryEscrowPort();
    const svc = new DiplomacyEscrowService(port, { has: () => true });
    const acctA = 'pl1-col_0.terraagent.mock';
    const acctB = 'pl1-col_1.terraagent.mock';
    port.seed(acctA, 'NEAR', 10n * ONE_NEAR_YOCTO);
    port.seed(acctB, 'NEAR', 10n * ONE_NEAR_YOCTO);

    const opened = await svc.openTruceBonds({
      planetId: 'pl1',
      truceId: 'tr_1',
      colonyAId: 'col_0',
      colonyBId: 'col_1',
      colonyAIndex: 0,
      colonyBIndex: 1,
      bondToken: 'NEAR',
      bondAmount: 5,
    });
    expect(opened?.escrowA.escrowId).toBe(escrowIdFromOp(truceEscrowOpenOpId('pl1', 'tr_1', 'a')));
    expect(port.balance(acctA, 'NEAR')).toBe(5n * ONE_NEAR_YOCTO);
    expect(port.balance(acctB, 'NEAR')).toBe(5n * ONE_NEAR_YOCTO);

    await svc.settleTruceBonds({
      planetId: 'pl1',
      truceId: 'tr_1',
      colonyAId: 'col_0',
      colonyBId: 'col_1',
      colonyAIndex: 0,
      colonyBIndex: 1,
      reason: 'cancelled',
      cancelledByColony: 0,
    });

    // Colony A broke: A loses 5 NEAR; Colony B gets 5 NEAR refund + 4.5 NEAR (90% of A) = 14.5 NEAR; Protocol gets 0.5 NEAR (10%)
    expect(port.balance(acctA, 'NEAR')).toBe(5n * ONE_NEAR_YOCTO);
    expect(port.balance(acctB, 'NEAR')).toBe(145n * (ONE_NEAR_YOCTO / 10n));
    expect(port.balance(PROTOCOL_ACCOUNT_ID, 'NEAR')).toBe(5n * (ONE_NEAR_YOCTO / 10n));
  });

  it('refunds 100% of both bonds on peaceful expiry and rolls back Side A if Side B lacks balance', async () => {
    const port = new InMemoryEscrowPort();
    const svc = new DiplomacyEscrowService(port, { has: () => true });
    const acctA = 'pl2-col_0.terraagent.mock';
    const acctB = 'pl2-col_1.terraagent.mock';
    const fiftyMetals = BigInt(bondToBaseUnits('metals.t1', 50));
    port.seed(acctA, 'metals.t1', fiftyMetals);

    await expect(
      svc.openTruceBonds({
        planetId: 'pl2',
        truceId: 'tr_fail',
        colonyAId: 'col_0',
        colonyBId: 'col_1',
        bondToken: 'metals.t1',
        bondAmount: 50,
      }),
    ).rejects.toThrow();
    expect(port.balance(acctA, 'metals.t1')).toBe(fiftyMetals);

    port.seed(acctB, 'metals.t1', fiftyMetals);
    await svc.openTruceBonds({
      planetId: 'pl2',
      truceId: 'tr_peace',
      colonyAId: 'col_0',
      colonyBId: 'col_1',
      bondToken: 'metals.t1',
      bondAmount: 50,
    });
    await svc.settleTruceBonds({
      planetId: 'pl2',
      truceId: 'tr_peace',
      colonyAId: 'col_0',
      colonyBId: 'col_1',
      reason: 'expired',
    });
    expect(port.balance(acctA, 'metals.t1')).toBe(fiftyMetals);
    expect(port.balance(acctB, 'metals.t1')).toBe(fiftyMetals);
  });
});

describe('DiplomacyEscrowService — 6h Bonded War Escrows', () => {
  it('refunds 100% on objective_met and slashes 90% Defender / 10% Protocol on cancel or expiry', async () => {
    const port = new InMemoryEscrowPort();
    const svc = new DiplomacyEscrowService(port, { has: () => true });
    const attacker = 'pl3-col_0.terraagent.mock';
    const defender = 'pl3-col_1.terraagent.mock';
    port.seed(attacker, 'NEAR', 20n * ONE_NEAR_YOCTO);

    const w1 = await svc.openWarBond({
      planetId: 'pl3',
      warId: 'war_win',
      attackerColonyId: 'col_0',
      attackerColonyIndex: 0,
      bondToken: 'NEAR',
      bondAmount: 10,
    });
    expect(w1?.escrowId).toBe(escrowIdFromOp(warEscrowOpenOpId('pl3', 'war_win')));
    await svc.settleWarBond({
      planetId: 'pl3',
      warId: 'war_win',
      attackerColonyId: 'col_0',
      defenderColonyId: 'col_1',
      reason: 'objective_met',
    });
    expect(port.balance(attacker, 'NEAR')).toBe(20n * ONE_NEAR_YOCTO);

    await svc.openWarBond({
      planetId: 'pl3',
      warId: 'war_fail',
      attackerColonyId: 'col_0',
      attackerColonyIndex: 0,
      bondToken: 'NEAR',
      bondAmount: 10,
    });
    await svc.settleWarBond({
      planetId: 'pl3',
      warId: 'war_fail',
      attackerColonyId: 'col_0',
      defenderColonyId: 'col_1',
      reason: 'expired',
    });
    expect(port.balance(attacker, 'NEAR')).toBe(10n * ONE_NEAR_YOCTO);
    expect(port.balance(defender, 'NEAR')).toBe(9n * ONE_NEAR_YOCTO);
    expect(port.balance(PROTOCOL_ACCOUNT_ID, 'NEAR')).toBe(1n * ONE_NEAR_YOCTO);
  });
});
