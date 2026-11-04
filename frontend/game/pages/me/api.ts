import {
  MeAchievementsResponseSchema,
  MeProfileResponseSchema,
  type MeAchievementsResponse,
  type MeProfileResponse,
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
        if (body.accessToken) token = body.accessToken;
      }
    } catch { /* A still-valid bearer can be used if refresh is unavailable. */ }
  }
  if (!token) return { kind: 'error', message: 'Sign in from the landing or planet selection screen to view your pilot.' };
  const headers: Record<string, string> = {
    Accept: 'application/json',
    Authorization: `Bearer ${token}`,
  };
  let querySuffix = '';
  try {
    const waves = new URLSearchParams(rawSearch).get('waves')?.trim();
    if (waves) querySuffix = `?waves=${encodeURIComponent(waves)}`;
  } catch {
    // Ignore
  }

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
