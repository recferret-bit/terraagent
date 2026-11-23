import { isProductionBuild } from '../../core/buildEnv';
import type { LocalHostOptions } from '../../store/local/protocol';
import { isSpectatorResetSearch, isSpectatorSearch, type SpectatorEnvOptions } from './onlineMode';
import { scenarioParam } from './sessionTarget';

export const DEFAULT_LOCAL_SCENARIO = 'w00';

/** Parsed spectator customization query params (`planet`, `bots`, `seed`, `reset`). */
export function parseSpectatorQueryOptions(search: string): {
  readonly planetType?: string;
  readonly seed?: string;
  readonly botCount?: number;
  readonly reset: boolean;
} {
  const q = new URLSearchParams(search);
  const rawBots = q.get('bots');
  const parsedBots = rawBots ? Number.parseInt(rawBots, 10) : Number.NaN;
  const botCount = Number.isInteger(parsedBots) && parsedBots >= 1 ? Math.min(6, parsedBots) : undefined;
  const planet = q.get('planet')?.trim();
  const seed = q.get('seed')?.trim();
  return {
    ...(planet ? { planetType: planet } : {}),
    ...(seed ? { seed } : {}),
    ...(botCount ? { botCount } : {}),
    reset: isSpectatorResetSearch(search),
  };
}

/** `?host=local` or `?spectator=1` (unless `join=` / `host=server`) → local host options; null for backend server flows or production builds. */
export function localHostOptions(search: string, envOpts?: SpectatorEnvOptions): LocalHostOptions | null {
  if (isProductionBuild(envOpts?.mode, envOpts?.prod, envOpts?.appEnv)) return null;
  const q = new URLSearchParams(search);
  const spectator = isSpectatorSearch(search, envOpts);
  if (spectator && (q.has('join') || q.get('host') === 'server')) return null;
  if (!spectator && q.get('host') !== 'local') return null;
  const specOpts = parseSpectatorQueryOptions(search);
  return {
    scenario: scenarioParam(search) ?? (spectator ? 'spectator' : DEFAULT_LOCAL_SCENARIO),
    waves: q.get('waves'),
    ...(spectator ? { spectator: true } : {}),
    ...(specOpts.planetType ? { planetType: specOpts.planetType } : {}),
    ...(specOpts.seed ? { seed: specOpts.seed } : {}),
    ...(specOpts.botCount ? { botCount: specOpts.botCount } : {}),
    ...(spectator && specOpts.reset ? { reset: true } : {}),
  };
}
