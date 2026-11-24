import {
  CANONICAL_PLANETS,
  PATRONAGE_PLANET_IDS,
  patronagePlanetName,
  type PatronContenderRow,
  type PatronHistoryEventKind,
  type PatronHistoryRow,
  type PlanetPatronCompetitionView,
  type PlanetaryPatronageView,
  type StakingPerformanceResponse,
} from '@terra/contracts';
import { el } from '../../../../dom';
import { formatNear } from '../../stakingMath';
import './patronTables.css';

export type PatronHistoryScope = 'planet' | 'all';

export interface PatronTablesHandle {
  readonly el: HTMLElement;
  setPlanet(planetId: string): void;
}

const EVENT_LABEL: Readonly<Record<PatronHistoryEventKind, string>> = {
  seat_claimed: 'Claimed Seat',
  seat_overtaken: 'Overtaken',
  seat_vacated: 'Seat Vacated',
  nominated: 'Nominated',
  fee_payout: '15% Fee Payout',
};

const STATUS_LABEL: Readonly<Record<PatronContenderRow['status'], string>> = {
  lead: '★ LEAD PATRON',
  contender: 'ELIGIBLE · T4',
  below_threshold: '<500 NEAR',
};

const STATUS_CLASS: Readonly<Record<PatronContenderRow['status'], string>> = {
  lead: 'is-lead',
  contender: 'is-contender',
  below_threshold: 'is-below',
};

const emptyPatronage = (): PlanetaryPatronageView => ({
  nominatedPlanetId: null,
  planets: PATRONAGE_PLANET_IDS.map((planetId) => ({
    planetId,
    leadPatron: null,
    stakeToLeadNear: '500',
    totalContenders: 0,
    contenders: [],
    history: [],
  })),
});

function formatUtc(atMs: number): string {
  return new Date(atMs).toISOString().slice(0, 16).replace('T', ' ');
}

function formatHistoryDetails(r: PatronHistoryRow): string {
  if (r.kind === 'fee_payout') return `+$${(r.payoutUsd ?? 0).toFixed(2)} USDC`;
  if (r.kind === 'seat_overtaken') {
    const prev = r.previousAccountId ?? 'incumbent';
    const prevAmt = r.previousStakedNear ? ` (${formatNear(Number(r.previousStakedNear))} NEAR)` : '';
    return `${formatNear(Number(r.activeStakedNear))} NEAR · beat ${prev}${prevAmt}`;
  }
  if (r.kind === 'seat_vacated') {
    const prevAmt = r.previousStakedNear ? ` (was ${formatNear(Number(r.previousStakedNear))} NEAR)` : '';
    return `Dropped to ${formatNear(Number(r.activeStakedNear))} NEAR${prevAmt}`;
  }
  if (r.kind === 'seat_claimed') return `${formatNear(Number(r.activeStakedNear))} NEAR`;
  return `${formatNear(Number(r.activeStakedNear))} NEAR active`;
}

function competitionRow(r: PatronContenderRow, hasLead: boolean): HTMLElement {
  const youBadge = r.isSelf ? el('span', { className: 'ta-stk-patron-you' }, 'YOU') : null;
  const statusPill = el(
    'span',
    { className: `ta-stk-patron-status-pill ${STATUS_CLASS[r.status]}` },
    r.status === 'below_threshold' ? `${STATUS_LABEL[r.status]} · T${r.tier}` : STATUS_LABEL[r.status],
  );
  const gapText =
    r.status === 'lead'
      ? 'SEAT HELD'
      : hasLead
        ? `+${formatNear(Number(r.gapToLeadNear))} NEAR`
        : `+${formatNear(Number(r.gapToLeadNear))} to claim`;
  return el(
    'tr',
    {
      className: r.isSelf ? 'is-self' : undefined,
      dataset: {
        testid: 'staking-patron-contender-row',
        account: r.accountId,
        status: r.status,
        self: r.isSelf ? '1' : '0',
      },
    },
    el('td', { className: 'ta-stk-patron-mono' }, `#${r.rank}`),
    el(
      'td',
      {},
      el('div', { className: 'ta-stk-patron-pilot' }, el('span', {}, r.accountId), youBadge),
      el('div', { className: 'ta-stk-patron-carrier' }, r.carrierName),
    ),
    el('td', { className: 'ta-stk-patron-mono' }, `${formatNear(Number(r.activeStakedNear))} NEAR`),
    el('td', {}, statusPill),
    el('td', { className: 'ta-stk-patron-mono' }, gapText),
  );
}

function historyRow(r: PatronHistoryRow): HTMLElement {
  const kindPill = el('span', { className: `ta-stk-patron-kind is-${r.kind}` }, EVENT_LABEL[r.kind]);
  return el(
    'tr',
    {
      dataset: {
        testid: 'staking-patron-history-row',
        kind: r.kind,
        planet: r.planetId,
      },
    },
    el('td', { className: 'ta-stk-patron-mono' }, formatUtc(r.atMs)),
    el('td', {}, patronagePlanetName(r.planetId)),
    el('td', {}, kindPill),
    el(
      'td',
      {},
      el('div', { className: 'ta-stk-patron-pilot' }, r.accountId),
      el('div', { className: 'ta-stk-patron-carrier' }, r.carrierName),
    ),
    el('td', { className: 'ta-stk-patron-mono' }, formatHistoryDetails(r)),
  );
}

function renderCompetitionBox(view: PlanetPatronCompetitionView): HTMLElement {
  const planetLabel = patronagePlanetName(view.planetId).toUpperCase();
  const lead = view.leadPatron;
  const summaryText = lead
    ? `Lead: ${lead.carrierName} (${formatNear(Number(lead.activeStakedNear))} NEAR) · >${formatNear(Number(lead.activeStakedNear))} NEAR to overtake`
    : 'Seat vacant · ≥500 NEAR to claim';

  const emptyCell = el('td', { className: 'ta-stk-sub' }, 'No nominations yet — stake ≥500 NEAR and nominate to claim this world.');
  emptyCell.colSpan = 5;

  const table = el(
    'table',
    { className: 'ta-stk-table ta-stk-patron-table', dataset: { testid: 'staking-patron-competition-table' } },
    el('thead', {}, el('tr', {}, ...['RANK', 'PILOT / FLAGSHIP', 'ACTIVE STAKE', 'STATUS', 'TO LEAD'].map((h) => el('th', {}, h)))),
    el('tbody', {}, ...(view.contenders.length === 0 ? [el('tr', {}, emptyCell)] : view.contenders.map((r) => competitionRow(r, lead !== null)))),
  );

  return el(
    'div',
    { className: 'plate-sm ta-stk-patron-panel', dataset: { testid: 'staking-patron-competition', planet: view.planetId } },
    el(
      'div',
      { className: 'ta-stk-patron-panel-head' },
      el('span', { className: 'label', dataset: { testid: 'staking-patron-competition-title' } }, `CURRENT COMPETITION · ${planetLabel}`),
      el('span', { className: 'ta-stk-patron-summary', dataset: { testid: 'staking-patron-competition-summary' } }, summaryText),
    ),
    el('div', { className: 'ta-stk-scroll' }, table),
  );
}

function renderHistoryBox(
  patronage: PlanetaryPatronageView,
  planetId: string,
  scope: PatronHistoryScope,
  onToggleScope: () => void,
): HTMLElement {
  const rows: readonly PatronHistoryRow[] =
    scope === 'all'
      ? patronage.planets.flatMap((pl) => pl.history).sort((a, b) => b.atMs - a.atMs).slice(0, 25)
      : (patronage.planets.find((pl) => pl.planetId === planetId)?.history ?? []);

  const title =
    scope === 'all'
      ? 'PATRONAGE HISTORY · ALL 3 WORLDS'
      : `PATRONAGE HISTORY · ${patronagePlanetName(planetId).toUpperCase()}`;

  const countLabel = `${rows.length} ${rows.length === 1 ? 'event' : 'events'}`;
  const scopeBtn = el(
    'button',
    {
      type: 'button',
      className: `btn btn-sm ${scope === 'all' ? 'btn-primary' : 'btn-ghost'} ta-stk-patron-scope-btn`,
      aria: { pressed: scope === 'all' ? 'true' : 'false' },
      dataset: {
        testid: 'staking-patron-history-scope',
        scope,
        taArea: 'staking',
        taAction: 'toggle_patron_history_scope',
      },
      onClick: onToggleScope,
    },
    scope === 'all' ? 'ALL 3 WORLDS' : 'THIS WORLD',
  );

  const emptyCell = el('td', { className: 'ta-stk-sub' }, 'No patronage events recorded yet.');
  emptyCell.colSpan = 5;

  const table = el(
    'table',
    { className: 'ta-stk-table ta-stk-patron-table', dataset: { testid: 'staking-patron-history-table' } },
    el('thead', {}, el('tr', {}, ...['WHEN (UTC)', 'WORLD', 'EVENT', 'PILOT', 'DETAILS'].map((h) => el('th', {}, h)))),
    el('tbody', {}, ...(rows.length === 0 ? [el('tr', {}, emptyCell)] : rows.map(historyRow))),
  );

  return el(
    'div',
    { className: 'plate-sm ta-stk-patron-panel', dataset: { testid: 'staking-patron-history', scope } },
    el(
      'div',
      { className: 'ta-stk-patron-panel-head' },
      el('span', { className: 'label', dataset: { testid: 'staking-patron-history-title' } }, title),
      el('div', { className: 'ta-stk-chips' }, el('span', { className: 'ta-stk-patron-count' }, countLabel), scopeBtn),
    ),
    el('div', { className: 'ta-stk-scroll' }, table),
  );
}

/** Side-by-side King-of-the-Hill Current Competition & Patronage History tables synced with the selected planet. */
export function renderPatronTables(
  p: StakingPerformanceResponse,
  initialPlanetId: string,
  initialScope: PatronHistoryScope = 'planet',
): PatronTablesHandle {
  const patronage = p.patronage ?? emptyPatronage();
  let currentPlanetId =
    patronage.planets.some((pl) => pl.planetId === initialPlanetId)
      ? initialPlanetId
      : (patronage.planets[0]?.planetId ?? CANONICAL_PLANETS.temperate.id);
  let scope: PatronHistoryScope = initialScope;

  const root = el('div', { className: 'ta-stk-patron-tables', dataset: { testid: 'staking-patron-tables' } });

  const draw = (): void => {
    const view =
      patronage.planets.find((pl) => pl.planetId === currentPlanetId) ??
      emptyPatronage().planets.find((pl) => pl.planetId === currentPlanetId) ??
      emptyPatronage().planets[0]!;
    root.replaceChildren(
      renderCompetitionBox(view),
      renderHistoryBox(patronage, currentPlanetId, scope, () => {
        scope = scope === 'planet' ? 'all' : 'planet';
        draw();
      }),
    );
  };

  draw();
  return {
    el: root,
    setPlanet(planetId: string) {
      if (!planetId || planetId === currentPlanetId) return;
      currentPlanetId = planetId;
      draw();
    },
  };
}
