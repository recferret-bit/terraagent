import type { PlanetState, SimCommand } from '@terra/sim';
import type { GameView } from '../../core/registry/types';

/** What a feature hears back about one command (the session `CommandBus` resolves to this shape). */
export interface CommandOutcome {
  ok: boolean;
  code?: string;
  detail?: string;
}

/**
 * An authoritative in-process host (tests and tools: `SimHost`). Features read its state / view and submit commands
 * through it; they never write its state themselves (AGENTS.md §6, D-37).
 */
export interface InProcessHost {
  readonly state: PlanetState;
  readonly tick?: number;
  readonly pending: number;
  view(): GameView;
  submit?(cmd: SimCommand): void;
  onEvents?: (cb: () => void) => () => void;
}

/** The channels a feature may send a command through; exactly one of them is used per command. */
export interface CommandSink {
  /** The session command bus (server or browser-local host). */
  sendCommand?: (kind: string, args?: unknown) => unknown;
  /** A store that forwards commands to the transport (`WorldStore.sendCommand(kind, args)`). */
  store?: { sendCommand?: (cmdOrKind: unknown, args?: unknown) => unknown };
  /** An in-process authoritative host. */
  host?: Pick<InProcessHost, 'submit'>;
}

export interface DispatchedCommand {
  /** Local id of this send (not the host's order id). */
  commandId: string;
  /** The host's verdict when the channel reports one (the command bus), else `undefined`. */
  result: Promise<CommandOutcome | undefined>;
}

let commandSeq = 0;

/**
 * Sends one command through exactly one channel: the command bus, else the store, else an in-process host. The client
 * never mutates world state itself and never sends the same command twice (FF-02).
 */
export function dispatchCommand(sink: CommandSink, kind: string, args: unknown, colonyIndex: number): DispatchedCommand {
  const commandId = `${kind}_${++commandSeq}`;
  let out: unknown;
  if (sink.sendCommand) out = sink.sendCommand(kind, args);
  else if (sink.store?.sendCommand) out = sink.store.sendCommand(kind, args);
  else if (sink.host?.submit) sink.host.submit({ colonyIndex, source: 'player', commandId, kind, args } as SimCommand);
  const result =
    out && typeof (out as Promise<unknown>).then === 'function'
      ? (out as Promise<CommandOutcome>)
      : Promise.resolve(undefined);
  return { commandId, result: result.catch(() => undefined) };
}
