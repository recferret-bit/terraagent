import { Injectable, Optional } from '@nestjs/common';
import {
  ACHIEVEMENTS,
  levelForXp,
  STAGE_UNLOCK_CONDITIONS,
  titleForLevel,
  type CurrentColonySummary,
  type MeProfileResponse,
  type PastColonySummary,
  type ProfileStats,
} from '@terra/contracts';
import { CoreException } from '../core/errors/index.js';
import { FlagsService } from '../flags/flags.service.js';
import { FactsStore } from '../progression/facts.store.js';
import { W12SeedService } from '../progression/w12-seed.service.js';
import { XpStore } from '../progression/xp.store.js';
import {
  ColonyHistoryStore,
  W12_SEED_CURRENT_COLONIES,
  W12_SEED_PAST_COLONIES,
} from './colony-history.store.js';
import { MeAchievementsService } from './me-achievements.service.js';
import type { ResolvedMePlayer } from './me-auth.js';

function unlockedTitlesForLevel(level: number): string[] {
  const out = ['Cadet'];
  if (level >= 2) out.push('Pioneer');
  if (level >= 4) out.push('Surveyor');
  if (level >= 6) out.push('Terraformer');
  if (level >= 10) out.push('Grid Master');
  if (level >= 15) out.push('Commander');
  if (level >= 20) out.push('Archon');
  if (level >= 25) out.push('Star Warden');
  if (level >= 30) out.push('Ascendant');
  return out;
}

function unlockedFramesForLevel(level: number): string[] {
  const out = ['default'];
  if (level >= 3) out.push('bronze-chamfer');
  if (level >= 4) out.push('surveyor');
  if (level >= 8) out.push('steel-hex');
  if (level >= 13) out.push('cyan-pulse');
  if (level >= 18) out.push('terra-crest');
  if (level >= 23) out.push('orbital-halo');
  if (level >= 28) out.push('ascendant-gold');
  return out;
}

function sanitizeHandle(raw: string): string {
  const cleaned = raw.replace(/^pr_dev_/, '').replace(/^pr_/, '').toLowerCase().replace(/[^a-z0-9_-]/g, '');
  return cleaned || 'pilot';
}

function buildProfileStats(
  facts: Readonly<Record<string, number>>,
  unlockStage: number,
  currentColonies: readonly CurrentColonySummary[],
  allPastColonies: readonly PastColonySummary[],
): ProfileStats {
  const settledCount = allPastColonies.filter((c) => c.outcome === 'settled').length;
  const eliminatedCount = allPastColonies.filter((c) => c.outcome === 'eliminated').length;
  const foundedCount = Math.max(
    facts['first-landfall'] ?? 0,
    currentColonies.length + allPastColonies.length,
  );
  return {
    coloniesFounded: foundedCount,
    coloniesSettled: Math.max(facts.settler ?? 0, settledCount),
    coloniesEliminated: eliminatedCount,
    highestStageReached: Math.max(unlockStage, facts['tech-ascendant'] ?? 0),
    tilesGraded: facts.groundbreaker ?? 0,
    obstaclesRemoved: facts['stone-mason'] ?? 0,
    waterTilesReclaimed: facts['hydro-engineer'] ?? 0,
    livingTilesCreated: facts['green-thumb'] ?? 0,
    buildingsCompleted: facts.architect ?? 0,
    peakNetPower: facts['power-broker'] ?? 0,
    nightsNoBrownout: facts['night-shift'] ?? 0,
    resourcesProduced: facts.stockpile ?? 0,
    faunaKilled: facts.exterminator ?? 0,
    nestsDestroyed: facts['nest-breaker'] ?? 0,
    raidsRepelled: facts.unbreached ?? 0,
    marketTradesSettled: facts.merchant ?? 0,
  };
}

@Injectable()
export class MeProfileService {
  constructor(
    private readonly facts: FactsStore,
    private readonly xp: XpStore,
    private readonly achievements: MeAchievementsService,
    private readonly colonies: ColonyHistoryStore,
    private readonly flags: FlagsService,
    @Optional() private readonly seed?: W12SeedService,
  ) {
    if (this.seed) {
      this.seed.onReset(async (pid) => {
        await this.colonies.reset(pid);
      });
    }
  }

  async getForPlayer(playerInput: string | ResolvedMePlayer): Promise<MeProfileResponse> {
    if (!this.flags.has('W12')) {
      throw new CoreException('wave_disabled', {
        status: 403,
        message: 'Player page is off',
        details: { code: 'wave_disabled' },
      });
    }

    const resolved: ResolvedMePlayer =
      typeof playerInput === 'string'
        ? { id: playerInput, handle: sanitizeHandle(playerInput), isGuest: false }
        : playerInput;
    const playerId = resolved.id;

    const [facts, xpState, achRes] = await Promise.all([
      this.facts.getAll(playerId),
      this.xp.get(playerId),
      this.achievements.getForPlayer(playerId),
    ]);

    let currentColonies = await this.colonies.getCurrent(playerId);
    let allPastColonies = await this.colonies.getPast(playerId);
    if (
      currentColonies.length === 0 &&
      allPastColonies.length === 0 &&
      !this.seed?.isReset(playerId) &&
      xpState.xp > 0
    ) {
      currentColonies = [...W12_SEED_CURRENT_COLONIES];
      allPastColonies = [...W12_SEED_PAST_COLONIES];
    }

    const visiblePastColonies = this.flags.has('W21')
      ? allPastColonies
      : allPastColonies.filter((c) => c.outcome !== 'settled');

    const levelProg = levelForXp(xpState.xp);
    const title = levelProg.level > 0 ? titleForLevel(levelProg.level) : xpState.title || 'Cadet';
    const currentStageMax = currentColonies.reduce((m, c) => Math.max(m, c.stage), 0);
    const unlockStage = Math.max(
      xpState.unlockStage,
      facts['tech-ascendant'] ?? 0,
      currentStageMax,
    );
    const nextStageCondition =
      unlockStage >= 10 ? null : (STAGE_UNLOCK_CONDITIONS[unlockStage + 1] ?? null);

    const handleSlug = sanitizeHandle(resolved.handle);
    const accountId = `${handleSlug}.terraagent.mock`;
    const stats = buildProfileStats(facts, unlockStage, currentColonies, allPastColonies);
    const next3 = this.achievements.nextAchievements(achRes.achievements, 3);

    return {
      identity: {
        playerId,
        handle: resolved.handle,
        accountId,
        isGuest: resolved.isGuest,
        pilotSince: '2026-10-01T00:00:00.000Z',
        avatarSeed: playerId,
        frame: xpState.frame || (levelProg.level >= 4 ? 'surveyor' : 'default'),
      },
      progression: {
        level: levelProg.level,
        xp: levelProg.xp,
        currentLevelXp: levelProg.currentLevelXp,
        nextLevelXp: levelProg.nextLevelXp,
        title,
        titles: unlockedTitlesForLevel(levelProg.level),
        frames: unlockedFramesForLevel(levelProg.level),
        unlockStage,
        nextStageCondition,
      },
      stats,
      currentColonies,
      pastColonies: visiblePastColonies,
      nextAchievements: next3,
      earnedAchievementsCount: achRes.earnedCount,
      totalAchievementsCount: ACHIEVEMENTS.length,
    };
  }
}
