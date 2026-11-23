import { describe, expect, it } from 'vitest';
import { ANALYTICS_EVENTS, POSTHOG_GEOIP_PROPS, analyticsEvent, clientMaySend, sanitizeAnalyticsProps } from '../src/analytics/catalog';
import { ANALYTICS_FUNNELS, ANALYTICS_RETENTION, ANALYTICS_TRENDS } from '../src/analytics/funnels';

const NAME = /^[a-z][a-z0-9_]{1,63}$/;

describe('product analytics catalog', () => {
  it('names are unique and legal on the wire', () => {
    const names = ANALYTICS_EVENTS.map((event) => event.name);
    expect(new Set(names).size).toBe(names.length);
    for (const name of names) expect(name).toMatch(NAME);
  });

  it('every funnel step, trend, and retention insight names a catalog event, and pinned failure funnels exclude success', () => {
    for (const funnel of ANALYTICS_FUNNELS) {
      expect(funnel.steps.length).toBeGreaterThan(1);
      expect(funnel.window.interval).toBeGreaterThan(0);
      for (const step of funnel.steps) expect(analyticsEvent(step.event), step.event).toBeDefined();
      if (funnel.id.endsWith('-fail')) expect(funnel.exclusion).toBeTruthy();
    }
    for (const trend of ANALYTICS_TRENDS) expect(analyticsEvent(trend.event), trend.event).toBeDefined();
    for (const ret of ANALYTICS_RETENTION) {
      expect(analyticsEvent(ret.targetEvent), ret.targetEvent).toBeDefined();
      expect(analyticsEvent(ret.returningEvent), ret.returningEvent).toBeDefined();
    }
    expect(POSTHOG_GEOIP_PROPS).toContain('$geoip_country_name');
  });

  it('sanitize keeps closed values and drops identity', () => {
    expect(sanitizeAnalyticsProps('auth_succeeded', {
      method: 'google', wallet_kind: 'none', surface: 'landing', email: 'a@b.c', colonyId: 'c1',
    })).toEqual({ method: 'google', wallet_kind: 'none', surface: 'landing' });
    expect(sanitizeAnalyticsProps('auth_succeeded', { method: 'sms' })).toEqual({});
    expect(sanitizeAnalyticsProps('surface_viewed', { utm_source: 'spring launch', surface: 'landing' })).toEqual({ surface: 'landing' });
    expect(sanitizeAnalyticsProps('trade_ticket_opened', { pair: 'bio.water/USDC', runtime: 'prod' })).toEqual({
      pair: 'bio.water-USDC', runtime: 'prod',
    });
    expect(sanitizeAnalyticsProps('ui_action_clicked', {
      surface: 'play', area: 'build', action: 'select_building', target: 'solar_gen', runtime: 'prod', ip: '1.2.3.4',
    })).toEqual({
      surface: 'play', area: 'build', action: 'select_building', target: 'solar_gen', runtime: 'prod',
    });
    expect(sanitizeAnalyticsProps('hud_panel_opened', {
      book: 'dock', panel: 'build', runtime: 'prod',
    })).toEqual({
      book: 'dock', panel: 'build', runtime: 'prod',
    });
    expect(clientMaySend('auth_completed')).toBe(false);
    expect(clientMaySend('auth_succeeded')).toBe(true);
    expect(clientMaySend('not_a_real_event')).toBe(true);
  });
});
