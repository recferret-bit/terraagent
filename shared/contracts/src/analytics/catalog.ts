/**
 * Product-analytics catalog (single source of truth).
 * The skill `.agents/skills/product-analytics` and `npm run validate:analytics` read this module.
 * Names match the client wire regex `^[a-z][a-z0-9_]{1,63}$`. Props are an allowlist.
 * A `server` event is written only after a commit. The public intake drops it.
 */

export type AnalyticsPlane = 'client' | 'server' | 'both';

export interface AnalyticsPropSpec {
  readonly key: string;
  /** Closed set. Absent means a short token (see `sanitizeAnalyticsProps`). */
  readonly values?: readonly string[];
}

export interface AnalyticsEventSpec {
  readonly name: string;
  readonly plane: AnalyticsPlane;
  readonly surface: string;
  readonly legacy?: boolean;
  readonly props: readonly AnalyticsPropSpec[];
}

export const ANALYTICS_DENY_PROPS = [
  'ip', 'email', 'account', 'accountid', 'account_id', 'wallet', 'address', 'publickey', 'public_key',
  'token', 'secret', 'authorization', 'useragent', 'user_agent', 'cookie', 'password', 'seed', 'mnemonic',
  'signature', 'colonyid', 'colony_id', 'playerid', 'player_id', 'anonid', 'distinct_id',
] as const;

const SURFACE = ['landing', 'play', 'trade', 'me', 'whitepaper', 'pitchdeck', 'deed', 'hub', 'playground', 'probe'] as const;
const REFERRER = ['direct', 'terraagent', 'search', 'social', 'other'] as const;
const PATH_GROUP = ['landing', 'play', 'trade', 'me', 'whitepaper', 'pitchdeck', 'deed', 'hub', 'playground', 'design', 'other'] as const;
const VIEWPORT = ['desktop', 'mobile'] as const;
const RUNTIME = ['local', 'prod'] as const;
const BIT = ['0', '1'] as const;
const METHOD = ['google', 'x', 'email', 'near-wallet', 'fastauth'] as const;
const WALLET = ['none', 'meteor-wallet', 'okx-wallet', 'near-mobile-wallet', 'intear-wallet', 'my-near-wallet', 'other'] as const;
const PLANET = ['dune', 'oceanForest', 'forestRock'] as const;
const HOST = ['local', 'online'] as const;
const STAGE = ['popup', 'oauth', 'verify', 'restore'] as const;
const AUTH_REASON = ['popup_blocked', 'dismissed', 'oauth_error', 'rejected', 'network', 'invalid', 'timeout', 'unknown'] as const;
const BOOT_REASON = ['boot', 'socket', 'auth', 'timeout', 'rejected', 'webgl', 'unknown'] as const;
const SIDE = ['buy', 'sell'] as const;
const TRADE_REASON = ['validation', 'rejected', 'network', 'insufficient', 'expired', 'timeout', 'unknown'] as const;
const SOURCE = ['client', 'server'] as const;
const SECTION = ['pilot', 'progress', 'planets', 'history', 'achievements', 'play'] as const;
const PROFILE_REASON = ['unauthorized', 'network', 'invalid', 'unknown'] as const;
const COMMAND = ['move', 'build', 'terraform', 'attack', 'stop', 'other'] as const;
const ERROR_KIND = ['error', 'rejection'] as const;
const ERROR_REASON = ['script', 'resource', 'socket', 'unknown'] as const;

const prop = (key: string, values?: readonly string[]): AnalyticsPropSpec => (values ? { key, values } : { key });

const visit = [
  prop('surface', SURFACE), prop('referrer_class', REFERRER), prop('utm_source'), prop('utm_medium'),
  prop('utm_campaign'), prop('path_group', PATH_GROUP), prop('viewport', VIEWPORT), prop('first_touch', BIT), prop('runtime', RUNTIME),
] as const;

const auth = [prop('method', METHOD), prop('wallet_kind', WALLET), prop('surface', SURFACE), prop('runtime', RUNTIME)] as const;

const legacy = (name: string, plane: AnalyticsPlane = 'client'): AnalyticsEventSpec => ({
  name, plane, surface: 'legacy', legacy: true, props: [],
});

/** Events the product emits. Legacy rows stay so older call sites keep validating. */
export const ANALYTICS_EVENTS: readonly AnalyticsEventSpec[] = [
  { name: 'surface_viewed', plane: 'client', surface: 'visitor', props: visit },
  { name: 'consent_granted', plane: 'client', surface: 'visitor', props: [prop('surface', SURFACE), prop('runtime', RUNTIME)] },
  { name: 'auth_started', plane: 'client', surface: 'auth', props: auth },
  { name: 'auth_failed', plane: 'client', surface: 'auth', props: [...auth, prop('stage', STAGE), prop('reason', AUTH_REASON)] },
  { name: 'auth_succeeded', plane: 'client', surface: 'auth', props: auth },
  { name: 'auth_completed', plane: 'server', surface: 'auth', props: [prop('method', METHOD), prop('wallet_kind', WALLET)] },
  { name: 'planet_picker_viewed', plane: 'client', surface: 'planet', props: [prop('surface', SURFACE), prop('runtime', RUNTIME)] },
  { name: 'planet_selected', plane: 'client', surface: 'planet', props: [prop('planet', PLANET), prop('surface', SURFACE), prop('runtime', RUNTIME)] },
  { name: 'descent_started', plane: 'client', surface: 'planet', props: [prop('planet', PLANET), prop('runtime', RUNTIME)] },
  { name: 'colony_entered', plane: 'client', surface: 'planet', props: [prop('planet', PLANET), prop('host', HOST), prop('runtime', RUNTIME)] },
  { name: 'colony_enter_failed', plane: 'client', surface: 'planet', props: [prop('planet', PLANET), prop('reason', BOOT_REASON), prop('runtime', RUNTIME)] },
  { name: 'trade_page_viewed', plane: 'client', surface: 'trade', props: [prop('runtime', RUNTIME)] },
  { name: 'trade_ticket_opened', plane: 'client', surface: 'trade', props: [prop('pair'), prop('runtime', RUNTIME)] },
  { name: 'trade_submit_clicked', plane: 'client', surface: 'trade', props: [prop('pair'), prop('side', SIDE), prop('runtime', RUNTIME)] },
  { name: 'trade_order_accepted', plane: 'server', surface: 'trade', props: [prop('pair'), prop('side', SIDE)] },
  { name: 'trade_order_failed', plane: 'both', surface: 'trade', props: [prop('pair'), prop('side', SIDE), prop('reason', TRADE_REASON), prop('source', SOURCE)] },
  { name: 'play_booted', plane: 'client', surface: 'play', props: [prop('planet', PLANET), prop('host', HOST), prop('runtime', RUNTIME)] },
  { name: 'play_boot_failed', plane: 'client', surface: 'play', props: [prop('reason', BOOT_REASON), prop('runtime', RUNTIME)] },
  { name: 'gameplay_first_command', plane: 'client', surface: 'play', props: [prop('kind', COMMAND), prop('runtime', RUNTIME)] },
  { name: 'gameplay_error', plane: 'client', surface: 'play', props: [prop('reason', ERROR_REASON), prop('runtime', RUNTIME)] },
  { name: 'profile_viewed', plane: 'client', surface: 'profile', props: [prop('runtime', RUNTIME)] },
  { name: 'profile_section_opened', plane: 'client', surface: 'profile', props: [prop('section', SECTION), prop('runtime', RUNTIME)] },
  { name: 'profile_load_failed', plane: 'client', surface: 'profile', props: [prop('reason', PROFILE_REASON), prop('runtime', RUNTIME)] },
  { name: 'client_error', plane: 'client', surface: 'diagnostics', props: [prop('surface', SURFACE), prop('kind', ERROR_KIND), prop('reason', ERROR_REASON), prop('runtime', RUNTIME)] },
  legacy('deed_viewed'), legacy('deed_shared'), legacy('stake_started'), legacy('stake_completed'),
  legacy('stake_cancelled'), legacy('unstake_started'), legacy('withdraw_completed'),
  legacy('council_opened'), legacy('guild_docked_seen'), legacy('guild_offer_accepted'), legacy('autotrade_configured'),
  legacy('director_key_enabled'), legacy('director_key_revoked'), legacy('director_trade_executed'),
  legacy('director_policy_changed'),
  legacy('market_tab_opened'), legacy('market_order_previewed'), legacy('market_order_placed'),
  legacy('market_order_cancelled'), legacy('market_order_rejected'), legacy('market_trade_settled'), legacy('stall_fee_changed'),
  legacy('raid_started'), legacy('colony_eliminated'), legacy('truce_signed'), legacy('truce_broken'),
  legacy('proposal_created', 'server'), legacy('vote_cast', 'server'), legacy('bounty_posted', 'server'),
  legacy('bounty_claimed', 'server'), legacy('bounty_paid', 'server'), legacy('mercenary_hired', 'server'),
];

const BY_NAME = new Map(ANALYTICS_EVENTS.map((event) => [event.name, event]));

export function analyticsEvent(name: string): AnalyticsEventSpec | undefined {
  return BY_NAME.get(name);
}

/** Client intake may store this name. Server-plane names are commits and cannot be minted by the browser. */
export function clientMaySend(name: string): boolean {
  const spec = BY_NAME.get(name);
  return spec === undefined || spec.plane !== 'server';
}

const TOKEN = /^[A-Za-z0-9._-]{1,64}$/;
const DENY = new Set<string>(ANALYTICS_DENY_PROPS);

/** Drops unknown, denied, and out-of-enum props. UTM and pair values must be short tokens. */
export function sanitizeAnalyticsProps(
  name: string,
  props: Readonly<Record<string, string | number | boolean | null | undefined>>,
): Record<string, string | number | boolean> {
  const spec = BY_NAME.get(name);
  if (!spec) return {};
  const allowed = new Map(spec.props.map((item) => [item.key, item]));
  const out: Record<string, string | number | boolean> = {};
  for (const [key, value] of Object.entries(props)) {
    const rule = allowed.get(key);
    if (!rule || DENY.has(key.toLowerCase()) || /id$/i.test(key) || value === null || value === undefined) continue;
    if (typeof value === 'string') {
      const text = key === 'pair' ? value.replace(/\//g, '-') : value;
      if (rule.values) {
        if (rule.values.includes(text)) out[key] = text;
        continue;
      }
      if (TOKEN.test(text)) out[key] = text;
      continue;
    }
    if (typeof value === 'number' && Number.isFinite(value) && !rule.values) out[key] = value;
    else if (typeof value === 'boolean' && !rule.values) out[key] = value;
  }
  return out;
}
