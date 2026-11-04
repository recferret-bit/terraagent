import { Module } from '@nestjs/common';
import { defineEnv } from '@terra/config';
import { z } from 'zod';
import { EconomyAuthGuard } from './economy-auth';
import { EconomyProfileController } from './profile/profile.controller';
import { EconomyProfileService } from './profile/profile.service';

export const env = defineEnv('economy', {
  /** Bearer token with the economy `read` role. Unset: dev builds use `dev-economy-reader`, production has none (role unavailable). */
  TA_ECONOMY_READ_TOKEN: z.string().min(16).optional(),
  /** Bearer token with the economy `edit` (candidate edit + experiment) role, which includes `read`. Unset: dev `dev-economy-operator`, production none. */
  TA_ECONOMY_EDIT_TOKEN: z.string().min(16).optional(),
});

/**
 * W13 economy management (D-44, ECONOMY §5–§8): parameter registry/schema, database profiles and versions,
 * compile/hash, activation/rollback, experiments and the operator API. Pure economy calculations live in
 * `shared/sim/src/economy/`; DB tables in `shared/db/prisma/economy.prisma` (W13-37).
 */
@Module({ providers: [EconomyProfileService, EconomyAuthGuard], controllers: [EconomyProfileController], imports: [], exports: [EconomyProfileService] })
export class EconomyModule {}
