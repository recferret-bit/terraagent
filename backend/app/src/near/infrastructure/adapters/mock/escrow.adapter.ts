import { Injectable } from '@nestjs/common';
import type { DbClient } from '@terra/db';
import { adapterOf } from '../../../../ports/adapters.js';
import {
  EscrowActionInput,
  EscrowGetInput,
  EscrowOpenInput,
  EscrowOpenResult,
  EscrowPort,
  EscrowView,
} from '../../../application/ports/escrow.port.js';
import { NearException } from '../../../domain/errors.js';
import type { ChainReceipt } from '../../../domain/types.js';
import { MockChainBase } from '../../mock/mock-chain.base.js';
import { escrowHoldAccount, escrowIdFromOp } from './escrow-id.js';
import { takeOpenEscrow, type OpenEscrowRow } from './escrow-move.js';

/**
 * Postgres escrow (`EscrowPort`, W22-17, NEAR-110).
 * `open` / `claim` / `refund` are idempotent on `opId` via `MockChainBase`.
 * `refund` without `amount` returns the whole hold and closes the row. A smaller `amount` returns
 * only that many base units and leaves the row `open` so a later `claim` pays the rest (W22-28).
 * Expiry is not stored: the bounty service owns it, and `get` reports `expiresAtMs: 0` (BE-73).
 */
@Injectable()
export class MockEscrowAdapter extends MockChainBase implements EscrowPort {
  async open(raw: EscrowOpenInput): Promise<EscrowOpenResult> {
    const input = EscrowOpenInput.parse(raw);
    const escrowId = escrowIdFromOp(input.opId);
    const { value, receipt } = await this.callWithResult('Escrow', 'open', input.opId, async (tx) => {
      await this.fundHold(tx, input, escrowId);
      return { escrowId };
    });
    return EscrowOpenResult.parse({ escrowId: value.escrowId, receipt });
  }

  async claim(raw: EscrowActionInput): Promise<ChainReceipt> {
    const input = EscrowActionInput.parse(raw);
    return this.call('Escrow', 'claim', input.opId, async (tx) => {
      const row = await takeOpenEscrow(tx, input.escrowId, 'claimed');
      // Pays `caller`, not the stored beneficiary (BE-70, NEAR-111).
      await this.release(tx, row, input.caller);
      return { escrowId: row.id, status: 'claimed', to: input.caller };
    });
  }

  async refund(raw: EscrowActionInput): Promise<ChainReceipt> {
    const input = EscrowActionInput.parse(raw);
    return this.call('Escrow', 'refund', input.opId, (tx) => this.refundOpen(tx, input));
  }

  async get(raw: EscrowGetInput): Promise<EscrowView> {
    const input = EscrowGetInput.parse(raw);
    const row = await this.prisma.mockChainEscrow.findUnique({ where: { id: input.escrowId } });
    if (!row) throw new NearException('NEAR_ESCROW_NOT_FOUND', { details: { escrowId: input.escrowId } });
    return this.viewOf(row);
  }

  /**
   * Test seam, not on `EscrowPort`. Raises `accountId` up to `amount` of `tokenId`.
   * A second call with the same target does not add. Does not spend an opId.
   */
  async creditCargo(accountId: string, tokenId: string, amount: string): Promise<void> {
    const have = BigInt(await this.balanceOf(this.prisma, accountId, tokenId));
    const target = BigInt(amount);
    if (have >= target) return;
    await this.credit(this.prisma, accountId, tokenId, (target - have).toString());
  }

  /** Debit the funder, credit the hold. Same SQL as `CargoTokenPort.transfer`, inside this transaction. */
  private async fundHold(tx: DbClient, input: EscrowOpenInput, escrowId: string): Promise<void> {
    const hold = escrowHoldAccount(escrowId);
    await this.debit(tx, input.funder, input.tokenId, input.amount);
    await this.credit(tx, hold, input.tokenId, input.amount);
    await tx.mockChainEscrow.create({
      data: {
        id: escrowId,
        opener: input.funder,
        beneficiary: input.beneficiary,
        tokenId: input.tokenId,
        amount: input.amount,
        status: 'open',
      },
    });
  }

  /** Whole hold closes the row. A part leaves it `open` with the remainder. `0` changes nothing. */
  private async refundOpen(tx: DbClient, input: EscrowActionInput): Promise<{ escrowId: string; status: string; to: string; amount: string }> {
    const row = await tx.mockChainEscrow.findUnique({ where: { id: input.escrowId } });
    if (!row) throw new NearException('NEAR_ESCROW_NOT_FOUND', { details: { escrowId: input.escrowId } });
    if (row.status !== 'open') {
      throw new NearException('NEAR_ESCROW_STATE', { details: { escrowId: row.id, status: row.status } });
    }
    const whole = BigInt(row.amount.toFixed(0));
    const requested = input.amount === undefined ? whole : BigInt(input.amount);
    if (requested > whole) {
      throw new NearException('NEAR_ESCROW_STATE', { details: { escrowId: row.id, amount: input.amount } });
    }
    if (requested === whole) return this.refundAll(tx, row);
    if (requested === 0n) return { escrowId: row.id, status: 'open', to: row.opener, amount: '0' };
    return this.refundPart(tx, row, requested.toString());
  }

  private async refundAll(tx: DbClient, row: OpenEscrowRow): Promise<{ escrowId: string; status: string; to: string; amount: string }> {
    const taken = await takeOpenEscrow(tx, row.id, 'refunded');
    await this.release(tx, taken, taken.opener);
    return { escrowId: taken.id, status: 'refunded', to: taken.opener, amount: taken.amount.toFixed(0) };
  }

  private async refundPart(tx: DbClient, row: OpenEscrowRow, amount: string): Promise<{ escrowId: string; status: string; to: string; amount: string }> {
    const moved = await tx.$executeRaw`UPDATE chain.mock_chain_escrow SET amount = amount - ${amount}::numeric
      WHERE id = ${row.id} AND status = 'open' AND amount >= ${amount}::numeric`;
    if (Number(moved) !== 1) throw new NearException('NEAR_ESCROW_STATE', { details: { escrowId: row.id } });
    await this.debit(tx, escrowHoldAccount(row.id), row.tokenId, amount);
    await this.credit(tx, row.opener, row.tokenId, amount);
    return { escrowId: row.id, status: 'open', to: row.opener, amount };
  }

  /** Debit the hold, credit `to`. Same SQL as `CargoTokenPort.transfer`, inside this transaction. */
  private async release(tx: DbClient, row: OpenEscrowRow, to: string): Promise<void> {
    const amount = row.amount.toFixed(0);
    await this.debit(tx, escrowHoldAccount(row.id), row.tokenId, amount);
    await this.credit(tx, to, row.tokenId, amount);
  }

  private viewOf(row: OpenEscrowRow): EscrowView {
    if (row.beneficiary == null) {
      throw new NearException('NEAR_ESCROW_STATE', {
        message: 'Escrow has no beneficiary.',
        details: { escrowId: row.id },
      });
    }
    return EscrowView.parse({
      escrowId: row.id,
      status: row.status,
      funder: row.opener,
      beneficiary: row.beneficiary,
      tokenId: row.tokenId,
      amount: row.amount.toFixed(0),
      expiresAtMs: 0,
    });
  }
}

export const adapter = adapterOf({ port: EscrowPort, kind: 'mock', useClass: MockEscrowAdapter });
