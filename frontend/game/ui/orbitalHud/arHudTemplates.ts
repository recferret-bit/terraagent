import type { PlanetSummaryV1 } from '@terra/contracts';
import { PLANET_SPECS, type PlanetKind } from '@terra/render/planets/PlanetSpec';
import {
  canFoundAnotherColony,
  type ActiveHomeColony,
  type PilotColonyRoster,
} from '../../../design/pilot/activeHomeColony';
import { resolvePlanetPopulationCounts, type SectorIntentV1 } from '../lobby/orbitalPickerModel';
import { renderSectorChooserHtml } from '../lobby/sectorChooser';
import { resolveColonySectorOnSummary, resolveSectorPopulationMap } from './sectorGlobeMap';

export const NEW_COLONY_SELECTION_ID = '__new__' as const;

export interface OrbitalDeployAction {
  readonly allowed: boolean;
  readonly mode: 'enter' | 'new' | 'locked';
  readonly colony: ActiveHomeColony | null;
  readonly buttonLabel: string;
  readonly ownedOnPlanet: readonly ActiveHomeColony[];
  readonly ownedSectorIds: readonly string[];
  readonly lockNotice: string | null;
}

export function resolveOrbitalDeployAction(opts: {
  readonly kind: PlanetKind;
  readonly summary: PlanetSummaryV1;
  readonly intent: SectorIntentV1;
  readonly activeColony: ActiveHomeColony | null;
  readonly colonyRoster?: PilotColonyRoster | null;
  readonly selectedColonyId?: string | null;
}): OrbitalDeployAction {
  const { kind, summary, intent, activeColony, colonyRoster, selectedColonyId } = opts;
  const allColonies = colonyRoster && colonyRoster.colonies.length > 0 ? colonyRoster.colonies : activeColony ? [activeColony] : [];
  const ownedOnPlanet = allColonies.filter((c) => c.kind === kind);
  const ownedBySector = new Map<string, ActiveHomeColony>();
  for (const col of ownedOnPlanet) {
    const sid = resolveColonySectorOnSummary(summary, col);
    if (sid && !ownedBySector.has(sid)) ownedBySector.set(sid, col);
  }
  const ownedSectorIds = [...ownedBySector.keys()];
  const canExpand = colonyRoster ? canFoundAnotherColony(colonyRoster) : allColonies.length === 0;
  const isNewMode = canExpand && selectedColonyId === NEW_COLONY_SELECTION_ID;

  if (allColonies.length === 0) {
    return { allowed: true, mode: 'new', colony: null, buttonLabel: 'DEPLOY', ownedOnPlanet, ownedSectorIds, lockNotice: null };
  }
  if (ownedOnPlanet.length === 0) {
    if (canExpand) {
      return { allowed: true, mode: 'new', colony: null, buttonLabel: 'DEPLOY NEW COLONY', ownedOnPlanet, ownedSectorIds, lockNotice: null };
    }
    const maxSlots = colonyRoster?.slots.max ?? 1;
    const lockNotice = colonyRoster?.slots.isStaker
      ? `All ${maxSlots}/${maxSlots} NEAR.AI colony slots are active — stake more NEAR on /me to unlock additional colonies.`
      : 'Multiple colonies require NEAR staking (Tier 2 · 50+ NEAR on /me for 3 NEAR.AI colony slots).';
    return { allowed: false, mode: 'locked', colony: null, buttonLabel: 'ENTER COLONY', ownedOnPlanet, ownedSectorIds, lockNotice };
  }
  if (isNewMode) {
    const landSectors = summary.sectors.filter((s) => s.kind === 'land');
    if (landSectors.length > 0 && landSectors.every((s) => ownedBySector.has(s.sectorId))) {
      return {
        allowed: false, mode: 'locked', colony: null, buttonLabel: 'SAME SECTOR LOCKED', ownedOnPlanet, ownedSectorIds,
        lockNotice: 'You already operate a colony in every land sector on this planet — choose another planet or select a colony above.',
      };
    }
    if (intent.mode === 'auto') {
      return { allowed: true, mode: 'new', colony: null, buttonLabel: 'DEPLOY NEW COLONY', ownedOnPlanet, ownedSectorIds, lockNotice: null };
    }
    const occupiedHere = ownedBySector.get(intent.sectorId);
    if (occupiedHere) {
      return {
        allowed: false, mode: 'locked', colony: null, buttonLabel: 'SAME SECTOR LOCKED', ownedOnPlanet, ownedSectorIds,
        lockNotice: `Colony ${occupiedHere.colonyName} already occupies ${intent.sectorId.toUpperCase()} — two colonies cannot share a sector. Pick an open sector or select ${occupiedHere.colonyName} above.`,
      };
    }
    return { allowed: true, mode: 'new', colony: null, buttonLabel: 'DEPLOY NEW COLONY', ownedOnPlanet, ownedSectorIds, lockNotice: null };
  }
  if (intent.mode === 'auto') {
    const selectedMatch = selectedColonyId
      ? ownedOnPlanet.find((c) => c.colonyId === selectedColonyId)
      : undefined;
    return { allowed: true, mode: 'enter', colony: selectedMatch ?? ownedOnPlanet[0]!, buttonLabel: 'ENTER COLONY', ownedOnPlanet, ownedSectorIds, lockNotice: null };
  }
  const matchedOwned =
    (selectedColonyId
      ? ownedOnPlanet.find(
          (c) =>
            c.colonyId === selectedColonyId &&
            resolveColonySectorOnSummary(summary, c) === intent.sectorId,
        )
      : undefined) ?? ownedBySector.get(intent.sectorId);
  if (matchedOwned) {
    return { allowed: true, mode: 'enter', colony: matchedOwned, buttonLabel: 'ENTER COLONY', ownedOnPlanet, ownedSectorIds, lockNotice: null };
  }
  if (canExpand) {
    return { allowed: true, mode: 'new', colony: null, buttonLabel: 'DEPLOY NEW COLONY', ownedOnPlanet, ownedSectorIds, lockNotice: null };
  }
  const firstSec = (ownedSectorIds[0] ?? 'sec_0_0').toUpperCase();
  const secList = ownedSectorIds.map((s) => s.toUpperCase()).join(', ') || firstSec;
  const notice =
    colonyRoster?.slots.isStaker && (colonyRoster.slots.max ?? 1) > 1
      ? `All ${colonyRoster.slots.used}/${colonyRoster.slots.max} NEAR.AI colony slots are active — select ${secList} to enter, or stake more NEAR on /me.`
      : `Colony ${ownedOnPlanet[0]!.colonyName} is deployed in ${firstSec} — select ${firstSec} to enter (or stake 50+ NEAR on /me for multi-colony slots).`;
  return { allowed: false, mode: 'locked', colony: null, buttonLabel: 'ENTER COLONY', ownedOnPlanet, ownedSectorIds, lockNotice: notice };
}

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
  colonyRoster?: PilotColonyRoster | null,
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

  const ownedOnPlanet = (colonyRoster?.colonies ?? (activeColony ? [activeColony] : [])).filter(
    (c) => resolveColonySectorOnSummary(summary, c) !== null,
  );
  const ownedHere = ownedOnPlanet.find((c) => resolveColonySectorOnSummary(summary, c) === selectedSecId) ?? null;
  const isHomeSelected = Boolean(ownedHere || (homeBaseSectorId && selectedSecId === homeBaseSectorId));
  const canExpand = colonyRoster ? canFoundAnotherColony(colonyRoster) : false;

  const onlineTag = pop.online > 0 ? `<span class="ar-live-pill"><i></i>${pop.online} LIVE</span>` : '<span class="ar-dim-pill">ORBIT LINK</span>';
  const slotsNote =
    colonyRoster && colonyRoster.colonies.length > 0
      ? canExpand
        ? `<div class="ar-home-callout is-base-note">NEAR.AI SLOTS: ${colonyRoster.colonies.length}/${colonyRoster.slots.max} ACTIVE · PICK ANY OTHER SECTOR OR PLANET TO DEPLOY</div>`
        : ownedOnPlanet.length > 0 && !isHomeSelected
          ? `<div class="ar-home-callout is-base-note">BASE: ${escapeHtml((ownedOnPlanet[0] ?? activeColony)!.colonyName)} (${escapeHtml(homeBaseSectorId ?? 'sec_0_0')})</div>`
          : ''
      : activeColony && !isHomeSelected
        ? `<div class="ar-home-callout is-base-note">BASE: ${escapeHtml(activeColony.colonyName)} (${escapeHtml(homeBaseSectorId ?? 'sec_0_0')})</div>`
        : '';

  const sectorBanner = isHomeSelected
    ? `<div class="ar-home-callout is-selected-sector">SELECTED · ${escapeHtml(selectedSecId)} · YOUR BASE${
        ownedHere ?? activeColony ? ` (${escapeHtml((ownedHere ?? activeColony)!.colonyName)})` : ''
      }${canExpand ? ' · SAME-SECTOR FOUNDING LOCKED' : ''}</div>${slotsNote}`
    : `<div class="ar-home-callout is-selected-sector">SELECTED SECTOR · ${escapeHtml(selectedSecId)} · ${secFree}/${secCap} ZONES OPEN · ${escapeHtml(formatPrimaryResource(secRes))}</div>${slotsNote}`;

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

export function renderColonyPickerHtml(
  summary: PlanetSummaryV1,
  ownedOnPlanet: readonly ActiveHomeColony[],
  selectedColonyId?: string | null,
  canExpand = false,
): string {
  if (ownedOnPlanet.length === 0 || (ownedOnPlanet.length === 1 && !canExpand)) return '';
  const isNewActive = canExpand && selectedColonyId === NEW_COLONY_SELECTION_ID;
  const activeId = isNewActive
    ? NEW_COLONY_SELECTION_ID
    : selectedColonyId && ownedOnPlanet.some((c) => c.colonyId === selectedColonyId)
      ? selectedColonyId
      : ownedOnPlanet[0]!.colonyId;
  const buttons = ownedOnPlanet
    .map((col) => {
      const secId = resolveColonySectorOnSummary(summary, col) ?? col.foundingSectorId ?? 'sec_0_0';
      const sel = col.colonyId === activeId;
      return `<button type="button" class="sector-opt colony-opt plate-sm${sel ? ' sel' : ''}" data-testid="orbital-colony-opt-${escapeHtml(col.colonyId)}" data-colony-id="${escapeHtml(col.colonyId)}" data-sector-id="${escapeHtml(secId)}" aria-pressed="${sel ? 'true' : 'false'}"><span class="sector-opt-id">${escapeHtml(col.colonyName)}</span><span class="sector-opt-seats">${escapeHtml(secId.toUpperCase())}</span></button>`;
    })
    .join('');
  const newBtn = canExpand
    ? `<button type="button" class="sector-opt colony-opt colony-opt-new plate-sm${isNewActive ? ' sel' : ''}" data-testid="orbital-colony-opt-new" data-colony-id="${NEW_COLONY_SELECTION_ID}" data-sector-id="auto" aria-pressed="${isNewActive ? 'true' : 'false'}"><span class="sector-opt-id">+ NEW COLONY</span><span class="sector-opt-seats">OPEN SECTOR</span></button>`
    : '';
  return `<div class="colony-picker" data-testid="orbital-colony-picker"><div class="sector-picker-head"><span class="field-label">ACTIVE COLONIES ON WORLD · ${ownedOnPlanet.length}</span></div><div class="colony-options" role="radiogroup" aria-label="Colony on selected planet">${buttons}${newBtn}</div></div>`;
}

export function renderLaunchCardShellHtml(
  kind: PlanetKind,
  summary: PlanetSummaryV1,
  intent: SectorIntentV1,
  queuePaused: boolean,
  activeColony: ActiveHomeColony | null,
  homeBaseSectorIdOrList: string | readonly string[] | null = null,
): string {
  const sectorChooser = renderSectorChooserHtml(kind, summary, intent, queuePaused, homeBaseSectorIdOrList);
  const btnText = activeColony ? 'ENTER COLONY' : 'DEPLOY';
  const statusPill =
    summary.availability !== 'open'
      ? `<span class="ar-code">${summary.availability.toUpperCase()}</span>`
      : '';
  return `<div class="ar-card-scanlines scanlines"></div>
    <div class="ar-eyebrow"><span>DROP VECTOR // INSERTION</span>${statusPill}</div>
    <div id="colony-picker-host" hidden></div>
    <div id="sector-picker-host">${sectorChooser}</div>
    <div id="menu-err"></div>
    <button type="button" class="btn btn-primary btn-lg" id="deploy">${btnText}</button>`;
}
