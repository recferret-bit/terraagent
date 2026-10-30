import type { ServerMessage } from '@terra/contracts';
import type { Outgoing } from '../../net/types';

/** Boot options of the local host (`?host=local&scenario=<id>&waves=<spec>`). */
export interface LocalHostOptions {
  /** Scenario id (`w00`). */
  scenario: string;
  /** `?waves=` spec (`..03`, `00,01`, `all`); default `all`, always intersected with the scenario's waves. */
  waves?: string | null;
}

/** What the page sends to the local host: the same client messages as `/ws`, plus dev commands and housekeeping. */
export type ToLocalHost =
  | { t: 'init'; opts: LocalHostOptions }
  | { t: 'client'; msg: Outgoing | { t: 'hello' } }
  /** Dev server command (`warp`, `scenario`, `tune`, `local.reset`); answered by `devResult` with the same `reqId`. */
  | { t: 'dev'; reqId: number; name: string; args: unknown }
  /** Save a snapshot now (the page is hiding). */
  | { t: 'save' }
  | { t: 'stop' };

export type FromLocalHost =
  | { t: 'server'; msg: ServerMessage }
  | { t: 'devResult'; reqId: number; ok: true; result: unknown }
  | { t: 'devResult'; reqId: number; ok: false; code: string; message: string }
  | { t: 'error'; message: string };

/** Posts a message to the page; `transfer` lists the byte buffers that move with it. */
export type LocalPost = (msg: FromLocalHost, transfer: ArrayBuffer[]) => void;
