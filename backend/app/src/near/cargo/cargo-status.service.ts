import {
  Inject,
  Injectable,
  Logger,
  Optional,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import {
  MOCK_ACCOUNT_ROOT,
  RESOURCE_KEYS,
  type CargoPendingItem,
  type CargoPendingState,
  type CargoResourceMap,
  type CargoStatusPayload,
  type NearCargoResponse,
  type ResourceKey,
} from '@terra/contracts';
import type { PrismaClient } from '@terra/db';
import type { IncomingMessage } from 'node:http';
import type { PlanetEventOf, PlanetEventV1 } from '../../bus/channels.js';
import { EventBus } from '../../bus/event-bus.js';
import { AuthTokenService, extractBearerPlayer } from '../../core/auth/index.js';
import { CoreException } from '../../core/errors/index.js';
import { databaseEnabled } from '../../core/persistence.js';
import { APP_ENV, type AppEnv } from '../../core/tokens.js';
import { PRISMA } from '../../db/db.module.js';
import { FlagsService } from '../../flags/flags.service.js';
import { devBearerPlayer } from '../../ws/session-verifier.js';
import {
  CargoTokenPort,
  fromCargoBaseUnits,
  NEAR_ADAPTER_CARGO,
} from '../application/ports/cargo-token.port.js';

export interface NearCargoStatusBusEvent {
  readonly planetId?: string;
  readonly playerId?: string;
  readonly colonyId: string;
  readonly status: CargoStatusPayload;
}

declare module '../../bus/channels.js' {
  interface BusChannels {
    'near.cargo.status': NearCargoStatusBusEvent;
  }
}

const PLAYER_SLOT = 'player';
const DAILY_MINT_CAP = 20_000;
const DEFAULT_THROUGHPUT_CAP_PER_MIN = 250;
const BEARER_RE = /^Bearer\s+(\S+)$/i;

/**
 * Per-colony orbital cargo read model (`GET /v1/near/cargo`) and `cargo.status` WebSocket push producer (W10-14).
 */
@Injectable()
export class CargoStatusService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger(CargoStatusService.name);
  private readonly stops: Array<() => void> = [];
  private readonly timers = new Set<NodeJS.Timeout>();
  private destroyed = false;

  constructor(
    @Inject(FlagsService) private readonly flags: FlagsService,
    @Inject(AuthTokenService) private readonly tokens: AuthTokenService,
    @Inject(EventBus) private readonly bus: EventBus,
    @Inject(APP_ENV) private readonly env: AppEnv,
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    @Optional() @Inject(NEAR_ADAPTER_CARGO) private readonly cargo?: CargoTokenPort,
  ) {}

  onModuleInit(): void {
    if (this.stops.length > 0) return;
    this.DestroyedReset();
    this.stops.push(
      this.bus.on('planet.event', (ev) => this.onPlanetEvent(ev), {
        module: 'CargoStatusService',
      }),
      this.bus.on(
        'near.cargo.settled',
        (ev) => {
          void this.pushColonyStatus(ev.colonyId, ev.planetId).catch((err: unknown) => {
            this.log.warn(
              `cargo status push on settled failed: ${err instanceof Error ? err.message : String(err)}`,
            );
          });
        },
        { module: 'CargoStatusService' },
      ),
    );
  }

  onModuleDestroy(): void {
    this.destroyed = true;
    for (const stop of this.stops.splice(0)) stop();
    for (const t of this.timers) clearTimeout(t);
    this.timers.clear();
  }

  private DestroyedReset(): void {
    this.destroyed = false;
  }

  async getColonyCargoStatus(opts: {
    colonyId: string;
    accountId?: string;
    playerId?: string;
    planetId?: string;
  }): Promise<CargoStatusPayload> {
    if (!this.flags.has('W10')) {
      throw new CoreException('NOT_FOUND', { status: 404, message: 'Not found' });
    }
    const colonyId = opts.colonyId || 'col-0';
    const accountId = await this.resolveAccountId(colonyId, opts.accountId, opts.playerId, opts.planetId);
    const prisma = this.database();
    const rows =
      prisma && 'cargoTx' in prisma && prisma.cargoTx
        ? await prisma.cargoTx.findMany({
            where: { OR: [{ colonyId }, { accountId }] },
            orderBy: { createdAt: 'asc' },
          })
        : [];

    const seenResources = new Set<string>(rows.map((r) => r.resource));
    const inOrbit = await this.readInOrbitBalances(accountId, seenResources);

    const pendingExport: CargoPendingItem[] = [];
    const pendingImport: CargoPendingItem[] = [];
    const pending: CargoPendingItem[] = [];
    const mintedToday: CargoResourceMap = {};
    let throughputUsedPerMin = 0;

    const now = new Date();
    const utcDayStart = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
    );
    const windowStart = new Date(now.getTime() - 60_000);

    for (const row of rows) {
      const amount = fromCargoBaseUnits(row.amount.toFixed());
      const resource = row.resource as ResourceKey;
      const isImport = row.direction.toUpperCase() === 'IMPORT';
      const direction: 'export' | 'import' = isImport ? 'import' : 'export';

      if (row.state === 'PENDING' || row.state === 'SENT') {
        const item = {
          ref: row.simRef || row.opId,
          opId: row.opId,
          dir: direction,
          direction,
          resource,
          amount,
          state: row.state as CargoPendingState,
          status: row.state,
          ...(row.txHash ? { txHash: row.txHash } : {}),
          ...(row.lastError ? { error: row.lastError } : {}),
        } as CargoPendingItem;
        pending.push(item);
        if (isImport) pendingImport.push(item);
        else pendingExport.push(item);
      }

      if (row.state !== 'FAILED') {
        if (!isImport && row.createdAt >= utcDayStart) {
          mintedToday[resource] = (mintedToday[resource] ?? 0) + amount;
        }
        if (row.createdAt >= windowStart) {
          throughputUsedPerMin += amount;
        }
      }
    }

    const todayMinted: CargoResourceMap = { ...mintedToday };
    return {
      colonyId,
      accountId,
      inOrbit,
      pending,
      pendingExport,
      pendingImport,
      mintedToday,
      todayMinted,
      dailyCap: DAILY_MINT_CAP,
      mintCapPerDay: DAILY_MINT_CAP,
      throughputUsedPerMin,
      throughputCapPerMin: DEFAULT_THROUGHPUT_CAP_PER_MIN,
    };
  }

  async getHttpCargoStatus(
    req: IncomingMessage,
    query?: { colonyId?: string; accountId?: string },
  ): Promise<NearCargoResponse> {
    if (!this.flags.has('W10')) {
      throw new CoreException('NOT_FOUND', { status: 404, message: 'Not found' });
    }
    const playerId = this.extractOptionalPlayerId(req, Boolean(query?.colonyId));
    const { colonyIds, accountByColony } = await this.resolvePlayerColonies(
      playerId,
      query?.colonyId,
    );

    const colonies: Record<string, CargoStatusPayload> = {};
    for (const cid of colonyIds) {
      const explicitAcct = cid === query?.colonyId ? query?.accountId : undefined;
      colonies[cid] = await this.getColonyCargoStatus({
        colonyId: cid,
        accountId: explicitAcct ?? accountByColony.get(cid),
        playerId,
      });
    }

    const primaryId = colonyIds[0] ?? 'col-0';
    const primaryStatus =
      colonies[primaryId] ??
      (await this.getColonyCargoStatus({
        colonyId: primaryId,
        accountId: query?.accountId,
        playerId,
      }));
    colonies[primaryId] = primaryStatus;

    return {
      ...primaryStatus,
      colonies,
    };
  }

  async pushColonyStatus(
    colonyId: string,
    planetId?: string,
    playerId?: string,
    accountId?: string,
  ): Promise<CargoStatusPayload | null> {
    if (this.destroyed || !this.flags.has('W10')) return null;
    const status = await this.getColonyCargoStatus({ colonyId, accountId, playerId, planetId });
    if (this.destroyed) return null;
    this.bus.emit('near.cargo.status', {
      ...(planetId ? { planetId } : {}),
      ...(playerId ? { playerId } : {}),
      colonyId,
      status,
    });
    return status;
  }

  private onPlanetEvent(ev: PlanetEventV1): void {
    if (
      ev.kind !== 'cargoExported' &&
      ev.kind !== 'cargoImported' &&
      ev.kind !== 'cargoRefunded'
    ) {
      return;
    }
    void this.schedulePlanetEventPush(ev).catch((err: unknown) => {
      this.log.warn(
        `cargo status push on ${ev.kind} failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    });
  }

  private async schedulePlanetEventPush(
    ev:
      | PlanetEventOf<'cargoExported'>
      | PlanetEventOf<'cargoImported'>
      | PlanetEventOf<'cargoRefunded'>,
  ): Promise<void> {
    const colonyId = String(ev.data.colonyId ?? 'col-0');
    const playerId =
      typeof ev.data.playerId === 'string' && ev.data.playerId.length > 0
        ? ev.data.playerId
        : undefined;
    const ref =
      typeof ev.data.ref === 'string' && ev.data.ref.length > 0 ? ev.data.ref : undefined;

    await this.delay(20);
    if (this.destroyed) return;

    const prisma = this.database();
    if (
      prisma &&
      ref &&
      (ev.kind === 'cargoExported' ||
        (ev.kind === 'cargoImported' && ev.data.phase !== 'settled'))
    ) {
      for (let i = 0; i < 15 && !this.destroyed; i++) {
        const exists = await prisma.cargoTx.findFirst({
          where: { OR: [{ opId: ref }, { simRef: ref }] },
          select: { id: true },
        });
        if (exists) break;
        await this.delay(10);
      }
    }

    if (!this.destroyed) {
      await this.pushColonyStatus(colonyId, ev.planetId, playerId);
    }
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.timers.delete(timer);
        resolve();
      }, ms);
      timer.unref?.();
      this.timers.add(timer);
    });
  }

  private async resolveAccountId(
    colonyId: string,
    accountId?: string,
    playerId?: string,
    planetId?: string,
  ): Promise<string> {
    if (typeof accountId === 'string' && accountId.trim().length > 0) {
      return accountId.trim();
    }
    const prisma = this.database();
    if (prisma) {
      if ('nearColonyAccount' in prisma && prisma.nearColonyAccount) {
        const byColony = await prisma.nearColonyAccount.findFirst({
          where: { OR: [{ colonyId }, { slot: colonyId }, { accountId: colonyId }] },
          select: { accountId: true },
        });
        if (byColony) return byColony.accountId;

        if (playerId) {
          const byPlayerSlot = await prisma.nearColonyAccount.findFirst({
            where: { playerId, slot: { not: PLAYER_SLOT } },
            select: { accountId: true },
          });
          if (byPlayerSlot) return byPlayerSlot.accountId;
        }

        if (planetId && 'colony' in prisma && prisma.colony) {
          const dbCol = await prisma.colony.findFirst({
            where: { planetId },
            orderBy: { createdAt: 'desc' },
            select: { id: true, playerId: true },
          });
          if (dbCol) {
            const byDbCol = await prisma.nearColonyAccount.findFirst({
              where: {
                OR: [{ colonyId: dbCol.id }, { playerId: dbCol.playerId, slot: { not: PLAYER_SLOT } }],
              },
              select: { accountId: true },
            });
            if (byDbCol) return byDbCol.accountId;
          }
        }
      }

      if ('cargoTx' in prisma && prisma.cargoTx) {
        const byTx = await prisma.cargoTx.findFirst({
          where: { colonyId, accountId: { not: null } },
          orderBy: { createdAt: 'desc' },
          select: { accountId: true },
        });
        if (byTx?.accountId) return byTx.accountId;
      }

      if (
        (colonyId === '0' || colonyId === 'col-0') &&
        'nearColonyAccount' in prisma &&
        prisma.nearColonyAccount
      ) {
        const first = await prisma.nearColonyAccount.findFirst({
          where: { slot: { not: PLAYER_SLOT } },
          select: { accountId: true },
        });
        if (first) return first.accountId;
      }
    }

    const stem = colonyId.toLowerCase().replace(/[^a-z0-9_-]/g, '-');
    return `${stem}.${MOCK_ACCOUNT_ROOT}`;
  }

  private async readInOrbitBalances(
    accountId: string,
    seenResources: ReadonlySet<string>,
  ): Promise<CargoResourceMap> {
    const inOrbit: CargoResourceMap = {};
    if (!this.cargo) return inOrbit;

    await Promise.all(
      RESOURCE_KEYS.map(async (key) => {
        const bal = await this.cargo!.balanceOf({ accountId, tokenId: key });
        const major = fromCargoBaseUnits(bal);
        if (major > 0 || seenResources.has(key)) {
          inOrbit[key] = major;
        }
      }),
    );
    return inOrbit;
  }

  private extractOptionalPlayerId(
    req: IncomingMessage,
    hasColonyQuery: boolean,
  ): string | undefined {
    const raw = req.headers?.authorization;
    const header = Array.isArray(raw) ? raw[0] : raw;
    if (typeof header === 'string' && header.trim().length > 0) {
      if (this.env.NODE_ENV !== 'production') {
        const token = BEARER_RE.exec(header.trim())?.[1];
        const dev = token ? devBearerPlayer(token) : null;
        if (dev) return dev.id;
      }
      return extractBearerPlayer(req, this.tokens).id;
    }
    if (!hasColonyQuery && this.env.NODE_ENV === 'production') {
      return extractBearerPlayer(req, this.tokens).id;
    }
    return undefined;
  }

  private async resolvePlayerColonies(
    playerId?: string,
    queryColonyId?: string,
  ): Promise<{ colonyIds: string[]; accountByColony: Map<string, string> }> {
    const colonyIds: string[] = [];
    const accountByColony = new Map<string, string>();
    const addColony = (id: string | null | undefined, acct?: string | null) => {
      if (!id) return;
      if (!colonyIds.includes(id)) colonyIds.push(id);
      if (acct && !accountByColony.has(id)) accountByColony.set(id, acct);
    };

    if (queryColonyId) addColony(queryColonyId);

    const prisma = this.database();
    if (prisma && playerId) {
      if ('nearColonyAccount' in prisma && prisma.nearColonyAccount) {
        const accounts = await prisma.nearColonyAccount.findMany({
          where: { playerId, slot: { not: PLAYER_SLOT } },
          select: { colonyId: true, slot: true, accountId: true },
        });
        for (const row of accounts) {
          addColony(row.colonyId || row.slot, row.accountId);
        }
      }
      if ('colony' in prisma && prisma.colony) {
        const cols = await prisma.colony.findMany({
          where: { playerId },
          select: { id: true },
        });
        for (const col of cols) addColony(col.id);
      }
    }

    if (colonyIds.length === 0 && prisma && 'cargoTx' in prisma && prisma.cargoTx) {
      const recent = await prisma.cargoTx.findMany({
        distinct: ['colonyId'],
        orderBy: { createdAt: 'desc' },
        take: 5,
        select: { colonyId: true, accountId: true },
      });
      for (const row of recent) addColony(row.colonyId, row.accountId);
    }

    if (colonyIds.length === 0) addColony('col-0');
    return { colonyIds, accountByColony };
  }

  private database(): PrismaClient | null {
    return databaseEnabled(this.env) ? this.prisma : null;
  }
}
