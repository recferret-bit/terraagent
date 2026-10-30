import { z } from 'zod';
import type { WaveId } from '../flags';

/**
 * One command kind = one file in `commands/` exporting `command = defineCommand({...})` (PRODUCT_WAVES §4,
 * "registries, not edits"). The generator builds the `CommandKind` union and the JSON-Schema snapshot from these files.
 *  - `origin: 'client'` kinds may arrive over `/ws` (`cmd`); `'module'` kinds only come from server modules (PROTOCOL §4.2).
 *  - `dev: true` kinds exist only in dev builds (dev console, D-25 / PRODUCT_WAVES §3).
 */
export interface CommandDef<K extends string = string, A extends z.ZodType = z.ZodType> {
  readonly kind: K;
  readonly wave: WaveId;
  readonly origin: 'client' | 'module';
  readonly dev?: boolean;
  readonly args: A;
  readonly summary: string;
}

export const defineCommand = <const K extends string, A extends z.ZodType>(def: CommandDef<K, A>) => def;
