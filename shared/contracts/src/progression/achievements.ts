// Pure, import-free achievement and XP catalogue (W12-01, player-profile-and-achievements-spec §§3-5).
// Imported directly by shared contracts, backend progression, frontend /me page, and design/achievements/generate.mjs.

export type AchievementTier = 1 | 2 | 3;
export type AchievementTierName = 'Bronze' | 'Silver' | 'Gold';
export type AchievementMetric = 'counter' | 'max';

export type AchievementProducerWave =
  | 'W01'
  | 'W02'
  | 'W03'
  | 'W05'
  | 'W07'
  | 'W08'
  | 'W13'
  | 'W14'
  | 'W15'
  | 'W18'
  | 'W21';

export const ACHIEVEMENT_FAMILY_IDS = [
  'first-landfall',
  'groundbreaker',
  'stone-mason',
  'hydro-engineer',
  'green-thumb',
  'architect',
  'power-broker',
  'night-shift',
  'stockpile',
  'tech-ascendant',
  'exterminator',
  'nest-breaker',
  'great-wall',
  'unbreached',
  'warlord',
  'merchant',
  'port-authority',
  'guild-contact',
  'diplomat',
  'settler',
] as const;

export type AchievementFamilyId = (typeof ACHIEVEMENT_FAMILY_IDS)[number];

export const TIER_NAMES: Readonly<Record<AchievementTier, AchievementTierName>> = {
  1: 'Bronze',
  2: 'Silver',
  3: 'Gold',
};

export const STANDARD_TIER_XP: readonly [number, number, number] = [50, 150, 400];
export const STAR_TIER_XP: readonly [number, number, number] = [100, 300, 800];

export interface AchievementFamilySpec {
  readonly familyId: AchievementFamilyId;
  readonly name: string;
  readonly glyph: string;
  readonly metric: AchievementMetric;
  readonly producerWave: AchievementProducerWave;
  readonly star: boolean;
  readonly thresholds: readonly [number, number, number];
  readonly descriptions: readonly [string, string, string];
}

export interface AchievementDef {
  readonly id: string;
  readonly familyId: AchievementFamilyId;
  readonly family: AchievementFamilyId;
  readonly familyName: string;
  readonly tier: AchievementTier;
  readonly tierName: AchievementTierName;
  readonly name: string;
  readonly description: string;
  readonly threshold: number;
  readonly xp: number;
  readonly star: boolean;
  readonly metric: AchievementMetric;
  readonly producerWave: AchievementProducerWave;
  readonly glyph: string;
}

export const ACHIEVEMENT_FAMILIES: readonly AchievementFamilySpec[] = [
  {
    familyId: 'first-landfall',
    name: 'Landfall',
    glyph: 'flag',
    metric: 'counter',
    producerWave: 'W01',
    star: false,
    thresholds: [1, 3, 10],
    descriptions: ['Found 1 colony.', 'Found 3 colonies.', 'Found 10 colonies.'],
  },
  {
    familyId: 'groundbreaker',
    name: 'Groundbreaker',
    glyph: 'shovel',
    metric: 'counter',
    producerWave: 'W01',
    star: false,
    thresholds: [100, 1000, 10000],
    descriptions: [
      'Grade 100 tiles to Prepared.',
      'Grade 1 000 tiles to Prepared.',
      'Grade 10 000 tiles to Prepared.',
    ],
  },
  {
    familyId: 'stone-mason',
    name: 'Stone Mason',
    glyph: 'rock',
    metric: 'counter',
    producerWave: 'W01',
    star: false,
    thresholds: [50, 500, 5000],
    descriptions: ['Remove 50 obstacles.', 'Remove 500 obstacles.', 'Remove 5 000 obstacles.'],
  },
  {
    familyId: 'hydro-engineer',
    name: 'Hydro Engineer',
    glyph: 'droplet',
    metric: 'counter',
    producerWave: 'W05',
    star: false,
    thresholds: [10, 100, 1000],
    descriptions: [
      'Reclaim 10 water tiles.',
      'Reclaim 100 water tiles.',
      'Reclaim 1 000 water tiles.',
    ],
  },
  {
    familyId: 'green-thumb',
    name: 'Green Thumb',
    glyph: 'sprout',
    metric: 'counter',
    producerWave: 'W05',
    star: false,
    thresholds: [50, 500, 5000],
    descriptions: [
      'Turn 50 tiles Living.',
      'Turn 500 tiles Living.',
      'Turn 5 000 tiles Living.',
    ],
  },
  {
    familyId: 'architect',
    name: 'Architect',
    glyph: 'crane',
    metric: 'counter',
    producerWave: 'W02',
    star: false,
    thresholds: [25, 250, 2500],
    descriptions: [
      'Complete 25 buildings.',
      'Complete 250 buildings.',
      'Complete 2 500 buildings.',
    ],
  },
  {
    familyId: 'power-broker',
    name: 'Power Broker',
    glyph: 'bolt',
    metric: 'max',
    producerWave: 'W03',
    star: false,
    thresholds: [100, 500, 2000],
    descriptions: [
      'Reach 100 E/s peak net power in one colony.',
      'Reach 500 E/s peak net power in one colony.',
      'Reach 2 000 E/s peak net power in one colony.',
    ],
  },
  {
    familyId: 'night-shift',
    name: 'Night Shift',
    glyph: 'moon',
    metric: 'counter',
    producerWave: 'W02',
    star: false,
    thresholds: [1, 10, 50],
    descriptions: [
      'Survive 1 night with no brownout beyond terraform shedding.',
      'Survive 10 nights with no brownout beyond terraform shedding.',
      'Survive 50 nights with no brownout beyond terraform shedding.',
    ],
  },
  {
    familyId: 'stockpile',
    name: 'Stockpile',
    glyph: 'crate',
    metric: 'counter',
    producerWave: 'W02',
    star: false,
    thresholds: [10000, 100000, 1000000],
    descriptions: [
      'Produce 10 000 resources across all types.',
      'Produce 100 000 resources across all types.',
      'Produce 1 000 000 resources across all types.',
    ],
  },
  {
    familyId: 'tech-ascendant',
    name: 'Ascendant',
    glyph: 'chevrons',
    metric: 'max',
    producerWave: 'W08',
    star: true,
    thresholds: [5, 8, 10],
    descriptions: ['Reach Stage 5.', 'Reach Stage 8.', 'Reach Stage 10.'],
  },
  {
    familyId: 'exterminator',
    name: 'Exterminator',
    glyph: 'bug',
    metric: 'counter',
    producerWave: 'W07',
    star: false,
    thresholds: [50, 500, 5000],
    descriptions: ['Kill 50 fauna.', 'Kill 500 fauna.', 'Kill 5 000 fauna.'],
  },
  {
    familyId: 'nest-breaker',
    name: 'Nest Breaker',
    glyph: 'nest',
    metric: 'counter',
    producerWave: 'W07',
    star: false,
    thresholds: [1, 10, 50],
    descriptions: ['Destroy 1 fauna nest.', 'Destroy 10 fauna nests.', 'Destroy 50 fauna nests.'],
  },
  {
    familyId: 'great-wall',
    name: 'Great Wall',
    glyph: 'wall',
    metric: 'counter',
    producerWave: 'W14',
    star: false,
    thresholds: [20, 200, 2000],
    descriptions: [
      'Raise 20 Ridge or Moat tiles.',
      'Raise 200 Ridge or Moat tiles.',
      'Raise 2 000 Ridge or Moat tiles.',
    ],
  },
  {
    familyId: 'unbreached',
    name: 'Unbreached',
    glyph: 'shield',
    metric: 'counter',
    producerWave: 'W07',
    star: false,
    thresholds: [5, 50, 250],
    descriptions: [
      'Repel 5 raids without losing a building.',
      'Repel 50 raids without losing a building.',
      'Repel 250 raids without losing a building.',
    ],
  },
  {
    familyId: 'warlord',
    name: 'Warlord',
    glyph: 'crossed-blades',
    metric: 'counter',
    producerWave: 'W18',
    star: true,
    thresholds: [10, 100, 1000],
    descriptions: [
      'Destroy 10 enemy units in PvP.',
      'Destroy 100 enemy units in PvP.',
      'Destroy 1 000 enemy units in PvP.',
    ],
  },
  {
    familyId: 'merchant',
    name: 'Merchant',
    glyph: 'coins',
    metric: 'counter',
    producerWave: 'W13',
    star: false,
    thresholds: [5, 50, 500],
    descriptions: [
      'Settle 5 market trades.',
      'Settle 50 market trades.',
      'Settle 500 market trades.',
    ],
  },
  {
    familyId: 'port-authority',
    name: 'Port Authority',
    glyph: 'market-stall',
    metric: 'counter',
    producerWave: 'W13',
    star: false,
    thresholds: [100, 1000, 10000],
    descriptions: [
      'Earn 100 units in fees from your Trade Hub stalls.',
      'Earn 1 000 units in fees from your Trade Hub stalls.',
      'Earn 10 000 units in fees from your Trade Hub stalls.',
    ],
  },
  {
    familyId: 'guild-contact',
    name: 'Guild Contact',
    glyph: 'ship',
    metric: 'counter',
    producerWave: 'W15',
    star: false,
    thresholds: [5, 50, 250],
    descriptions: [
      'Complete 5 trades with the Orbital Guild.',
      'Complete 50 trades with the Orbital Guild.',
      'Complete 250 trades with the Orbital Guild.',
    ],
  },
  {
    familyId: 'diplomat',
    name: 'Diplomat',
    glyph: 'handshake',
    metric: 'counter',
    producerWave: 'W18',
    star: false,
    thresholds: [1, 5, 25],
    descriptions: [
      'Sign and keep 1 truce to term.',
      'Sign and keep 5 truces to term.',
      'Sign and keep 25 truces to term.',
    ],
  },
  {
    familyId: 'settler',
    name: 'Star Settler',
    glyph: 'rocket',
    metric: 'counter',
    producerWave: 'W21',
    star: true,
    thresholds: [1, 3, 10],
    descriptions: ['Settle 1 colony.', 'Settle 3 colonies.', 'Settle 10 colonies.'],
  },
];

export function achievementIdFor(familyId: AchievementFamilyId, tier: AchievementTier): string {
  return tier === 1 ? familyId : `${familyId}-${tier}`;
}

function expandCatalogue(families: readonly AchievementFamilySpec[]): readonly AchievementDef[] {
  const out: AchievementDef[] = [];
  for (const f of families) {
    const xps = f.star ? STAR_TIER_XP : STANDARD_TIER_XP;
    for (const tier of [1, 2, 3] as const) {
      const idx = tier - 1;
      out.push({
        id: achievementIdFor(f.familyId, tier),
        familyId: f.familyId,
        family: f.familyId,
        familyName: f.name,
        tier,
        tierName: TIER_NAMES[tier],
        name: f.name,
        description: f.descriptions[idx],
        threshold: f.thresholds[idx],
        xp: xps[idx],
        star: f.star,
        metric: f.metric,
        producerWave: f.producerWave,
        glyph: f.glyph,
      });
    }
  }
  return out;
}

export const ACHIEVEMENTS: readonly AchievementDef[] = expandCatalogue(ACHIEVEMENT_FAMILIES);

export const ACHIEVEMENT_BY_ID: ReadonlyMap<string, AchievementDef> = new Map(
  ACHIEVEMENTS.map((a) => [a.id, a]),
);

export const ACHIEVEMENT_FAMILY_BY_ID: ReadonlyMap<AchievementFamilyId, AchievementFamilySpec> = new Map(
  ACHIEVEMENT_FAMILIES.map((f) => [f.familyId, f]),
);

export const ACHIEVEMENTS_BY_FAMILY: ReadonlyMap<
  AchievementFamilyId,
  readonly [AchievementDef, AchievementDef, AchievementDef]
> = new Map(
  ACHIEVEMENT_FAMILIES.map((f) => {
    const tiers = ACHIEVEMENTS.filter((a) => a.familyId === f.familyId);
    return [f.familyId, [tiers[0], tiers[1], tiers[2]] as const];
  }),
);

/** Computes `{ value, target }` for one achievement tier against a player's facts map (`0 <= value <= target`). */
export function progressOf(
  def: Pick<AchievementDef, 'familyId' | 'threshold'>,
  facts: Readonly<Record<string, number>>,
): { value: number; target: number } {
  const raw = Number(facts[def.familyId] ?? 0);
  const clean = Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 0;
  return { value: Math.min(clean, def.threshold), target: def.threshold };
}

/** Returns all catalogue tiers whose threshold is met by `facts` and not in `alreadyEarned`. */
export function evaluateNewUnlocks(
  facts: Readonly<Record<string, number>>,
  alreadyEarned: ReadonlySet<string> = new Set(),
  allowedFamilies?: ReadonlySet<string>,
): AchievementDef[] {
  const unlocked: AchievementDef[] = [];
  for (const def of ACHIEVEMENTS) {
    if (allowedFamilies && !allowedFamilies.has(def.familyId)) continue;
    if (alreadyEarned.has(def.id)) continue;
    const raw = Number(facts[def.familyId] ?? 0);
    if (Number.isFinite(raw) && raw >= def.threshold) unlocked.push(def);
  }
  return unlocked;
}

export const MAX_PLAYER_LEVEL = 30;

/** Total XP required to reach `level` (`50 * L * (L + 1)`, cap 30 = 46 500 XP). */
export function xpRequiredForLevel(level: number): number {
  const clamped = Math.max(0, Math.min(MAX_PLAYER_LEVEL, Math.floor(level)));
  return 50 * clamped * (clamped + 1);
}

export interface LevelProgress {
  readonly level: number;
  readonly xp: number;
  readonly currentLevelXp: number;
  readonly nextLevelXp: number;
}

/** Derives player level (`0..30`) and current/next level XP thresholds from total `xp`. */
export function levelForXp(xp: number): LevelProgress {
  const safeXp = Number.isFinite(xp) && xp > 0 ? Math.floor(xp) : 0;
  let level = 0;
  while (level < MAX_PLAYER_LEVEL && safeXp >= xpRequiredForLevel(level + 1)) {
    level += 1;
  }
  const currentLevelXp = xpRequiredForLevel(level);
  const nextLevelXp = level >= MAX_PLAYER_LEVEL ? currentLevelXp : xpRequiredForLevel(level + 1);
  return { level, xp: safeXp, currentLevelXp, nextLevelXp };
}

export function titleForLevel(level: number): string {
  if (level >= 30) return 'Ascendant';
  if (level >= 25) return 'Star Warden';
  if (level >= 20) return 'Archon';
  if (level >= 15) return 'Commander';
  if (level >= 10) return 'Grid Master';
  if (level >= 6) return 'Terraformer';
  if (level >= 4) return 'Surveyor';
  if (level >= 2) return 'Pioneer';
  return 'Cadet';
}

export const STAGE_UNLOCK_CONDITIONS: Readonly<Record<number, string>> = {
  0: 'Drop Pod in orbit',
  1: 'Landfall — deploy the Command Hub',
  2: 'Build first Extractor and Solar Array',
  3: 'Grade 20 tiles and establish Storage Depot',
  4: 'Reach 50 E/s power output and 3 active workers',
  5: 'Construct Research Uplink and reach 100 E/s peak power',
  6: 'Reclaim 10 water tiles and establish Hydro Processing',
  7: 'Repel a fauna raid and reinforce colony perimeter',
  8: 'Activate Orbital Beacon and Trade Hub',
  9: 'Complete planetary terraforming lattice',
  10: 'Launch Star Settler Ark (Colony Settled)',
};
