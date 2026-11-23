import type { ServerMessage } from '@terra/contracts';
import type { Outgoing } from '../../net/types';

/** Boot options of the local host (`?host=local&scenario=<id>&waves=<spec>`). */
export interface LocalHostOptions {
  /** Scenario id (`w00`, or `spectator` for zero-player local spectator mode). */
  scenario: string;
  /** `?waves=` spec (`..03`, `00,01`, `all`); default `all`, always intersected with the scenario's waves. */
  waves?: string | null;
  /** Spectator mode: no player spawned, read-only observer seeing all bots + inputs/decisions. */
  spectator?: boolean;
  /** Planet archetype (`dune`, `oceanForest`, `forestRock`) when `scenario` is `spectator`. */
  planetType?: string;
  /** Seed override for spectator / generated local worlds. */
  seed?: string;
  /** Number of initial bot colonies when booting spectator mode (1..6; default 2). */
  botCount?: number;
  /** When true, wipes any persisted local snapshot for this source and starts bots from scratch. */
  reset?: boolean;
}

/** What the page sends to the local host: the same client messages as `/ws`, plus dev commands and housekeeping. */
export type ToLocalHost =
  | { t: 'init'; opts: LocalHostOptions }
  | { t: 'client'; msg: Outgoing | { t: 'hello' } }
  /**
   * Dev server command (`warp`, `scenario`, `tune`, `local.reset`, `ledger`, `away`, `back`, `colony.eliminate`); answered by `devResult` with the same `reqId`.
   * `ledger` (`args { account, limit }`) returns the host's journal as a `LedgerView` (`{ planetId, account, balances,
   * entries }`, the shape of `GET /v1/dev/planets/:planetId/ledger`): the only way the journal leaves the worker.
   */
  | { t: 'dev'; reqId: number; name: string; args: unknown }
  /** Save a snapshot now (the page is hiding). */
  | { t: 'save' }
  | { t: 'stop' };

export type FromLocalHost =
  | { t: 'server'; msg: ServerMessage }
  | { t: 'devResult'; reqId: number; ok: true; result: unknown }
  | { t: 'devResult'; reqId: number; ok: false; code: string; message: string }
  | { t: 'error'; message: string }
  /** Answer to `stop`: stepping ended and the final snapshot save settled, the worker may be terminated now. */
  | { t: 'stopped' };

/** Posts a message to the page; `transfer` lists the byte buffers that move with it. */
export type LocalPost = (msg: FromLocalHost, transfer: ArrayBuffer[]) => void;
