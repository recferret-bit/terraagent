import { Inject, Injectable, Optional } from '@nestjs/common';
import { GuildArrivedPayload, GuildDepartedPayload, T1ResourceKey } from '@terra/contracts';
import type { DbClient, PrismaClient } from '@terra/db';
import { CoreException } from '../../../core/errors/index.js';
import { PRISMA } from '../../../db/db.module.js';
import { FlagsService } from '../../../flags/flags.service.js';
import { DevPresence, type PresenceReply, type PresenceSeat } from '../../../game/presence/dev-presence.js';
import { DirectorKeyService, type DevAllowanceResult } from '../../../near/director-key/director-key.service.js';
import { GuildKillSwitch } from '../funding/guild-kill.js';
import { GuildProvisionError } from '../guild-error.js';
import { GuildNpcRepository } from '../guild-npc.repository.js';
import { loadPolicy } from '../guild-plan.js';
import { setAbsoluteStock } from '../inventory.js';
import { GuildMakerService } from '../maker/guild-maker.service.js';
import { GuildVisitService } from '../visit/guild-visit.service.js';
import type { ArrivedInput } from '../visit/guild-visit.publisher.js';

export interface SummonResult {
  readonly npcId: string;
  readonly name: string;
  readonly planetId: string;
  readonly visitId: string;
  readonly status: 'docked';
  readonly placed: number;
  readonly offers: number;
}

export interface DepartResult {
  readonly npcId: string;
  readonly planetId: string;
  readonly status: 'departed';
  readonly cleared: number;
}

export interface StockResult {
  readonly npcId: string;
  readonly resource: string;
  readonly stock: number;
}

export interface AllowanceInput {
  readonly amount: number;
  readonly resource?: string;
  readonly colonyId?: string;
  readonly planetId?: string;
  readonly colonyIndex?: number;
}

/**
 * Dev console for Guild docks and the director (W15-28).
 * `simulateAway` posts `system.presence` through {@link DevPresence}. The director sweep does not
 * keep a second flag: `SimDirectorSource.listAway` reads `colonyIsAway` on that sim blob.
 */
@Injectable()
export class GuildDevService {
  constructor(
    private readonly flags: FlagsService,
    private readonly visits: GuildVisitService,
    private readonly maker: GuildMakerService,
    private readonly kill: GuildKillSwitch,
    private readonly npcs: GuildNpcRepository,
    private readonly presence: DevPresence,
    private readonly director: DirectorKeyService,
    @Optional() @Inject(PRISMA) private readonly prisma?: PrismaClient,
  ) {}

  async summon(planetId: string, npcId: string): Promise<SummonResult> {
    this.assertWave();
    this.assertNpc(npcId);
    const opened = await this.visits.dockNow(planetId, npcId);
    const placed = await this.quote(opened.input);
    const push = await this.visits.announceDock(opened.id, opened.input);
    const offers = push.t === 'guild.arrived' && 'offers' in push.d ? push.d.offers.length : 0;
    return { npcId, name: opened.input.name, planetId, visitId: opened.id, status: 'docked', placed, offers };
  }

  async depart(planetId: string, npcId: string): Promise<DepartResult> {
    this.assertWave();
    this.assertNpc(npcId);
    const closed = await this.visits.departNow(planetId, npcId);
    if (!closed) return { npcId, planetId, status: 'departed', cleared: 0 };
    await this.maker.onDeparted(GuildDepartedPayload.parse(closed.input));
    this.visits.announceDepart(closed.input);
    return { npcId, planetId, status: 'departed', cleared: closed.cleared };
  }

  async setInventory(npcId: string, resource: string, amount: number): Promise<StockResult> {
    this.assertWave();
    this.assertNpc(npcId);
    this.assertResource(resource);
    if (!Number.isSafeInteger(amount) || amount < 0) {
      throw new GuildProvisionError('bad_amount', 'amount must be a whole number, 0 or more');
    }
    return this.npcs.withLock(npcId, (db) => this.writeStock(npcId, resource, amount, db));
  }

  async disable(npcId: string): Promise<{ npcId: string; keyId: string; killed: true }> {
    this.assertWave();
    this.assertNpc(npcId);
    return this.kill.killGuild(npcId);
  }

  /** Posts `system.presence`. See the class note: that blob is what the director loop reads. */
  async simulateAway(input: PresenceSeat & { on: boolean }): Promise<PresenceReply> {
    this.assertWave();
    return this.presence.setAway({
      planetId: input.planetId,
      colonyIndex: input.colonyIndex,
      colonyId: input.colonyId,
      away: input.on,
    });
  }

  async setAllowance(input: AllowanceInput): Promise<DevAllowanceResult> {
    this.assertWave();
    const resource = input.resource ?? 'metals.t1';
    this.assertResource(resource);
    return this.director.setDevAllowance(await this.colonyOf(input), resource, input.amount);
  }

  private async quote(input: ArrivedInput): Promise<number> {
    const report = await this.maker.onArrived(GuildArrivedPayload.parse({ ...input, offers: [] }));
    return report.placed.length;
  }

  private async writeStock(npcId: string, resource: string, amount: number, db: DbClient): Promise<StockResult> {
    const row = await this.npcs.find(npcId, db);
    if (!row) throw new GuildProvisionError('not_provisioned', `Guild NPC ${npcId} is not provisioned`);
    const next = setAbsoluteStock(row, resource, amount);
    if (!next.ok) throw new GuildProvisionError('bad_amount', 'amount must be a whole number, 0 or more');
    await this.npcs.saveInventory(npcId, next.inventory, db);
    return { npcId, resource, stock: next.stock };
  }

  private async colonyOf(input: AllowanceInput): Promise<string> {
    if (input.colonyId) return input.colonyId;
    const index = input.colonyIndex;
    if (!input.planetId || index === undefined || !this.prisma) {
      throw new CoreException('NOT_FOUND', { status: 404, message: 'Colony not found' });
    }
    const row = await this.prisma.colony.findUnique({
      where: { planetId_colonyIndex: { planetId: input.planetId, colonyIndex: index } },
      select: { id: true },
    });
    if (!row) throw new CoreException('NOT_FOUND', { status: 404, message: 'Colony not found' });
    return row.id;
  }

  private assertWave(): void {
    if (!this.flags.has('W15')) throw new CoreException('wave_disabled', { status: 403, message: 'wave_disabled' });
  }

  private assertNpc(npcId: string): void {
    const known = loadPolicy((wave) => this.flags.has(wave)).roster.some((row) => row.id === npcId);
    if (!known) throw new GuildProvisionError('unknown_npc', `unknown npc "${npcId}"`);
  }

  private assertResource(resource: string): void {
    if (!T1ResourceKey.safeParse(resource).success) {
      throw new CoreException('VALIDATION_ERROR', { status: 400, message: `unknown resource "${resource}"` });
    }
  }
}
