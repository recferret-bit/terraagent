import type { PlanetSummaryV1, SectorSummaryV1 } from '@terra/contracts';
import type { PlanetKind } from '@terra/render/planets/PlanetSpec';
import type { SectorIntentV1 } from './orbitalPickerModel';

function formatSectorButtonSeatLabel(sec: SectorSummaryV1): string {
  return `${sec.freeSeats}/${sec.validatedCapacity}`;
}

function renderLandSectorOptionHtml(sec: SectorSummaryV1, selected: boolean): string {
  const selClass = selected ? ' sel' : '';
  const availUpper = sec.availability.toUpperCase();
  const resHtml = sec.mainResource
    ? `<span class="sector-opt-res" data-main-resource="${sec.mainResource}">${sec.mainResource}</span>`
    : '';
  return `<button type="button" class="sector-opt sector-opt-land plate-sm${selClass}" data-testid="sector-opt-${sec.sectorId}" data-sector-mode="chosen" data-sector-id="${sec.sectorId}" data-sector-kind="land" data-availability="${sec.availability}" data-free-seats="${sec.freeSeats}" data-validated-capacity="${sec.validatedCapacity}" data-reserved-seats="${sec.reservedSeats}" data-founded-seats="${sec.foundedSeats}" aria-pressed="${selected ? 'true' : 'false'}"><span class="sector-opt-id">${sec.sectorId}</span><span class="sector-opt-seats">${formatSectorButtonSeatLabel(sec)}</span><span class="badge sector-opt-avail" data-availability="${sec.availability}">${availUpper}</span>${resHtml}</button>`;
}

export function renderSectorChooserHtml(
  kind: PlanetKind,
  summary: PlanetSummaryV1,
  intent: SectorIntentV1,
  queuePaused = false,
): string {
  const landSectors = summary.sectors.filter((s) => s.kind === 'land');
  const oceanCount = summary.oceanSectors ?? summary.sectors.filter((s) => s.kind === 'ocean').length;
  const isAuto = intent.mode === 'auto';
  const autoSelClass = isAuto ? ' sel' : '';
  const oceanLabel = oceanCount > 0 ? ` · ${oceanCount} OCEAN` : '';
  const pausedBadge = queuePaused
    ? `<span class="badge sector-queue-badge" data-testid="sector-queue-paused" data-queue-paused="true">QUEUE PAUSED</span>`
    : '';
  const autoBtn = `<button type="button" class="sector-opt sector-opt-auto plate-sm${autoSelClass}" data-testid="sector-opt-auto" data-sector-mode="auto" data-sector-id="auto" data-availability="${summary.availability}" data-free-seats="${summary.freeSeats}" data-validated-capacity="${summary.validatedCapacity}" aria-pressed="${isAuto ? 'true' : 'false'}"><span class="sector-opt-id">AUTO · AUTOMATIC SECTOR</span><span class="sector-opt-seats">${summary.freeSeats}/${summary.validatedCapacity} FREE</span><span class="badge sector-opt-avail" data-availability="${summary.availability}">${summary.availability.toUpperCase()}</span></button>`;
  const landBtns = landSectors
    .map((sec) => renderLandSectorOptionHtml(sec, intent.mode === 'chosen' && intent.sectorId === sec.sectorId))
    .join('');

  return `<div class="sector-picker" data-testid="sector-picker" data-planet-kind="${kind}" data-planet-type="${summary.type}" data-planet-id="${summary.id}" data-land-sectors="${landSectors.length}" data-ocean-sectors="${oceanCount}" data-queue-paused="${queuePaused ? 'true' : 'false'}"><div class="sector-picker-head"><span class="field-label">LANDING SECTOR · ${landSectors.length} LAND${oceanLabel}</span>${pausedBadge}</div><div class="sector-options" role="radiogroup" aria-label="Landing sector">${autoBtn}${landBtns}</div></div>`;
}

export function bindSectorChooserEvents(
  container: HTMLElement,
  onSelect: (intent: SectorIntentV1) => void,
): void {
  container.querySelectorAll<HTMLElement>('.sector-opt').forEach((btn) => {
    btn.onclick = () => {
      const mode = btn.dataset.sectorMode;
      const sectorId = btn.dataset.sectorId;
      if (mode === 'chosen' && sectorId && sectorId !== 'auto') {
        onSelect({ mode: 'chosen', sectorId });
      } else {
        onSelect({ mode: 'auto' });
      }
    };
  });
}
