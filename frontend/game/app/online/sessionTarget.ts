import type { SessionTarget } from '../../net/types';

const randomName = () => `pilot-${Math.random().toString(36).slice(2, 8)}`;
const SCENARIO_ID = /^[a-z0-9][a-z0-9_-]{0,63}$/;

type Fetch = (input: string, init?: RequestInit) => Promise<Pick<Response, 'ok' | 'status' | 'json'>>;

/** `?scenario=<id>` (lower-cased, validated) or null. */
export const scenarioParam = (search: string): string | null => {
  const v = new URLSearchParams(search).get('scenario')?.trim().toLowerCase();
  return v && SCENARIO_ID.test(v) ? v : null;
};

/**
 * Where the online flow connects: `ws(s)://<page host>/ws` (Vite proxies it to the app), a dev token and a planet.
 * With `?scenario=<id>` the planet is created once per page load by `POST /v1/dev/scenarios/<id>` and the id is kept in
 * this object, so every reconnect (e.g. after an app restart; snapshots bring the planet back) rejoins that planet instead
 * of creating another. A full page reload makes a new target, hence a fresh planet: that is "open ?scenario=w00 twice, get two
 * fresh identical planets". (sessionStorage is deliberately not used: it would survive the reload and defeat that.)
 * Without `?scenario` it joins the first loaded dev planet (`GET /v1/dev/planets`, `?host=` flow).
 */
export function createSessionTarget(loc: Pick<Location, 'protocol' | 'host' | 'search'>, doFetch: Fetch = (u, i) => fetch(u, i)): SessionTarget {
  const name = new URLSearchParams(loc.search).get('as')?.toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 32) || randomName();
  const scenario = scenarioParam(loc.search);
  let created: Promise<{ planetId: string }> | null = null;

  async function createFromScenario(id: string): Promise<{ planetId: string }> {
    const res = await doFetch(`/v1/dev/scenarios/${encodeURIComponent(id)}`, { method: 'POST' });
    if (!res.ok) throw new Error(`POST /v1/dev/scenarios/${id}: ${res.status}`);
    const body = (await res.json()) as { planetId: string };
    return { planetId: body.planetId };
  }

  async function firstPlanet(): Promise<{ planetId: string }> {
    const res = await doFetch('/v1/dev/planets');
    if (!res.ok) throw new Error(`GET /v1/dev/planets: ${res.status}`);
    const body = (await res.json()) as { planets: Array<{ id: string }> };
    const first = body.planets[0];
    if (!first) throw new Error('no planet is loaded (start the app with GAME_DEV_PLANETS=1)');
    return { planetId: first.id };
  }

  return {
    url: `${loc.protocol === 'https:' ? 'wss' : 'ws'}://${loc.host}/ws`,
    accessToken: `dev:${name}`,
    resolve() {
      if (!scenario) return firstPlanet();
      // cache the promise (a concurrent resolve shares it) but not a failure, so a retry may try again
      created ??= createFromScenario(scenario).catch((e) => { created = null; throw e; });
      return created;
    },
  };
}
