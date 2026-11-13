import { createHash } from 'node:crypto';
import { Inject, Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { cargoExportOpId, MOCK_ACCOUNT_ROOT, type ResourceKey } from '@terra/contracts';
import { withTransaction, type DbClient, type PrismaClient } from '@terra/db';
import type { PlanetEventV1 } from '../../bus/channels.js';
import { EventBus } from '../../bus/event-bus.js';
import { databaseEnabled } from '../../core/persistence.js';
import { APP_ENV, type AppEnv } from '../../core/tokens.js';
import { PRISMA } from '../../db/db.module.js';
import { ChainOutboxRepository } from '../application/outbox/chain-outbox.repository.js';
import { CARGO_MINTER_ACCOUNT, toCargoBaseUnits } from '../application/ports/cargo-token.port.js';

export interface CargoExportEnqueued {
  readonly opId: string;
  readonly accountId: string;
}

/**
 * Listens for `cargoExported` on `planet.event` and atomically writes `chain.cargo_tx` (`EXPORT`, `PENDING`)
 * and enqueues a `CargoToken.mint` row in `chain.chain_outbox` with `opId = cargo-export:{colonyId}:{exportSeq}`
 * in a single Postgres transaction (W10-08, NEAR §1a rule 6).
 */
@Injectable()
export class CargoExportOutboxService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger(CargoExportOutboxService.name);
  private stop: (() => void) | null = null;

  constructor(
    private readonly bus: EventBus,
    private readonly outbox: ChainOutboxRepository,
    @Inject(APP_ENV) private readonly env: AppEnv,
    @Inject(PRISMA) private readonly prisma: PrismaClient,
  ) {}

  onModuleInit(): void {
    if (this.stop) return;
    this.stop = this.bus.on('planet.event', (ev) => this.onPlanetEvent(ev), {
      module: 'CargoExportOutboxService',
    });
  }

  onModuleDestroy(): void {
    this.stop?.();
    this.stop = null;
  }

  private onPlanetEvent(event: PlanetEventV1): void {
    if (event.kind !== 'cargoExported') return;
    void this.handleCargoExported(event).catch((err: unknown) => {
      this.log.warn(
        `cargo export outbox enqueue failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    });
  }

  async handleCargoExported(event: PlanetEventV1): Promise<CargoExportEnqueued | null> {
    if (event.kind !== 'cargoExported') return null;
    const prisma = this.database();
    if (!prisma) return null;

    const colonyId = String(event.data.colonyId ?? '');
    if (!colonyId) return null;
    const rawColonyIndex = event.data.colonyIndex ?? (event as { colony?: unknown }).colony;
    const colonyIndex =
      typeof rawColonyIndex === 'number' && Number.isFinite(rawColonyIndex) ? rawColonyIndex : 0;
    const playerId =
      typeof event.data.playerId === 'string' && event.data.playerId.length > 0
        ? event.data.playerId
        : null;
    const exportSeq = Number(event.data.exportSeq ?? 1);
    const resource = String(event.data.resource) as ResourceKey;
    const amount = Number(event.data.amount ?? 0);
    const opId = cargoExportOpId(colonyId, exportSeq);
    const simRef =
      typeof event.data.ref === 'string' && event.data.ref.length > 0 ? event.data.ref : opId;
    const baseAmount = toCargoBaseUnits(amount);

    return withTransaction(prisma, async (tx) => {
      const accountId = await resolveColonyAccountId(tx, colonyId, playerId, event.planetId, colonyIndex);

      await tx.cargoTx.upsert({
        where: { opId },
        create: {
          opId,
          planetId: event.planetId,
          colonyId,
          colonyIndex,
          accountId,
          direction: 'EXPORT',
          resource,
          amount: baseAmount,
          state: 'PENDING',
          simRef,
        },
        update: {},
      });

      await this.outbox.enqueue(
        {
          opId,
          port: 'CargoToken',
          method: 'mint',
          payload: {
            to: accountId,
            tokenId: resource,
            amount: baseAmount,
            caller: CARGO_MINTER_ACCOUNT,
            by: CARGO_MINTER_ACCOUNT,
            colonyId,
            planetId: event.planetId,
            colonyIndex,
            resource,
            majorAmount: amount,
            exportSeq,
            simRef,
            direction: 'EXPORT',
          },
        },
        tx,
      );

      return { opId, accountId };
    });
  }

  private database(): PrismaClient | null {
    return databaseEnabled(this.env) ? this.prisma : null;
  }
}

export async function resolveColonyAccountId(
  tx: DbClient,
  colonyId: string,
  playerId: string | null,
  planetId?: string,
  colonyIndex?: number,
): Promise<string> {
  const byColony = await tx.nearColonyAccount.findFirst({
    where: { colonyId },
    select: { accountId: true, playerId: true },
  });
  if (byColony) return byColony.accountId;

  if (playerId) {
    const bySlot = await tx.nearColonyAccount.findUnique({
      where: { playerId_slot: { playerId, slot: colonyId } },
      select: { accountId: true },
    });
    if (bySlot) return bySlot.accountId;
    const byPlayer = await tx.nearColonyAccount.findFirst({
      where: { playerId, slot: { not: 'player' } },
      select: { accountId: true },
    });
    if (byPlayer) return byPlayer.accountId;
  }

  if (planetId && 'colony' in tx && tx.colony) {
    const dbCol = await tx.colony.findFirst({
      where: { planetId, colonyIndex: colonyIndex ?? 0 },
      orderBy: { createdAt: 'desc' },
      select: { id: true, playerId: true },
    });
    if (dbCol) {
      const byDbCol = await tx.nearColonyAccount.findFirst({
        where: {
          OR: [{ colonyId: dbCol.id }, { playerId: dbCol.playerId, slot: { not: 'player' } }],
        },
        select: { accountId: true },
      });
      if (byDbCol) return byDbCol.accountId;
    }
  }

  const root = activeAccountRoot();
  const accountId = `${mockAccountStem(colonyId, planetId, root)}.${root}`;
  await tx.mockChainAccount.upsert({
    where: { accountId },
    create: { accountId, kind: 'colony' },
    update: {},
  });
  return accountId;
}

const slug = (v: string): string => v.toLowerCase().replace(/[^a-z0-9_-]/g, '-');

function activeAccountRoot(env: Readonly<Record<string, string | undefined>> = process.env): string {
  const mode = env.NEAR_ADAPTER_IDENTITY ?? env.NEAR_MODE;
  if (mode === 'testnet' || mode === 'devnet') {
    return env.NEAR_ROOT_ACCOUNT?.trim() || 'terraagent.testnet';
  }
  if (mode === 'mainnet') {
    return env.NEAR_ROOT_ACCOUNT?.trim() || 'terraagent.near';
  }
  return MOCK_ACCOUNT_ROOT;
}

/**
 * Real colony ids (`co_<cuid>`) are globally unique, so their mock account is named by the id alone. Scenario planets seat
 * sim colonies `col_<index>` (digits only) that repeat on every planet; their account carries the planet (`<planet>--col_<index>`), so two
 * planets never share cargo, verifier funds or reservations. Long planet ids are shortened with a hash to fit `account_id`
 * (64 chars incl. the `.terraagent.mock` root).
 */
export function mockAccountStem(colonyId: string, planetId?: string, root = MOCK_ACCOUNT_ROOT): string {
  const colony = slug(colonyId);
  if (!planetId || !/^col_\d+$/.test(colonyId)) return colony;
  const planet = slug(planetId);
  const room = 64 - root.length - 1 - colony.length - 2;
  if (planet.length <= room) return `${planet}--${colony}`;
  const h = createHash('sha256').update(planetId).digest('hex').slice(0, 8);
  return `${planet.slice(0, Math.max(0, room - 9))}-${h}--${colony}`;
}
