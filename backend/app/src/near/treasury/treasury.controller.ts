import { Body, Controller, Get, HttpCode, Inject, Param, Post, Req } from '@nestjs/common';
import type { IncomingMessage } from 'node:http';
import { CoreException } from '../../core/errors/core-exception.js';
import { FlagsService } from '../../flags/flags.service.js';
import type { TreasuryCouncilResponse, TreasuryProposalResponse } from './council-view.js';
import { TreasuryProposalsService } from './proposals.service.js';

/**
 * `GET/POST /v1/near/treasury/:planetId` (W22-08, PROTOCOL F7).
 * The caller is the session colony's account. Under `NODE_ENV=test` only, body `colonyAccountId`
 * or header `x-colony-account-id` names that account (integration tests have no session).
 * 404 when W22 is off. `effects` stays empty: the finalize job posts the sim command (BE-82).
 * `projects` lists table costs from `shared/sim/src/data/treasury.ts`, including `guild_subsidy`.
 */
@Controller('near/treasury')
export class TreasuryController {
  constructor(
    @Inject(TreasuryProposalsService) private readonly proposals: TreasuryProposalsService,
    @Inject(FlagsService) private readonly flags: FlagsService,
  ) {}

  @Get(':planetId')
  async council(@Param('planetId') planetId: string): Promise<TreasuryCouncilResponse> {
    this.assertWave();
    return this.proposals.council(planetId);
  }

  @Post(':planetId/proposals')
  @HttpCode(200)
  async propose(
    @Param('planetId') planetId: string,
    @Body() raw: unknown,
    @Req() req: IncomingMessage,
  ): Promise<TreasuryProposalResponse> {
    this.assertWave();
    return this.proposals.propose(planetId, raw, req);
  }

  @Post(':planetId/proposals/:id/vote')
  @HttpCode(200)
  async vote(
    @Param('planetId') planetId: string,
    @Param('id') id: string,
    @Body() raw: unknown,
    @Req() req: IncomingMessage,
  ): Promise<TreasuryProposalResponse> {
    this.assertWave();
    return this.proposals.vote(planetId, id, raw, req);
  }

  private assertWave(): void {
    if (!this.flags.has('W22')) throw new CoreException('NOT_FOUND', { status: 404, message: 'Not found' });
  }
}
