import { ProgressionEngine } from './progression-engine.js';
import { ProgressionEffects } from './progression-effects.js';
import { Global, Module } from '@nestjs/common';
import { AchievementEvaluatorService } from './achievement-evaluator.service.js';
import { AchievementUnlockStore } from './achievement-unlock.store.js';
import { FactsUpdaterService } from './facts-updater.service.js';
import { FactsStore } from './facts.store.js';
import { FamilyAvailabilityService } from './family-availability.js';
import { ProgressionDevCommand } from './progression-dev.command.js';
import { W12SeedService } from './w12-seed.service.js';
import { XpLedgerService } from './xp-ledger.service.js';
import { XpStore } from './xp.store.js';

/**
 * Progression domain module (W12): player facts, append-only achievement unlocks, wave availability,
 * idempotent XP ledger + level curve, W12 scenario seeder, and server dev commands.
 */
@Global()
@Module({
  providers: [
    ProgressionEngine,
    ProgressionEffects,
    FactsStore,
    FactsUpdaterService,
    AchievementUnlockStore,
    AchievementEvaluatorService,
    FamilyAvailabilityService,
    XpStore,
    XpLedgerService,
    W12SeedService,
    ProgressionDevCommand,
  ],
  exports: [
    ProgressionEngine,
    ProgressionEffects,
    FactsStore,
    FactsUpdaterService,
    AchievementUnlockStore,
    AchievementEvaluatorService,
    FamilyAvailabilityService,
    XpStore,
    XpLedgerService,
    W12SeedService,
    ProgressionDevCommand,
  ],
})
export class ProgressionModule {}
