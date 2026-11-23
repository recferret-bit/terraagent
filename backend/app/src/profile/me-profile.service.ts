import type { PrismaClient } from '@terra/db';
import { PRISMA } from '../db/db.module.js';
import { ProgressionEngine } from '../progression/progression-engine.js';
import { Inject, Injectable, Optional } from '@nestjs/common';
import {
  ACHIEVEMENTS,
  levelForXp,
  STAGE_UNLOCK_CONDITIONS,
  titleForLevel,
  type CurrentColonySummary,
  type MeProfileResponse,
  type PastColonySummary,
  type PilotHandleResponse,
  type PlayerAiSettings,
  type ProfileIdentity,
  type ProfileStats,
  type UpdatePilotHandle,
  type UpdatePlayerAiSettings,
} from '@terra/contracts';
import { CoreException } from '../core/errors/index.js';
import { databaseEnabled } from '../core/persistence.js';
import { APP_ENV, type AppEnv } from '../core/tokens.js';
import { FlagsService } from '../flags/flags.service.js';
import { DEFAULT_NEAR_AI_MODEL } from '../ai/nearai-models.js';
import { isLocalStakingFastTimings } from '../near/staking/local-staking-timings.js';
import { resolveDbStakerPerks } from '../near/staking/staker-perks.js';
import { isTeeAttestationRejected, LlmProviderPort, type LlmAttestation } from '../ports/llm-provider.port.js';
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
import { PlayerAiSettingsStore } from './player-ai-settings.store.js';
import { devPlayerId } from '../ws/session-verifier.js';

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

function formatActivity(
  notices: ReadonlyArray<{ readonly id: string; readonly payload: unknown; readonly createdAt: Date }> | undefined,
): MeProfileResponse['activity'] {
  return (notices ?? []).map((n) => {
    const payload = n.payload as { kind?: string; title?: string; familyName?: string; tierName?: string; xp?: number };
    if (payload.kind === 'history.trade' && payload.title) {
      return { id: n.id, title: payload.title, createdAt: n.createdAt.toISOString() };
    }
    return {
      id: n.id,
      title: `${payload.familyName ?? 'Achievement'} · ${payload.tierName ?? ''} (+${payload.xp ?? 0} XP)`,
      createdAt: n.createdAt.toISOString(),
    };
  });
}

@Injectable()
export class MeProfileService {
  private readonly aiSettings: PlayerAiSettingsStore;
  private readonly customHandles = new Map<string, string>();

  constructor(
    @Inject(FactsStore) private readonly facts: FactsStore,
    @Inject(XpStore) private readonly xp: XpStore,
    @Inject(MeAchievementsService) private readonly achievements: MeAchievementsService,
    @Inject(ColonyHistoryStore) private readonly colonies: ColonyHistoryStore,
    @Inject(FlagsService) private readonly flags: FlagsService,
    @Optional() @Inject(W12SeedService) private readonly seed?: W12SeedService,
    @Optional() @Inject(ProgressionEngine) private readonly engine?: ProgressionEngine,
    @Optional() @Inject(PRISMA) private readonly db?: PrismaClient,
    @Optional() @Inject(PlayerAiSettingsStore) aiSettings?: PlayerAiSettingsStore,
    @Optional() @Inject(LlmProviderPort) private readonly llm?: LlmProviderPort,
    @Optional() @Inject(APP_ENV) private readonly env?: AppEnv,
  ) {
    this.aiSettings = aiSettings ?? new PlayerAiSettingsStore();
    if (this.seed) {
      this.seed.onReset(async (pid) => {
        this.customHandles.delete(pid);
        await this.colonies.reset(pid);
      });
    }
  }

  getAiSettingsStore(): PlayerAiSettingsStore {
    return this.aiSettings;
  }

  async getAiSettings(playerId: string): Promise<PlayerAiSettings> {
    const [base, staker] = await Promise.all([
      this.aiSettings.getSettings(playerId),
      this.resolvePlayerStakerSummary(playerId),
    ]);
    return { ...base, ...staker };
  }

  async verifyAiEnclave(playerId: string): Promise<{
    readonly ok: boolean;
    readonly model: string;
    readonly managedStaker: boolean;
    readonly usedPlayerKey: boolean;
    readonly attestation: LlmAttestation | null;
  }> {
    const [creds, staker] = await Promise.all([
      this.aiSettings.getCredentials(playerId),
      this.resolvePlayerStakerSummary(playerId),
    ]);
    const hasKey = Boolean(creds.apiKey);
    if (!hasKey && !staker.stakerAutopilotActive) {
      throw new CoreException('invalid_ai_settings', {
        status: 400,
        message: 'Save a BYOK NEAR.AI key or stake >=10 NEAR in Colony Staking before running a TEE enclave check.',
      });
    }
    if (!this.llm) {
      return { ok: false, model: creds.model, managedStaker: staker.stakerAutopilotActive, usedPlayerKey: hasKey, attestation: null };
    }
    const model = hasKey ? creds.model : DEFAULT_NEAR_AI_MODEL;
    const res = await this.llm.complete({
      system: 'Reply strictly with JSON {"ok":true} for a TEE attestation probe.',
      messages: [{ role: 'user', content: 'ping' }],
      maxTokens: 24,
      temperature: 0,
      json: true,
      model,
      ...(hasKey && creds.apiKey ? { apiKey: creds.apiKey } : {}),
    });
    const envMap = (this.env ?? process.env) as Record<string, string | undefined>;
    const ok = res.attestation
      ? Boolean(res.attestation.verified) && !isTeeAttestationRejected(res.attestation)
      : envMap.AI_PROVIDER !== 'nearai';
    return {
      ok,
      model: res.model,
      managedStaker: !hasKey && staker.stakerAutopilotActive,
      usedPlayerKey: hasKey,
      attestation: res.attestation ?? null,
    };
  }

  private activeDb(): PrismaClient | undefined {
    return this.db && (this.engine?.enabled || databaseEnabled(this.env)) ? this.db : undefined;
  }

  private async resolvePlayerStakerSummary(
    playerId: string,
  ): Promise<{ readonly stakerAutopilotActive: boolean; readonly stakedNear: string }> {
    const liveDb = this.activeDb();
    if (!liveDb || typeof liveDb.socialIdentity?.findFirst !== 'function') {
      return { stakerAutopilotActive: false, stakedNear: '0' };
    }
    const envMap = (this.env ?? process.env) as Record<string, string | undefined>;
    const fastLocal = isLocalStakingFastTimings(envMap);
    const devMockAcct =
      playerId === 'pr_dev_w12' || (fastLocal && playerId.startsWith('pr_dev_'))
        ? `${sanitizeHandle(playerId)}.terraagent.mock`
        : null;
    const [linked, cols] = await Promise.all([
      liveDb.socialIdentity.findFirst({ where: { playerId }, orderBy: { createdAt: 'asc' }, select: { accountId: true } }),
      liveDb.colony.findMany({ where: { playerId }, take: 5, select: { id: true } }),
    ]);
    let bestYocto = 0n;
    let active = false;
    let stakedNear = '0';
    for (const candidate of [
      ...cols.map((c) => ({ colonyId: c.id })),
      ...(linked?.accountId ? [{ accountId: linked.accountId }] : []),
      ...(devMockAcct && devMockAcct !== linked?.accountId ? [{ accountId: devMockAcct }] : []),
    ]) {
      const perks = await resolveDbStakerPerks(liveDb, { ...candidate, env: envMap }).catch(() => null);
      if (perks && perks.totalStakedYocto >= bestYocto) {
        bestYocto = perks.totalStakedYocto;
        active = active || perks.managedAutopilotUnlocked;
        stakedNear = perks.totalStakedNear;
      }
    }
    return { stakerAutopilotActive: active, stakedNear };
  }

  async updateAiSettings(
    player: ResolvedMePlayer,
    input: UpdatePlayerAiSettings,
  ): Promise<PlayerAiSettings> {
    if (!this.flags.has('W12')) {
      throw new CoreException('wave_disabled', {
        status: 403,
        message: 'Player page is off',
        details: { code: 'wave_disabled' },
      });
    }
    const [saved, staker] = await Promise.all([
      this.aiSettings.updateSettings(
        { id: player.id, handle: player.handle },
        input,
      ),
      this.resolvePlayerStakerSummary(player.id),
    ]);
    return { ...saved, ...staker };
  }

  async updateHandle(
    player: ResolvedMePlayer,
    input: UpdatePilotHandle,
  ): Promise<PilotHandleResponse> {
    if (!this.flags.has('W12')) {
      throw new CoreException('wave_disabled', {
        status: 403,
        message: 'Player page is off',
        details: { code: 'wave_disabled' },
      });
    }
    const nextHandle = input.handle.trim();
    const liveDb = this.activeDb();
    const pairedDevId = player.id.startsWith('pr_dev_') ? devPlayerId(player.id.slice('pr_dev_'.length)) : null;
    if (liveDb && typeof liveDb.player?.findUnique === 'function') {
      const clash = await liveDb.player.findUnique({ where: { handle: nextHandle }, select: { id: true } });
      if (clash && clash.id !== player.id) {
        if (pairedDevId && clash.id === pairedDevId && typeof liveDb.player.update === 'function') {
          await liveDb.player.update({
            where: { id: pairedDevId },
            data: { handle: `dev_${player.id.slice('pr_dev_'.length)}_${pairedDevId.slice(-4)}` },
          }).catch(() => undefined);
        } else {
          throw new CoreException('handle_taken', {
            status: 409,
            message: 'That pilot name is already taken.',
          });
        }
      }
      try {
        await liveDb.player.upsert({
          where: { id: player.id },
          create: { id: player.id, handle: nextHandle },
          update: { handle: nextHandle },
        });
      } catch (err) {
        if (typeof err === 'object' && err !== null && (err as { code?: unknown }).code === 'P2002') {
          throw new CoreException('handle_taken', {
            status: 409,
            message: 'That pilot name is already taken.',
          });
        }
        throw err;
      }
    } else {
      for (const [otherId, existing] of this.customHandles) {
        if (otherId !== player.id && existing === nextHandle) {
          throw new CoreException('handle_taken', {
            status: 409,
            message: 'That pilot name is already taken.',
          });
        }
      }
    }
    this.customHandles.set(player.id, nextHandle);
    return { handle: nextHandle };
  }

  private async resolveIdentity(
    resolved: ResolvedMePlayer,
    frame: string,
  ): Promise<ProfileIdentity> {
    const playerId = resolved.id;
    const handleSlug = sanitizeHandle(resolved.handle);
    const liveDb = this.activeDb();
    const [player, linked] = await Promise.all([
      typeof liveDb?.player?.findUnique === 'function' ? liveDb.player.findUnique({ where: { id: playerId } }) : null,
      typeof liveDb?.socialIdentity?.findFirst === 'function'
        ? liveDb.socialIdentity.findFirst({ where: { playerId }, orderBy: { createdAt: 'asc' } })
        : null,
    ]);
    if (liveDb && linked && typeof liveDb.progressionEffect?.updateMany === 'function') {
      await this.expeditePendingBadgeEffects(liveDb, playerId);
    }
    const fastLocal = isLocalStakingFastTimings((this.env ?? process.env) as Record<string, string | undefined>);
    const accountId =
      linked?.accountId ??
      (playerId === 'pr_dev_w12' || (fastLocal && playerId.startsWith('pr_dev_'))
        ? `${handleSlug}.terraagent.mock`
        : null);
    const isGuest =
      liveDb && typeof liveDb.socialIdentity?.findFirst === 'function'
        ? !linked && !playerId.startsWith('pr_dev_')
        : resolved.isGuest;
    return {
      playerId,
      handle: player?.handle || this.customHandles.get(playerId) || resolved.handle,
      accountId,
      isGuest,
      pilotSince: player?.createdAt.toISOString() ?? (playerId === 'pr_dev_w12' ? '2026-10-01T00:00:00.000Z' : 'Unknown'),
      avatarSeed: playerId,
      frame,
    };
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

    await this.engine?.catchUp(playerId);
    const [facts, xpState, achRes] = await Promise.all([
      this.facts.getAll(playerId),
      this.xp.get(playerId),
      this.achievements.getForPlayer(playerId),
    ]);

    let currentColonies = await this.colonies.getCurrent(playerId);
    let allPastColonies = await this.colonies.getPast(playerId);
    if (
      playerId === 'pr_dev_w12' &&
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

    const liveDb = this.activeDb();
    const [identity, notices] = await Promise.all([
      this.resolveIdentity(resolved, xpState.frame || (levelProg.level >= 4 ? 'surveyor' : 'default')),
      typeof liveDb?.playerNotification?.findMany === 'function'
        ? liveDb.playerNotification.findMany({ where: { playerId }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 50 })
        : undefined,
    ]);
    const stats = buildProfileStats(facts, unlockStage, currentColonies, allPastColonies);

    return {
      identity,
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
      activity: formatActivity(notices),
      nextAchievements: this.achievements.nextAchievements(achRes.achievements, 3),
      earnedAchievementsCount: achRes.earnedCount,
      totalAchievementsCount: ACHIEVEMENTS.length,
      aiSettings: await this.getAiSettings(playerId),
    };
  }

  private async expeditePendingBadgeEffects(liveDb: PrismaClient, playerId: string): Promise<void> {
    await liveDb.progressionEffect.updateMany({
      where: { playerId, kind: 'achievement.badge', completedAt: null, availableAt: { gt: new Date() } },
      data: { availableAt: new Date(0) },
    });
  }
}
