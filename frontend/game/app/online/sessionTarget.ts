import type { SessionTarget } from '../../net/types';

const randomName = () => `pilot-${Math.random().toString(36).slice(2, 8)}`;

/**
 * Where the online flow connects: `ws(s)://<page host>/ws` (Vite proxies it to the app), a dev token and, for now, the
 * first loaded dev planet (`GET /v1/dev/planets`; the scenario loader replaces this resolve later).
 */
export function createSessionTarget(loc: Pick<Location, 'protocol' | 'host' | 'search'>): SessionTarget {
  const name = new URLSearchParams(loc.search).get('as')?.toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 32) || randomName();
  return {
    url: `${loc.protocol === 'https:' ? 'wss' : 'ws'}://${loc.host}/ws`,
    accessToken: `dev:${name}`,
    async resolve() {
      const res = await fetch('/v1/dev/planets');
      if (!res.ok) throw new Error(`GET /v1/dev/planets: ${res.status}`);
      const body = (await res.json()) as { planets: Array<{ id: string }> };
      const first = body.planets[0];
      if (!first) throw new Error('no planet is loaded (start the app with GAME_DEV_PLANETS=1)');
      return { planetId: first.id };
    },
  };
}
