// Live stats (GET /v1/planets/stats, GET /v1/planets, GET /v1/trade/overview/:id), refreshed every minute.
const FETCH_TIMEOUT_MS = 20_000;
const REFRESH_MS = 60_000;
const RETRY_DELAY_MS = 3_000;

interface PublicStatsDto {
  readonly planetsActive?: number | null;
  readonly coloniesAlive?: number | null;
  readonly playersOnline?: number | null;
}

interface PlanetSummaryDto {
  readonly id: string;
  readonly type: 'desert' | 'ocean' | 'temperate';
  readonly look?: string;
  readonly availability: string;
  readonly validatedCapacity: number;
  readonly reservedSeats: number;
  readonly foundedSeats: number;
  readonly freeSeats: number;
  readonly livingColonies: number | null;
  readonly onlinePlayers: number | null;
}

interface TradeOverviewItemDto {
  readonly bestBid?: unknown;
  readonly bestAsk?: unknown;
  readonly last?: unknown;
}

interface TradeOverviewDto {
  readonly overview?: readonly TradeOverviewItemDto[];
  readonly pairs?: readonly TradeOverviewItemDto[];
}

const LOOK_TO_TYPE: Readonly<Record<string, PlanetSummaryDto['type']>> = {
  dune: 'desert',
  oceanForest: 'ocean',
  forestRock: 'temperate',
};

const TYPE_LABEL: Readonly<Record<PlanetSummaryDto['type'], string>> = {
  desert: 'DESERT',
  ocean: 'OCEAN',
  temperate: 'TEMPERATE',
};

const FALLBACK_STATS: Readonly<Record<string, string>> = {
  planetsActive: '3',
  coloniesAlive: '15',
  playersOnline: '0',
};

async function fetchJson<T>(url: string): Promise<T | null> {
  if (!globalThis.fetch) return null;
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: ctl.signal, headers: { accept: 'application/json' } });
    clearTimeout(timer);
    return res.ok ? ((await res.json()) as T) : null;
  } catch {
    clearTimeout(timer);
    return null;
  }
}

function applyHeroStats(stats: PublicStatsDto | null): void {
  const rec = (stats ?? {}) as Readonly<Record<string, unknown>>;
  document.querySelectorAll<HTMLElement>('[data-stat]').forEach((el) => {
    const key = el.dataset.stat ?? '';
    const v = rec[key];
    if (typeof v === 'number' && Number.isFinite(v)) {
      el.textContent = v.toLocaleString('en-US');
      return;
    }
    const cur = el.textContent?.trim() ?? '';
    if (!cur || cur === '—') {
      el.textContent = FALLBACK_STATS[key] ?? '0';
    }
  });
}

function renderPlanetLiveBlock(card: HTMLElement, planet: PlanetSummaryDto, activePairs: number): void {
  const body = card.querySelector<HTMLElement>('.planet-body');
  if (!body) return;

  const badge = body.querySelector<HTMLElement>('.planet-head .badge');
  if (badge && !card.dataset.activeColony && !card.dataset.colonyLocked) {
    const avail = planet.availability.toUpperCase();
    badge.textContent = `${TYPE_LABEL[planet.type]} · ${avail}`;
    badge.className = `badge ${planet.availability === 'full' || planet.availability === 'faulted' ? 'badge-alert' : 'badge-ok'}`;
  }

  let live = body.querySelector<HTMLElement>('[data-planet-live]');
  if (!live) {
    live = document.createElement('div');
    live.className = 'planet-live';
    const cta = body.querySelector('.btn');
    if (cta) body.insertBefore(live, cta);
    else body.append(live);
  }
  live.dataset.planetLive = planet.id;

  const seatsBar = document.createElement('div');
  seatsBar.className = 'seats';
  seatsBar.setAttribute('aria-label', `${planet.freeSeats} of ${planet.validatedCapacity} seats free`);
  const takenSeats = planet.foundedSeats + planet.reservedSeats;
  const activePips =
    takenSeats > 0
      ? Math.min(7, Math.max(1, Math.round((takenSeats / Math.max(1, planet.validatedCapacity)) * 7)))
      : 0;
  for (let i = 0; i < 7; i++) {
    const pip = document.createElement('i');
    if (i < activePips) pip.className = 'on';
    seatsBar.append(pip);
  }

  const row = document.createElement('div');
  row.className = 'planet-live-row';
  const coloniesCount = planet.livingColonies ?? planet.foundedSeats;
  const countsSpan = document.createElement('span');
  countsSpan.textContent = `${planet.freeSeats}/${planet.validatedCapacity} SEATS · ${coloniesCount} COLONIES`;

  const marketLink = document.createElement('a');
  marketLink.className = 'planet-market-link';
  marketLink.href = `/trade.html?planet=${encodeURIComponent(planet.id)}`;
  marketLink.textContent = activePairs > 0 ? `${activePairs} PAIRS LIVE →` : 'EXCHANGE →';

  row.append(countsSpan, marketLink);
  live.replaceChildren(seatsBar, row);
}

async function hydratePlanetCards(api: string): Promise<void> {
  const list = await fetchJson<{ readonly planets?: readonly PlanetSummaryDto[] }>(`${api}/v1/planets`);
  const planets = list?.planets;
  if (!planets?.length) return;

  const pairCounts = await Promise.all(
    planets.map(async (planet) => {
      const ov = await fetchJson<TradeOverviewDto>(`${api}/v1/trade/overview/${encodeURIComponent(planet.id)}`);
      const items = ov?.overview ?? ov?.pairs ?? [];
      const count = items.filter((p) => p.bestBid || p.bestAsk || p.last).length;
      return [planet.type, { planet, count }] as const;
    }),
  );
  const byType = new Map(pairCounts);

  document.querySelectorAll<HTMLElement>('#planets article.planet').forEach((card) => {
    const look = card.querySelector<HTMLCanvasElement>('canvas[data-planet]')?.dataset.planet ?? '';
    const type = LOOK_TO_TYPE[look];
    const entry = type ? byType.get(type) : undefined;
    if (entry) renderPlanetLiveBlock(card, entry.planet, entry.count);
  });
}

export async function refreshLiveStats(page: HTMLElement | null): Promise<boolean> {
  if (!globalThis.fetch || (typeof location !== 'undefined' && location.protocol === 'file:')) return false;
  const api = page?.dataset.api || '';
  const [stats] = await Promise.all([
    fetchJson<PublicStatsDto>(`${api}/v1/planets/stats`),
    hydratePlanetCards(api),
  ]);
  applyHeroStats(stats);
  return stats !== null;
}

export function initLiveStats(page: HTMLElement | null): void {
  if (!globalThis.fetch || (typeof location !== 'undefined' && location.protocol === 'file:')) return;
  void refreshLiveStats(page).then((ok) => {
    if (!ok) {
      setTimeout(() => {
        void refreshLiveStats(page);
      }, RETRY_DELAY_MS);
    }
  });
  setInterval(() => {
    void refreshLiveStats(page);
  }, REFRESH_MS);
}
