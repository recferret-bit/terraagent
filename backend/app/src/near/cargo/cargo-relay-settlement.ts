import { Inject, Injectable, Logger } from '@nestjs/common';
import type { ResourceKey } from '@terra/contracts';
import type { PrismaClient } from '@terra/db';
import { EventBus } from '../../bus/event-bus.js';
import { databaseEnabled } from '../../core/persistence.js';
import { APP_ENV, type AppEnv } from '../../core/tokens.js';
import { PRISMA } from '../../db/db.module.js';
import type { ClaimedRow } from '../application/outbox/chain-outbox.repository.js';
import { fromCargoBaseUnits } from '../application/ports/cargo-token.port.js';

export interface NearCargoSettledBusEvent {
  readonly planetId: string;
  readonly colonyId: string;
  readonly colonyIndex: number;
  readonly ref: string;
  readonly opId: string;
  readonly direction: 'export' | 'import';
  readonly resource: ResourceKey;
  readonly amount: number;
  readonly ok: boolean;
  readonly txHash?: string;
  readonly error?: string;
}

declare module '../../bus/channels.js' {
  interface BusChannels {
    'near.cargo.settled': NearCargoSettledBusEvent;
  }
}

interface ResolvedCargoMeta {
  readonly planetId: string;
  readonly colonyId: string;
  readonly colonyIndex: number;
  readonly ref: string;
  readonly direction: 'export' | 'import';
  readonly resource: ResourceKey;
  readonly majorAmount: number;
}

/**
 * Settles `CargoToken` outbox rows (`mint` for `EXPORT`, `burn` for `IMPORT`) against `chain.cargo_tx`
 * and emits `'near.cargo.settled'` on the in-process `EventBus` so `bridgePlanetEvents` submits
 * `cargo.settled` back into the planet's simulation (W10-09, W10-13).
 */
@Injectable()
export class CargoRelaySettlementService {
  private readonly log = new Logger(CargoRelaySettlementService.name);

  constructor(
    private readonly bus: EventBus,
    @Inject(APP_ENV) private readonly env: AppEnv,
    @Inject(PRISMA) private readonly prisma: PrismaClient,
  ) {}

  async onOutboxRowDone(row: ClaimedRow, _result: object, txHash: string | null): Promise<void> {
    if (row.port !== 'CargoToken') return;
    try {
      const prisma = this.database();
      if (prisma) {
        await prisma.cargoTx.updateMany({
          where: { opId: row.opId },
          data: { state: 'FINAL', txHash, lastError: null },
        });
      }
      const meta = await this.resolveMeta(row, prisma);
      if (!meta.planetId || !meta.colonyId || meta.majorAmount <= 0) return;

      this.bus.emit('near.cargo.settled', {
        planetId: meta.planetId,
        colonyId: meta.colonyId,
        colonyIndex: meta.colonyIndex,
        ref: meta.ref,
        opId: row.opId,
        direction: meta.direction,
        resource: meta.resource,
        amount: meta.majorAmount,
        ok: true,
        ...(txHash ? { txHash } : {}),
      });
    } catch (err) {
      this.log.warn(
        `cargo settlement done hook failed for ${row.opId}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  async onOutboxRowFailed(row: ClaimedRow, error: string, dead: boolean): Promise<void> {
    if (row.port !== 'CargoToken') return;
    try {
      const prisma = this.database();
      const clipped = error.slice(0, 400);
      if (!dead) {
        if (prisma) {
          await prisma.cargoTx.updateMany({
            where: { opId: row.opId },
            data: { state: 'SENT', lastError: clipped },
          });
        }
        return;
      }

      if (prisma) {
        await prisma.cargoTx.updateMany({
          where: { opId: row.opId },
          data: { state: 'FAILED', lastError: clipped },
        });
      }
      const meta = await this.resolveMeta(row, prisma);
      if (!meta.planetId || !meta.colonyId || meta.majorAmount <= 0) return;

      this.bus.emit('near.cargo.settled', {
        planetId: meta.planetId,
        colonyId: meta.colonyId,
        colonyIndex: meta.colonyIndex,
        ref: meta.ref,
        opId: row.opId,
        direction: meta.direction,
        resource: meta.resource,
        amount: meta.majorAmount,
        ok: false,
        error: error.slice(0, 200),
      });
    } catch (err) {
      this.log.warn(
        `cargo settlement fail hook failed for ${row.opId}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  private async resolveMeta(row: ClaimedRow, prisma: PrismaClient | null): Promise<ResolvedCargoMeta> {
    const p = row.payload;
    const txRow = prisma ? await prisma.cargoTx.findUnique({ where: { opId: row.opId } }) : null;

    const planetId = typeof p.planetId === 'string' && p.planetId.length > 0 ? p.planetId : (txRow?.planetId ?? '');
    const colonyId = typeof p.colonyId === 'string' && p.colonyId.length > 0 ? p.colonyId : (txRow?.colonyId ?? '');
    const colonyIndex =
      typeof p.colonyIndex === 'number' && Number.isFinite(p.colonyIndex)
        ? p.colonyIndex
        : (txRow?.colonyIndex ?? 0);
    const simRef =
      typeof p.simRef === 'string' && p.simRef.length > 0 ? p.simRef : txRow?.simRef || row.opId;
    const rawDir =
      typeof p.direction === 'string'
        ? p.direction
        : (txRow?.direction ?? (row.method === 'burn' ? 'IMPORT' : 'EXPORT'));
    const direction: 'export' | 'import' = rawDir.toUpperCase() === 'IMPORT' ? 'import' : 'export';
    const rawRes =
      typeof p.resource === 'string'
        ? p.resource
        : typeof p.tokenId === 'string'
          ? p.tokenId
          : (txRow?.resource ?? 'metals.t1');
    const resource = rawRes as ResourceKey;

    let majorAmount = 0;
    if (typeof p.majorAmount === 'number' && Number.isFinite(p.majorAmount) && p.majorAmount > 0) {
      majorAmount = p.majorAmount;
    } else if (typeof p.amount === 'string' && p.amount.length > 0) {
      majorAmount = fromCargoBaseUnits(p.amount);
    } else if (txRow) {
      majorAmount = fromCargoBaseUnits(txRow.amount.toFixed());
    }

    return { planetId, colonyId, colonyIndex, ref: simRef, direction, resource, majorAmount };
  }

  private database(): PrismaClient | null {
    return databaseEnabled(this.env) ? this.prisma : null;
  }
}
