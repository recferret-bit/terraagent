import type { LocalHostOptions } from '../../store/local/protocol';
import { isSpectatorSearch } from './onlineMode';
import { scenarioParam } from './sessionTarget';

export const DEFAULT_LOCAL_SCENARIO = 'w00';

/** `?host=local` or `?spectator=1` (unless `join=` / `host=server`) → local host options; null for backend server flows. */
export function localHostOptions(search: string): LocalHostOptions | null {
  const q = new URLSearchParams(search);
  const spectator = isSpectatorSearch(search);
  if (spectator && (q.has('join') || q.get('host') === 'server')) return null;
  if (!spectator && q.get('host') !== 'local') return null;
  const rawBots = q.get('bots');
  const parsedBots = rawBots ? Number.parseInt(rawBots, 10) : Number.NaN;
  const botCount = Number.isInteger(parsedBots) && parsedBots >= 1 ? Math.min(6, parsedBots) : undefined;
  return {
    scenario: scenarioParam(search) ?? (spectator ? 'spectator' : DEFAULT_LOCAL_SCENARIO),
    waves: q.get('waves'),
    ...(spectator ? { spectator: true } : {}),
    ...(q.get('planet') ? { planetType: q.get('planet')! } : {}),
    ...(q.get('seed') ? { seed: q.get('seed')! } : {}),
    ...(botCount ? { botCount } : {}),
  };
}
