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
 * Expiry is not stored: the bounty service owns it, and `get` reports `expiresAtMs: 0` (BE-71).
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
    return this.call('Escrow', 'refund', input.opId, async (tx) => {
      const row = await takeOpenEscrow(tx, input.escrowId, 'refunded');
      await this.release(tx, row, row.opener);
      return { escrowId: row.id, status: 'refunded', to: row.opener };
    });
  }

  async get(raw: EscrowGetInput): Promise<EscrowView> {
    const input = EscrowGetInput.parse(raw);
    const row = await this.prisma.mockChainEscrow.findUnique({ where: { id: input.escrowId } });
    if (!row) throw new NearException('NEAR_ESCROW_NOT_FOUND', { details: { escrowId: input.escrowId } });
    return this.viewOf(row);
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
