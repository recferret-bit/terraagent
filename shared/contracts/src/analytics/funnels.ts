/** PostHog insight spec. Pinned rows belong on the product board. Windows are conversion windows, not chart ranges. */

export type AnalyticsDashboardKey = 'exec' | 'gameplay' | 'economy' | 'health';
export type AnalyticsTrendDisplay = 'ActionsLineGraph' | 'ActionsBar' | 'ActionsBarValue' | 'ActionsTable' | 'WorldMap' | 'BoldNumber';

export interface AnalyticsWhere {
  readonly key: string;
  readonly value: string;
}

export interface AnalyticsFunnelStep {
  readonly event: string;
  readonly where?: readonly AnalyticsWhere[];
}

export interface AnalyticsFunnelSpec {
  readonly id: string;
  readonly title: string;
  readonly window: { readonly interval: number; readonly unit: 'minute' | 'hour' | 'day' };
  readonly steps: readonly AnalyticsFunnelStep[];
  readonly breakdown?: string;
  /** Person who hits this event between the steps is left out of the funnel. */
  readonly exclusion?: string;
  readonly dashboard?: AnalyticsDashboardKey;
  readonly pin: boolean;
}

export interface AnalyticsTrendSpec {
  readonly id: string;
  readonly title: string;
  readonly event: string;
  /** `dau` / `wau` are unique anon or identified people. `total` is event count. */
  readonly math: 'dau' | 'wau' | 'total';
  readonly breakdown?: string;
  readonly where?: readonly AnalyticsWhere[];
  readonly display?: AnalyticsTrendDisplay;
  readonly dashboard?: AnalyticsDashboardKey;
  readonly pin: boolean;
}

export interface AnalyticsRetentionSpec {
  readonly id: string;
  readonly title: string;
  readonly targetEvent: string;
  readonly returningEvent: string;
  readonly period: 'Day' | 'Week';
  readonly totalIntervals?: number;
  readonly where?: readonly AnalyticsWhere[];
  readonly dashboard?: AnalyticsDashboardKey;
  readonly pin: boolean;
}

const prod = { key: 'runtime', value: 'prod' } as const;
const step = (event: string, where?: readonly AnalyticsWhere[]): AnalyticsFunnelStep => (where ? { event, where } : { event });

export const ANALYTICS_FUNNELS: readonly AnalyticsFunnelSpec[] = [
  {
    id: 'acquisition', title: 'TA · Landing to signed in', pin: true, dashboard: 'exec',
    window: { interval: 24, unit: 'hour' }, breakdown: 'method',
    steps: [
      step('surface_viewed', [{ key: 'surface', value: 'landing' }, prod]),
      step('auth_started', [prod]),
      step('auth_succeeded', [prod]),
      step('auth_completed'),
    ],
  },
  {
    id: 'acquisition-fail', title: 'TA · Sign-in failed', pin: true, dashboard: 'health',
    window: { interval: 1, unit: 'hour' }, breakdown: 'reason', exclusion: 'auth_succeeded',
    steps: [step('auth_started', [prod]), step('auth_failed', [prod])],
  },
  {
    id: 'landing-to-play', title: 'TA · Landing CTA to first command', pin: true, dashboard: 'exec',
    window: { interval: 2, unit: 'hour' }, breakdown: 'viewport',
    steps: [
      step('surface_viewed', [{ key: 'surface', value: 'landing' }, prod]),
      step('ui_action_clicked', [{ key: 'surface', value: 'landing' }, prod]),
      step('play_booted', [prod]),
      step('colony_entered', [prod]),
      step('gameplay_first_command', [prod]),
    ],
  },
  {
    id: 'whitepaper-to-play', title: 'TA · Whitepaper to play', pin: true, dashboard: 'exec',
    window: { interval: 24, unit: 'hour' },
    steps: [
      step('surface_viewed', [{ key: 'surface', value: 'whitepaper' }, prod]),
      step('ui_action_clicked', [{ key: 'surface', value: 'whitepaper' }, prod]),
      step('play_booted', [prod]),
    ],
  },
  {
    id: 'pitchdeck-to-play', title: 'TA · Pitch deck to play', pin: true, dashboard: 'exec',
    window: { interval: 24, unit: 'hour' },
    steps: [
      step('surface_viewed', [{ key: 'surface', value: 'pitchdeck' }, prod]),
      step('ui_action_clicked', [{ key: 'surface', value: 'pitchdeck' }, prod]),
      step('play_booted', [prod]),
    ],
  },
  {
    id: 'country-acquisition', title: 'TA · Visitor to colony by country', pin: true, dashboard: 'exec',
    window: { interval: 24, unit: 'hour' }, breakdown: '$geoip_country_name',
    steps: [
      step('surface_viewed', [prod]),
      step('auth_succeeded', [prod]),
      step('colony_entered', [prod]),
    ],
  },
  {
    id: 'planet', title: 'TA · Planet to colony', pin: true, dashboard: 'gameplay',
    window: { interval: 1, unit: 'hour' }, breakdown: 'planet',
    steps: [
      step('planet_picker_viewed', [prod]),
      step('planet_selected', [prod]),
      step('descent_started', [prod]),
      step('colony_entered', [prod]),
    ],
  },
  {
    id: 'planet-fail', title: 'TA · Colony enter failed', pin: true, dashboard: 'health',
    window: { interval: 1, unit: 'hour' }, breakdown: 'reason', exclusion: 'colony_entered',
    steps: [step('planet_selected', [prod]), step('colony_enter_failed', [prod])],
  },
  {
    id: 'colony-hud-to-command', title: 'TA · Colony HUD to action', pin: true, dashboard: 'gameplay',
    window: { interval: 1, unit: 'hour' }, breakdown: 'panel',
    steps: [
      step('colony_entered', [prod]),
      step('hud_panel_opened', [prod]),
      step('ui_action_clicked', [{ key: 'surface', value: 'play' }, prod]),
      step('gameplay_first_command', [prod]),
    ],
  },
  {
    id: 'trade', title: 'TA · Trade ticket to fill', pin: true, dashboard: 'economy',
    window: { interval: 30, unit: 'minute' },
    steps: [
      step('trade_page_viewed', [prod]),
      step('trade_ticket_opened', [prod]),
      step('trade_submit_clicked', [prod]),
      step('trade_order_accepted'),
    ],
  },
  {
    id: 'trade-fail', title: 'TA · Trade submit failed', pin: true, dashboard: 'health',
    window: { interval: 30, unit: 'minute' }, breakdown: 'reason', exclusion: 'trade_order_accepted',
    steps: [step('trade_submit_clicked', [prod]), step('trade_order_failed')],
  },
  {
    id: 'market', title: 'TA · In-game market', pin: true, dashboard: 'economy',
    window: { interval: 30, unit: 'minute' },
    steps: [
      step('market_tab_opened'),
      step('market_order_previewed'),
      step('market_order_placed'),
      step('market_trade_settled'),
    ],
  },
  {
    id: 'gameplay', title: 'TA · Play to first command', pin: true, dashboard: 'gameplay',
    window: { interval: 2, unit: 'hour' },
    steps: [step('play_booted', [prod]), step('colony_entered', [prod]), step('gameplay_first_command', [prod])],
  },
  {
    id: 'gameplay-fail', title: 'TA · Play boot failed', pin: true, dashboard: 'health',
    window: { interval: 30, unit: 'minute' }, breakdown: 'reason', exclusion: 'colony_entered',
    steps: [step('surface_viewed', [{ key: 'surface', value: 'play' }, prod]), step('play_boot_failed', [prod])],
  },
  {
    id: 'profile', title: 'TA · Profile section', pin: true, dashboard: 'economy',
    window: { interval: 1, unit: 'hour' }, breakdown: 'section',
    steps: [step('profile_viewed', [prod]), step('profile_section_opened', [prod])],
  },
  {
    id: 'profile-fail', title: 'TA · Profile failed to load', pin: true, dashboard: 'health',
    window: { interval: 15, unit: 'minute' }, breakdown: 'reason', exclusion: 'profile_viewed',
    steps: [step('surface_viewed', [{ key: 'surface', value: 'me' }, prod]), step('profile_load_failed', [prod])],
  },
];

export const ANALYTICS_TRENDS: readonly AnalyticsTrendSpec[] = [
  { id: 'visitors', title: 'TA · Visitors (DAU by surface)', event: 'surface_viewed', math: 'dau', breakdown: 'surface', where: [prod], display: 'ActionsLineGraph', dashboard: 'exec', pin: true },
  { id: 'visitors-wau', title: 'TA · Weekly active visitors (WAU)', event: 'surface_viewed', math: 'wau', breakdown: 'surface', where: [prod], display: 'ActionsLineGraph', dashboard: 'exec', pin: true },
  { id: 'pageviews-by-surface', title: 'TA · Pageviews by surface', event: 'surface_viewed', math: 'total', breakdown: 'surface', where: [prod], display: 'ActionsBarValue', dashboard: 'exec', pin: true },
  { id: 'landing-visitors', title: 'TA · Landing visitors', event: 'surface_viewed', math: 'dau', where: [{ key: 'surface', value: 'landing' }, prod], display: 'ActionsLineGraph', dashboard: 'exec', pin: true },
  { id: 'visitors-by-country', title: 'TA · Visitors by country', event: 'surface_viewed', math: 'dau', breakdown: '$geoip_country_name', where: [prod], display: 'ActionsBarValue', dashboard: 'exec', pin: true },
  { id: 'country-world-map', title: 'TA · Global reach (country map)', event: 'surface_viewed', math: 'dau', breakdown: '$geoip_country_code', where: [prod], display: 'WorldMap', dashboard: 'exec', pin: true },
  { id: 'traffic-sources', title: 'TA · Traffic sources', event: 'surface_viewed', math: 'dau', breakdown: 'referrer_class', where: [prod], display: 'ActionsBarValue', dashboard: 'exec', pin: true },
  { id: 'utm-campaigns', title: 'TA · UTM sources', event: 'surface_viewed', math: 'dau', breakdown: 'utm_source', where: [prod], display: 'ActionsTable', dashboard: 'exec', pin: true },
  { id: 'viewport-split', title: 'TA · Desktop vs mobile', event: 'surface_viewed', math: 'dau', breakdown: 'viewport', where: [prod], display: 'ActionsBarValue', dashboard: 'exec', pin: true },
  { id: 'first-touch-visitors', title: 'TA · First-touch vs returning', event: 'surface_viewed', math: 'dau', breakdown: 'first_touch', where: [prod], display: 'ActionsBarValue', dashboard: 'exec', pin: true },
  { id: 'ui-actions-by-surface', title: 'TA · Button & CTA clicks by surface', event: 'ui_action_clicked', math: 'total', breakdown: 'surface', where: [prod], display: 'ActionsBarValue', dashboard: 'exec', pin: true },
  { id: 'ui-actions-top', title: 'TA · Top buttons & CTAs', event: 'ui_action_clicked', math: 'total', breakdown: 'action', where: [prod], display: 'ActionsTable', dashboard: 'gameplay', pin: true },
  { id: 'hud-panels-opened', title: 'TA · In-game HUD panels opened', event: 'hud_panel_opened', math: 'total', breakdown: 'panel', where: [prod], display: 'ActionsBarValue', dashboard: 'gameplay', pin: true },
  { id: 'gameplay-commands', title: 'TA · First gameplay commands', event: 'gameplay_first_command', math: 'total', breakdown: 'kind', where: [prod], display: 'ActionsBarValue', dashboard: 'gameplay', pin: true },
  { id: 'auth-method', title: 'TA · Sign-in by method', event: 'auth_succeeded', math: 'total', breakdown: 'method', where: [prod], display: 'ActionsBarValue', dashboard: 'economy', pin: true },
  { id: 'wallet-kind', title: 'TA · Wallet kind', event: 'auth_succeeded', math: 'total', breakdown: 'wallet_kind', where: [{ key: 'method', value: 'near-wallet' }, prod], display: 'ActionsBarValue', dashboard: 'economy', pin: true },
  { id: 'auth-failed-reason', title: 'TA · Sign-in failures', event: 'auth_failed', math: 'total', breakdown: 'reason', where: [prod], display: 'ActionsTable', dashboard: 'health', pin: true },
  { id: 'boot-failed-reason', title: 'TA · Boot failures', event: 'play_boot_failed', math: 'total', breakdown: 'reason', where: [prod], display: 'ActionsTable', dashboard: 'health', pin: true },
  { id: 'colony-failed-reason', title: 'TA · Colony enter failures', event: 'colony_enter_failed', math: 'total', breakdown: 'reason', where: [prod], display: 'ActionsTable', dashboard: 'health', pin: true },
  { id: 'trade-failed-reason', title: 'TA · Trade failures', event: 'trade_order_failed', math: 'total', breakdown: 'reason', display: 'ActionsTable', dashboard: 'health', pin: true },
  { id: 'gameplay-errors', title: 'TA · Gameplay errors', event: 'gameplay_error', math: 'total', breakdown: 'reason', where: [prod], display: 'ActionsTable', dashboard: 'health', pin: true },
  { id: 'client-errors', title: 'TA · Client errors', event: 'client_error', math: 'total', breakdown: 'reason', where: [prod], display: 'ActionsTable', dashboard: 'health', pin: true },
];

export const ANALYTICS_RETENTION: readonly AnalyticsRetentionSpec[] = [
  {
    id: 'visitor-retention', title: 'TA · Visitor D1–D7 retention', pin: true, dashboard: 'exec',
    targetEvent: 'surface_viewed', returningEvent: 'surface_viewed', period: 'Day', totalIntervals: 8, where: [prod],
  },
  {
    id: 'colony-retention', title: 'TA · Colony player retention', pin: true, dashboard: 'gameplay',
    targetEvent: 'colony_entered', returningEvent: 'colony_entered', period: 'Day', totalIntervals: 8, where: [prod],
  },
];
