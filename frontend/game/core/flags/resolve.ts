import { flagsFromList, parseWaves, type FlagSet } from '@terra/contracts';

export type FlagSource = 'welcome' | 'override' | 'default';
export interface ResolvedFlags { flags: FlagSet; source: FlagSource }
export interface ResolveInput {
  /** `welcome.flags` from the server, when connected. Authoritative. */
  welcomeFlags?: readonly string[];
  /** `location.search`. */
  search: string;
  /** Dev build: the `?waves=` override is honoured only then. */
  dev: boolean;
  warn?: (msg: string) => void;
}

/**
 * Which waves the client shows (PRODUCT_WAVES §3).
 * - With a server `welcome.flags`: that set is authoritative. A dev `?waves=` may only NARROW it (intersection),
 *   never widen, since the server would reject commands of waves it has off.
 * - Without a welcome (prototype / before connect): the dev `?waves=` override, else `all`.
 * - A malformed `?waves=` warns and is ignored; this never throws.
 */
export function resolveClientFlags(input: ResolveInput): ResolvedFlags {
  const warn = input.warn ?? ((m: string) => console.warn(m));
  const server = input.welcomeFlags ? flagsFromList(input.welcomeFlags) : null;
  let override: FlagSet | null = null;
  const raw = input.dev ? new URLSearchParams(input.search).get('waves') : null;
  if (raw !== null) {
    try { override = parseWaves(raw); } catch (e) { warn(`ignoring ?waves=${raw}: ${(e as Error).message}`); }
  }
  if (server) {
    if (!override) return { flags: server, source: 'welcome' };
    return { flags: flagsFromList(override.list.filter((w) => server.has(w))), source: 'override' };
  }
  if (override) return { flags: override, source: 'override' };
  return { flags: parseWaves('all'), source: 'default' };
}
