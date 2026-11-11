import { Inject, Injectable, Optional } from '@nestjs/common';
import { newId, type BountyPostArgs } from '@terra/contracts';
import { CargoTokenPort, toCargoBaseUnits } from '../application/ports/cargo-token.port.js';
import type { EscrowOpenResult } from '../application/ports/escrow.port.js';
import { EscrowPort } from '../application/ports/escrow.port.js';
import { ChainOutboxRepository } from '../application/outbox/chain-outbox.repository.js';
import { AccountId } from '../domain/types.js';
import { NearException } from '../domain/errors.js';
import { escrowHoldAccount, escrowIdFromOp } from '../application/escrow-id.js';
import { CoreException } from '../../core/errors/core-exception.js';
import { FlagsService } from '../../flags/flags.service.js';
import { W22TelemetryService } from '../telemetry/w22-telemetry.service.js';

interface WaveFlags {
  has(wave: string): boolean;
}
import { BountyRepository, type NewBountyRow } from './bounty.repository.js';
import { BountyPostError } from './errors.js';
import { screenTarget } from './target.js';
import { activeScreen, bountyOpenOpId, expiryScreen, expiryWithMin, type BountyScreen } from './validate.js';
import { toBountyView, type BountyRow, type BountyView, type PostedBounty } from './view.js';
import { PlanetBountyWorld, type BountyWorldSource } from './world.js';

export interface BountyPostInput {
  readonly planetId: string;
  readonly colonyId: string;
  readonly colonyIndex: number;
  readonly accountId: string;
  readonly bountyId?: string;
  readonly args: BountyPostArgs;
  readonly nowMs?: number;
  /** When set, the expiry floor may drop to 1 h. Player posts omit it (2–48 h). */
  readonly expiryMinMs?: number;
  /** False for a mercenary hire: that path records `mercenary_hired`, not `bounty_posted` (BE-91). */
  readonly playerPost?: boolean;
}

/**
 * Opens bounty escrow and writes `chain.bounty` only after the port succeeds (W22-19).
 * The same bounty id reuses `bounty-open:{bountyId}`, so a retry does not debit cargo twice.
 */
@Injectable()
export class BountyPostService {
  constructor(
    @Inject(EscrowPort) private readonly escrow: EscrowPort,
    @Inject(CargoTokenPort) private readonly cargo: CargoTokenPort,
    @Inject(BountyRepository) private readonly repo: BountyRepository,
    @Inject(ChainOutboxRepository) private readonly outbox: ChainOutboxRepository,
    @Inject(PlanetBountyWorld) private readonly world: BountyWorldSource,
    @Inject(FlagsService) private readonly flags: WaveFlags,
    @Optional() @Inject(W22TelemetryService) private readonly telemetry?: W22TelemetryService,
  ) {}

  async list(planetId: string): Promise<BountyView[]> {
    this.assertEnabled();
    return (await this.repo.list(planetId)).map(toBountyView);
  }

  /** Read-only checks (expiry, target, cap, cargo). The WS precheck calls this and does not open escrow. */
  async screen(input: BountyPostInput): Promise<BountyScreen | null> {
    const now = input.nowMs ?? Date.now();
    const expiry = input.expiryMinMs === undefined
      ? expiryScreen(input.args.expiresAt, now)
      : expiryScreen(input.args.expiresAt, now, expiryWithMin(input.expiryMinMs));
    if (expiry) return expiry;
    const world = input.args.target.kind === 'deliver_units' ? null : await this.world.load(input.planetId);
    const target = screenTarget(world, input.colonyIndex, input.args.target);
    if (target) return target;
    const cap = activeScreen(await this.repo.countActive(input.colonyId));
    if (cap) return cap;
    return this.cargoScreen(input);
  }

  async post(input: BountyPostInput): Promise<PostedBounty> {
    this.assertEnabled();
    const bountyId = this.requireId(input);
    this.requireAccount(input.accountId);
    const existing = await this.repo.find(bountyId);
    if (existing) return this.replay(existing, input, bountyId);
    const problem = await this.screen(input);
    if (problem) throw new BountyPostError(problem);
    const opened = await this.openEscrow(input, bountyId);
    const saved = await this.save(this.draft(input, bountyId, opened));
    await this.outbox.markDoneByOpId(bountyOpenOpId(bountyId), opened, opened.receipt.txHash).catch(() => false);
    if (saved.inserted && input.playerPost !== false) await this.telemetry?.bountyPosted(input.args.target.kind);
    return { ...toBountyView(saved.row), receipt: opened.receipt };
  }

  private async replay(existing: BountyRow, input: BountyPostInput, bountyId: string): Promise<PostedBounty> {
    if (existing.planetId !== input.planetId || existing.posterColonyId !== input.colonyId) {
      throw new BountyPostError({ code: 'invalid_args', detail: 'Bounty id is already used' });
    }
    const opened = await this.openEscrow(input, bountyId);
    return { ...toBountyView(existing), receipt: opened.receipt };
  }

  private async openEscrow(input: BountyPostInput, bountyId: string): Promise<EscrowOpenResult> {
    const op = bountyOpenOpId(bountyId);
    const hold = escrowHoldAccount(escrowIdFromOp(op));
    const body = {
      opId: op,
      funder: input.accountId,
      beneficiary: hold,
      tokenId: input.args.reward.resource,
      amount: toCargoBaseUnits(input.args.reward.amount),
      expiresAtMs: input.args.expiresAt,
    };
    await this.outbox.enqueue({ opId: op, port: 'Escrow', method: 'open', payload: body });
    try {
      return await this.escrow.open(body);
    } catch (err) {
      await this.outbox.abandon(op).catch(() => undefined);
      throw this.asPostError(err);
    }
  }

  private async cargoScreen(input: BountyPostInput): Promise<BountyScreen | null> {
    const need = BigInt(toCargoBaseUnits(input.args.reward.amount));
    const raw = await this.cargo.balanceOf({ accountId: input.accountId, tokenId: input.args.reward.resource });
    if (baseUnits(raw) < need) return { code: 'insufficient_cargo', detail: 'Reward exceeds cargo' };
    return null;
  }

  private async save(row: NewBountyRow): Promise<{ row: BountyRow; inserted: boolean }> {
    try {
      return { row: await this.repo.insert(row), inserted: true };
    } catch (err) {
      if (!isUnique(err)) throw err;
      const found = await this.repo.find(row.id);
      if (!found) throw err;
      return { row: found, inserted: false };
    }
  }

  private draft(input: BountyPostInput, bountyId: string, opened: EscrowOpenResult): NewBountyRow {
    return {
      id: bountyId,
      planetId: input.planetId,
      posterColonyId: input.colonyId,
      colonyIndex: input.colonyIndex,
      accountId: input.accountId,
      target: input.args.target,
      reward: input.args.reward,
      escrowId: opened.escrowId,
      escrowTx: opened.receipt.txHash,
      opId: bountyOpenOpId(bountyId),
      expiresAt: input.args.expiresAt,
    };
  }

  private requireId(input: BountyPostInput): string {
    const id = input.bountyId ?? newId('bt');
    if (id.length < 1 || id.length > 80 || /\s/.test(id)) {
      throw new BountyPostError({ code: 'invalid_args', detail: 'Bounty id is invalid' });
    }
    return id;
  }

  private requireAccount(accountId: string): void {
    if (!AccountId.safeParse(accountId).success) {
      throw new BountyPostError({ code: 'invalid_args', detail: 'Colony account is invalid' });
    }
  }

  private asPostError(err: unknown): unknown {
    if (err instanceof NearException && err.errorCode === 'NEAR_INSUFFICIENT_BALANCE') {
      return new BountyPostError({ code: 'insufficient_cargo', detail: 'Reward exceeds cargo' });
    }
    return err;
  }

  private assertEnabled(): void {
    if (!this.flags.has('W22')) throw new CoreException('NOT_FOUND', { status: 404, message: 'Not found' });
  }
}

function baseUnits(amount: string): bigint {
  const whole = amount.split('.')[0] ?? '0';
  return BigInt(whole === '' ? '0' : whole);
}

function isUnique(err: unknown): boolean {
  return typeof err === 'object' && err !== null && 'code' in err && (err as { code: string }).code === 'P2002';
}
