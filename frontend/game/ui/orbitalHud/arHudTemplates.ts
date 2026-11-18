import type { PlanetSummaryV1 } from '@terra/contracts';
import { PLANET_SPECS, type PlanetKind } from '@terra/render/planets/PlanetSpec';
import type { ActiveHomeColony } from '../../../design/pilot/activeHomeColony';
import { resolvePlanetPopulationCounts, type SectorIntentV1 } from '../lobby/orbitalPickerModel';
import { renderSectorChooserHtml } from '../lobby/sectorChooser';

function escapeHtml(text: string): string {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

export function renderScanCardInnerHtml(kind: PlanetKind, summary: PlanetSummaryV1): string {
  const spec = PLANET_SPECS[kind];
  const traitsHtml = spec.traits.map((t) => `<span class="ar-chip">${escapeHtml(t)}</span>`).join('');
  const primaryRes =
    summary.sectors.find((s) => s.kind === 'land' && s.mainResource)?.mainResource ?? 'metals.t1';
  const seaFrac = Math.round(spec.orbital.seaLevel * 100);
  const climateLabel = seaFrac > 40 ? 'ARCHIPELAGO' : seaFrac > 10 ? 'TEMPERATE' : 'ARID';

  return `<div class="ar-card-scanlines scanlines"></div>
    <div class="ar-eyebrow"><span>SHIP AR // PLANETARY SCAN</span><span class="ar-code">${summary.type.toUpperCase()}</span></div>
    <h2 class="ar-title">${escapeHtml(spec.name)}</h2>
    <p class="ar-desc">${escapeHtml(spec.tagline)}</p>
    <div class="ar-stat-grid">
      <div class="ar-kv"><span class="ar-k">HYDROSPHERE</span><b class="ar-v">${seaFrac}%</b></div>
      <div class="ar-kv"><span class="ar-k">CLIMATE</span><b class="ar-v">${climateLabel}</b></div>
      <div class="ar-kv"><span class="ar-k">DOMINANT</span><b class="ar-v">${escapeHtml(primaryRes)}</b></div>
    </div>
    <div class="ar-chips">${traitsHtml}</div>`;
}

function renderRosterHtml(summary: PlanetSummaryV1): string {
  const colonies = summary.colonies ?? [];
  if (colonies.length === 0) {
    return '<div class="ar-roster-empty">NO COLONIES LANDED YET · ALL DROP SITES OPEN</div>';
  }
  const rows = colonies.slice(0, 4).map((col) => {
    const tag = col.isBot ? 'AI BOT' : 'PILOT';
    const tagCls = col.isBot ? 'is-bot' : 'is-player';
    return `<div class="ar-roster-row">
      <span class="ar-roster-tag ${tagCls}">${tag}</span>
      <span class="ar-roster-name">${escapeHtml(col.displayName)}</span>
      <span class="ar-roster-sec">${escapeHtml(col.foundingSectorId)}</span>
    </div>`;
  });
  const extra = colonies.length > 4 ? `<div class="ar-roster-more">+${colonies.length - 4} MORE ON SURFACE</div>` : '';
  return `<div class="ar-roster">${rows.join('')}${extra}</div>`;
}

export function renderPresenceCardInnerHtml(
  summary: PlanetSummaryV1,
  activeColony: ActiveHomeColony | null,
): string {
  const pop = resolvePlanetPopulationCounts(summary);
  const zoneNote =
    pop.reservedZones > 0
      ? `${pop.openZones} open · ${pop.reservedZones} inbound`
      : 'Safe landing pads across 7 land sectors';
  const onlineTag = pop.online > 0 ? `<span class="ar-live-pill"><i></i>${pop.online} LIVE</span>` : '<span class="ar-dim-pill">ORBIT LINK</span>';
  const homeCallout = activeColony
    ? `<div class="ar-home-callout">ACTIVE BASE · ${escapeHtml(activeColony.colonyName)}</div>`
    : '';

  return `<div class="ar-card-scanlines scanlines"></div>
    <div class="ar-eyebrow"><span>SURFACE TELEMETRY</span>${onlineTag}</div>
    ${homeCallout}
    <div class="ar-kpi-row">
      <div class="ar-kpi is-player">
        <span class="ar-kpi-label">PLAYERS</span>
        <b class="ar-kpi-val" data-testid="ar-players-count">${pop.players}</b>
        <span class="ar-kpi-sub">${pop.online} online now</span>
      </div>
      <div class="ar-kpi is-bot">
        <span class="ar-kpi-label">AI BOTS</span>
        <b class="ar-kpi-val" data-testid="ar-bots-count">${pop.bots}</b>
        <span class="ar-kpi-sub">autonomous colonies</span>
      </div>
    </div>
    <div class="ar-zone-bar">
      <div class="ar-zone-head">
        <span class="ar-k">DROP ZONES AVAILABLE</span>
        <b class="ar-v">${pop.openZones} / ${pop.totalZones} OPEN</b>
      </div>
      <div class="ar-zone-sub">${zoneNote}</div>
    </div>
    ${renderRosterHtml(summary)}`;
}

export function renderLaunchCardShellHtml(
  kind: PlanetKind,
  summary: PlanetSummaryV1,
  intent: SectorIntentV1,
  queuePaused: boolean,
  activeColony: ActiveHomeColony | null,
): string {
  const sectorChooser = renderSectorChooserHtml(kind, summary, intent, queuePaused);
  const btnText = activeColony ? 'ENTER COLONY' : 'DEPLOY';
  return `<div class="ar-card-scanlines scanlines"></div>
    <div class="ar-eyebrow"><span>DROP VECTOR // INSERTION</span><span class="ar-code">${summary.availability.toUpperCase()}</span></div>
    <div id="sector-picker-host"${activeColony ? ' hidden' : ''}>${sectorChooser}</div>
    <div id="menu-err"></div>
    <button type="button" class="btn btn-primary btn-lg" id="deploy">${btnText}</button>`;
}
