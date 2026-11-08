import type { PlanetSummaryV1 } from '@terra/contracts';
import { PLANET_SPECS, type PlanetKind } from '@terra/render/planets/PlanetSpec';
import { buildDefaultPlanetSummaryV1, normalizePlanetSummaryV1 } from './lobby/orbitalPickerModel';

const css = (n: number) => '#' + n.toString(16).padStart(6, '0');

export function formatWorldLiveTelemetry(
  summary: Pick<PlanetSummaryV1, 'livingColonies' | 'onlinePlayers'>,
): string {
  const parts: string[] = [];
  if (summary.livingColonies !== null && summary.livingColonies !== undefined) {
    parts.push(`${summary.livingColonies} LIVING`);
  }
  if (summary.onlinePlayers !== null && summary.onlinePlayers !== undefined) {
    parts.push(`${summary.onlinePlayers} ONLINE`);
  }
  return parts.join(' · ');
}

function resolveCardSummary(k: PlanetKind, candidate?: PlanetSummaryV1 | number): PlanetSummaryV1 {
  if (candidate && typeof candidate === 'object' && 'type' in candidate) {
    return normalizePlanetSummaryV1(candidate);
  }
  return buildDefaultPlanetSummaryV1(k);
}

/**
 * HTML of one persistent canonical world card (`dune` ↔ `desert`, `oceanForest` ↔ `ocean`, `forestRock` ↔ `temperate`).
 * Includes procedural planet thumbnail, live availability badge (`open|full|paused|faulted|archived`),
 * live seat/colony counts (`freeSeats / validatedCapacity`, `foundedSeats`, `reservedSeats`, `livingColonies`, `onlinePlayers`),
 * traits, and palette swatches. Never renders `newPlanet` CTAs or age-closing timers.
 */
export function worldCardHtml(k: PlanetKind, summaryArg?: PlanetSummaryV1 | number): string {
  const s = PLANET_SPECS[k];
  const o = s.orbital;
  const summary = resolveCardSummary(k, summaryArg);
  const base = css(o.sea ?? o.land[1]);
  const land = css(o.land[1]);
  const hi = css(o.land[2]);
  const thumb = `radial-gradient(circle at 32% 28%, ${css(o.cloudColor)}55 0%, transparent 28%), radial-gradient(circle at 36% 32%, ${hi} 0%, ${land} 38%, ${base} 70%, #000 100%)`;
  const sw = [
    s.palette.groundLow,
    s.palette.groundHigh,
    s.palette.rock,
    s.palette.accent,
    s.palette.water ?? s.palette.rockDark,
  ]
    .map((c) => `<i style="background:${css(c)}"></i>`)
    .join('');
  const avail = summary.availability;
  const liveText = formatWorldLiveTelemetry(summary);
  const livingAttr = summary.livingColonies !== null ? String(summary.livingColonies) : '';
  const onlineAttr = summary.onlinePlayers !== null ? String(summary.onlinePlayers) : '';

  return `<button class="world-card plate" data-k="${k}" data-planet-type="${summary.type}" data-planet-id="${summary.id}" data-availability="${avail}" data-free-seats="${summary.freeSeats}" data-validated-capacity="${summary.validatedCapacity}" data-reserved-seats="${summary.reservedSeats}" data-founded-seats="${summary.foundedSeats}" data-living-colonies="${livingAttr}" data-online-players="${onlineAttr}"><div class="thumb" style="background:${thumb};--glow:${css(o.atmosphereColor)}88"></div>
        <div class="world-card-head"><h3>${s.name}</h3><span class="badge world-card-status" data-testid="world-status-${k}" data-availability="${avail}">${avail.toUpperCase()}</span></div><p>${s.tagline}</p><div class="world-card-counts" data-testid="world-counts-${k}"><span class="world-seat-free" data-testid="world-free-seats-${k}">${summary.freeSeats}/${summary.validatedCapacity} SEATS FREE</span><span class="world-seat-meta" data-testid="world-seat-meta-${k}">${summary.foundedSeats} FOUNDED · ${summary.reservedSeats} RESERVED</span><span class="world-live-meta" data-testid="world-live-meta-${k}">${liveText}</span></div><div class="traits">${s.traits.map((t) => `<span>${t}</span>`).join('')}</div><div class="swatches">${sw}</div></button>`;
}

export function updateWorldCardElement(cardEl: HTMLElement, rawSummary: PlanetSummaryV1): void {
  const summary = normalizePlanetSummaryV1(rawSummary);
  const avail = summary.availability;
  cardEl.dataset.planetType = summary.type;
  cardEl.dataset.planetId = summary.id;
  cardEl.dataset.availability = avail;
  cardEl.dataset.freeSeats = String(summary.freeSeats);
  cardEl.dataset.validatedCapacity = String(summary.validatedCapacity);
  cardEl.dataset.reservedSeats = String(summary.reservedSeats);
  cardEl.dataset.foundedSeats = String(summary.foundedSeats);
  cardEl.dataset.livingColonies =
    summary.livingColonies !== null ? String(summary.livingColonies) : '';
  cardEl.dataset.onlinePlayers =
    summary.onlinePlayers !== null ? String(summary.onlinePlayers) : '';

  const statusEl = cardEl.querySelector<HTMLElement>('.world-card-status');
  if (statusEl) {
    statusEl.dataset.availability = avail;
    statusEl.textContent = avail.toUpperCase();
  }
  const freeEl = cardEl.querySelector<HTMLElement>('.world-seat-free');
  if (freeEl) {
    freeEl.textContent = `${summary.freeSeats}/${summary.validatedCapacity} SEATS FREE`;
  }
  const metaEl = cardEl.querySelector<HTMLElement>('.world-seat-meta');
  if (metaEl) {
    metaEl.textContent = `${summary.foundedSeats} FOUNDED · ${summary.reservedSeats} RESERVED`;
  }
  const liveEl = cardEl.querySelector<HTMLElement>('.world-live-meta');
  if (liveEl) {
    liveEl.textContent = formatWorldLiveTelemetry(summary);
  }
}
