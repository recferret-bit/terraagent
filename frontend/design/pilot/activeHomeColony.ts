import { refreshPilotSession } from './PilotAccess';

export type ActivePlanetKind = 'dune' | 'oceanForest' | 'forestRock';
export type ActivePlanetType = 'desert' | 'ocean' | 'temperate';

export interface ActiveHomeColony {
  readonly kind: ActivePlanetKind;
  readonly planetType: ActivePlanetType;
  readonly planetId: string;
  readonly planetName: string;
  readonly colonyId: string;
  readonly colonyName: string;
  readonly foundingSectorId?: string;
}

const PLANET_TYPE_TO_KIND: Readonly<Record<string, ActivePlanetKind>> = {
  desert: 'dune',
  ocean: 'oceanForest',
  temperate: 'forestRock',
};

export function kindOfPlanetType(type: string): ActivePlanetKind | null {
  return PLANET_TYPE_TO_KIND[type] ?? null;
}

const DEVICE_SECRET_KEY = 'ta_device_secret';

function readExistingDeviceSecret(
  storage: Pick<Storage, 'getItem'> | null | undefined,
  search: string,
  dev: boolean,
): string | null {
  if (!storage) return null;
  try {
    const as = dev ? new URLSearchParams(search).get('as')?.toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 32) : '';
    const key = as ? `${DEVICE_SECRET_KEY}:${as}` : DEVICE_SECRET_KEY;
    const raw = storage.getItem(key);
    return raw && raw.length >= 16 ? raw : null;
  } catch {
    return null;
  }
}

export interface ProbeActiveColonyOptions {
  readonly fetch?: typeof fetch;
  readonly storage?: Pick<Storage, 'getItem'> | null;
  readonly search?: string;
  readonly dev?: boolean;
}

/**
 * Resolves the caller's existing ACTIVE home colony (if any) via `GET /v1/me/home?resolve=1` without creating
 * a new guest secret or founding a colony.
 */
export async function probeActiveHomeColony(opts: ProbeActiveColonyOptions = {}): Promise<ActiveHomeColony | null> {
  const doFetch = opts.fetch ?? (typeof fetch === 'function' ? fetch : undefined);
  if (!doFetch) return null;
  const search = opts.search ?? (typeof location !== 'undefined' ? location.search : '');
  const dev = opts.dev ?? import.meta.env.DEV;
  const storage = opts.storage === undefined ? (typeof localStorage !== 'undefined' ? localStorage : null) : opts.storage;

  try {
    let token = '';
    const refreshed = await refreshPilotSession(doFetch, !opts.fetch);
    if (refreshed?.accessToken) {
      token = refreshed.accessToken;
    } else {
      const secret = readExistingDeviceSecret(storage, search, dev);
      if (secret) {
        const res = await doFetch('/v1/auth/guest', {
          method: 'POST',
          credentials: 'include',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ deviceSecret: secret }),
        });
        if (res.ok) {
          const auth = (await res.json()) as { accessToken?: string };
          if (auth?.accessToken) token = auth.accessToken;
        }
      }
    }
    if (!token) return null;

    const homeRes = await doFetch('/v1/me/home?resolve=1', {
      method: 'GET',
      credentials: 'include',
      headers: { authorization: `Bearer ${token}`, accept: 'application/json' },
    });
    if (!homeRes.ok) return null;
    const body = (await homeRes.json()) as {
      state?: string;
      foundingSectorId?: unknown;
      colony?: { id?: string; name?: string; foundingSectorId?: unknown };
      planet?: { id?: string; name?: string; type?: string };
    };
    if (body?.state !== 'ACTIVE' || !body.planet || !body.colony) return null;
    const kind = kindOfPlanetType(body.planet.type ?? '');
    if (!kind) return null;
    const rawSector =
      typeof body.colony.foundingSectorId === 'string' && body.colony.foundingSectorId.trim().length > 0
        ? body.colony.foundingSectorId.trim()
        : typeof body.foundingSectorId === 'string' && body.foundingSectorId.trim().length > 0
          ? body.foundingSectorId.trim()
          : undefined;
    return {
      kind,
      planetType: body.planet.type as ActivePlanetType,
      planetId: String(body.planet.id ?? ''),
      planetName: String(body.planet.name ?? kind),
      colonyId: String(body.colony.id ?? ''),
      colonyName: String(body.colony.name ?? 'Colony'),
      ...(rawSector ? { foundingSectorId: rawSector } : {}),
    };
  } catch {
    return null;
  }
}
