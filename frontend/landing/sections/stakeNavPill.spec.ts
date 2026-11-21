// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { bindStakeCalculator, renderStakingCalculatorHtml } from './stakeCalculator';
import { initStakeNavPill } from './stakeNavPill';

const resp = (status: number, body: unknown): typeof fetch => (async () => new Response(JSON.stringify(body), { status })) as typeof fetch;

describe('stake nav pill', () => {
  it('falls back to 7.20% SIM APY on 404', async () => {
    const host = document.createElement('div');
    await initStakeNavPill(host, resp(404, {}));
    const pill = host.querySelector<HTMLAnchorElement>('.stake-pill')!;
    expect(pill.getAttribute('href')).toBe('/me.html#staking');
    expect(pill.textContent).toContain('STAKE · LIVE APY');
    expect(pill.textContent).toContain('7.20% SIM APY');
  });
  it('falls back when the network throws', async () => {
    const host = document.createElement('div');
    await initStakeNavPill(host, (async () => { throw new Error('down'); }) as typeof fetch);
    expect(host.querySelector('.stake-pill-badge')!.textContent).toBe('7.20% SIM APY');
  });
  it('shows the live APY from the overview endpoint', async () => {
    const host = document.createElement('div');
    await initStakeNavPill(host, resp(200, { apy: { netApyBp: 480, source: 'live' } }));
    expect(host.querySelectorAll('.stake-pill')).toHaveLength(1);
    expect(host.querySelector('.stake-pill-badge')!.textContent).toBe('4.80% APY');
  });
  it('is a no-op without a host', async () => { await expect(initStakeNavPill(null, resp(200, {}))).resolves.toBeUndefined(); });
});

describe('staking calculator wiring', () => {
  const mount = (): { root: HTMLElement; set: (v: number) => void; cta: HTMLAnchorElement } => {
    const root = document.createElement('div');
    root.innerHTML = renderStakingCalculatorHtml();
    bindStakeCalculator(root);
    const slider = root.querySelector<HTMLInputElement>('#econ-stake-slider')!;
    return {
      root, cta: root.querySelector<HTMLAnchorElement>('#econ-stake-cta')!,
      set: (v) => { slider.value = String(v); slider.dispatchEvent(new Event('input')); },
    };
  };
  it('slider spans 0..500 with four tier markers', () => {
    const { root } = mount();
    const s = root.querySelector<HTMLInputElement>('#econ-stake-slider')!;
    expect([s.min, s.max]).toEqual(['0', '500']);
    expect(root.querySelectorAll('.econ-tier-marker')).toHaveLength(4);
  });
  it('200 NEAR -> CTA text and href', () => {
    const { set, cta } = mount();
    set(200);
    expect(cta.textContent).toBe('STAKE 200 NEAR · UNLOCK TIER 3 →');
    expect(cta.getAttribute('href')).toBe('/me.html#staking?amount=200');
  });
  it('0 NEAR -> entry CTA; 49 vs 50 changes tier, fee and warmup note', () => {
    const { root, set, cta } = mount();
    set(0);
    expect(cta.textContent).toBe('STAKE 10 NEAR · UNLOCK TIER 1 →');
    set(49);
    expect(root.querySelector('#econ-fee-saved')!.textContent).toContain('65 bp');
    expect(root.querySelector('#econ-fee-note')!.textContent).not.toContain('warmup');
    set(50);
    expect(root.querySelector('#econ-fee-saved')!.textContent).toContain('50 bp');
    expect(root.querySelector('#econ-fee-note')!.textContent).toContain('24h');
  });
  it('500 NEAR shows the 500+ label and Tier 4', () => {
    const { root, set, cta } = mount();
    set(500);
    expect(root.querySelector('#econ-stake-out')!.textContent).toBe('500+ NEAR');
    expect(cta.textContent).toContain('TIER 4');
  });
});
