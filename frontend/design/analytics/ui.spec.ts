// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';

const track = vi.fn();
vi.mock('../../game/core/analytics', () => ({
  track: (...args: unknown[]) => track(...args),
  setConsent: vi.fn(),
  getConsent: () => true,
  flush: async () => undefined,
}));

describe('analytics UI & HUD action tracking', () => {
  beforeEach(async () => {
    track.mockClear();
    document.body.innerHTML = '';
    vi.resetModules();
    const { resetUiDelegationForTest } = await import('./ui');
    resetUiDelegationForTest();
  });

  it('tracks whitepaper, pitchdeck, trade, me, and deed CTAs cleanly', async () => {
    const { rememberSurface } = await import('./context');
    const { installUiActionDelegation } = await import('./ui');
    rememberSurface('whitepaper');
    installUiActionDelegation('whitepaper');

    const railTab = document.createElement('button');
    railTab.dataset.railTab = 'entities';
    document.body.appendChild(railTab);
    railTab.click();

    const playLink = document.createElement('a');
    playLink.className = 'btn btn-primary btn-sm';
    playLink.href = '/play.html?planet=dune&skip=1';
    playLink.addEventListener('click', (e) => e.preventDefault());
    document.body.appendChild(playLink);
    playLink.click();

    rememberSurface('trade');
    const suggest = document.createElement('button');
    suggest.id = 'tk-suggest';
    document.body.appendChild(suggest);
    suggest.click();

    rememberSurface('me');
    const compound = document.createElement('button');
    compound.dataset.testid = 'staking-compound-btn';
    document.body.appendChild(compound);
    compound.click();

    expect(track.mock.calls.map(([name, props]) => [name, props])).toEqual([
      ['ui_action_clicked', expect.objectContaining({ surface: 'whitepaper', area: 'rail', action: 'rail_tab', target: 'entities' })],
      ['ui_action_clicked', expect.objectContaining({ surface: 'whitepaper', area: 'cta', action: 'navigate', target: 'play' })],
      ['ui_action_clicked', expect.objectContaining({ surface: 'trade', area: 'trade_ticket', action: 'trade_suggest' })],
      ['ui_action_clicked', expect.objectContaining({ surface: 'me', area: 'staking', action: 'compound_yield' })],
    ]);
  });

  it('sanitizes weird tokens, ignores consent buttons, and resolves external subdomains safely', async () => {
    const { rememberSurface } = await import('./context');
    const { installUiActionDelegation, noteUiAction, sanitizeUiToken } = await import('./ui');
    expect(sanitizeUiToken('  solar gen!@#  ')).toBe('solar_gen');
    expect(sanitizeUiToken('   ')).toBeUndefined();

    rememberSurface('design');
    installUiActionDelegation('design');

    const consentBox = document.createElement('aside');
    consentBox.dataset.testid = 'analytics-consent';
    const allow = document.createElement('button');
    allow.dataset.testid = 'analytics-consent-allow';
    consentBox.appendChild(allow);
    document.body.appendChild(consentBox);
    allow.click();
    expect(track).not.toHaveBeenCalled();

    const nav = document.createElement('nav');
    const sub = document.createElement('a');
    sub.href = 'https://play.terraagent.fun/?planet=dune';
    sub.addEventListener('click', (e) => e.preventDefault());
    nav.appendChild(sub);
    document.body.appendChild(nav);
    sub.click();

    const ext = document.createElement('a');
    ext.className = 'btn';
    ext.href = 'https://example.org/secret?playerId=123';
    ext.addEventListener('click', (e) => e.preventDefault());
    document.body.appendChild(ext);
    ext.click();

    noteUiAction('build', 'select building!', 'commandHub');

    expect(track.mock.calls.map(([, p]) => p)).toEqual([
      expect.objectContaining({ surface: 'design', area: 'nav', action: 'navigate', target: 'play' }),
      expect.objectContaining({ surface: 'design', area: 'cta', action: 'navigate', target: 'external' }),
      expect.objectContaining({ surface: 'design', area: 'build', action: 'select_building', target: 'commandHub' }),
    ]);
  });
});

describe('analytics UI & HUD extended rules', () => {
  beforeEach(async () => {
    track.mockClear();
    document.body.innerHTML = '';
    vi.resetModules();
    const { resetUiDelegationForTest } = await import('./ui');
    resetUiDelegationForTest();
  });

  it('tracks playground toolbar and pause overlay controls', async () => {
    const { rememberSurface } = await import('./context');
    const { installUiActionDelegation } = await import('./ui');
    installUiActionDelegation('playground');

    rememberSurface('playground');
    const views = document.createElement('div');
    views.id = 'views';
    const front = document.createElement('button');
    front.dataset.v = 'front';
    const night = document.createElement('button');
    night.dataset.night = '1';
    views.append(front, night);
    const planetBtns = document.createElement('div');
    planetBtns.id = 'planet-btns';
    const dune = document.createElement('button');
    dune.dataset.v = 'dune';
    planetBtns.append(dune);
    const workTarget = document.createElement('button');
    workTarget.id = 'work-target';
    document.body.append(views, planetBtns, workTarget);
    front.click();
    night.click();
    dune.click();
    workTarget.click();

    rememberSurface('play');
    for (const attrs of [
      { 'data-testid': 'pause-resume' },
      { 'data-testid': 'pause-return-orbit' },
      { id: 'p-resume' },
      { id: 'p-return' },
      { 'data-fps-cap': '60' },
      { 'data-shadow-quality': 'high' },
    ]) {
      const b = document.createElement('button');
      for (const [k, v] of Object.entries(attrs)) b.setAttribute(k, v);
      document.body.appendChild(b);
      b.click();
    }

    expect(track.mock.calls.map(([, p]) => [p.surface, p.area, p.action, p.target])).toEqual([
      ['playground', 'playground', 'set_view', 'front'],
      ['playground', 'playground', 'set_night', 'night'],
      ['playground', 'playground', 'set_biome', 'dune'],
      ['playground', 'playground', 'cycle_work_target', undefined],
      ['play', 'settings', 'pause_resume', undefined],
      ['play', 'settings', 'pause_return_orbit', undefined],
      ['play', 'settings', 'pause_resume', undefined],
      ['play', 'settings', 'pause_return_orbit', undefined],
      ['play', 'settings', 'pause_fps_cap', '60'],
      ['play', 'settings', 'pause_shadows', 'high'],
    ]);
  });
});

describe('analytics gameplay, market, staking, and hub controls', () => {
  beforeEach(async () => {
    track.mockClear();
    document.body.innerHTML = '';
    vi.resetModules();
    const { resetUiDelegationForTest } = await import('./ui');
    resetUiDelegationForTest();
  });

  it('tracks bounty/diplomacy, queue/army, market, staking, and hub controls', async () => {
    const { rememberSurface } = await import('./context');
    const { installUiActionDelegation } = await import('./ui');
    installUiActionDelegation('play');

    rememberSurface('play');
    const mkBtn = (attrs: Record<string, string>) => {
      const b = document.createElement('button');
      for (const [k, v] of Object.entries(attrs)) b.setAttribute(k, v);
      document.body.appendChild(b);
      return b;
    };
    mkBtn({ 'data-testid': 'bounty-post' }).click();
    mkBtn({ 'data-action': 'propose-truce' }).click();
    mkBtn({ 'data-action': 'declare-war' }).click();
    mkBtn({ 'data-testid': 'queue-cancel-all' }).click();
    mkBtn({ 'data-stance': 'defend' }).click();
    mkBtn({ 'data-testid': 'order-submit' }).click();
    mkBtn({ 'data-testid': 'guild-accept' }).click();
    mkBtn({ 'data-testid': 'command-dock-toggle' }).click();
    mkBtn({ 'data-testid': 'colony-book-toggle' }).click();

    rememberSurface('trade');
    mkBtn({ 'data-testid': 'ramp-quote-btn' }).click();
    mkBtn({ 'data-testid': 'orders-filter-open' }).click();

    rememberSurface('me');
    mkBtn({ 'data-testid': 'staking-console-stake' }).click();
    mkBtn({ 'data-testid': 'continue-google' }).click();

    rememberSurface('hub');
    const cover = document.createElement('a');
    cover.className = 'cover';
    cover.href = '/play.html?planet=dune';
    cover.addEventListener('click', (e) => e.preventDefault());
    document.body.appendChild(cover);
    cover.click();

    const plainDiv = document.createElement('div');
    document.body.appendChild(plainDiv);
    plainDiv.click();

    expect(track.mock.calls.map(([, p]) => [p.surface, p.area, p.action, p.target])).toEqual([
      ['play', 'bounty', 'bounty_post', undefined],
      ['play', 'diplomacy', 'propose_truce', undefined],
      ['play', 'diplomacy', 'declare_war', undefined],
      ['play', 'queue', 'cancel_all', undefined],
      ['play', 'army', 'set_stance', 'defend'],
      ['play', 'market', 'market_order_submit', undefined],
      ['play', 'market', 'guild_accept', undefined],
      ['play', 'hud_dock', 'toggle_dock', undefined],
      ['play', 'hud_colony', 'toggle_colony_book', undefined],
      ['trade', 'ramp', 'ramp_quote', undefined],
      ['trade', 'orders', 'filter_orders', 'open'],
      ['me', 'staking', 'stake_submit', undefined],
      ['me', 'profile', 'auth_provider_click', 'google'],
      ['hub', 'hub', 'open_door_card', 'play'],
    ]);
  });
});

describe('analytics TradeHub, tier tabs, disabled controls, and subdomain links', () => {
  beforeEach(async () => {
    track.mockClear();
    document.body.innerHTML = '';
    vi.resetModules();
    const { resetUiDelegationForTest } = await import('./ui');
    resetUiDelegationForTest();
  });

  it('routes TradeHub resource vs family, quick amounts, tier tabs, raid, queue, disabled controls, and apex subdomain links', async () => {
    const { rememberSurface } = await import('./context');
    const { installUiActionDelegation } = await import('./ui');
    installUiActionDelegation('play');

    rememberSurface('play');
    const hub = document.createElement('section');
    hub.dataset.testid = 'trade-hub-panel';
    const famBtn = document.createElement('button');
    famBtn.dataset.testid = 'trade-hub-family-bio';
    famBtn.dataset.family = 'bio';
    const resBtn = document.createElement('button');
    resBtn.dataset.testid = 'trade-hub-resource-bio.water';
    resBtn.dataset.resource = 'bio.water';
    resBtn.dataset.family = 'bio';
    const quick50 = document.createElement('button');
    quick50.dataset.testid = 'trade-hub-amount-50';
    const extTab = document.createElement('button');
    extTab.dataset.testid = 'trade-hub-tab-contracts';
    hub.append(famBtn, resBtn, quick50, extTab);
    document.body.appendChild(hub);
    famBtn.click();
    resBtn.click();
    quick50.click();
    extTab.click();

    const buildTier = document.createElement('button');
    buildTier.dataset.testid = 'build-tier-t2';
    const prodTier = document.createElement('button');
    prodTier.dataset.testid = 'prod-tier-t3';
    const raidDispatch = document.createElement('button');
    raidDispatch.dataset.testid = 'raid-target-dispatch';
    const reorderDown = document.createElement('button');
    reorderDown.setAttribute('data-reorder-down', 't1');
    const hqTab = document.createElement('button');
    hqTab.dataset.testid = 'hq-tab-priorities';
    document.body.append(buildTier, prodTier, raidDispatch, reorderDown, hqTab);
    buildTier.click();
    prodTier.click();
    raidDispatch.click();
    reorderDown.click();
    hqTab.click();

    expect(track.mock.calls.map(([, p]) => [p.surface, p.area, p.action, p.target])).toEqual([
      ['play', 'market', 'trade_hub_family', 'bio'],
      ['play', 'market', 'trade_hub_resource', 'bio.water'],
      ['play', 'market', 'trade_hub_quick', '50'],
      ['play', 'market', 'trade_hub_tab', 'contracts'],
      ['play', 'build', 'select_tier', 't2'],
      ['play', 'units', 'select_tier', 't3'],
      ['play', 'army', 'raid_dispatch', undefined],
      ['play', 'queue', 'reorder_task', undefined],
      ['play', 'hq_ai', 'hq_tab', 'priorities'],
    ]);
  });
});

describe('analytics disabled controls and subdomain links', () => {
  beforeEach(async () => {
    track.mockClear();
    document.body.innerHTML = '';
    vi.resetModules();
    const { resetUiDelegationForTest } = await import('./ui');
    resetUiDelegationForTest();
  });

  it('ignores disabled/aria-disabled controls and maps apex/subdomain links', async () => {
    const { rememberSurface } = await import('./context');
    const { installUiActionDelegation } = await import('./ui');
    installUiActionDelegation('play');
    rememberSurface('play');

    const disabledBtn = document.createElement('button');
    disabledBtn.disabled = true;
    disabledBtn.dataset.testid = 'bounty-post';
    const inner = document.createElement('span');
    disabledBtn.appendChild(inner);
    const lockedLink = document.createElement('a');
    lockedLink.className = 'btn';
    lockedLink.href = '/play.html?planet=dune';
    lockedLink.setAttribute('aria-disabled', 'true');
    lockedLink.addEventListener('click', (e) => e.preventDefault());
    document.body.append(disabledBtn, lockedLink);
    inner.click();
    lockedLink.click();

    rememberSurface('whitepaper');
    const mkLink = (href: string, inNav = false) => {
      const a = document.createElement('a');
      a.className = 'btn';
      a.href = href;
      a.addEventListener('click', (e) => e.preventDefault());
      if (inNav) {
        const nav = document.createElement('nav');
        nav.appendChild(a);
        document.body.appendChild(nav);
      } else {
        document.body.appendChild(a);
      }
      return a;
    };
    mkLink('https://terraagent.fun/', true).click();
    mkLink('https://play.terraagent.fun/trade.html').click();
    mkLink('https://play.terraagent.fun/me.html#staking').click();

    rememberSurface('landing');
    const stageBtn = document.createElement('button');
    stageBtn.dataset.stage = 'half';
    document.body.appendChild(stageBtn);
    stageBtn.click();

    expect(track.mock.calls.map(([, p]) => [p.surface, p.area, p.action, p.target])).toEqual([
      ['whitepaper', 'nav', 'navigate', 'landing'],
      ['whitepaper', 'cta', 'navigate', 'trade'],
      ['whitepaper', 'cta', 'navigate', 'staking'],
      ['landing', 'resources', 'select_deposit_stage', 'half'],
    ]);
  });
});

describe('analytics away, signer, trade overview, and page CTA rules', () => {
  beforeEach(async () => {
    track.mockClear();
    document.body.innerHTML = '';
    vi.resetModules();
    const { resetUiDelegationForTest } = await import('./ui');
    resetUiDelegationForTest();
  });

  it('tracks away/boot/signer/trade-pair controls and whitepaper/landing secondary CTAs', async () => {
    const { rememberSurface } = await import('./context');
    const { installUiActionDelegation } = await import('./ui');
    installUiActionDelegation('play');

    rememberSurface('play');
    for (const testid of ['away-toggle', 'away-autotrade-save', 'away-director-toggle', 'away-dismiss', 'orbital-splash-retry', 'queue-cancel-btn', 'order-cancel', 'trade-hub-open', 'signer-approve-btn', 'real-signer-meteor']) {
      const btn = document.createElement('button');
      btn.dataset.testid = testid;
      document.body.appendChild(btn);
      btn.click();
    }

    rememberSurface('me');
    const tip = document.createElement('button');
    tip.dataset.testid = 'help-tip-btn-section-staking';
    document.body.appendChild(tip);
    tip.click();

    rememberSurface('whitepaper');
    const wpSummary = document.createElement('summary');
    document.body.appendChild(wpSummary);
    wpSummary.click();

    rememberSurface('landing');
    const scenLink = document.createElement('a');
    scenLink.className = 'scenarios-cta';
    scenLink.href = '/me.html#staking';
    scenLink.addEventListener('click', (e) => e.preventDefault());
    document.body.appendChild(scenLink);
    scenLink.click();

    rememberSurface('trade');
    const pairBtn = document.createElement('button');
    pairBtn.className = 'tr-linkbtn';
    pairBtn.textContent = 'bio.water/USDC';
    document.body.appendChild(pairBtn);
    pairBtn.click();

    expect(track.mock.calls.map(([, p]) => [p.surface, p.area, p.action, p.target])).toEqual([
      ['play', 'hq_ai', 'away_toggle', undefined],
      ['play', 'hq_ai', 'away_autotrade_save', undefined],
      ['play', 'hq_ai', 'away_director_toggle', undefined],
      ['play', 'hq_ai', 'away_digest_dismiss', undefined],
      ['play', 'orbit_lobby', 'boot_retry', undefined],
      ['play', 'orbit_lobby', 'queue_cancel', undefined],
      ['play', 'market', 'market_order_cancel', undefined],
      ['play', 'market', 'open_trade_hub', undefined],
      ['play', 'wallet', 'signer_approve', undefined],
      ['play', 'wallet', 'signer_wallet_click', 'meteor'],
      ['me', 'profile', 'open_help_tip', 'section-staking'],
      ['whitepaper', 'cta', 'toggle_canonical_draft', undefined],
      ['landing', 'cta', 'navigate', 'staking'],
      ['trade', 'market', 'select_pair', 'bio.water_USDC'],
    ]);
  });
});
