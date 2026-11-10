import { Inject, Injectable } from '@nestjs/common';
import { BountyTarget } from '@terra/contracts';
import { CoreException } from '../../core/errors/core-exception.js';
import { FlagsService } from '../../flags/flags.service.js';
import { AccountId } from '../domain/types.js';
import { BountyRepository } from './bounty.repository.js';
import { BountyClaimError } from './errors.js';
import { toBountyView, type BountyRow, type BountyView } from './view.js';

interface WaveFlags {
  has(wave: string): boolean;
}

export interface BountyClaimInput {
  readonly planetId: string;
  readonly bountyId: string;
  readonly accountId: string;
}

/**
 * `bounty.claim` on the chain row (W22-23). Stores the caller in the one claimer column.
 * `clear_nest` may replace that caller; defend and deliver stay with the first.
 * W22 off is rejected. Payout is separate, after the bounty is completed.
 */
@Injectable()
export class BountyClaimService {
  constructor(
    @Inject(BountyRepository) private readonly repo: BountyRepository,
    @Inject(FlagsService) private readonly flags: WaveFlags,
  ) {}

  async claim(input: BountyClaimInput): Promise<BountyView> {
    if (!this.flags.has('W22')) throw new CoreException('NOT_FOUND', { status: 404, message: 'Not found' });
    if (!AccountId.safeParse(input.accountId).success) {
      throw new BountyClaimError('invalid_args', 'Colony account is invalid');
    }
    const row = await this.openRow(input);
    if (row.claimerAccountId === input.accountId && row.state === 'claimed') return toBountyView(row);
    const target = BountyTarget.parse(row.target);
    const replace = target.kind === 'clear_nest';
    if (row.claimerAccountId && row.claimerAccountId !== input.accountId && !replace) {
      throw new BountyClaimError('queue_full', 'This bounty already has a claimer');
    }
    return toBountyView(await this.write(row.id, input.accountId, replace));
  }

  private async openRow(input: BountyClaimInput): Promise<BountyRow> {
    const row = await this.repo.find(input.bountyId);
    if (!row || row.planetId !== input.planetId || !BountyTarget.safeParse(row.target).success) {
      throw new BountyClaimError('invalid_args', 'Bounty is not open');
    }
    if (row.state !== 'open' && row.state !== 'claimed') {
      throw new BountyClaimError('invalid_args', 'Bounty is not open');
    }
    return row;
  }

  private async write(id: string, accountId: string, replace: boolean): Promise<BountyRow> {
    const wrote = await this.repo.markClaimed(id, accountId, replace);
    const next = await this.repo.find(id);
    if (wrote && next) return next;
    if (next?.claimerAccountId === accountId) return next;
    if (next?.claimerAccountId) throw new BountyClaimError('queue_full', 'This bounty already has a claimer');
    throw new BountyClaimError('invalid_args', 'Bounty is not open');
  }
}
