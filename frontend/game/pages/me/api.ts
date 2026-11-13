import {
  MeAchievementsResponseSchema,
  MeProfileResponseSchema,
  PlayerAiSettingsSchema,
  type MeAchievementsResponse,
  type MeProfileResponse,
  type PlayerAiSettings,
  type UpdatePlayerAiSettings,
} from '@terra/contracts';
import { refreshPilotSession } from '../../../design/pilot/PilotAccess';
import { readActivePilot } from '../../features/achievements/activePilot';

export type MeFetchResult =
  | {
      readonly kind: 'ok';
      readonly profile: MeProfileResponse;
      readonly achievements: MeAchievementsResponse;
    }
  | {
      readonly kind: 'wave_disabled';
      readonly message: string;
    }
  | {
      readonly kind: 'unauthenticated';
      readonly message: string;
    }
  | {
      readonly kind: 'error';
      readonly message: string;
    };

export type MeFetchFn = (input: string, init?: RequestInit) => Promise<{
  readonly ok: boolean;
  readonly status: number;
  json(): Promise<unknown>;
}>;

let cachedRefreshedToken = '';
const defaultMeFetch: MeFetchFn = (input, init) => fetch(input, init);

export function clearMeCachedToken(): void {
  cachedRefreshedToken = '';
}

export function resolveMeBearerToken(search?: string): string {
  const rawSearch = search ?? (typeof location !== 'undefined' ? location.search : '');
  try {
    const params = new URLSearchParams(rawSearch);
    const pid = params.get('playerId')?.trim();
    if (pid) return `player:${pid}`;
    const as = params.get('as')?.trim().toLowerCase().replace(/[^a-z0-9_-]/g, '');
    if (as) return `dev:${as}`;
  } catch {
    // Ignore malformed query
  }

  const stored = readActivePilot();
  if (stored && stored.isGuest !== true && stored.accessToken && !stored.accessToken.startsWith('player:')) {
    return stored.accessToken;
  }
  return cachedRefreshedToken;
}

function isWaveDisabledPayload(status: number, body: unknown): boolean {
  if (status === 403) return true;
  if (!body || typeof body !== 'object') return false;
  const rec = body as { code?: unknown; errorCode?: unknown; error?: { code?: unknown } };
  return (
    rec.code === 'wave_disabled' ||
    rec.errorCode === 'wave_disabled' ||
    rec.error?.code === 'wave_disabled'
  );
}

function buildWavesQuerySuffix(rawSearch: string): string {
  try {
    const waves = new URLSearchParams(rawSearch).get('waves')?.trim();
    if (waves) return `?waves=${encodeURIComponent(waves)}`;
  } catch {
    // Ignore
  }
  return '';
}

export async function fetchMeData(
  doFetch: MeFetchFn = defaultMeFetch,
  search?: string,
): Promise<MeFetchResult> {
  const rawSearch = search ?? (typeof location !== 'undefined' ? location.search : '');
  let token = resolveMeBearerToken(rawSearch);
  const params = new URLSearchParams(rawSearch);
  if (!params.has('as') && !params.has('playerId')) {
    const refreshed = await refreshPilotSession(doFetch, doFetch === defaultMeFetch);
    if (refreshed) {
      if (refreshed.player?.isGuest === true) {
        cachedRefreshedToken = '';
        return {
          kind: 'unauthenticated',
          message: 'Sign in or create a pilot account to view your profile, achievements, and NEAR.AI settings.',
        };
      }
      if (refreshed.accessToken) {
        token = refreshed.accessToken;
        cachedRefreshedToken = refreshed.accessToken;
      }
    }
  }
  if (!token) {
    return {
      kind: 'unauthenticated',
      message: 'Sign in or create a pilot account to view your profile, achievements, and NEAR.AI settings.',
    };
  }
  const headers: Record<string, string> = {
    Accept: 'application/json',
    Authorization: `Bearer ${token}`,
  };
  const querySuffix = buildWavesQuerySuffix(rawSearch);

  try {
    const [profRes, achRes] = await Promise.all([
      doFetch(`/v1/me/profile${querySuffix}`, { headers, credentials: 'include' }),
      doFetch(`/v1/me/achievements${querySuffix}`, { headers, credentials: 'include' }),
    ]);

    const [profBody, achBody] = await Promise.all([
      profRes.json().catch(() => null),
      achRes.json().catch(() => null),
    ]);

    if (
      isWaveDisabledPayload(profRes.status, profBody) ||
      isWaveDisabledPayload(achRes.status, achBody)
    ) {
      return { kind: 'wave_disabled', message: 'Player page is off' };
    }

    if (profRes.status === 401 || achRes.status === 401) {
      return {
        kind: 'unauthenticated',
        message: 'Sign in or create a pilot account to view your profile, achievements, and NEAR.AI settings.',
      };
    }

    if (!profRes.ok || !achRes.ok) {
      return {
        kind: 'error',
        message: `Failed to load pilot profile (${profRes.status} / ${achRes.status})`,
      };
    }

    const profile = MeProfileResponseSchema.parse(profBody);
    const achievements = MeAchievementsResponseSchema.parse(achBody);
    if (profile.identity.isGuest && !profile.identity.accountId && !params.has('as') && !params.has('playerId')) {
      return {
        kind: 'unauthenticated',
        message: 'Sign in or create a pilot account to view your profile, achievements, and NEAR.AI settings.',
      };
    }
    return { kind: 'ok', profile, achievements };
  } catch (err) {
    return {
      kind: 'error',
      message: err instanceof Error ? err.message : 'Unable to load pilot profile',
    };
  }
}

export async function saveMeAiSettings(
  input: UpdatePlayerAiSettings,
  doFetch: MeFetchFn = (url, init) => fetch(url, init),
  search?: string,
): Promise<{ readonly ok: true; readonly settings: PlayerAiSettings } | { readonly ok: false; readonly message: string }> {
  const rawSearch = search ?? (typeof location !== 'undefined' ? location.search : '');
  const params = new URLSearchParams(rawSearch);
  let token = resolveMeBearerToken(rawSearch);
  if (!params.has('as') && !params.has('playerId')) {
    if (!token && cachedRefreshedToken) token = cachedRefreshedToken;
    if (!token) {
      try {
        const refreshed = await doFetch('/v1/auth/refresh', { method: 'POST', credentials: 'include' });
        if (refreshed.ok) {
          const body = (await refreshed.json()) as { accessToken?: string };
          if (body.accessToken) {
            token = body.accessToken;
            cachedRefreshedToken = body.accessToken;
          }
        }
      } catch {
        // Ignore refresh failure
      }
    }
  }
  if (!token) {
    return { ok: false, message: 'Sign in to save your NEAR.AI API key and model.' };
  }
  const querySuffix = buildWavesQuerySuffix(rawSearch);
  try {
    const res = await doFetch(`/v1/me/ai-settings${querySuffix}`, {
      method: 'PUT',
      credentials: 'include',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(input),
    });
    const body = await res.json().catch(() => null);
    if (!res.ok) {
      const msg = (body as { message?: string; error?: { message?: string } } | null)?.error?.message
        ?? (body as { message?: string } | null)?.message
        ?? `Failed to save NEAR.AI settings (${res.status})`;
      return { ok: false, message: msg };
    }
    return { ok: true, settings: PlayerAiSettingsSchema.parse(body) };
  } catch (err) {
    return {
      ok: false,
      message: err instanceof Error ? err.message : 'Unable to save NEAR.AI settings',
    };
  }
}
