export interface EarlyGuildRadarVisit {
  readonly npcId: string;
  readonly name: string;
  readonly arriveAt: number;
  readonly departAt: number;
  readonly noticeAt: number;
  readonly early: boolean;
}

export interface GuildRadarQuery {
  readonly planetId: string | null;
  readonly colonyId: string | null;
  readonly colonyIndex?: number | null;
}

export type GuildRadarFetch = (input: string, init?: RequestInit) => Promise<Pick<Response, 'ok' | 'json'>>;

/**
 * W28-06 / W28-11: polls `GET /v1/market/guild/radar` so Tier 2+ stakers (`guildRadarLeadMs = 5 min`) see inbound
 * NPC Guild freighters before they dock (`early: true`). Returns `null` on 404, offline, or when no ship is in the
 * early-warning window.
 */
export async function fetchEarlyGuildRadar(
  q: GuildRadarQuery,
  doFetch: GuildRadarFetch = (i, init) => fetch(i, init),
): Promise<{ visit: EarlyGuildRadarVisit; serverNowMs: number } | null> {
  if (!q.planetId || !q.colonyId) return null;
  const params = new URLSearchParams({ planetId: q.planetId, colonyId: q.colonyId });
  if (typeof q.colonyIndex === 'number' && Number.isInteger(q.colonyIndex) && q.colonyIndex >= 0) {
    params.set('colonyIndex', String(q.colonyIndex));
  }
  try {
    const res = await doFetch(`/v1/market/guild/radar?${params.toString()}`, { headers: { accept: 'application/json' } });
    if (!res.ok) return null;
    const body = (await res.json()) as { nowMs?: unknown; visits?: unknown };
    if (!Array.isArray(body.visits)) return null;
    const serverNowMs = typeof body.nowMs === 'number' && Number.isFinite(body.nowMs) ? body.nowMs : Date.now();
    const early = (body.visits as Array<Record<string, unknown>>)
      .filter((v) => v && v.early === true && typeof v.name === 'string' && typeof v.arriveAt === 'number')
      .sort((a, b) => Number(a.arriveAt) - Number(b.arriveAt))[0];
    if (!early) return null;
    return {
      serverNowMs,
      visit: {
        npcId: String(early.npcId ?? ''),
        name: String(early.name),
        arriveAt: Number(early.arriveAt),
        departAt: Number(early.departAt ?? 0),
        noticeAt: Number(early.noticeAt ?? 0),
        early: true,
      },
    };
  } catch {
    return null;
  }
}
