import type { AnalyticsUiArea } from '@terra/contracts';
import type { AnalyticsSurface } from './context';

export interface UiRuleMatch {
  readonly area: AnalyticsUiArea;
  readonly action: string;
  readonly target?: string;
}

export const TESTID_MATCHERS: Readonly<Record<string, UiRuleMatch>> = {
  // Landing & Profile & Staking
  'landing-stake-cta': { area: 'economics', action: 'stake_cta', target: 'staking' },
  'landing-stake-pill': { area: 'economics', action: 'stake_pill', target: 'staking' },
  'me-pilot-rename': { area: 'profile', action: 'pilot_rename_open' },
  'me-pilot-rename-save': { area: 'profile', action: 'pilot_rename' },
  'me-pilot-rename-cancel': { area: 'profile', action: 'pilot_rename_cancel' },
  'me-ai-save-btn': { area: 'profile', action: 'ai_settings_save' },
  'me-ai-clear-btn': { area: 'profile', action: 'ai_settings_clear' },
  'me-ai-verify-btn': { area: 'profile', action: 'ai_settings_verify' },
  'me-colony-dive-in': { area: 'planets', action: 'colony_dive_in' },
  'me-same-planet-option': { area: 'planets', action: 'same_planet_colony_select' },
  'me-same-planet-dive': { area: 'planets', action: 'same_planet_colony_dive' },
  'me-play-cta': { area: 'cta', action: 'play_cta', target: 'play' },
  'staking-compound-btn': { area: 'staking', action: 'compound_yield' },
  'staking-share-social': { area: 'staking', action: 'share_social' },
  'staking-share-x': { area: 'staking', action: 'share_x' },
  'staking-claim-btn': { area: 'staking', action: 'claim_yield' },
  'staking-stake-btn': { area: 'staking', action: 'stake_submit' },
  'staking-unstake-btn': { area: 'staking', action: 'unstake_submit' },
  'staking-withdraw-btn': { area: 'staking', action: 'withdraw_submit' },
  'staking-wallet-deposit-btn': { area: 'staking', action: 'wallet_deposit' },
  'staking-nominate-planet-btn': { area: 'staking', action: 'nominate_planet' },
  'staking-console-stake': { area: 'staking', action: 'stake_submit' },
  'staking-console-compound': { area: 'staking', action: 'compound_yield' },
  'staking-console-unstake': { area: 'staking', action: 'unstake_submit' },
  'staking-console-withdraw': { area: 'staking', action: 'withdraw_submit' },
  'staking-stake-profits-btn': { area: 'staking', action: 'stake_profits_open' },
  'staking-local-faucet-btn': { area: 'staking', action: 'local_faucet' },
  'staking-nominate-btn': { area: 'staking', action: 'nominate_planet' },

  // Auth & Pilot Dialog
  'pilot-sign-in': { area: 'profile', action: 'pilot_sign_in_open' },
  'pilot-sign-out': { area: 'profile', action: 'pilot_sign_out' },
  'pilot-mode-signin': { area: 'profile', action: 'pilot_mode_signin' },
  'pilot-mode-signup': { area: 'profile', action: 'pilot_mode_signup' },
  'pilot-dialog-trigger': { area: 'profile', action: 'pilot_dialog_open' },
  'pilot-dialog-close': { area: 'profile', action: 'pilot_dialog_close' },
  'pilot-open-deed': { area: 'deed', action: 'open_deed_panel' },
  'pilot-open-goals': { area: 'goals', action: 'open_goals' },
  'pilot-open-me': { area: 'profile', action: 'open_profile', target: 'me' },
  'continue-google': { area: 'profile', action: 'auth_provider_click', target: 'google' },
  'continue-x': { area: 'profile', action: 'auth_provider_click', target: 'x' },
  'continue-email': { area: 'profile', action: 'auth_provider_click', target: 'email' },
  'continue-near': { area: 'profile', action: 'auth_provider_click', target: 'fastauth' },
  'near-mode-signin': { area: 'profile', action: 'near_mode_signin' },
  'near-mode-signup': { area: 'profile', action: 'near_mode_signup' },
  'near-wallet-pair-btn': { area: 'profile', action: 'near_wallet_pair' },
  'near-wallet-resume': { area: 'profile', action: 'near_wallet_resume' },
  'near-account-submit': { area: 'profile', action: 'near_account_submit' },

  // Exchange Trading (/trade.html)
  'orders-cancel-all': { area: 'orders', action: 'cancel_all' },
  'my-order-cancel': { area: 'orders', action: 'cancel_order' },
  'key-create': { area: 'keys', action: 'create_key' },
  'key-copy': { area: 'keys', action: 'copy_key' },
  'stall-apply': { area: 'market', action: 'stall_apply' },
  'stake-profits-btn': { area: 'staking', action: 'stake_profits_open' },
  'stake-profits-submit': { area: 'staking', action: 'stake_profits_submit' },
  'stake-profits-max': { area: 'staking', action: 'stake_profits_max' },
  'stake-profits-cancel': { area: 'staking', action: 'stake_profits_cancel' },
  'ticket-suggest': { area: 'trade_ticket', action: 'trade_suggest' },
  'ticket-wallet-sign': { area: 'trade_ticket', action: 'trade_wallet_sign' },
  'ramp-quote-btn': { area: 'ramp', action: 'ramp_quote' },

  // Deed & In-Game Market / Trade Hub / Wallet Signer
  'deed-colonize-cta': { area: 'deed', action: 'colonize_cta', target: 'play' },
  'deed-staking-cta': { area: 'deed', action: 'staking_cta', target: 'staking' },
  'deed-share-x-btn': { area: 'deed', action: 'share_x' },
  'deed-share-social-btn': { area: 'deed', action: 'share_social' },
  'deed-share-link': { area: 'deed', action: 'open_share_link' },
  'deed-settle-btn': { area: 'deed', action: 'settle_deed' },
  'deed-close-btn': { area: 'deed', action: 'close_deed' },
  'colony-deed-btn': { area: 'deed', action: 'open_deed_panel' },
  'signer-approve-btn': { area: 'wallet', action: 'signer_approve' },
  'signer-reject-btn': { area: 'wallet', action: 'signer_reject' },
  'trade-hub-open': { area: 'market', action: 'open_trade_hub' },
  'trade-hub-open-contracts': { area: 'market', action: 'open_contracts' },
  'trade-hub-confirm': { area: 'market', action: 'trade_hub_confirm' },
  'trade-hub-open-terminal': { area: 'market', action: 'open_trade_terminal', target: 'trade' },
  'trade-hub-amount-25': { area: 'market', action: 'trade_hub_quick', target: '25' },
  'trade-hub-amount-50': { area: 'market', action: 'trade_hub_quick', target: '50' },
  'trade-hub-amount-max': { area: 'market', action: 'trade_hub_quick', target: 'max' },
  'trade-hub-close': { area: 'market', action: 'trade_hub_close' },
  'market-open-full': { area: 'market', action: 'open_trade_terminal', target: 'trade' },
  'market-open-board': { area: 'market', action: 'open_price_board' },
  'market-open-contracts': { area: 'market', action: 'open_contracts' },
  'order-submit': { area: 'market', action: 'market_order_submit' },
  'order-cancel': { area: 'market', action: 'market_order_cancel' },
  'guild-accept': { area: 'market', action: 'guild_accept' },
  'supply-toggle': { area: 'market', action: 'supply_toggle' },
  'supply-open-trade': { area: 'market', action: 'open_trade_hub' },
  'command-dock-toggle': { area: 'hud_dock', action: 'toggle_dock' },
  'colony-book-toggle': { area: 'hud_colony', action: 'toggle_colony_book' },

  // HQ, AI Director, Away, Goals, Stages, Orbit Boot/Queue
  'away-toggle': { area: 'hq_ai', action: 'away_toggle' },
  'away-save': { area: 'hq_ai', action: 'away_save' },
  'away-open-hq': { area: 'hq_ai', action: 'away_open_hq' },
  'away-open-director': { area: 'hq_ai', action: 'away_open_director' },
  'away-autotrade-save': { area: 'hq_ai', action: 'away_autotrade_save' },
  'away-director-toggle': { area: 'hq_ai', action: 'away_director_toggle' },
  'away-director-revoke': { area: 'hq_ai', action: 'away_director_revoke' },
  'away-dismiss': { area: 'hq_ai', action: 'away_digest_dismiss' },
  'orbital-splash-retry': { area: 'orbit_lobby', action: 'boot_retry' },
  'queue-cancel-btn': { area: 'orbit_lobby', action: 'queue_cancel' },
  'director-autopilot-toggle': { area: 'hq_ai', action: 'director_autopilot_toggle' },
  'director-war-diplomacy-toggle': { area: 'diplomacy', action: 'war_diplomacy_toggle' },
  'director-tee-btn': { area: 'hq_ai', action: 'director_tee_proof' },
  'director-open-hq': { area: 'hq_ai', action: 'director_open_hq' },
  'director-open-away': { area: 'hq_ai', action: 'director_open_away' },
  'tee-modal-ai-access': { area: 'hq_ai', action: 'tee_open_ai_access' },
  'tee-modal-stake-cta': { area: 'staking', action: 'tee_stake_cta', target: 'staking' },
  'hq-select-btn': { area: 'hq_ai', action: 'hq_select' },
  'hq-panel-cancel': { area: 'hq_ai', action: 'hq_cancel_job' },
  'goal-add-btn': { area: 'goals', action: 'goal_add' },
  'goal-suggestion-accept': { area: 'goals', action: 'goal_suggestion_accept' },
  'goal-suggestion-dismiss': { area: 'goals', action: 'goal_suggestion_dismiss' },
  'stage-goals-launcher': { area: 'goals', action: 'stage_goals_open' },
  'stage-goals-close': { area: 'goals', action: 'stage_goals_close' },
  'colony-critical-place-hub': { area: 'build', action: 'critical_place_hub' },
  'found-new-colony-btn': { area: 'build', action: 'found_new_colony' },

  // Queue, Army, Raid, Diplomacy, Bounty, Council, Maps, Notifications, Pause/Settings
  'queue-cancel-all': { area: 'queue', action: 'cancel_all' },
  'raid-picker-toggle': { area: 'army', action: 'raid_picker_toggle' },
  'raid-mode-direct': { area: 'army', action: 'raid_mode', target: 'direct' },
  'raid-mode-goal': { area: 'army', action: 'raid_mode', target: 'goal' },
  'raid-target-dispatch': { area: 'army', action: 'raid_dispatch' },
  'raid-target-goal-btn': { area: 'army', action: 'raid_queue_goal' },
  'bounty-post': { area: 'bounty', action: 'bounty_post' },
  'bounty-close': { area: 'bounty', action: 'bounty_close' },
  'council-propose': { area: 'diplomacy', action: 'council_propose' },
  'council-close': { area: 'diplomacy', action: 'council_close' },
  'planet-menu-toggle': { area: 'hud_colony', action: 'planet_menu_toggle' },
  'minimap-expand': { area: 'map', action: 'minimap_expand' },
  'minimap-resources-toggle': { area: 'map', action: 'minimap_resources_toggle' },
  'global-map-close': { area: 'map', action: 'global_map_close' },
  'notifications-mark-read': { area: 'notifications', action: 'mark_read' },
  'notifications-clear': { area: 'notifications', action: 'clear_all' },
  'notification-history-close': { area: 'notifications', action: 'close_history' },
  'settings-close': { area: 'settings', action: 'settings_close' },
  'pause-resume': { area: 'settings', action: 'pause_resume' },
  'pause-return-orbit': { area: 'settings', action: 'pause_return_orbit' },
};

export const ID_MATCHERS: Readonly<Record<string, UiRuleMatch>> = {
  wpRailHide: { area: 'rail', action: 'rail_hide' },
  wpRailShowFloat: { area: 'rail', action: 'rail_show' },
  wpRailMore: { area: 'rail', action: 'rail_scroll' },
  'pitch-prev': { area: 'slides', action: 'slide_prev' },
  'pitch-next': { area: 'slides', action: 'slide_next' },
  'pitch-mode': { area: 'slides', action: 'slide_mode' },
  'tk-suggest': { area: 'trade_ticket', action: 'trade_suggest' },
  'orders-cancel-all': { area: 'orders', action: 'cancel_all' },
  'key-create': { area: 'keys', action: 'create_key' },
  'key-copy': { area: 'keys', action: 'copy_key' },
  'stall-apply': { area: 'market', action: 'stall_apply' },
  'ver-pose': { area: 'playground', action: 'cycle_pose' },
  'work-target': { area: 'playground', action: 'cycle_work_target' },
  build: { area: 'playground', action: 'cycle_build_stage' },
  replay: { area: 'design', action: 'motion_replay' },
  pause: { area: 'design', action: 'motion_pause' },
  'fire-toast': { area: 'design', action: 'storybook_toast' },
  'p-resume': { area: 'settings', action: 'pause_resume' },
  'p-return': { area: 'settings', action: 'pause_return_orbit' },
};

const ACTION_MATCHERS: Readonly<Record<string, UiRuleMatch>> = {
  'propose-truce': { area: 'diplomacy', action: 'propose_truce' },
  'accept-truce': { area: 'diplomacy', action: 'accept_truce' },
  'decline-truce': { area: 'diplomacy', action: 'decline_truce' },
  'cancel-truce': { area: 'diplomacy', action: 'cancel_truce' },
  'declare-war': { area: 'diplomacy', action: 'declare_war' },
  'cancel-war': { area: 'diplomacy', action: 'cancel_war' },
};

export function classifyByDataAttr(el: HTMLElement, surface: AnalyticsSurface): UiRuleMatch | null {
  const explicitAction = el.dataset.taAction;
  if (explicitAction) {
    const area = (el.dataset.taArea as AnalyticsUiArea | undefined) ?? 'cta';
    return { area, action: explicitAction, target: el.dataset.taTarget };
  }
  if (el.dataset.res) return { area: 'resources', action: 'select_resource', target: el.dataset.res };
  if (el.dataset.stage && surface === 'landing') return { area: 'resources', action: 'select_deposit_stage', target: el.dataset.stage };
  if (el.hasAttribute('data-scenario-card')) {
    return { area: 'director', action: 'select_scenario', target: el.dataset.scenarioCard || el.id || 'scenario' };
  }
  if (el.dataset.protoFilter) return { area: 'protocol', action: 'filter_stream', target: el.dataset.protoFilter };
  if (el.dataset.railTab) return { area: 'rail', action: 'rail_tab', target: el.dataset.railTab };

  // Playground toolbar
  if (el.dataset.night) return { area: 'playground', action: 'set_night', target: el.dataset.night === '1' ? 'night' : 'day' };
  if (el.dataset.depositStage) return { area: 'playground', action: 'set_deposit_stage', target: el.dataset.depositStage };
  if (el.dataset.tileState) return { area: 'playground', action: 'set_tile_state', target: el.dataset.tileState };
  if (el.dataset.k && surface === 'playground') return { area: 'playground', action: 'toggle_option', target: el.dataset.k };
  if (el.dataset.v) {
    if (el.closest('#views')) return { area: 'playground', action: 'set_view', target: el.dataset.v };
    if (el.closest('#planet-btns')) return { area: 'playground', action: 'set_biome', target: el.dataset.v };
  }
  if (el.dataset.tab) {
    if (el.closest('#bar')) return { area: 'playground', action: 'toolbar_tab', target: el.dataset.tab };
    if (surface === 'design') return { area: 'design', action: 'storybook_tab', target: el.dataset.tab };
  }
  if (el.dataset.story) return { area: 'design', action: 'storybook_story', target: el.dataset.story };
  if (el.dataset.bg) return { area: 'design', action: 'storybook_bg', target: el.dataset.bg };

  // Pause & Settings quality presets
  if (el.dataset.fpsCap) return { area: 'settings', action: 'pause_fps_cap', target: el.dataset.fpsCap };
  if (el.dataset.shadowQuality) return { area: 'settings', action: 'pause_shadows', target: el.dataset.shadowQuality };

  // Queue, Army, Trade Hub, Exchange Keys, Build Tiers, Units Counters
  if (el.dataset.laneTab) return { area: 'queue', action: 'lane_tab', target: el.dataset.laneTab };
  if (el.hasAttribute('data-queue-collapse')) return { area: 'queue', action: 'toggle_collapse' };
  if (el.hasAttribute('data-cancel-task')) return { area: 'queue', action: 'cancel_task' };
  if (el.hasAttribute('data-reorder-up') || el.hasAttribute('data-reorder-down')) {
    return { area: 'queue', action: 'reorder_task' };
  }
  if (el.dataset.stance) return { area: 'army', action: 'set_stance', target: el.dataset.stance };
  if (el.hasAttribute('data-attack-move-btn')) return { area: 'army', action: 'arm_attack_move' };
  if (el.dataset.resource && el.closest('[data-testid="trade-hub-panel"]')) {
    return { area: 'market', action: 'trade_hub_resource', target: el.dataset.resource };
  }
  if (el.dataset.family) return { area: 'market', action: 'trade_hub_family', target: el.dataset.family };
  if (el.hasAttribute('data-kill')) return { area: 'keys', action: 'kill_switch' };
  if (el.hasAttribute('data-revoke-confirm')) return { area: 'keys', action: 'revoke_key' };
  if (el.hasAttribute('data-count-dec')) return { area: 'units', action: 'count_dec' };
  if (el.hasAttribute('data-count-inc')) return { area: 'units', action: 'count_inc' };
  if (el.hasAttribute('data-repeat')) return { area: 'units', action: 'repeat_toggle' };
  if (el.dataset.action && ACTION_MATCHERS[el.dataset.action]) return ACTION_MATCHERS[el.dataset.action];
  return null;
}

export function classifyByTestIdPrefix(testid: string): UiRuleMatch | null {
  if (testid.startsWith('tab-')) return { area: 'trade_ticket', action: 'trade_tab', target: testid.slice(4) };
  if (testid.startsWith('ticket-side-')) return { area: 'trade_ticket', action: 'trade_side', target: testid.slice(12) };
  if (testid.startsWith('orders-filter-')) return { area: 'orders', action: 'filter_orders', target: testid.slice(14) };
  if (testid.startsWith('order-side-')) return { area: 'market', action: 'market_order_side', target: testid.slice(11) };
  if (testid.startsWith('me-tab-')) return { area: 'profile', action: 'open_section', target: testid.slice(7) };
  if (testid.startsWith('orbital-colony-opt-')) return { area: 'orbit_lobby', action: 'select_colony', target: testid.slice(19) };
  if (testid.startsWith('build-tier-')) return { area: 'build', action: 'select_tier', target: testid.slice(11) };
  if (testid.startsWith('prod-tier-')) return { area: 'units', action: 'select_tier', target: testid.slice(10) };
  if (testid.startsWith('hq-tab-')) return { area: 'hq_ai', action: 'hq_tab', target: testid.slice(7) };
  if (testid.startsWith('trade-hub-tab-')) return { area: 'market', action: 'trade_hub_tab', target: testid.slice(14) };
  if (testid.startsWith('planet-menu-') && testid !== 'planet-menu-list') {
    return { area: 'hud_colony', action: 'planet_menu_item', target: testid.slice(12) };
  }
  if (testid.startsWith('bounty-claim-')) return { area: 'bounty', action: 'bounty_claim' };
  if (testid.startsWith('council-vote-yes-')) return { area: 'diplomacy', action: 'council_vote', target: 'yes' };
  if (testid.startsWith('council-vote-no-')) return { area: 'diplomacy', action: 'council_vote', target: 'no' };
  if (testid.startsWith('duration-chip-')) return { area: 'diplomacy', action: 'truce_duration', target: testid.slice(14) };
  if (testid.startsWith('truce-bond-chip-')) return { area: 'diplomacy', action: 'truce_bond', target: testid.slice(16) };
  if (testid.startsWith('war-bond-chip-')) return { area: 'diplomacy', action: 'war_bond', target: testid.slice(14) };
  if (testid.startsWith('supply-') && testid.endsWith('-act')) return { area: 'market', action: 'supply_action' };
  if (testid.startsWith('supply-') && testid.endsWith('-compare')) return { area: 'market', action: 'supply_compare' };
  if (testid.startsWith('notifications-filter-')) return { area: 'notifications', action: 'filter', target: testid.slice(21) };
  if (testid.startsWith('help-tip-btn-')) return { area: 'profile', action: 'open_help_tip', target: testid.slice(13) };
  if (
    testid.startsWith('real-signer-')
    && testid !== 'real-signer-cli-cmd'
    && testid !== 'real-signer-account'
    && testid !== 'real-signer-pubkey'
    && testid !== 'real-signer-signature'
  ) {
    return { area: 'wallet', action: 'signer_wallet_click', target: testid.slice(12) };
  }
  return null;
}
