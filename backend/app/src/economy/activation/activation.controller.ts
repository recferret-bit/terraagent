import { Body, Controller, Get, HttpCode, Param, ParseIntPipe, Post, Query, Req, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import { ZodPipe } from '../../core/errors';
import { EconomyAuthGuard, RequireEconomyRole, type EconomyRequest } from '../economy-auth';
import { EconomyProfileService } from '../profile/profile.service';
import { ACTIVATION_SCOPE, EconomyActivationService } from './activation.service';

const RequestId = z.string().min(1).max(120);
const ActivateBody = z.strictObject({
  requestId: RequestId,
  scope: z.string().min(1).max(120).default(ACTIVATION_SCOPE),
  /** `<profileId>@<version>`, e.g. `candidate-a@2`. */
  versionId: z.string().min(1).max(64),
  /** The version id ACTIVE for the scope now (`null`: none): the compare-and-swap guard. */
  expectedPreviousVersionId: z.string().min(1).max(64).nullable(),
  evidenceRunId: z.string().min(1).max(64).optional(),
  effectiveTick: z.number().int().nonnegative().default(0),
  nonProduction: z.boolean().optional(),
});
const RollbackBody = z.strictObject({ requestId: RequestId, effectiveTick: z.number().int().nonnegative().default(0) });
const ApproveBody = z.strictObject({ requestId: RequestId });
const ListQuery = z.strictObject({ scope: z.string().min(1).max(120).optional() });
const actorOf = (req: EconomyRequest): string => req.economy?.actor ?? 'unknown';

/**
 * Operator-only activation API (ECONOMY §5/§8, W13-39). Needs the separate `activate` token: the read/edit credentials of
 * AI experiments answer 403. Every mutation carries a `requestId` (idempotent, audited). Activation is scheduled at an
 * effective tick and applied by the host; rollback schedules the previous immutable version as a new activation.
 */
@Controller('economy')
@UseGuards(EconomyAuthGuard)
export class EconomyActivationController {
  constructor(private readonly activations: EconomyActivationService, private readonly profiles: EconomyProfileService) {}

  @Get('activations') @RequireEconomyRole('read')
  async list(@Query(new ZodPipe(ListQuery)) q: z.infer<typeof ListQuery>) { return { activations: await this.activations.list(q.scope), loadState: this.profiles.loadState }; }

  @Post('profiles/:id/versions/:version/approve') @HttpCode(200) @RequireEconomyRole('activate')
  approve(@Param('id') id: string, @Param('version', ParseIntPipe) version: number, @Body(new ZodPipe(ApproveBody)) body: z.infer<typeof ApproveBody>, @Req() req: EconomyRequest) {
    return this.profiles.approve(id, version, { actor: actorOf(req), requestId: body.requestId });
  }

  @Post('activations') @HttpCode(202) @RequireEconomyRole('activate')
  activate(@Body(new ZodPipe(ActivateBody)) body: z.infer<typeof ActivateBody>, @Req() req: EconomyRequest) {
    const { evidenceRunId, nonProduction, ...rest } = body;
    return this.activations.activate({ ...rest, actor: actorOf(req), ...(evidenceRunId ? { evidenceRunId } : {}), ...(nonProduction === undefined ? {} : { nonProduction }) });
  }

  @Post('activations/:id/rollback') @HttpCode(202) @RequireEconomyRole('activate')
  rollback(@Param('id') id: string, @Body(new ZodPipe(RollbackBody)) body: z.infer<typeof RollbackBody>, @Req() req: EconomyRequest) {
    return this.activations.rollback(id, { actor: actorOf(req), requestId: body.requestId, effectiveTick: body.effectiveTick });
  }
}
