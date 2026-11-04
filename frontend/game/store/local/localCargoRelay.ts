import { newId, RESOURCE_KEYS, type ResourceKey } from '@terra/contracts';
import type { SimCommand, SimEvent } from '@terra/sim';
import { LocalDevError } from './LocalHostCore';

interface PendingLocalSettlement {
  readonly dueTick: number;
  readonly cmd: SimCommand;
}

/**
 * Local-host (`?host=local`) mock NEAR cargo relay (W10-14):
 * - Watches `cargoExported` and `cargoImported` (`phase === 'requested'`) and schedules a `cargo.settled`
 *   module command (`source: 'near'`) 2 ticks later so the transfer indicator is briefly visible before settling.
 * - Supports `near.mock.fail cargo <rate>` and `cargo.grant` dev commands on the local host.
 */
export class LocalCargoRelay {
  private readonly failRates = new Map<string, number>();
  private readonly pending: PendingLocalSettlement[] = [];
  private readonly internalIds = new Set<string>();

  reset(): void {
    this.pending.length = 0;
    this.internalIds.clear();
  }

  isInternalCommand(commandId: string): boolean {
    if (!this.internalIds.has(commandId)) return false;
    this.internalIds.delete(commandId);
    return true;
  }

  onEvents(events: readonly SimEvent[], currentTick: number): void {
    for (const ev of events) {
      if (ev.kind === 'cargoExported') {
        this.enqueueSettlement('export', ev.data, currentTick);
      } else if (ev.kind === 'cargoImported' && ev.data.phase === 'requested') {
        this.enqueueSettlement('import', ev.data, currentTick);
      }
    }
  }

  drainDue(upToTick: number): SimCommand[] {
    if (this.pending.length === 0) return [];
    const due: SimCommand[] = [];
    for (let i = 0; i < this.pending.length; ) {
      const item = this.pending[i]!;
      if (item.dueTick <= upToTick) {
        due.push(item.cmd);
        this.pending.splice(i, 1);
      } else {
        i++;
      }
    }
    return due;
  }

  devFail(args: Record<string, unknown>): { port: string; rate: number } {
    const port = typeof args.port === 'string' ? args.port.trim() : '';
    const rate = args.rate;
    if (!port || typeof rate !== 'number' || !Number.isFinite(rate) || rate < 0 || rate > 1) {
      throw new LocalDevError('invalid_args', 'near.mock.fail needs { port, rate: 0..1 }');
    }
    const lower = port.toLowerCase();
    if (lower !== 'cargo' && lower !== 'cargotoken') {
      throw new LocalDevError('host_unavailable', `near.mock.fail for "${port}" needs the game server; not available on this host`);
    }
    this.failRates.set(lower, rate);
    return { port, rate };
  }

  devGrant(
    args: Record<string, unknown>,
    queue: SimCommand[],
  ): { colony: string; accountId: string; resource: string; amount: number; txHash: string } {
    const resource = typeof args.resource === 'string' ? args.resource : '';
    const amount = Number(args.amount);
    if (
      !resource ||
      !(RESOURCE_KEYS as readonly string[]).includes(resource) ||
      !Number.isInteger(amount) ||
      amount <= 0
    ) {
      throw new LocalDevError('invalid_args', 'cargo.grant needs { colony, resource, amount }');
    }
    const rawColony = args.colony ?? '0';
    const colonyStr = String(rawColony);
    let colonyIndex = 0;
    if (typeof rawColony === 'number' && Number.isInteger(rawColony) && rawColony >= 0) {
      colonyIndex = rawColony;
    } else if (/^\d+$/.test(colonyStr)) {
      colonyIndex = parseInt(colonyStr, 10);
    } else if (colonyStr.startsWith('col-') && /^\d+$/.test(colonyStr.slice(4))) {
      colonyIndex = parseInt(colonyStr.slice(4), 10);
    }

    const commandId = newId('cm');
    this.internalIds.add(commandId);
    queue.push({
      colonyIndex,
      source: 'dev',
      commandId,
      kind: 'dev.cargoGrant',
      args: {
        colonyIndex,
        colony: colonyStr,
        resource: resource as ResourceKey,
        amount,
      },
    });
    return {
      colony: colonyStr,
      accountId: `${colonyStr.toLowerCase()}.terraagent.mock`,
      resource,
      amount,
      txHash: `mock:grant:${Date.now()}`,
    };
  }

  private enqueueSettlement(
    direction: 'export' | 'import',
    data: Record<string, unknown>,
    currentTick: number,
  ): void {
    const ref = typeof data.ref === 'string' ? data.ref : '';
    if (!ref) return;
    const colonyId = typeof data.colonyId === 'string' ? data.colonyId : 'col-0';
    const colonyIndex =
      typeof data.colonyIndex === 'number' && Number.isInteger(data.colonyIndex)
        ? data.colonyIndex
        : 0;
    const resource = typeof data.resource === 'string' ? (data.resource as ResourceKey) : undefined;
    const amount = typeof data.amount === 'number' ? data.amount : undefined;

    const failRate = this.cargoFailRate();
    const ok = !(failRate > 0 && Math.random() < failRate);
    const commandId = newId('cm');
    this.internalIds.add(commandId);

    this.pending.push({
      dueTick: currentTick + 2,
      cmd: {
        colonyIndex,
        source: 'near',
        commandId,
        kind: 'cargo.settled',
        args: {
          colonyId,
          colonyIndex,
          ref,
          direction,
          ...(resource ? { resource } : {}),
          ...(amount !== undefined ? { amount } : {}),
          ok,
          ...(ok ? { txHash: `mock:local:${ref}` } : { error: 'NEAR_MOCK_INJECTED_FAILURE' }),
        },
      },
    });
  }

  private cargoFailRate(): number {
    return this.failRates.get('cargo') ?? this.failRates.get('cargotoken') ?? 0;
  }
}
