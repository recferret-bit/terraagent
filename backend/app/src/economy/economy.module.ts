import { Module } from '@nestjs/common';
import { defineEnv } from '@terra/config';
import { z } from 'zod';
import { EconomyAuthGuard } from './economy-auth';
import { EconomyActivationController } from './activation/activation.controller';
import { EconomyActivationService } from './activation/activation.service';
import { EconomyProfileController } from './profile/profile.controller';
import { EconomyCashPrecheck } from './cash-precheck';
import { EconomyProfileService } from './profile/profile.service';
import { ExperimentController } from './experiments/experiment.controller';
import { ExperimentJobService } from './experiments/experiment-job.service';

export const env = defineEnv('economy', {
  /** Bearer token with the economy `read` role. Unset: dev builds use `dev-economy-reader`, production has none (role unavailable). */
  TA_ECONOMY_READ_TOKEN: z.string().min(16).optional(),
  /** Bearer token with the economy `edit` (candidate edit + experiment) role, which includes `read`. Unset: dev `dev-economy-operator`, production none. */
  TA_ECONOMY_EDIT_TOKEN: z.string().min(16).optional(),
  /** Bearer token with the economy `activate` role (approve, activate, rollback): operators only, never given to AI experiment credentials. Unset: dev `dev-economy-activator`, production none. */
  TA_ECONOMY_ACTIVATE_TOKEN: z.string().min(16).optional(),
  /** Concurrent experiment run threads (each experiment's own `budget.maxWorkers` also applies). Default 1. */
  TA_ECONOMY_EXPERIMENT_WORKERS: z.coerce.number().int().min(1).max(16).optional(),
  /** Run lease length in ms; an expired lease makes the run reclaimable after a crash. Default 30000. */
  TA_ECONOMY_EXPERIMENT_LEASE_MS: z.coerce.number().int().min(1000).optional(),
  /** Directory of the checksummed experiment artifacts. Default `tests/economy/artifacts/` (gitignored). */
  TA_ECONOMY_ARTIFACT_DIR: z.string().min(1).optional(),
});

/**
 * W13 economy management (D-44, ECONOMY §5–§8): parameter registry/schema, database profiles and versions,
 * compile/hash, activation/rollback, experiments and the operator API. Pure economy calculations live in
 * `shared/sim/src/economy/`; DB tables in `shared/db/prisma/economy.prisma` (W13-37).
 */
@Module({
  providers: [
    EconomyProfileService,
    EconomyActivationService,
    EconomyAuthGuard,
    EconomyCashPrecheck,
    ExperimentJobService,
  ],
  controllers: [
    EconomyProfileController,
    EconomyActivationController,
    ExperimentController,
  ],
  imports: [],
  exports: [EconomyProfileService, EconomyActivationService, ExperimentJobService],
})
export class EconomyModule {}
