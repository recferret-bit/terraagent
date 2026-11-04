import { Module } from '@nestjs/common';
import { ProgressionModule } from '../progression/progression.module.js';
import { ColonyHistoryStore } from './colony-history.store.js';
import { MeAchievementsController } from './me-achievements.controller.js';
import { MeAchievementsService } from './me-achievements.service.js';
import { MeProfileController } from './me-profile.controller.js';
import { MeProfileService } from './me-profile.service.js';

/** Player profile & achievements HTTP module (`/v1/me/profile`, `/v1/me/achievements`, W12-09, W12-12). */
@Module({
  imports: [ProgressionModule],
  controllers: [MeProfileController, MeAchievementsController],
  providers: [ColonyHistoryStore, MeAchievementsService, MeProfileService],
  exports: [ColonyHistoryStore, MeAchievementsService, MeProfileService],
})
export class ProfileModule {}
