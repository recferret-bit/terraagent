import { Body, Controller, Get, HttpCode, Param, ParseIntPipe, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import { EconomyAuthGuard, RequireEconomyRole, type EconomyRequest } from '../economy-auth';
import { ZodPipe } from '../../core/errors';
import { EconomyProfileService } from './profile.service';

const MutationBody = z.strictObject({ requestId: z.string().min(1).max(120), rationale: z.string().max(2000).optional() });
const ScopeQuery = z.strictObject({
  planetType: z.string().min(1).max(60).optional(), planetId: z.string().min(1).max(64).optional(),
  sectorArchetype: z.string().min(1).max(64).optional(), sectorId: z.string().min(1).max(64).optional(),
});
const actorOf = (req: EconomyRequest): string => req.economy?.actor ?? 'unknown';

/**
 * Economy management API (ECONOMY §8, W13-38). Every route needs a bearer token: `read` for GET, `edit` for clone / patch /
 * validate. Mutations carry `requestId` (idempotent, audited in `economy.audit_event`) and, for patch, the draft revision as
 * `expectedVersion`. No activation here (W13-39).
 */
@Controller('economy')
@UseGuards(EconomyAuthGuard)
export class EconomyProfileController {
  constructor(private readonly profiles: EconomyProfileService) {}

  @Get('schema') @RequireEconomyRole('read')
  schema() { return this.profiles.schema(); }

  @Get('profiles') @RequireEconomyRole('read')
  async list() { return { profiles: await this.profiles.list() }; }

  @Get('resolve') @RequireEconomyRole('read')
  async resolve(@Query(new ZodPipe(ScopeQuery)) q: z.infer<typeof ScopeQuery>) {
    const [c, region] = await Promise.all([this.profiles.compiledFor(q), this.profiles.regionFor(q)]);
    return {
      layers: c.layers, overrides: c.overrides, overridesHash: c.overridesHash, dataHash: c.dataHash, marketPolicyHash: c.marketConfig?.policyHash ?? null,
      /** Resolved endowment with per-field provenance and hashes (W13-50); `regionErrors` when the bindings/profile are invalid for this scope. */
      region: region.ok ? region.region : null,
      regionErrors: region.ok ? [] : region.errors,
    };
  }

  @Get('profiles/:id/versions') @RequireEconomyRole('read')
  async versions(@Param('id') id: string) { return { versions: await this.profiles.versions(id) }; }

  @Get('profiles/:id/versions/:version') @RequireEconomyRole('read')
  get(@Param('id') id: string, @Param('version', ParseIntPipe) version: number) { return this.profiles.get(id, version); }

  @Get('profiles/:id/versions/:version/export') @RequireEconomyRole('read')
  export(@Param('id') id: string, @Param('version', ParseIntPipe) version: number) { return this.profiles.export(id, version); }

  @Post('profiles/:id/versions/:version/clone') @HttpCode(201) @RequireEconomyRole('edit')
  clone(@Param('id') id: string, @Param('version', ParseIntPipe) version: number, @Body(new ZodPipe(MutationBody)) body: z.infer<typeof MutationBody>, @Req() req: EconomyRequest) {
    return this.profiles.clone(id, version, { actor: actorOf(req), requestId: body.requestId, rationale: body.rationale });
  }

  @Patch('profiles/:id/versions/:version') @RequireEconomyRole('edit')
  patch(@Param('id') id: string, @Param('version', ParseIntPipe) version: number, @Body() body: unknown, @Req() req: EconomyRequest) {
    return this.profiles.patch(id, version, body, actorOf(req));
  }

  @Post('profiles/:id/versions/:version/validate') @HttpCode(200) @RequireEconomyRole('edit')
  validate(@Param('id') id: string, @Param('version', ParseIntPipe) version: number, @Body(new ZodPipe(MutationBody)) body: z.infer<typeof MutationBody>, @Req() req: EconomyRequest) {
    return this.profiles.validate(id, version, { actor: actorOf(req), requestId: body.requestId });
  }
}
