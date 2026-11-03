import { randomUUID } from 'node:crypto';
import { Inject, Injectable, Optional, type OnModuleInit } from '@nestjs/common';
import { AchievementFamilyIdSchema } from '@terra/contracts';
import { z } from 'zod';
import { defineDevCommand, DevCommandRegistry } from '../dev/dev-command.registry.js';
import {
  AchievementEvaluatorService,
  type AchievementUnlockedEventV1,
} from './achievement-evaluator.service.js';
import { FactsUpdaterService } from './facts-updater.service.js';
import { W12SeedService } from './w12-seed.service.js';
import { XpLedgerService, type XpLevelUpEventV1 } from './xp-ledger.service.js';

export interface FactAddDevResult {
  readonly playerId: string;
  readonly family: string;
  readonly previousValue: number;
  readonly value: number;
  readonly unlocked: readonly AchievementUnlockedEventV1[];
  readonly levelUp: XpLevelUpEventV1 | null;
  readonly xp: number;
  readonly level: number;
  readonly title: string;
}

export interface XpAddDevResult {
  readonly playerId: string;
  readonly applied: boolean;
  readonly delta: number;
  readonly previousLevel: number;
  readonly xp: number;
  readonly level: number;
  readonly title: string;
  readonly leveledUp: boolean;
  readonly levelUp: XpLevelUpEventV1 | null;
}

/**
 * Registers server dev commands `fact.add`, `xp.add`, `profile.reset`, and `profile.seed_w12`
 * on `DevCommandRegistry` (W12-31). Disabled automatically in production.
 */
@Injectable()
export class ProgressionDevCommand implements OnModuleInit {
  constructor(
    @Optional() @Inject(DevCommandRegistry) private readonly registry: DevCommandRegistry | undefined,
    @Inject(FactsUpdaterService) private readonly factsUpdater: FactsUpdaterService,
    @Inject(AchievementEvaluatorService) private readonly evaluator: AchievementEvaluatorService,
    @Inject(XpLedgerService) private readonly xpLedger: XpLedgerService,
    @Inject(W12SeedService) private readonly seed: W12SeedService,
  ) {}

  onModuleInit(): void {
    if (!this.registry) return;
    this.registerFactAdd(this.registry);
    this.registerXpAdd(this.registry);
    this.registerProfileReset(this.registry);
    this.registerProfileSeed(this.registry);
  }

  async runFactAdd(input: {
    playerId?: string;
    family: z.output<typeof AchievementFamilyIdSchema>;
    delta: number;
  }): Promise<FactAddDevResult> {
    const pid = input.playerId ?? this.seed.lastActivePlayerId ?? 'pr_dev_w12';
    if (pid === 'pr_dev_w12') {
      await this.seed.ensureSeeded(pid);
    }
    this.seed.noteActivePlayer(pid);
    const unlocked: AchievementUnlockedEventV1[] = [];
    let levelUp: XpLevelUpEventV1 | null = null;

    const unsubUnlock = this.evaluator.onUnlocked((ev) => {
      if (ev.playerId === pid) unlocked.push(ev);
    });
    const unsubLevel = this.xpLedger.onLevelUp((ev) => {
      if (ev.playerId === pid) levelUp = ev;
    });

    try {
      const res = await this.factsUpdater.recordFact(pid, input.family, input.delta);
      if (res.unlocked) unlocked.push(...res.unlocked);
      if (res.levelUp) levelUp = res.levelUp;
      const xpState = await this.xpLedger.getPlayerXp(pid);
      return {
        playerId: pid,
        family: input.family,
        previousValue: res.previousValue,
        value: res.value,
        unlocked,
        levelUp,
        xp: xpState.xp,
        level: xpState.level,
        title: xpState.title,
      };
    } finally {
      unsubUnlock();
      unsubLevel();
    }
  }

  async runXpAdd(input: {
    playerId?: string;
    delta: number;
    sourceId?: string;
  }): Promise<XpAddDevResult> {
    const pid = input.playerId ?? this.seed.lastActivePlayerId ?? 'pr_dev_w12';
    if (pid === 'pr_dev_w12') {
      await this.seed.ensureSeeded(pid);
    }
    const sid = input.sourceId ?? randomUUID();
    this.seed.noteActivePlayer(pid);
    let levelUp: XpLevelUpEventV1 | null = null;
    const unsubLevel = this.xpLedger.onLevelUp((ev) => {
      if (ev.playerId === pid) levelUp = ev;
    });

    try {
      const out = await this.xpLedger.award(pid, 'dev', sid, input.delta);
      if (pid !== 'pr_dev_w12') {
        await this.xpLedger.award('pr_dev_w12', 'dev', sid, input.delta);
      }
      return {
        playerId: pid,
        applied: out.applied,
        delta: out.delta,
        previousLevel: out.previousLevel,
        xp: out.state.xp,
        level: out.state.level,
        title: out.state.title,
        leveledUp: out.state.level > out.previousLevel,
        levelUp,
      };
    } finally {
      unsubLevel();
    }
  }

  async runProfileReset(input: { playerId?: string }): Promise<{ playerId: string; reset: true }> {
    const pid = input.playerId ?? this.seed.lastActivePlayerId ?? 'pr_dev_w12';
    await this.seed.resetPilot(pid);
    return { playerId: pid, reset: true };
  }

  async runProfileSeed(input: { playerId?: string }): Promise<{ playerId: string; seeded: true }> {
    const pid = input.playerId ?? this.seed.lastActivePlayerId ?? 'pr_dev_w12';
    await this.seed.ensureSeeded(pid);
    return { playerId: pid, seeded: true };
  }

  private registerFactAdd(reg: DevCommandRegistry): void {
    reg.register(
      defineDevCommand({
        name: 'fact.add',
        help: 'Server: fact add <family> <n> increments or updates achievement fact <family> for a pilot',
        args: z
          .object({
            playerId: z.string().min(1).optional(),
            family: AchievementFamilyIdSchema,
            delta: z.number().finite(),
          })
          .strict(),
        run: (args) => this.runFactAdd(args),
      }),
    );
  }

  private registerXpAdd(reg: DevCommandRegistry): void {
    reg.register(
      defineDevCommand({
        name: 'xp.add',
        help: 'Server: xp add <n> awards <n> XP to a pilot',
        args: z
          .object({
            playerId: z.string().min(1).optional(),
            delta: z.number().finite(),
            sourceId: z.string().min(1).optional(),
          })
          .strict(),
        run: (args) => this.runXpAdd(args),
      }),
    );
  }

  private registerProfileReset(reg: DevCommandRegistry): void {
    reg.register(
      defineDevCommand({
        name: 'profile.reset',
        help: 'Server: profile reset clears facts, achievement unlocks and XP for a pilot',
        args: z.object({ playerId: z.string().min(1).optional() }).strict(),
        run: (args) => this.runProfileReset(args),
      }),
    );
  }

  private registerProfileSeed(reg: DevCommandRegistry): void {
    reg.register(
      defineDevCommand({
        name: 'profile.seed_w12',
        help: 'Server: seeds the W12 scenario pilot progression baseline',
        args: z.object({ playerId: z.string().min(1).optional() }).strict(),
        run: (args) => this.runProfileSeed(args),
      }),
    );
  }
}
