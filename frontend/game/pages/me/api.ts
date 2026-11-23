import {
  MeAchievementsResponseSchema,
  MeProfileResponseSchema,
  PilotHandleResponseSchema,
  PlayerAiSettingsSchema,
  type MeAchievementsResponse,
  type MeProfileResponse,
  type PlayerAiSettings,
  type UpdatePlayerAiSettings,
} from '@terra/contracts';
import { classifyProfileFailure, type ProfileReason } from '../../../design/analytics/profile';
import { jwtStillValid, refreshPilotSession } from '../../../design/pilot/PilotAccess';
import { readActivePilot } from '../../features/achievements/activePilot';
import { isLocalSimSignedOut } from './localModeSim';

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
      readonly reason: ProfileReason;
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

function isUsableServerBearer(token: string): boolean {
  if (!token || token === 'local-mode-token' || token.startsWith('player:')) return false;
  return token.split('.').length === 3 ? jwtStillValid(token) : true;
}

function syncRefreshedPilotToken(accessToken: string): void {
  if (!isUsableServerBearer(accessToken)) return;
  try {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem('ta_active_pilot') : null;
    if (!raw) return;
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (parsed.accessToken === 'local-mode-token') return;
    localStorage.setItem('ta_active_pilot', JSON.stringify({ ...parsed, accessToken, updatedAt: Date.now() }));
  } catch {
    /* ignore storage errors */
  }
}

export function resolveMeBearerToken(search?: string): string {
  const rawSearch = search ?? (typeof location !== 'undefined' ? location.search : '');
  try {
    const params = new URLSearchParams(rawSearch);
    const pid = params.get('playerId')?.trim();
    if (pid) return `player:${pid}`;
    const as = params.get('as')?.trim().toLowerCase().replace(/[^a-z0-9_-]/g, '');
    if (as) return `dev:${as}`;
    if (params.get('host') === 'local') return isLocalSimSignedOut() ? '' : 'local-mode-token';
  } catch {
    // Ignore malformed query
  }

  const stored = readActivePilot();
  if (stored && stored.isGuest !== true && stored.accessToken && isUsableServerBearer(stored.accessToken)) {
    return stored.accessToken;
  }
  return isUsableServerBearer(cachedRefreshedToken) ? cachedRefreshedToken : '';
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

export function buildWavesQuerySuffix(rawSearch: string): string {
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
        syncRefreshedPilotToken(refreshed.accessToken);
      }
    } else {
      cachedRefreshedToken = '';
      token = resolveMeBearerToken(rawSearch);
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
        reason: classifyProfileFailure({ status: profRes.ok ? achRes.status : profRes.status }),
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
      reason: classifyProfileFailure({
        network: err instanceof TypeError,
        invalid: err instanceof Error && err.name === 'ZodError',
      }),
    };
  }
}

async function resolveMeWriteBearer(doFetch: MeFetchFn, rawSearch: string): Promise<string> {
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
  return token;
}

export async function saveMeAiSettings(
  input: UpdatePlayerAiSettings,
  doFetch: MeFetchFn = (url, init) => fetch(url, init),
  search?: string,
): Promise<{ readonly ok: true; readonly settings: PlayerAiSettings } | { readonly ok: false; readonly message: string }> {
  const rawSearch = search ?? (typeof location !== 'undefined' ? location.search : '');
  const token = await resolveMeWriteBearer(doFetch, rawSearch);
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

export async function saveMePilotHandle(
  handle: string,
  doFetch: MeFetchFn = (url, init) => fetch(url, init),
  search?: string,
): Promise<{ readonly ok: true; readonly handle: string } | { readonly ok: false; readonly message: string }> {
  const rawSearch = search ?? (typeof location !== 'undefined' ? location.search : '');
  const token = await resolveMeWriteBearer(doFetch, rawSearch);
  if (!token) return { ok: false, message: 'Sign in to rename your pilot.' };
  const querySuffix = buildWavesQuerySuffix(rawSearch);
  try {
    const res = await doFetch(`/v1/me/profile/handle${querySuffix}`, {
      method: 'PUT',
      credentials: 'include',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ handle }),
    });
    const body = await res.json().catch(() => null);
    if (!res.ok) {
      const msg = (body as { message?: string; error?: { message?: string } } | null)?.error?.message
        ?? (body as { message?: string } | null)?.message
        ?? `Failed to rename pilot (${res.status})`;
      return { ok: false, message: msg };
    }
    return { ok: true, handle: PilotHandleResponseSchema.parse(body).handle };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : 'Unable to rename pilot' };
  }
}
