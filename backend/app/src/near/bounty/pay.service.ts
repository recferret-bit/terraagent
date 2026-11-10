import { Inject, Injectable, Logger, Optional, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { BountyReward, newId, type SimCommandV1 } from '@terra/contracts';
import { GamePlanets } from '../../game/game-planets.service.js';
import { FlagsService } from '../../flags/flags.service.js';
import { EscrowPort } from '../application/ports/escrow.port.js';
import { ChainOutboxRepository, type ClaimedRow } from '../application/outbox/chain-outbox.repository.js';
import { OutboxListeners } from '../application/outbox/outbox-listeners.js';
import { BountyRepository } from './bounty.repository.js';
import { bountyIdFromPayOp, bountyPayOpId } from './validate.js';
import type { BountyRow } from './view.js';

interface WaveFlags {
  has(wave: string): boolean;
}

interface SimHost {
  isLoaded(planetId: string): boolean;
  submit(planetId: string, cmd: SimCommandV1): Promise<{ ok: boolean; code?: string }>;
}

/**
 * Pays a completed bounty once (`opId = bounty-pay:{id}`, W22-23).
 * The mock escrow replays that op, so a second call does not credit the claimer again.
 * A throw leaves the row `completed` and the outbox row pending for the relay.
 */
@Injectable()
export class BountyPayService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger(BountyPayService.name);
  private off: (() => void) | null = null;

  constructor(
    @Inject(EscrowPort) private readonly escrow: EscrowPort,
    @Inject(ChainOutboxRepository) private readonly outbox: ChainOutboxRepository,
    @Inject(BountyRepository) private readonly repo: BountyRepository,
    @Inject(FlagsService) private readonly flags: WaveFlags,
    @Optional() @Inject(GamePlanets) private readonly sim?: SimHost,
    @Optional() @Inject(OutboxListeners) private readonly listeners?: OutboxListeners,
  ) {}

  onModuleInit(): void {
    this.off ??= this.listeners?.onDone((row) => this.afterRelay(row)) ?? null;
    void this.replay();
  }

  onModuleDestroy(): void {
    this.off?.();
    this.off = null;
  }

  /** False when there is no claimer, the row is not completed, or W22 is off. Throws when the escrow claim fails. */
  async pay(id: string, claimerId?: string): Promise<boolean> {
    if (!this.flags.has('W22')) return false;
    const row = await this.repo.find(id);
    if (!this.payable(row)) return false;
    await this.claimEscrow(row);
    await this.finish(row, claimerId ?? row.claimerAccountId);
    return true;
  }

  private payable(row: BountyRow | null): row is BountyRow & { claimerAccountId: string } {
    return !!row?.claimerAccountId && (row.state === 'completed' || row.state === 'paid');
  }

  private async claimEscrow(row: BountyRow & { claimerAccountId: string }): Promise<void> {
    const body = { opId: bountyPayOpId(row.id), escrowId: row.escrowId, caller: row.claimerAccountId };
    await this.outbox.enqueue({ opId: body.opId, port: 'Escrow', method: 'claim', payload: body });
    const receipt = await this.escrow.claim(body);
    await this.outbox.markDoneByOpId(body.opId, receipt, receipt.txHash).catch(() => false);
  }

  private async finish(row: BountyRow, claimerId: string): Promise<void> {
    if (row.state === 'completed') await this.repo.markPaid(row.id);
    if (await this.tellSim(row, claimerId)) await this.outbox.flagPayload(bountyPayOpId(row.id), 'simPaid');
  }

  /** Module command. No planet loaded, or no reward amount, means try again on the next pay or boot. */
  private async tellSim(row: BountyRow, claimerId: string): Promise<boolean> {
    const amount = rewardAmount(row);
    if (amount === null || !this.sim?.isLoaded(row.planetId)) return false;
    try {
      const out = await this.sim.submit(row.planetId, paidCommand(row.id, claimerId, amount));
      if (out.ok || out.code === 'unknown_entity') return true;
      this.log.warn(`bounty ${row.id} sim paid rejected: ${out.code ?? 'unknown'}`);
      return false;
    } catch (err) {
      this.log.warn(`bounty ${row.id} sim paid failed: ${message(err)}`);
      return false;
    }
  }

  private async afterRelay(row: ClaimedRow): Promise<void> {
    if (row.port !== 'Escrow' || row.method !== 'claim') return;
    const id = bountyIdFromPayOp(row.opId);
    const bounty = id ? await this.repo.find(id) : null;
    if (!bounty?.claimerAccountId || (bounty.state !== 'completed' && bounty.state !== 'paid')) return;
    await this.finish(bounty, bounty.claimerAccountId);
  }

  private async replay(): Promise<void> {
    if (!this.flags.has('W22')) return;
    try {
      for (const row of await this.repo.completed()) {
        try {
          await this.pay(row.id);
        } catch (err) {
          this.log.warn(`bounty ${row.id} repay failed: ${message(err)}`);
        }
      }
      await this.replaySim();
    } catch (err) {
      this.log.warn(`bounty repay failed: ${message(err)}`);
    }
  }

  private async replaySim(): Promise<void> {
    for (const row of await this.outbox.doneMissingFlag('bounty-pay:', 'simPaid')) {
      const id = bountyIdFromPayOp(row.opId);
      const bounty = id ? await this.repo.find(id) : null;
      if (!bounty || (bounty.state !== 'completed' && bounty.state !== 'paid')) continue;
      await this.finish(bounty, bounty.claimerAccountId ?? id!);
    }
  }
}

function paidCommand(bountyId: string, claimerId: string, amount: number): SimCommandV1 {
  return {
    colonyIndex: null,
    source: 'near',
    commandId: newId('cm'),
    kind: 'bounty.paid',
    args: { bountyId, claimerId, amount },
  };
}

function rewardAmount(row: BountyRow): number | null {
  const parsed = BountyReward.safeParse(row.reward);
  return parsed.success ? parsed.data.amount : null;
}

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
