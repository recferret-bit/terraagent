import { describe, expect, it } from 'vitest';
import { makePerformance } from './dashboardFixtures';
import { patronFacts, patronNearSocialTx, patronShareText, patronShareUrl, patronTwitterIntentUrl } from './patronShare';

describe('patron share', () => {
  const facts = patronFacts(makePerformance());
  it('text uses the self-fill-excluded effective APY and the total staked', () => {
    const text = patronShareText(facts);
    expect(text).toContain('Commander');
    expect(text).toContain('70.50');
    expect(text).toContain('8.10%');
    expect(text).toContain('self-fills excluded');
    expect(text).toContain('Lead Patron of dune');
  });
  it('no lead planets: the planet clause is omitted (corner)', () => {
    expect(patronShareText({ ...facts, leadPlanets: [] })).not.toContain('Lead Patron');
  });
  it('X intent URL carries text and url', () => {
    const u = new URL(patronTwitterIntentUrl(facts, 'https://terra.example/'));
    expect(u.origin + u.pathname).toBe('https://twitter.com/intent/tweet');
    expect(u.searchParams.get('text')).toBe(patronShareText(facts));
    expect(u.searchParams.get('url')).toBe('https://terra.example/me.html#staking');
    expect(patronShareUrl('https://a.b///')).toBe('https://a.b/me.html#staking');
  });
  it('NEAR Social tx: testnet -> v1.social08.testnet, mainnet -> social.near, post under the account', () => {
    const t = patronNearSocialTx(facts, 'https://x', 'pilot.testnet', 'testnet');
    expect(t.contractId).toBe('v1.social08.testnet');
    expect(t.methodName).toBe('set');
    const post = JSON.parse((t.args.data['pilot.testnet'] as { post: { main: string } }).post.main) as { text: string };
    expect(post.text).toContain(patronShareText(facts));
    expect(patronNearSocialTx(facts, 'https://x', 'p.near', 'mainnet').contractId).toBe('social.near');
  });
});
