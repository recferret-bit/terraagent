import { z } from 'zod';
import type { WaveId } from '../flags';

/**
 * One event kind = one file in `events/` exporting `event = defineEvent({...})`. Events are emitted by the sim,
 * carried in deltas / `event` messages and on the in-process bus (`planet.event`, ARCHITECTURE §6).
 *  - `audience: 'player'` events (toasts, alerts) are shown only from the server (D-31 authority rule);
 *    `'render'` events may also come from the predicted engine.
 */
export interface EventDef<K extends string = string, D extends z.ZodType = z.ZodType> {
  readonly kind: K;
  readonly wave: WaveId;
  readonly severity: 'info' | 'warn' | 'critical';
  readonly audience: 'player' | 'render' | 'server';
  readonly data: D;
  readonly summary: string;
}

export const defineEvent = <const K extends string, D extends z.ZodType>(def: EventDef<K, D>) => def;
