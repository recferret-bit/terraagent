import { randomBytes } from 'node:crypto';
import { Inject, Injectable, Logger, Optional, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { CoreException } from '../../../core/errors/index.js';
import { databaseEnabled } from '../../../core/persistence.js';
import { APP_ENV, type AppEnv } from '../../../core/tokens.js';
import { FlagsService } from '../../../flags/flags.service.js';
import { GamePlanets } from '../../../game/game-planets.service.js';
import { GuildProvisionError } from '../guild-error.js';
import { loadPolicy, type GuildPolicy, type RosterNpc } from '../guild-plan.js';
import { routeAfterStrategy } from '../strategy/apply.js';
import { GuildStrategyPort } from '../strategy/port.js';
import { GuildVisitClock } from './guild-visit.clock.js';
import { GuildVisitPublisher, type ArrivedInput, type DepartedInput, type GuildPush } from './guild-visit.publisher.js';
import { GuildVisitRepository, type GuildVisitInsert, type GuildVisitRow } from './guild-visit.repository.js';
import { cadenceId, dueWindows, extraVisit, extraVisitId, type ScheduleInput, type VisitWindow } from './schedule.js';

export interface OpenDock {
  readonly id: string;
  readonly input: ArrivedInput;
}

export interface ClosedDock {
  readonly input: DepartedInput;
  readonly cleared: number;
}

export const GUILD_VISIT_TICK_MS = 5_000;

/**
 * Seeded Guild visits (W15-09). Each NPC loops one planet: dock for `dockWindowS`, en route for `visitGapS`, then the same planet.
 * A planned visit calls `GuildStrategyPort.choose` (W15-35). Prices stay in `quoteGuild`.
 * W15 off writes nothing and pushes nothing. Offers come from the maker's resting quotes when that source is wired.
 */
@Injectable()
export class GuildVisitService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger(GuildVisitService.name);
  private readonly clock = new GuildVisitClock();
  /** Last accepted route per NPC. Absent means the data-table route. */
  private readonly routes = new Map<string, readonly string[]>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private sweeping = false;

  constructor(
    private readonly flags: FlagsService,
    private readonly repo: GuildVisitRepository,
    private readonly publisher: GuildVisitPublisher,
    @Optional() @Inject(APP_ENV) private readonly env?: AppEnv,
    @Optional() @Inject(GamePlanets) private readonly planets?: GamePlanets,
    @Optional() @Inject(GuildStrategyPort) private readonly strategy?: GuildStrategyPort,
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

  /**
   * Dock `npcId` on `planetId` now. An open dock is reused. Does not publish; {@link announceDock} does,
   * after the caller has asked the maker for quotes. W15 off throws `wave_disabled` and writes nothing.
   */
  async dockNow(planetId: string, npcId: string): Promise<OpenDock> {
    this.requireOn();
    const npc = this.npcOf(npcId);
    await this.noteStrategy(npc, planetId);
    const open = await this.repo.openDocked(npc.id, planetId);
    const current = open[open.length - 1];
    if (current) return { id: current.id, input: arrivedOf(npc, windowOf(current)) };
    return this.insertDock(npc, planetId);
  }

  /** Push `guild.arrived` for a dock {@link dockNow} opened, and store the curated offers on the row. */
  async announceDock(id: string, input: ArrivedInput): Promise<GuildPush> {
    this.requireOn();
    const push = await this.publisher.arrived(input);
    if (push.t === 'guild.arrived' && 'offers' in push.d) await this.repo.saveOffers(id, push.d.offers);
    return push;
  }

  /** Mark every open dock departed. Null when nothing was docked. Does not publish. */
  async departNow(planetId: string, npcId: string): Promise<ClosedDock | null> {
    this.requireOn();
    const npc = this.npcOf(npcId);
    const open = await this.repo.openDocked(npc.id, planetId);
    let cleared = 0;
    for (const row of open) if (await this.repo.markDeparted(row.id)) cleared += 1;
    if (cleared === 0) return null;
    return { input: departedOf(npc, planetId), cleared };
  }

  /** Push `guild.departed` after the caller has cancelled quotes. */
  announceDepart(input: DepartedInput): GuildPush {
    this.requireOn();
    return this.publisher.departed(input);
  }

  /** One extra dock for kestrel on `planetId`. The seeded cadence is unchanged. W15 off returns null. */
  async scheduleExtraVisit(planetId: string): Promise<GuildPush | null> {
    if (!this.enabled()) return null;
    const npc = this.policy().roster[0];
    if (!npc) return null;
    await this.noteStrategy(npc, planetId);
    const now = this.clock.now(planetId);
    const window = extraVisit({ npcId: npc.id, planetId, nowMs: now, dockWindowMs: this.policy().dockWindowS * 1000 });
    const id = extraVisitId(npc.id, planetId, window.arriveAt, randomBytes(4).toString('hex'));
    await this.repo.insertExtra(draft(npc, window, id, 'extra'));
    const push = await this.publisher.arrived(arrivedOf(npc, window));
    if ('offers' in push.d) await this.repo.saveOffers(id, push.d.offers);
    return push;
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
    await this.noteStrategy(npc, planetId);
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
    if (created) pushes.push(await this.publishArrived(id, npc, window));
    if (now >= window.departAt && (await this.repo.markDeparted(id)))
      pushes.push(this.publisher.departed(departedOf(npc, window.planetId)));
    return pushes;
  }

  private async publishArrived(id: string, npc: RosterNpc, window: VisitWindow): Promise<GuildPush> {
    const push = await this.publisher.arrived(arrivedOf(npc, window));
    if ('offers' in push.d) await this.repo.saveOffers(id, push.d.offers);
    return push;
  }

  private input(npc: RosterNpc, planetId: string, policy: GuildPolicy): ScheduleInput {
    return {
      seed: policy.policyVersion,
      npcId: npc.id,
      planetId,
      route: this.routeOf(npc),
      dockWindowMs: policy.dockWindowS * 1000,
      visitGapMs: policy.visitGapS * 1000,
      enabled: true,
    };
  }

  private policy(): GuildPolicy {
    return loadPolicy((wave) => this.flags.has(wave));
  }

  /** `choose` before the window is opened. A rejected payload keeps the data route and does not price. */
  private async noteStrategy(npc: RosterNpc, planetId: string): Promise<void> {
    if (!this.strategy) return;
    const choice = await this.strategy.choose({ id: npc.id }, { nowMs: this.clock.now(planetId) });
    this.routes.set(npc.id, routeAfterStrategy(npc.route, choice));
  }

  private routeOf(npc: RosterNpc): readonly string[] {
    return this.routes.get(npc.id) ?? npc.route;
  }

  private requireOn(): void {
    if (!this.enabled()) throw new CoreException('wave_disabled', { status: 403, message: 'wave_disabled' });
  }

  private npcOf(npcId: string): RosterNpc {
    const npc = this.policy().roster.find((row) => row.id === npcId);
    if (!npc) throw new GuildProvisionError('unknown_npc', `unknown npc "${npcId}"`);
    return npc;
  }

  private async insertDock(npc: RosterNpc, planetId: string): Promise<OpenDock> {
    const now = this.clock.now(planetId);
    const window = extraVisit({ npcId: npc.id, planetId, nowMs: now, dockWindowMs: this.policy().dockWindowS * 1000 });
    const id = extraVisitId(npc.id, planetId, window.arriveAt, randomBytes(4).toString('hex'));
    await this.repo.insertExtra(draft(npc, window, id, 'extra'));
    return { id, input: arrivedOf(npc, window) };
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

function windowOf(row: GuildVisitRow): VisitWindow {
  return { npcId: row.npcId, planetId: row.planetId, arriveAt: row.arriveAt, departAt: row.departAt };
}

function arrivedOf(npc: RosterNpc, window: VisitWindow): ArrivedInput {
  return { shipId: npc.id, planetId: window.planetId, npcId: npc.id, name: npc.name, departAt: window.departAt };
}

function departedOf(npc: RosterNpc, planetId: string) {
  return { shipId: npc.id, planetId, npcId: npc.id };
}
