import type { PlanetSummaryV1 } from '@terra/contracts';
import { PLANET_SPECS, type PlanetKind } from '@terra/render/planets/PlanetSpec';
import type { ActiveHomeColony } from '../../../design/pilot/activeHomeColony';
import { resolvePlanetPopulationCounts, type SectorIntentV1 } from '../lobby/orbitalPickerModel';
import { renderSectorChooserHtml } from '../lobby/sectorChooser';
import { resolveSectorPopulationMap } from './sectorGlobeMap';

function escapeHtml(text: string): string {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

const RESOURCE_LABELS: Readonly<Record<string, string>> = {
  'metals.t1': 'METALS',
  'minerals.t1': 'MINERALS',
  'bio.water': 'WATER',
  'bio.biomass': 'BIOMASS',
};

function formatPrimaryResource(res: string): string {
  return RESOURCE_LABELS[res] ?? res.toUpperCase();
}

export function renderScanCardInnerHtml(kind: PlanetKind, summary: PlanetSummaryV1): string {
  const spec = PLANET_SPECS[kind];
  const traitsHtml = spec.traits.map((t) => `<span class="ar-chip">${escapeHtml(t)}</span>`).join('');
  const primaryRes =
    summary.sectors.find((s) => s.kind === 'land' && s.mainResource)?.mainResource ?? 'metals.t1';
  const seaFrac = Math.round(spec.orbital.seaLevel * 100);
  const climateLabel = seaFrac > 40 ? 'OCEANIC' : seaFrac > 10 ? 'TEMPERATE' : 'ARID';

  return `<div class="ar-card-scanlines scanlines"></div>
    <div class="ar-eyebrow"><span>ORBITAL SCAN // BIOME</span><span class="ar-code">${summary.type.toUpperCase()}</span></div>
    <h2 class="ar-title">${escapeHtml(spec.name)}</h2>
    <p class="ar-desc">${escapeHtml(spec.tagline)}</p>
    <div class="ar-stat-grid">
      <div class="ar-kv"><span class="ar-k">HYDROSPHERE</span><b class="ar-v">${seaFrac}%</b></div>
      <div class="ar-kv"><span class="ar-k">CLIMATE</span><b class="ar-v">${climateLabel}</b></div>
      <div class="ar-kv"><span class="ar-k">DOMINANT</span><b class="ar-v">${escapeHtml(formatPrimaryResource(primaryRes))}</b></div>
    </div>
    <div class="ar-chips">${traitsHtml}</div>`;
}

interface RosterDisplayRow {
  readonly isBot: boolean;
  readonly displayName: string;
  readonly sectorId: string;
}

function buildCombinedRosterRows(summary: PlanetSummaryV1): RosterDisplayRow[] {
  const rows: RosterDisplayRow[] = [];
  const popMap = resolveSectorPopulationMap(summary);
  for (const [sectorId, entry] of popMap) {
    let explicitPlayers = 0;
    let explicitBots = 0;
    for (const col of entry.colonies) {
      const isBot = Boolean(col.isBot);
      if (isBot) explicitBots += 1;
      else explicitPlayers += 1;
      rows.push({ isBot, displayName: col.displayName, sectorId });
    }
    for (let i = explicitPlayers; i < entry.players; i++) {
      rows.push({ isBot: false, displayName: `Colonist Base #${i + 1}`, sectorId });
    }
    for (let i = explicitBots; i < entry.bots; i++) {
      rows.push({ isBot: true, displayName: `Autonomous Guild Bot`, sectorId });
    }
  }
  return rows;
}

function renderRosterRowsHtml(rows: readonly RosterDisplayRow[], cls = ''): string {
  return rows
    .map((col) => {
      const tag = col.isBot ? 'AI BOT' : 'PILOT';
      const tagCls = col.isBot ? 'is-bot' : 'is-player';
      return `<div class="ar-roster-row${cls}">
      <span class="ar-roster-tag ${tagCls}">${tag}</span>
      <span class="ar-roster-name">${escapeHtml(col.displayName)}</span>
      <span class="ar-roster-sec">${escapeHtml(col.sectorId)}</span>
    </div>`;
    })
    .join('');
}

function renderRosterHtml(summary: PlanetSummaryV1, selectedSectorId: string): string {
  const rows = buildCombinedRosterRows(summary);
  if (rows.length === 0) {
    return `<div class="ar-roster-empty">NO COLONIES IN ${escapeHtml(selectedSectorId)} · ALL DROP SITES OPEN</div>`;
  }
  const sortOrder = (a: RosterDisplayRow, b: RosterDisplayRow) => {
    if (a.isBot !== b.isBot) return a.isBot ? 1 : -1;
    return a.sectorId.localeCompare(b.sectorId);
  };
  const inSectorRows = rows.filter((r) => r.sectorId === selectedSectorId).sort(sortOrder);
  const otherRows = rows.filter((r) => r.sectorId !== selectedSectorId).sort(sortOrder);

  if (inSectorRows.length === 0) {
    const emptyBanner = `<div class="ar-roster-empty">NO COLONIES IN ${escapeHtml(selectedSectorId)} · OPEN FOR DROP</div>`;
    const otherHtml = renderRosterRowsHtml(otherRows.slice(0, 3), ' is-other-sector');
    return `<div class="ar-roster">${emptyBanner}${otherHtml}</div>`;
  }
  const shownIn = inSectorRows.slice(0, 5);
  const shownOther = shownIn.length < 5 ? otherRows.slice(0, 5 - shownIn.length) : [];
  const remaining = inSectorRows.length - shownIn.length + (otherRows.length - shownOther.length);
  const extra = remaining > 0 ? `<div class="ar-roster-more">+${remaining} MORE ON SURFACE</div>` : '';
  return `<div class="ar-roster">${renderRosterRowsHtml(shownIn, ' is-target-sector')}${renderRosterRowsHtml(shownOther, ' is-other-sector')}${extra}</div>`;
}

export function renderPresenceCardInnerHtml(
  summary: PlanetSummaryV1,
  activeColony: ActiveHomeColony | null,
  targetSectorId?: string,
  homeBaseSectorId?: string | null,
): string {
  const pop = resolvePlanetPopulationCounts(summary);
  const popMap = resolveSectorPopulationMap(summary);
  const selectedSecId = targetSectorId ?? summary.sectors.find((s) => s.kind === 'land')?.sectorId ?? 'sec_0_0';
  const selectedSec = summary.sectors.find((s) => s.sectorId === selectedSecId);
  const secFree = selectedSec?.freeSeats ?? 0;
  const secCap = selectedSec?.validatedCapacity ?? 4;
  const secRes = selectedSec?.mainResource ?? 'metals.t1';
  const focusSec = popMap.get(selectedSecId);
  const focusPlayers = focusSec?.players ?? 0;
  const focusBots = focusSec?.bots ?? 0;
  const isHomeSelected = Boolean(homeBaseSectorId && selectedSecId === homeBaseSectorId);

  const onlineTag = pop.online > 0 ? `<span class="ar-live-pill"><i></i>${pop.online} LIVE</span>` : '<span class="ar-dim-pill">ORBIT LINK</span>';
  const sectorBanner = isHomeSelected
    ? `<div class="ar-home-callout is-selected-sector">SELECTED · ${escapeHtml(selectedSecId)} · YOUR BASE${activeColony ? ` (${escapeHtml(activeColony.colonyName)})` : ''}</div>`
    : `<div class="ar-home-callout is-selected-sector">SELECTED SECTOR · ${escapeHtml(selectedSecId)} · ${secFree}/${secCap} ZONES OPEN · ${escapeHtml(formatPrimaryResource(secRes))}</div>${
        activeColony
          ? `<div class="ar-home-callout is-base-note">BASE: ${escapeHtml(activeColony.colonyName)} (${escapeHtml(homeBaseSectorId ?? 'sec_0_0')})</div>`
          : ''
      }`;

  return `<div class="ar-card-scanlines scanlines"></div>
    <div class="ar-eyebrow"><span>SURFACE TELEMETRY // ${escapeHtml(selectedSecId)}</span>${onlineTag}</div>
    ${sectorBanner}
    <div class="ar-kpi-row">
      <div class="ar-kpi is-player">
        <span class="ar-kpi-label">PLAYERS</span>
        <b class="ar-kpi-val" data-testid="ar-players-count">${pop.players}</b>
        <span class="ar-kpi-sub">${focusPlayers} in ${escapeHtml(selectedSecId)} · ${pop.online} online</span>
      </div>
      <div class="ar-kpi is-bot">
        <span class="ar-kpi-label">AI BOTS</span>
        <b class="ar-kpi-val" data-testid="ar-bots-count">${pop.bots}</b>
        <span class="ar-kpi-sub">${focusBots} in ${escapeHtml(selectedSecId)} · surface total</span>
      </div>
    </div>
    <div class="ar-zone-bar">
      <div class="ar-zone-head">
        <span class="ar-k">SECTOR ${escapeHtml(selectedSecId)} OCCUPANCY</span>
        <b class="ar-v">${focusPlayers} PLAYERS · ${focusBots} BOTS</b>
      </div>
      <div class="ar-zone-sub">${secFree} / ${secCap} drop zones open in ${escapeHtml(selectedSecId)} (${pop.openZones}/${pop.totalZones} planet-wide)</div>
    </div>
    ${renderRosterHtml(summary, selectedSecId)}`;
}

export function renderLaunchCardShellHtml(
  kind: PlanetKind,
  summary: PlanetSummaryV1,
  intent: SectorIntentV1,
  queuePaused: boolean,
  activeColony: ActiveHomeColony | null,
  homeBaseSectorId: string | null = null,
): string {
  const sectorChooser = renderSectorChooserHtml(kind, summary, intent, queuePaused, homeBaseSectorId);
  const btnText = activeColony ? 'ENTER COLONY' : 'DEPLOY';
  const statusPill =
    summary.availability !== 'open'
      ? `<span class="ar-code">${summary.availability.toUpperCase()}</span>`
      : '';
  return `<div class="ar-card-scanlines scanlines"></div>
    <div class="ar-eyebrow"><span>DROP VECTOR // INSERTION</span>${statusPill}</div>
    <div id="sector-picker-host">${sectorChooser}</div>
    <div id="menu-err"></div>
    <button type="button" class="btn btn-primary btn-lg" id="deploy">${btnText}</button>`;
}
