/** PostHog insight spec. Pinned rows belong on the product board. Windows are conversion windows, not chart ranges. */

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
  readonly pin: boolean;
}

export interface AnalyticsTrendSpec {
  readonly id: string;
  readonly title: string;
  readonly event: string;
  /** `dau` is unique anon or identified people. `total` is event count. */
  readonly math: 'dau' | 'total';
  readonly breakdown?: string;
  readonly where?: readonly AnalyticsWhere[];
  readonly pin: boolean;
}

const prod = { key: 'runtime', value: 'prod' } as const;
const step = (event: string, where?: readonly AnalyticsWhere[]): AnalyticsFunnelStep => (where ? { event, where } : { event });

export const ANALYTICS_FUNNELS: readonly AnalyticsFunnelSpec[] = [
  {
    id: 'acquisition', title: 'TA · Landing to signed in', pin: true,
    window: { interval: 24, unit: 'hour' }, breakdown: 'method',
    steps: [
      step('surface_viewed', [{ key: 'surface', value: 'landing' }, prod]),
      step('auth_started', [prod]),
      step('auth_succeeded', [prod]),
      step('auth_completed'),
    ],
  },
  {
    id: 'acquisition-fail', title: 'TA · Sign-in failed', pin: true,
    window: { interval: 1, unit: 'hour' }, breakdown: 'reason', exclusion: 'auth_succeeded',
    steps: [step('auth_started', [prod]), step('auth_failed', [prod])],
  },
  {
    id: 'planet', title: 'TA · Planet to colony', pin: true,
    window: { interval: 1, unit: 'hour' }, breakdown: 'planet',
    steps: [
      step('planet_picker_viewed', [prod]),
      step('planet_selected', [prod]),
      step('descent_started', [prod]),
      step('colony_entered', [prod]),
    ],
  },
  {
    id: 'planet-fail', title: 'TA · Colony enter failed', pin: true,
    window: { interval: 1, unit: 'hour' }, breakdown: 'reason', exclusion: 'colony_entered',
    steps: [step('planet_selected', [prod]), step('colony_enter_failed', [prod])],
  },
  {
    id: 'trade', title: 'TA · Trade ticket to fill', pin: true,
    window: { interval: 30, unit: 'minute' },
    steps: [
      step('trade_page_viewed', [prod]),
      step('trade_ticket_opened', [prod]),
      step('trade_submit_clicked', [prod]),
      step('trade_order_accepted'),
    ],
  },
  {
    id: 'trade-fail', title: 'TA · Trade submit failed', pin: true,
    window: { interval: 30, unit: 'minute' }, breakdown: 'reason', exclusion: 'trade_order_accepted',
    steps: [step('trade_submit_clicked', [prod]), step('trade_order_failed')],
  },
  {
    id: 'market', title: 'TA · In-game market', pin: true,
    window: { interval: 30, unit: 'minute' },
    steps: [
      step('market_tab_opened'),
      step('market_order_previewed'),
      step('market_order_placed'),
      step('market_trade_settled'),
    ],
  },
  {
    id: 'gameplay', title: 'TA · Play to first command', pin: true,
    window: { interval: 2, unit: 'hour' },
    steps: [step('play_booted', [prod]), step('colony_entered', [prod]), step('gameplay_first_command', [prod])],
  },
  {
    id: 'gameplay-fail', title: 'TA · Play boot failed', pin: true,
    window: { interval: 30, unit: 'minute' }, breakdown: 'reason', exclusion: 'colony_entered',
    steps: [step('play_booted', [prod]), step('play_boot_failed', [prod])],
  },
  {
    id: 'profile', title: 'TA · Profile section', pin: true,
    window: { interval: 1, unit: 'hour' }, breakdown: 'section',
    steps: [step('profile_viewed', [prod]), step('profile_section_opened', [prod])],
  },
  {
    id: 'profile-fail', title: 'TA · Profile failed to load', pin: true,
    window: { interval: 15, unit: 'minute' }, breakdown: 'reason', exclusion: 'profile_viewed',
    steps: [step('surface_viewed', [{ key: 'surface', value: 'me' }, prod]), step('profile_load_failed', [prod])],
  },
];

export const ANALYTICS_TRENDS: readonly AnalyticsTrendSpec[] = [
  { id: 'visitors', title: 'TA · Visitors', event: 'surface_viewed', math: 'dau', breakdown: 'surface', where: [prod], pin: true },
  { id: 'landing-visitors', title: 'TA · Landing visitors', event: 'surface_viewed', math: 'dau', where: [{ key: 'surface', value: 'landing' }, prod], pin: true },
  { id: 'auth-method', title: 'TA · Sign-in by method', event: 'auth_succeeded', math: 'total', breakdown: 'method', where: [prod], pin: true },
  { id: 'wallet-kind', title: 'TA · Wallet kind', event: 'auth_succeeded', math: 'total', breakdown: 'wallet_kind', where: [{ key: 'method', value: 'near-wallet' }, prod], pin: true },
  { id: 'auth-failed-reason', title: 'TA · Sign-in failures', event: 'auth_failed', math: 'total', breakdown: 'reason', where: [prod], pin: true },
  { id: 'boot-failed-reason', title: 'TA · Boot failures', event: 'play_boot_failed', math: 'total', breakdown: 'reason', where: [prod], pin: true },
  { id: 'colony-failed-reason', title: 'TA · Colony enter failures', event: 'colony_enter_failed', math: 'total', breakdown: 'reason', where: [prod], pin: true },
  { id: 'trade-failed-reason', title: 'TA · Trade failures', event: 'trade_order_failed', math: 'total', breakdown: 'reason', pin: true },
  { id: 'client-errors', title: 'TA · Client errors', event: 'client_error', math: 'total', breakdown: 'reason', where: [prod], pin: true },
  { id: 'consent', title: 'TA · Consent granted', event: 'consent_granted', math: 'total', breakdown: 'surface', where: [prod], pin: true },
];
