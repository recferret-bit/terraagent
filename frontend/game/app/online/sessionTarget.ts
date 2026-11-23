import type { SessionTarget } from '../../net/types';
import { parseSpectatorQueryOptions } from './localHost';
import { isSpectatorSearch } from './onlineMode';
import {
  browserKeyValue,
  matchingLiveClaim,
  putLiveClaim,
  readLiveClaims,
  watchLiveClaim,
  withTabLock,
  type KeyValueStore,
  type LiveClaim,
} from './scenarioPlanet';
import { browserSeatStorage, chooseScenarioSeat, type SeatStorage } from './scenarioSeat';

const SCENARIO_ID = /^[a-z0-9][a-z0-9_-]{0,63}$/;

type Fetch = (input: string, init?: RequestInit) => Promise<Pick<Response, 'ok' | 'status' | 'json'>>;

const PLANET_ID = /^pl_[A-Za-z0-9_-]{1,64}$/;
type Listed = 'yes' | 'no' | 'unknown';

function hostnameOfHost(host: string): string {
  const trimmed = host.trim();
  if (trimmed.startsWith('[')) {
    const close = trimmed.indexOf(']');
    return close > 0 ? trimmed.slice(0, close + 1) : trimmed;
  }
  return trimmed.split(':')[0] ?? '';
}

/** `?join=<planetId>` (an existing planet, e.g. a second player joining the first one's scenario planet) or null. */
export const joinParam = (search: string): string | null => {
  const v = new URLSearchParams(search).get('join')?.trim();
  return v && PLANET_ID.test(v) ? v : null;
};

/** `?scenario=<id>` (lower-cased, validated) or null. */
export const scenarioParam = (search: string): string | null => {
  const v = new URLSearchParams(search).get('scenario')?.trim().toLowerCase();
  return v && SCENARIO_ID.test(v) ? v : null;
};

interface HeldPlanet {
  readonly name: string;
  readonly planetId: string;
}

/**
 * Where the online flow connects: `ws(s)://<page host>/ws` (Vite proxies it to the app), a dev token and a planet.
 * `?scenario=` creates a planet for this dev name. While that tab is open, another tab of the same URL joins it
 * (same player, live tick). The server then closes the older socket with `4001`. A reload before `away` starts
 * fresh once this tab has dropped its claim. After `away`, this tab's reload rejoins so the digest can be delivered.
 * `&as=` is a different player and does not take the other name's planet. `&fresh=1` creates another planet.
 * `?join=` joins that planet instead. `?spectator=1&host=server` provisions or resumes the dedicated server spectator planet.
 */
export function createSessionTarget(
  loc: Pick<Location, 'protocol' | 'host' | 'search'>,
  doFetch: Fetch = (u, i) => fetch(u, i),
  seats: SeatStorage | null = browserSeatStorage(),
  live: KeyValueStore = browserKeyValue(),
): SessionTarget {
  const spectator = isSpectatorSearch(loc.search, {
    location: { protocol: loc.protocol, hostname: hostnameOfHost(loc.host) },
  });
  const rawScenario = scenarioParam(loc.search);
  const scenario = spectator && rawScenario === 'spectator' ? null : rawScenario;
  const join = joinParam(loc.search);
  const specOpts = parseSpectatorQueryOptions(loc.search);
  let resetPending = spectator && specOpts.reset;
  const tab = tabId(seats);
  const explicit = explicitAs(loc.search);
  const opening = openingSeat(loc.search, scenario, seats, live, tab, resetPending);
  let name = opening.name;
  const pinned = opening.planetId;
  let created: Promise<{ planetId: string }> | null = null;
  let spectatorInFlight: Promise<{ planetId: string }> | null = null;
  let watching = false;

  const claim = (planetId: string): void => {
    if (!scenario) return;
    const row: LiveClaim = { scenario, planetId, as: name, tabId: tab, seenAt: Date.now(), explicit: explicit.length > 0 };
    putLiveClaim(live, row);
    if (watching) return;
    watching = true;
    watchLiveClaim(live, tab);
  };

  const scenarioPlanet = (): Promise<{ planetId: string }> => withTabLock(lockName(scenario, explicit), async () => {
    const held = currentHold(loc.search, scenario, seats, live, tab, pinned, name);
    if (held) {
      name = held.name;
      const listed = await planetListed(doFetch, held.planetId);
      if (listed !== 'no') {
        claim(held.planetId);
        return { planetId: held.planetId };
      }
    }
    const made = await postScenario(doFetch, scenario ?? '');
    claim(made.planetId);
    return made;
  });

  const resolveSpectator = (explicitPlanetId?: string, explicitScenario?: string): Promise<{ planetId: string }> => {
    if (!spectatorInFlight) {
      const sendReset = resetPending;
      spectatorInFlight = postSpectator(doFetch, {
        ...(explicitPlanetId ? { planetId: explicitPlanetId } : {}),
        ...(explicitScenario ? { scenario: explicitScenario } : {}),
        ...(specOpts.planetType ? { planetType: specOpts.planetType } : {}),
        ...(specOpts.botCount ? { botCount: specOpts.botCount } : {}),
        ...(specOpts.seed ? { seed: specOpts.seed } : {}),
        ...(sendReset ? { reset: true } : {}),
      })
        .then((res) => {
          if (sendReset) resetPending = false;
          return res;
        })
        .finally(() => {
          spectatorInFlight = null;
        });
    }
    return spectatorInFlight;
  };

  return {
    url: `${loc.protocol === 'https:' ? 'wss' : 'ws'}://${loc.host}/ws`,
    ...(spectator ? { mode: 'spectator' as const } : {}),
    get accessToken() { return `dev:${name}`; },
    resolve() {
      if (join) {
        return spectator && (resetPending || join.startsWith('pl_spec_'))
          ? resolveSpectator(join)
          : Promise.resolve({ planetId: join });
      }
      if (spectator) return resolveSpectator(undefined, scenario ?? undefined);
      if (!scenario) return firstPlanet(doFetch);
      // One promise per page, so a reconnect does not create another planet. A failure may try again.
      created ??= scenarioPlanet().catch((error) => {
        created = null;
        throw error;
      });
      return created;
    },
  };
}

function openingSeat(
  search: string,
  scenario: string | null,
  seats: SeatStorage | null,
  live: KeyValueStore,
  tab: string,
  forceFresh = false,
): { name: string; planetId: string | null } {
  const picked = chooseScenarioSeat(search, scenario, seats);
  if (forceFresh) return { name: picked.name, planetId: null };
  if (picked.planetId || freshParam(search)) return picked;
  const sibling = matchingLiveClaim(readLiveClaims(live), scenario, explicitAs(search), tab);
  return sibling ? { name: sibling.as, planetId: sibling.planetId } : picked;
}

function currentHold(
  search: string,
  scenario: string | null,
  seats: SeatStorage | null,
  live: KeyValueStore,
  tab: string,
  pinned: string | null,
  name: string,
): HeldPlanet | null {
  if (freshParam(search)) return null;
  const resumed = chooseScenarioSeat(search, scenario, seats);
  if (resumed.planetId) return { name: resumed.name, planetId: resumed.planetId };
  if (pinned) return { name, planetId: pinned };
  const sibling = matchingLiveClaim(readLiveClaims(live), scenario, explicitAs(search), tab);
  return sibling ? { name: sibling.as, planetId: sibling.planetId } : null;
}

async function firstPlanet(doFetch: Fetch): Promise<{ planetId: string }> {
  const res = await doFetch('/v1/dev/planets');
  if (!res.ok) throw new Error(`GET /v1/dev/planets: ${res.status}`);
  const body = (await res.json()) as { planets: Array<{ id: string }> };
  const first = body.planets[0];
  if (!first) throw new Error('no planet is loaded (start the app with GAME_DEV_PLANETS=1)');
  return { planetId: first.id };
}

async function postScenario(doFetch: Fetch, id: string): Promise<{ planetId: string }> {
  const res = await doFetch(`/v1/dev/scenarios/${encodeURIComponent(id)}`, { method: 'POST' });
  if (!res.ok) throw new Error(`POST /v1/dev/scenarios/${id}: ${res.status}`);
  const body = (await res.json()) as { planetId: string };
  return { planetId: body.planetId };
}

async function postSpectator(
  doFetch: Fetch,
  opts: { planetId?: string; scenario?: string; planetType?: string; botCount?: number; seed?: string; reset?: boolean },
): Promise<{ planetId: string }> {
  const res = await doFetch('/v1/dev/spectator', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(opts),
  });
  if (!res.ok) throw new Error(`POST /v1/dev/spectator: ${res.status}`);
  const body = (await res.json()) as { planetId: string };
  return { planetId: body.planetId };
}

/** `unknown` keeps a remembered planet when the list itself cannot be read. */
async function planetListed(doFetch: Fetch, planetId: string): Promise<Listed> {
  try {
    const res = await doFetch('/v1/dev/planets');
    if (!res.ok) return 'unknown';
    const body = (await res.json()) as { planets?: Array<{ id?: string }> };
    if (!Array.isArray(body.planets)) return 'unknown';
    return body.planets.some((planet) => planet.id === planetId) ? 'yes' : 'no';
  } catch {
    return 'unknown';
  }
}

function explicitAs(search: string): string {
  return new URLSearchParams(search).get('as')?.toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 32) ?? '';
}

function freshParam(search: string): boolean {
  return new URLSearchParams(search).get('fresh') === '1';
}

function lockName(scenario: string | null, explicit: string): string {
  return `ta-scenario:${scenario ?? ''}:${explicit || 'default'}`;
}

function tabId(seats: SeatStorage | null): string {
  const key = 'ta.scenario.tab';
  const existing = seats ? safeGet(seats, key) : null;
  if (existing) return existing;
  const id = `tab-${Math.random().toString(36).slice(2, 10)}`;
  if (seats) safeSet(seats, key, id);
  return id;
}

function safeGet(storage: SeatStorage, key: string): string | null {
  try {
    return storage.getItem(key);
  } catch {
    return null;
  }
}

function safeSet(storage: SeatStorage, key: string, value: string): void {
  try {
    storage.setItem(key, value);
  } catch {
    // The tab id is only a claim key. A new one next load is safe.
  }
}
