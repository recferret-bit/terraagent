import type {
  CargoStatusPayload,
  DeedUpdatedPayload,
  MarketBookPayload,
  MarketTradePayload,
  ServerMessage,
  TreasuryProposalPush,
} from '@terra/contracts';
import type { Emitter } from '../../net/emitter';
import type { ClientView } from '../replica/viewCodec';
import type { CommandInput, WorkerLike } from '../WorldStore';
import type { FromWorker } from '../worker/protocol';
import { SimWorkerController } from '../worker/SimWorkerController';

export function normalizeWorldCommand(
  input: CommandInput | unknown,
  maybeArgs?: unknown,
): { kind: string; args: unknown } {
  if (typeof input === 'string') {
    return { kind: input, args: maybeArgs ?? {} };
  }
  const obj = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
  const kind = String(obj.kind ?? obj.type ?? '');
  if (obj.args !== undefined) {
    return { kind, args: obj.args };
  }
  const rest: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (k !== 'type' && k !== 'kind') rest[k] = v;
  }
  return { kind, args: rest };
}

export function createDefaultSimWorker(): WorkerLike {
  if (typeof Worker === 'function') {
    return new Worker(new URL('../worker/sim.worker.ts', import.meta.url), {
      type: 'module',
    }) as unknown as WorkerLike;
  }
  const w: WorkerLike = {
    onmessage: null,
    terminate() {},
    postMessage(msg) {
      queueMicrotask(() => ctl.handle(msg));
    },
  };
  const ctl = new SimWorkerController((m: FromWorker) =>
    queueMicrotask(() => w.onmessage?.({ data: m })),
  );
  return w;
}

export function handleFeatureServerMessage(
  m: ServerMessage,
  deps: {
    setCargoStatus: (s: CargoStatusPayload) => void;
    latestView: ClientView | null;
    views: Emitter<ClientView>;
    cargoStatuses: Emitter<CargoStatusPayload>;
    marketBooks: Emitter<MarketBookPayload>;
    marketTrades: Emitter<MarketTradePayload>;
    deedUpdates: Emitter<DeedUpdatedPayload>;
    treasuryProposals: Emitter<TreasuryProposalPush>;
  },
): boolean {
  switch (m.t) {
    case 'cargo.status': {
      deps.setCargoStatus(m.d);
      if (deps.latestView) {
        (deps.latestView as unknown as Record<string, unknown>).cargoStatus = m.d;
        deps.views.emit(deps.latestView);
      }
      deps.cargoStatuses.emit(m.d);
      return true;
    }
    case 'market.book':
      deps.marketBooks.emit(m.d);
      return true;
    case 'market.trade':
      deps.marketTrades.emit(m.d);
      return true;
    case 'deed.updated':
      deps.deedUpdates.emit(m.d);
      return true;
    case 'treasury.proposal':
      deps.treasuryProposals.emit(m.d);
      return true;
    default:
      return false;
  }
}
