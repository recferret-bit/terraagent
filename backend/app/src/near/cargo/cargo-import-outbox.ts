import {
  Inject,
  Injectable,
  Logger,
  Optional,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { cargoImportOpId, marketWithdrawOpId, MARKET_TOKENS, type ResourceKey } from '@terra/contracts';
import { withTransaction, type PrismaClient } from '@terra/db';
import type { PlanetEventV1 } from '../../bus/channels.js';
import { EventBus } from '../../bus/event-bus.js';
import { databaseEnabled } from '../../core/persistence.js';
import { APP_ENV, type AppEnv } from '../../core/tokens.js';
import { PRISMA } from '../../db/db.module.js';
import { ChainOutboxRepository } from '../application/outbox/chain-outbox.repository.js';
import {
  CARGO_MINTER_ACCOUNT,
  CargoTokenPort,
  NEAR_ADAPTER_CARGO,
  toCargoBaseUnits,
} from '../application/ports/cargo-token.port.js';
import { resolveColonyAccountId } from './cargo-export-outbox.js';
import { FreeVerifierService } from './free-verifier.service.js';

export interface CargoImportResult {
  readonly opId: string;
  readonly accountId: string;
  readonly status: 'PENDING' | 'FAILED';
  readonly error?: string;
}

interface ParsedCargoImportEvent {
  readonly planetId: string;
  readonly colonyId: string;
  readonly colonyIndex: number;
  readonly playerId: string | null;
  readonly importSeq: number;
  readonly resource: ResourceKey;
  readonly amount: number;
  readonly opId: string;
  readonly simRef: string;
  readonly baseAmount: string;
}

function parseCargoImportedEvent(event: PlanetEventV1): ParsedCargoImportEvent | null {
  if (event.kind !== 'cargoImported') return null;
  const phase = (event.data.phase as string | undefined) ?? 'requested';
  if (phase !== 'requested') return null;

  const colonyId = String(event.data.colonyId ?? '');
  if (!colonyId) return null;
  const rawColonyIndex = event.data.colonyIndex ?? (event as { colony?: unknown }).colony;
  const colonyIndex =
    typeof rawColonyIndex === 'number' && Number.isFinite(rawColonyIndex) ? rawColonyIndex : 0;
  const playerId =
    typeof event.data.playerId === 'string' && event.data.playerId.length > 0
      ? event.data.playerId
      : null;
  const importSeq = Number(event.data.importSeq ?? 1);
  const resource = String(event.data.resource) as ResourceKey;
  const amount = Number(event.data.amount ?? 0);
  if (!Number.isFinite(amount) || amount <= 0) return null;

  const opId = cargoImportOpId(colonyId, importSeq);
  const simRef =
    typeof event.data.ref === 'string' && event.data.ref.length > 0 ? event.data.ref : opId;
  const baseAmount = toCargoBaseUnits(amount);

  return {
    planetId: event.planetId,
    colonyId,
    colonyIndex,
    playerId,
    importSeq,
    resource,
    amount,
    opId,
    simRef,
    baseAmount,
  };
}

/**
 * Listens for `cargoImported` (`phase === 'requested'`) on `planet.event`, verifies the colony's
 * in-orbit balance via `CargoTokenPort.balanceOf`, and either rejects with `insufficient_cargo`
 * (emitting `'near.cargo.settled'` `{ ok: false, error: 'insufficient_cargo' }`) or atomically
 * writes `chain.cargo_tx` (`IMPORT`, `PENDING`) and enqueues `CargoToken.burn` in `chain.chain_outbox`
 * with `opId = cargo-import:{colonyId}:{importSeq}` (W10-13, NEAR §1a rule 6).
 */
@Injectable()
export class CargoImportOutboxService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger(CargoImportOutboxService.name);
  private stop: (() => void) | null = null;

  constructor(
    private readonly bus: EventBus,
    private readonly outbox: ChainOutboxRepository,
    @Inject(APP_ENV) private readonly env: AppEnv,
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    @Optional() @Inject(NEAR_ADAPTER_CARGO) private readonly cargo?: CargoTokenPort,
    @Optional() private readonly freeVerifier?: FreeVerifierService,
  ) {}

  onModuleInit(): void {
    if (this.stop) return;
    this.stop = this.bus.on('planet.event', (ev) => this.onPlanetEvent(ev), {
      module: 'CargoImportOutboxService',
    });
  }

  onModuleDestroy(): void {
    this.stop?.();
    this.stop = null;
  }

  private onPlanetEvent(event: PlanetEventV1): void {
    if (event.kind !== 'cargoImported') return;
    void this.handleCargoImported(event).catch((err: unknown) => {
      this.log.warn(
        `cargo import outbox enqueue failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    });
  }

  async handleCargoImported(event: PlanetEventV1): Promise<CargoImportResult | null> {
    const parsed = parseCargoImportedEvent(event);
    if (!parsed) return null;
    const prisma = this.database();
    if (!prisma) return null;

    const accountId = await resolveColonyAccountId(
      prisma,
      parsed.colonyId,
      parsed.playerId,
      parsed.planetId,
      parsed.colonyIndex,
    );
    const existing = await prisma.cargoTx.findUnique({
      where: { opId: parsed.opId },
      select: { state: true },
    });

    if (!existing || existing.state === 'FAILED') {
      const balance = this.cargo
        ? await this.cargo.balanceOf({ accountId, tokenId: parsed.resource })
        : '0';
      const shortfall = BigInt(parsed.baseAmount) - BigInt(balance);
      if (shortfall > 0n) {
        // W13-16: top up from the free verifier balance (market proceeds), never from funds reserved by open orders.
        const free = this.freeVerifier ? await this.freeVerifier.freeChain(accountId, parsed.resource) : 0n;
        if (free < shortfall) return this.rejectInsufficientCargo(prisma, parsed, accountId);
        return this.enqueueBurn(prisma, parsed, accountId, shortfall);
      }
    }

    return this.enqueueBurn(prisma, parsed, accountId);
  }

  private async rejectInsufficientCargo(
    prisma: PrismaClient,
    parsed: ParsedCargoImportEvent,
    accountId: string,
  ): Promise<CargoImportResult> {
    await prisma.cargoTx.upsert({
      where: { opId: parsed.opId },
      create: {
        opId: parsed.opId,
        planetId: parsed.planetId,
        colonyId: parsed.colonyId,
        colonyIndex: parsed.colonyIndex,
        accountId,
        direction: 'IMPORT',
        resource: parsed.resource,
        amount: parsed.baseAmount,
        state: 'FAILED',
        simRef: parsed.simRef,
        lastError: 'insufficient_cargo: Not enough in orbit.',
      },
      update: {
        state: 'FAILED',
        lastError: 'insufficient_cargo: Not enough in orbit.',
      },
    });

    this.bus.emit('near.cargo.settled', {
      planetId: parsed.planetId,
      colonyId: parsed.colonyId,
      colonyIndex: parsed.colonyIndex,
      ref: parsed.simRef,
      opId: parsed.opId,
      direction: 'import',
      resource: parsed.resource,
      amount: parsed.amount,
      ok: false,
      error: 'insufficient_cargo',
    });

    return {
      opId: parsed.opId,
      accountId,
      status: 'FAILED',
      error: 'insufficient_cargo',
    };
  }

  private async enqueueBurn(
    prisma: PrismaClient,
    parsed: ParsedCargoImportEvent,
    accountId: string,
    withdrawShortfall = 0n,
  ): Promise<CargoImportResult> {
    const withdrawOpId = marketWithdrawOpId(parsed.colonyId, parsed.importSeq);
    return withTransaction(prisma, async (tx) => {
      if (withdrawShortfall > 0n) {
        // Same transaction as the burn row; the burn declares `dependsOn` so the relay runs it after the withdraw is DONE.
        await this.outbox.enqueue(
          {
            opId: withdrawOpId,
            port: 'Intents',
            method: 'withdraw',
            payload: { accountId, tokenId: MARKET_TOKENS[parsed.resource].verifierId, amount: withdrawShortfall.toString(), to: accountId },
          },
          tx,
        );
      }
      await tx.cargoTx.upsert({
        where: { opId: parsed.opId },
        create: {
          opId: parsed.opId,
          planetId: parsed.planetId,
          colonyId: parsed.colonyId,
          colonyIndex: parsed.colonyIndex,
          accountId,
          direction: 'IMPORT',
          resource: parsed.resource,
          amount: parsed.baseAmount,
          state: 'PENDING',
          simRef: parsed.simRef,
        },
        update: {},
      });

      await this.outbox.enqueue(
        {
          opId: parsed.opId,
          port: 'CargoToken',
          method: 'burn',
          payload: {
            from: accountId,
            tokenId: parsed.resource,
            amount: parsed.baseAmount,
            caller: CARGO_MINTER_ACCOUNT,
            by: CARGO_MINTER_ACCOUNT,
            colonyId: parsed.colonyId,
            planetId: parsed.planetId,
            colonyIndex: parsed.colonyIndex,
            resource: parsed.resource,
            majorAmount: parsed.amount,
            importSeq: parsed.importSeq,
            simRef: parsed.simRef,
            direction: 'IMPORT',
            ...(withdrawShortfall > 0n ? { dependsOn: withdrawOpId } : {}),
          },
        },
        tx,
      );

      return { opId: parsed.opId, accountId, status: 'PENDING' };
    });
  }

  private database(): PrismaClient | null {
    return databaseEnabled(this.env) ? this.prisma : null;
  }
}
