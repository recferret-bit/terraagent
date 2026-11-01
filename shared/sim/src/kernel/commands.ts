import type { SimCommandV1 } from '@terra/contracts';
import type { StepContext } from './context';
import type { PlanetState } from './state';
import type { WaveId } from './types';

export type SimCommand = SimCommandV1;

/** Game-rule rejection code returned by a handler (SIM-C-02: rejections never throw). */
export type RejectCodeOf = string;

/** A rejection with a human-readable cause (e.g. the placement block text), passed on in `cmd.reject.detail` (GP-31). */
export interface CommandReject {
  code: RejectCodeOf;
  detail?: string;
}

/**
 * Handles one command kind inside the `commands` system (slot 0). Returns nothing on success, or a reject code (or a
 * code with a detail). Arguments were zod-checked on the host; the handler checks game rules only (SIM-C-01).
 */
export type CommandHandler = (state: PlanetState, cmd: SimCommand, ctx: StepContext) => RejectCodeOf | CommandReject | void;

export interface CommandHandlerDef {
  readonly kind: string;
  readonly wave: WaveId;
  readonly handle: CommandHandler;
}

export const defineCommandHandler = (def: CommandHandlerDef) => def;

/** What happened to each command of a step, in arrival order. Hosts turn these into `cmd.ack` / `cmd.reject`. */
export interface CommandOutcome {
  commandId: string;
  kind: string;
  appliedAtTick: number;
  code?: string; // set when rejected
  detail?: string; // optional cause of a rejection (hosts pass it in `cmd.reject.detail`)
}
