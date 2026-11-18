import type { PlanetSummaryV1 } from '@terra/contracts';
import { PLANET_SPECS, type PlanetKind } from '@terra/render/planets/PlanetSpec';
import {
  buildDefaultPlanetSummaryV1,
  normalizePlanetSummaryV1,
  resolvePlanetPopulationCounts,
} from './lobby/orbitalPickerModel';

const css = (n: number) => '#' + n.toString(16).padStart(6, '0');

export function formatWorldPopulationLabel(summary: PlanetSummaryV1): string {
  const pop = resolvePlanetPopulationCounts(summary);
  const pWord = pop.players === 1 ? 'PLAYER' : 'PLAYERS';
  const bWord = pop.bots === 1 ? 'BOT' : 'BOTS';
  const onlinePart = pop.online > 0 ? ` · ${pop.online} ONLINE` : '';
  return `${pop.players} ${pWord} · ${pop.bots} ${bWord}${onlinePart}`;
}

export function formatWorldDropZonesLabel(summary: PlanetSummaryV1): string {
  const pop = resolvePlanetPopulationCounts(summary);
  return `${pop.openZones}/${pop.totalZones} DROP ZONES OPEN`;
}

function renderZonePipsHtml(summary: PlanetSummaryV1): string {
  const pop = resolvePlanetPopulationCounts(summary);
  const taken = Math.max(0, pop.totalZones - pop.openZones);
  const filled =
    taken > 0 ? Math.min(7, Math.max(1, Math.round((taken / Math.max(1, pop.totalZones)) * 7))) : 0;
  let html = '';
  for (let i = 0; i < 7; i++) {
    html += `<i class="${i < filled ? 'on' : ''}"></i>`;
  }
  return html;
}

function resolveCardSummary(k: PlanetKind, candidate?: PlanetSummaryV1 | number): PlanetSummaryV1 {
  if (candidate && typeof candidate === 'object' && 'type' in candidate) {
    return normalizePlanetSummaryV1(candidate);
  }
  return buildDefaultPlanetSummaryV1(k);
}

/**
 * HTML of one persistent canonical world card (`dune` ↔ `desert`, `oceanForest` ↔ `ocean`, `forestRock` ↔ `temperate`).
 * Renders an animated 3D globe canvas (`<canvas data-planet="...">`, with CSS fallback), real player/bot counts,
 * open drop-zone meter, traits, and palette swatches — without `YOUR COLONY` / `OPEN` chips or `newPlanet` CTAs.
 */
export function worldCardHtml(k: PlanetKind, summaryArg?: PlanetSummaryV1 | number): string {
  const s = PLANET_SPECS[k];
  const o = s.orbital;
  const summary = resolveCardSummary(k, summaryArg);
  const pop = resolvePlanetPopulationCounts(summary);
  const base = css(o.sea ?? o.land[1]);
  const land = css(o.land[1]);
  const hi = css(o.land[2]);
  const fallbackArt = `radial-gradient(circle at 32% 28%, ${css(o.cloudColor)}55 0%, transparent 28%), radial-gradient(circle at 36% 32%, ${hi} 0%, ${land} 38%, ${base} 70%, #000 100%)`;
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
  const livingAttr = summary.livingColonies !== null ? String(summary.livingColonies) : '';
  const onlineAttr = summary.onlinePlayers !== null ? String(summary.onlinePlayers) : '';

  return `<button type="button" class="world-card plate" data-k="${k}" data-planet-type="${summary.type}" data-planet-id="${summary.id}" data-availability="${avail}" data-free-seats="${summary.freeSeats}" data-validated-capacity="${summary.validatedCapacity}" data-reserved-seats="${summary.reservedSeats}" data-founded-seats="${summary.foundedSeats}" data-living-colonies="${livingAttr}" data-online-players="${onlineAttr}" data-player-colonies="${pop.players}" data-bot-colonies="${pop.bots}">
        <div class="world-card-top">
          <div class="world-card-art" style="background:${fallbackArt};--glow:${css(o.atmosphereColor)}66"><canvas data-planet="${k}" aria-hidden="true"></canvas></div>
          <div class="world-card-title"><h3>${s.name}</h3><span class="world-card-biome">${summary.type.toUpperCase()} WORLD</span></div>
        </div>
        <p>${s.tagline}</p>
        <div class="world-card-counts" data-testid="world-counts-${k}">
          <span class="world-pop-summary" data-testid="world-pop-${k}">${formatWorldPopulationLabel(summary)}</span>
          <span class="world-zones-summary" data-testid="world-free-seats-${k}">${formatWorldDropZonesLabel(summary)}</span>
          <div class="world-zone-pips" aria-hidden="true">${renderZonePipsHtml(summary)}</div>
        </div>
        <div class="traits">${s.traits.map((t) => `<span>${t}</span>`).join('')}</div>
        <div class="swatches">${sw}</div>
      </button>`;
}

export function updateWorldCardElement(cardEl: HTMLElement, rawSummary: PlanetSummaryV1): void {
  const summary = normalizePlanetSummaryV1(rawSummary);
  const pop = resolvePlanetPopulationCounts(summary);
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
  cardEl.dataset.playerColonies = String(pop.players);
  cardEl.dataset.botColonies = String(pop.bots);

  const popEl = cardEl.querySelector<HTMLElement>('.world-pop-summary');
  if (popEl) popEl.textContent = formatWorldPopulationLabel(summary);

  const freeEl = cardEl.querySelector<HTMLElement>('.world-zones-summary');
  if (freeEl) freeEl.textContent = formatWorldDropZonesLabel(summary);

  const pipsEl = cardEl.querySelector<HTMLElement>('.world-zone-pips');
  if (pipsEl) pipsEl.innerHTML = renderZonePipsHtml(summary);
}
