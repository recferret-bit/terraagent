import {
  ACHIEVEMENTS,
  progressOf,
  type MeAchievementsResponse,
  type MeProfileResponse,
  type PlayerAchievementEntry,
} from '@terra/contracts';

const EARNED_IDS = new Set([
  'first-landfall',
  'first-landfall-2',
  'groundbreaker',
  'stone-mason',
  'architect',
  'power-broker',
  'night-shift',
  'night-shift-2',
  'stockpile',
]);

const FACTS: Readonly<Record<string, number>> = {
  'first-landfall': 3,
  groundbreaker: 800,
  'stone-mason': 350,
  'hydro-engineer': 4,
  'green-thumb': 20,
  architect: 150,
  'power-broker': 140,
  'night-shift': 12,
  stockpile: 24500,
  'tech-ascendant': 4,
  exterminator: 18,
  unbreached: 2,
};

export function makeW12AchievementsFixture(comingSoonFamilies: ReadonlySet<string> = new Set()): MeAchievementsResponse {
  const entries: PlayerAchievementEntry[] = ACHIEVEMENTS.map((def) => {
    const isEarned = EARNED_IDS.has(def.id);
    const isComingSoon = !isEarned && comingSoonFamilies.has(def.familyId);
    const status = isEarned ? 'earned' : isComingSoon ? 'coming_soon' : 'locked';
    const progress = isEarned
      ? { value: def.threshold, target: def.threshold }
      : isComingSoon
        ? { value: 0, target: def.threshold }
        : progressOf(def, FACTS);
    return {
      id: def.id,
      familyId: def.familyId,
      familyName: def.familyName,
      tier: def.tier,
      tierName: def.tierName,
      name: def.name,
      description: def.description,
      threshold: def.threshold,
      xp: def.xp,
      star: def.star,
      metric: def.metric,
      producerWave: def.producerWave,
      glyph: def.glyph,
      status,
      progress,
      earnedAt: isEarned ? '2026-10-18T12:00:00.000Z' : null,
      nft: isEarned ? { status: 'minted', tokenId: `badge:${def.id}`, txHash: `mock:${def.id}` } : { status: 'none' },
    };
  });

  return {
    earnedCount: EARNED_IDS.size,
    totalCount: ACHIEVEMENTS.length,
    achievements: entries,
  };
}

export function makeW12ProfileFixture(handle = 'w12'): MeProfileResponse {
  const ach = makeW12AchievementsFixture();
  const next3 = ach.achievements
    .filter((a) => a.status === 'locked' && (a.id === 'groundbreaker-2' || a.id === 'stone-mason-2' || a.id === 'architect-2'))
    .slice(0, 3);

  return {
    identity: {
      playerId: 'pr_dev_w12',
      handle,
      accountId: 'w12.terraagent.mock',
      isGuest: true,
      pilotSince: '2026-10-01T00:00:00.000Z',
      avatarSeed: 'pr_dev_w12',
      frame: 'surveyor',
    },
    progression: {
      level: 4,
      xp: 1120,
      currentLevelXp: 1000,
      nextLevelXp: 1500,
      title: 'Surveyor',
      titles: ['Cadet', 'Pioneer', 'Surveyor'],
      frames: ['default', 'bronze-chamfer', 'surveyor'],
      unlockStage: 4,
      nextStageCondition: 'Construct Research Uplink and reach 100 E/s peak power',
    },
    stats: {
      coloniesFounded: 3,
      coloniesSettled: 1,
      coloniesEliminated: 1,
      highestStageReached: 4,
      tilesGraded: 800,
      obstaclesRemoved: 350,
      waterTilesReclaimed: 4,
      livingTilesCreated: 20,
      buildingsCompleted: 150,
      peakNetPower: 140,
      nightsNoBrownout: 12,
      resourcesProduced: 24500,
      faunaKilled: 18,
      nestsDestroyed: 0,
      raidsRepelled: 2,
      marketTradesSettled: 0,
    },
    currentColonies: [
      {
        colonyId: 'co_w12_live_1',
        name: 'Aegis Basin',
        planetId: 'pl_w12_forest',
        planetName: 'Sylva Reach',
        planetType: 'temperate',
        stage: 4,
        status: 'active',
        foundedAt: '2026-10-25T08:00:00.000Z',
      },
    ],
    pastColonies: [
      {
        colonyId: 'co_w12_past_1',
        name: 'Cinder Outpost',
        planetId: 'pl_w12_dune',
        planetName: 'Helios Prime',
        planetType: 'desert',
        stageReached: 3,
        outcome: 'eliminated',
        foundedAt: '2026-10-02T09:00:00.000Z',
        endedAt: '2026-10-08T19:30:00.000Z',
      },
      {
        colonyId: 'co_w12_past_2',
        name: 'Verdant Spire',
        planetId: 'pl_w12_ocean',
        planetName: 'Thalassa IV',
        planetType: 'ocean',
        stageReached: 10,
        outcome: 'settled',
        foundedAt: '2026-10-10T14:00:00.000Z',
        endedAt: '2026-10-21T22:15:00.000Z',
      },
    ],
    nextAchievements: next3,
    earnedAchievementsCount: 9,
    totalAchievementsCount: 60,
  };
}
