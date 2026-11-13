import {
  MeAchievementsResponseSchema,
  MeProfileResponseSchema,
  PlayerAiSettingsSchema,
  type MeAchievementsResponse,
  type MeProfileResponse,
  type PlayerAiSettings,
  type UpdatePlayerAiSettings,
} from '@terra/contracts';
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
      readonly kind: 'error';
      readonly message: string;
    };

export type MeFetchFn = (input: string, init?: RequestInit) => Promise<{
  readonly ok: boolean;
  readonly status: number;
  json(): Promise<unknown>;
}>;

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
  if (stored?.accessToken) return stored.accessToken;
  if (stored?.playerId) return `player:${stored.playerId}`;
  return '';
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

let cachedRefreshedToken = '';

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
  doFetch: MeFetchFn = (input, init) => fetch(input, init),
  search?: string,
): Promise<MeFetchResult> {
  const rawSearch = search ?? (typeof location !== 'undefined' ? location.search : '');
  let token = resolveMeBearerToken(rawSearch);
  const params = new URLSearchParams(rawSearch);
  if (!params.has('as') && !params.has('playerId')) {
    try {
      const refreshed = await doFetch('/v1/auth/refresh', { method: 'POST', credentials: 'include' });
      if (refreshed.ok) {
        const body = await refreshed.json() as { accessToken?: string };
        if (body.accessToken) {
          token = body.accessToken;
          cachedRefreshedToken = body.accessToken;
        }
      }
    } catch { /* A still-valid bearer can be used if refresh is unavailable. */ }
  }
  if (!token) return { kind: 'error', message: 'Sign in from the landing or planet selection screen to view your pilot.' };
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

    if (!profRes.ok || !achRes.ok) {
      return {
        kind: 'error',
        message: `Failed to load pilot profile (${profRes.status} / ${achRes.status})`,
      };
    }

    const profile = MeProfileResponseSchema.parse(profBody);
    const achievements = MeAchievementsResponseSchema.parse(achBody);
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
