import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import type { DiplomacyBondToken } from '@terra/contracts';
import type { PrismaClient } from '@terra/db';
import { databaseEnabled } from '../../core/persistence.js';
import { APP_ENV, type AppEnv } from '../../core/tokens.js';
import { PRISMA } from '../../db/db.module.js';
import { FlagsService } from '../../flags/flags.service.js';
import { PROTOCOL_ACCOUNT_ID } from '../../market/orders/market-policy.provider.js';
import { escrowHoldAccount, escrowIdFromOp } from '../application/escrow-id.js';
import { ChainOutboxRepository } from '../application/outbox/chain-outbox.repository.js';
import { toCargoBaseUnits } from '../application/ports/cargo-token.port.js';
import {
  DEFAULT_ESCROW_SLASH_PROTOCOL_BP,
  EscrowPort,
  type EscrowOpenResult,
} from '../application/ports/escrow.port.js';
import { mockAccountStem, resolveColonyAccountId } from '../cargo/cargo-export-outbox.js';
import { NearException } from '../domain/errors.js';
import type { ChainReceipt } from '../domain/types.js';
import { nearAdapterFor } from '../infrastructure/adapter-selection.js';
import { resolveNearNetworkConfig } from '../infrastructure/network/near-network.config.js';
import { nearToYocto } from '../staking/yocto.js';

export const truceEscrowOpenOpId = (planetId: string, truceId: string, side: 'a' | 'b'): string =>
  `truce-open:${planetId}:${truceId}:${side}`;

export const truceEscrowSettleOpId = (planetId: string, truceId: string, side: 'a' | 'b'): string =>
  `truce-settle:${planetId}:${truceId}:${side}`;

export const warEscrowOpenOpId = (planetId: string, warId: string): string =>
  `war-open:${planetId}:${warId}`;

export const warEscrowSettleOpId = (planetId: string, warId: string): string =>
  `war-settle:${planetId}:${warId}`;

export function bondToBaseUnits(bondToken: DiplomacyBondToken, bondAmount: number): string {
  return bondToken === 'NEAR' ? nearToYocto(bondAmount) : toCargoBaseUnits(bondAmount);
}

export interface BondedTruceSignedInput {
  readonly planetId: string;
  readonly truceId: string;
  readonly colonyAId: string;
  readonly colonyBId: string;
  readonly colonyAIndex?: number;
  readonly colonyBIndex?: number;
  readonly bondToken: DiplomacyBondToken;
  readonly bondAmount: number;
  readonly expiresAtMs?: number;
}

export interface BondedTruceEndedInput {
  readonly planetId: string;
  readonly truceId: string;
  readonly colonyAId: string;
  readonly colonyBId: string;
  readonly colonyAIndex?: number;
  readonly colonyBIndex?: number;
  readonly reason: 'expired' | 'cancelled' | 'settled' | 'eliminated';
  readonly cancelledBy?: string | number;
  readonly cancelledByColony?: number;
}

export interface BondedWarDeclaredInput {
  readonly planetId: string;
  readonly warId: string;
  readonly attackerColonyId: string;
  readonly attackerColonyIndex?: number;
  readonly bondToken: DiplomacyBondToken;
  readonly bondAmount: number;
  readonly expiresAtMs?: number;
}

export interface BondedWarEndedInput {
  readonly planetId: string;
  readonly warId: string;
  readonly attackerColonyId: string;
  readonly defenderColonyId: string;
  readonly attackerColonyIndex?: number;
  readonly defenderColonyIndex?: number;
  readonly reason: 'objective_met' | 'cancelled' | 'expired' | 'eliminated';
}

@Injectable()
export class DiplomacyEscrowService {
  private readonly log = new Logger(DiplomacyEscrowService.name);
  private readonly envSource: Record<string, string | undefined>;

  constructor(
    @Inject(EscrowPort) private readonly escrow: EscrowPort,
    @Inject(FlagsService) private readonly flags: { has(wave: string): boolean },
    @Optional() @Inject(ChainOutboxRepository) private readonly outbox?: ChainOutboxRepository,
    @Optional() @Inject(PRISMA) private readonly prisma?: PrismaClient,
    @Optional() @Inject(APP_ENV) env?: AppEnv,
  ) {
    this.envSource = (env ?? process.env) as Record<string, string | undefined>;
  }

  resolveProtocolAccount(): string {
    const adapter = nearAdapterFor('Escrow', this.envSource);
    if (adapter === 'mock') return this.envSource.NEAR_PROTOCOL_ACCOUNT?.trim() || PROTOCOL_ACCOUNT_ID;
    const net = adapter === 'mainnet' ? 'mainnet' : 'testnet';
    return resolveNearNetworkConfig(this.envSource, net).accounts.protocol;
  }

  async openTruceBonds(input: BondedTruceSignedInput): Promise<{ escrowA: EscrowOpenResult; escrowB: EscrowOpenResult } | null> {
    if (!this.flags.has('W22') || input.bondAmount <= 0) return null;
    const [accountA, accountB] = await Promise.all([
      this.accountFor(input.planetId, input.colonyAId, input.colonyAIndex),
      this.accountFor(input.planetId, input.colonyBId, input.colonyBIndex),
    ]);
    const baseUnits = bondToBaseUnits(input.bondToken, input.bondAmount);
    const expiresAtMs = input.expiresAtMs ?? 0;
    const opA = truceEscrowOpenOpId(input.planetId, input.truceId, 'a');
    const opB = truceEscrowOpenOpId(input.planetId, input.truceId, 'b');

    const escrowA = await this.openSingle(opA, accountA, input.bondToken, baseUnits, expiresAtMs);
    try {
      const escrowB = await this.openSingle(opB, accountB, input.bondToken, baseUnits, expiresAtMs);
      return { escrowA, escrowB };
    } catch (err) {
      await this.refundSingle(`truce-rollback:${input.planetId}:${input.truceId}:a`, escrowA.escrowId, accountA);
      throw err;
    }
  }

  async settleTruceBonds(input: BondedTruceEndedInput): Promise<void> {
    if (!this.flags.has('W22')) return;
    const [accountA, accountB] = await Promise.all([
      this.accountFor(input.planetId, input.colonyAId, input.colonyAIndex),
      this.accountFor(input.planetId, input.colonyBId, input.colonyBIndex),
    ]);
    const escrowA = escrowIdFromOp(truceEscrowOpenOpId(input.planetId, input.truceId, 'a'));
    const escrowB = escrowIdFromOp(truceEscrowOpenOpId(input.planetId, input.truceId, 'b'));
    const settleA = truceEscrowSettleOpId(input.planetId, input.truceId, 'a');
    const settleB = truceEscrowSettleOpId(input.planetId, input.truceId, 'b');

    if (input.reason === 'cancelled') {
      const aBroke =
        (input.cancelledByColony !== undefined && input.cancelledByColony === input.colonyAIndex) ||
        String(input.cancelledBy) === input.colonyAId ||
        (input.colonyAIndex !== undefined && Number(input.cancelledBy) === input.colonyAIndex);
      if (aBroke) {
        await this.slashSingle(settleA, escrowA, accountB);
        await this.refundSingle(settleB, escrowB, accountB);
      } else {
        await this.refundSingle(settleA, escrowA, accountA);
        await this.slashSingle(settleB, escrowB, accountA);
      }
      return;
    }

    await this.refundSingle(settleA, escrowA, accountA);
    await this.refundSingle(settleB, escrowB, accountB);
  }

  async openWarBond(input: BondedWarDeclaredInput): Promise<EscrowOpenResult | null> {
    if (!this.flags.has('W22') || input.bondAmount <= 0) return null;
    const attackerAccount = await this.accountFor(input.planetId, input.attackerColonyId, input.attackerColonyIndex);
    const opId = warEscrowOpenOpId(input.planetId, input.warId);
    const baseUnits = bondToBaseUnits(input.bondToken, input.bondAmount);
    return this.openSingle(opId, attackerAccount, input.bondToken, baseUnits, input.expiresAtMs ?? 0);
  }

  async settleWarBond(input: BondedWarEndedInput): Promise<ChainReceipt | null> {
    if (!this.flags.has('W22')) return null;
    const escrowId = escrowIdFromOp(warEscrowOpenOpId(input.planetId, input.warId));
    const settleOpId = warEscrowSettleOpId(input.planetId, input.warId);
    if (input.reason === 'objective_met' || input.reason === 'eliminated') {
      const attackerAccount = await this.accountFor(input.planetId, input.attackerColonyId, input.attackerColonyIndex);
      return this.refundSingle(settleOpId, escrowId, attackerAccount);
    }
    const defenderAccount = await this.accountFor(input.planetId, input.defenderColonyId, input.defenderColonyIndex);
    return this.slashSingle(settleOpId, escrowId, defenderAccount);
  }

  private async openSingle(
    opId: string,
    funder: string,
    tokenId: string,
    amount: string,
    expiresAtMs: number,
  ): Promise<EscrowOpenResult> {
    const hold = escrowHoldAccount(escrowIdFromOp(opId));
    const body = { opId, funder, beneficiary: hold, tokenId, amount, expiresAtMs };
    if (this.useOutbox()) {
      await this.outbox!.enqueue({ opId, port: 'Escrow', method: 'open', payload: body });
    }
    try {
      const opened = await this.escrow.open(body);
      if (this.useOutbox()) {
        await this.outbox!.markDoneByOpId(opId, opened, opened.receipt.txHash).catch(() => false);
      }
      return opened;
    } catch (err) {
      if (this.useOutbox()) await this.outbox!.abandon(opId).catch(() => undefined);
      throw err;
    }
  }

  private async refundSingle(opId: string, escrowId: string, caller: string): Promise<ChainReceipt | null> {
    const body = { opId, escrowId, caller };
    try {
      const receipt = await this.escrow.refund(body);
      return receipt;
    } catch (err) {
      if (err instanceof NearException && err.errorCode === 'NEAR_ESCROW_NOT_FOUND') {
        this.log.warn(`diplomacy/war escrow ${escrowId} not found on refund (${opId})`);
        return null;
      }
      throw err;
    }
  }

  private async slashSingle(opId: string, escrowId: string, victimAccountId: string): Promise<ChainReceipt | null> {
    const body = {
      opId,
      escrowId,
      victimAccountId,
      protocolAccountId: this.resolveProtocolAccount(),
      protocolFeeBp: DEFAULT_ESCROW_SLASH_PROTOCOL_BP,
    };
    try {
      return await this.escrow.slash(body);
    } catch (err) {
      if (err instanceof NearException && err.errorCode === 'NEAR_ESCROW_NOT_FOUND') {
        this.log.warn(`diplomacy/war escrow ${escrowId} not found on slash (${opId})`);
        return null;
      }
      throw err;
    }
  }

  private async accountFor(planetId: string, colonyId: string, colonyIndex?: number): Promise<string> {
    if (this.prisma && databaseEnabled(this.envSource as unknown as AppEnv)) {
      const raw = await resolveColonyAccountId(this.prisma, colonyId, null, planetId, colonyIndex);
      return raw.replace(/[-_]{2,}/g, '-');
    }
    const stem = mockAccountStem(colonyId, planetId).replace(/[-_]{2,}/g, '-');
    return `${stem}.terraagent.mock`;
  }

  private useOutbox(): boolean {
    return Boolean(this.outbox && this.prisma && databaseEnabled(this.envSource as unknown as AppEnv));
  }
}
