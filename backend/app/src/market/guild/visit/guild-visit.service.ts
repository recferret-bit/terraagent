import { randomBytes } from 'node:crypto';
import { Inject, Injectable, Logger, Optional, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { databaseEnabled } from '../../../core/persistence.js';
import { APP_ENV, type AppEnv } from '../../../core/tokens.js';
import { FlagsService } from '../../../flags/flags.service.js';
import { GamePlanets } from '../../../game/game-planets.service.js';
import { loadPolicy, type GuildPolicy, type RosterNpc } from '../guild-plan.js';
import { GuildVisitClock } from './guild-visit.clock.js';
import { GuildVisitPublisher, type ArrivedInput, type GuildPush } from './guild-visit.publisher.js';
import { GuildVisitRepository, type GuildVisitInsert } from './guild-visit.repository.js';
import { cadenceId, dueWindows, extraVisit, extraVisitId, type ScheduleInput, type VisitWindow } from './schedule.js';

export const GUILD_VISIT_TICK_MS = 5_000;

/**
 * Seeded Guild visits (W15-09). Each NPC loops one planet: dock for `dockWindowS`, en route for `visitGapS`, then the same planet.
 * W15 off writes nothing and pushes nothing. Offers are empty until W15-11.
 */
@Injectable()
export class GuildVisitService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger(GuildVisitService.name);
  private readonly clock = new GuildVisitClock();
  private timer: ReturnType<typeof setInterval> | null = null;
  private sweeping = false;

  constructor(
    private readonly flags: FlagsService,
    private readonly repo: GuildVisitRepository,
    private readonly publisher: GuildVisitPublisher,
    @Optional() @Inject(APP_ENV) private readonly env?: AppEnv,
    @Optional() @Inject(GamePlanets) private readonly planets?: GamePlanets,
  ) {}

  onModuleInit(): void {
    if (!this.enabled() || this.env?.NODE_ENV === 'test') return;
    this.start();
  }

  onModuleDestroy(): void {
    this.stop();
  }

  start(intervalMs = GUILD_VISIT_TICK_MS): void {
    if (this.timer || !this.enabled()) return;
    this.timer = setInterval(() => {
      void this.sweep().catch((err: unknown) => this.warn(err));
    }, intervalMs);
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** Pin this planet's guild clock at `toMs` and open or close the visits that are due. */
  advance(planetId: string, toMs: number, npcId?: string): Promise<GuildPush[]> {
    this.clock.warpTo(planetId, toMs);
    return this.at(planetId, toMs, npcId);
  }

  tick(planetId: string, npcId?: string): Promise<GuildPush[]> {
    return this.at(planetId, this.clock.now(planetId), npcId);
  }

  /** One extra dock for kestrel on `planetId`. The seeded cadence is unchanged. W15 off returns null. */
  async scheduleExtraVisit(planetId: string): Promise<GuildPush | null> {
    if (!this.enabled()) return null;
    const npc = this.policy().roster[0];
    if (!npc) return null;
    const now = this.clock.now(planetId);
    const window = extraVisit({ npcId: npc.id, planetId, nowMs: now, dockWindowMs: this.policy().dockWindowS * 1000 });
    const id = extraVisitId(npc.id, planetId, window.arriveAt, randomBytes(4).toString('hex'));
    await this.repo.insertExtra(draft(npc, window, id, 'extra'));
    return this.publisher.arrived(arrivedOf(npc, window));
  }

  private async sweep(): Promise<void> {
    if (this.sweeping || !this.enabled()) return;
    this.sweeping = true;
    try {
      for (const planetId of this.planets?.loadedIds() ?? []) {
        await this.tick(planetId).catch((err: unknown) => this.warn(err));
      }
    } finally {
      this.sweeping = false;
    }
  }

  private async at(planetId: string, now: number, npcId?: string): Promise<GuildPush[]> {
    if (!this.enabled()) return [];
    const policy = this.policy();
    const roster = npcId ? policy.roster.filter((npc) => npc.id === npcId) : policy.roster;
    const pushes: GuildPush[] = [];
    for (const npc of roster) pushes.push(...(await this.syncNpc(npc, planetId, now, policy)));
    return pushes;
  }

  private async syncNpc(npc: RosterNpc, planetId: string, now: number, policy: GuildPolicy): Promise<GuildPush[]> {
    const last = await this.repo.latestCadence(npc.id, planetId);
    const pushes: GuildPush[] = [];
    for (const window of dueWindows(this.input(npc, planetId, policy), last?.arriveAt ?? null, now)) {
      pushes.push(...(await this.apply(npc, window, now)));
    }
    for (const row of await this.repo.openDue(npc.id, planetId, now)) {
      if (await this.repo.markDeparted(row.id)) pushes.push(this.publisher.departed(row));
    }
    return pushes;
  }

  private async apply(npc: RosterNpc, window: VisitWindow, now: number): Promise<GuildPush[]> {
    const id = cadenceId(npc.id, window.planetId, window.arriveAt);
    const { created } = await this.repo.insertCadence(draft(npc, window, id, 'cadence'));
    const pushes: GuildPush[] = [];
    if (created) pushes.push(this.publisher.arrived(arrivedOf(npc, window)));
    if (now >= window.departAt && (await this.repo.markDeparted(id)))
      pushes.push(this.publisher.departed(departedOf(npc, window.planetId)));
    return pushes;
  }

  private input(npc: RosterNpc, planetId: string, policy: GuildPolicy): ScheduleInput {
    return {
      seed: policy.policyVersion,
      npcId: npc.id,
      planetId,
      route: npc.route,
      dockWindowMs: policy.dockWindowS * 1000,
      visitGapMs: policy.visitGapS * 1000,
      enabled: true,
    };
  }

  private policy(): GuildPolicy {
    return loadPolicy((wave) => this.flags.has(wave));
  }

  private enabled(): boolean {
    return this.flags.has('W15') && databaseEnabled(this.env);
  }

  private warn(err: unknown): void {
    this.log.warn(`guild visit tick failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}

function draft(npc: RosterNpc, window: VisitWindow, id: string, kind: 'cadence' | 'extra'): GuildVisitInsert {
  return {
    id,
    npcId: npc.id,
    shipId: npc.id,
    planetId: window.planetId,
    arriveAt: window.arriveAt,
    departAt: window.departAt,
    kind,
  };
}

function arrivedOf(npc: RosterNpc, window: VisitWindow): ArrivedInput {
  return { shipId: npc.id, planetId: window.planetId, npcId: npc.id, name: npc.name, departAt: window.departAt };
}

function departedOf(npc: RosterNpc, planetId: string) {
  return { shipId: npc.id, planetId, npcId: npc.id };
}
