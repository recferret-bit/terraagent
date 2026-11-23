import { el } from '../../../dom';

interface IntroPillar {
  readonly index: string;
  readonly title: string;
  readonly copy: string;
  readonly accent?: boolean;
}

const PILLARS: readonly IntroPillar[] = [
  {
    index: '01',
    title: '100% PRINCIPAL CUSTODY',
    copy: 'Stake native NEAR, stNEAR, or LiNEAR in your wallet and withdraw matured principal anytime.',
  },
  {
    index: '02',
    title: '80% NET VALIDATOR YIELD',
    copy: 'Rewards accrue live every second; 20% funds gasless NEP-366 relays and protocol compute.',
  },
  {
    index: '03',
    title: 'NEAR.AI TEE & 0.25% FEES',
    copy: 'Higher tiers unlock up to 12 managed autopilot colony slots and cut market taker fees.',
  },
  {
    index: '04',
    title: 'PLANETARY PATRONAGE',
    copy: 'Tier 4 (≥500 NEAR) competes on the 3 canonical worlds to name a flagship & earn 15% of fees (Sovereign NFTs excluded).',
    accent: true,
  },
] as const;

/** Always-visible visual 4-pillar overview banner at the top of `/me.html#staking`. */
export function renderStakingIntroBanner(): HTMLElement {
  return el(
    'div',
    { className: 'ta-stk-intro plate-sm', dataset: { testid: 'staking-intro-banner' } },
    el(
      'div',
      { className: 'ta-stk-intro-grid' },
      ...PILLARS.map((p) =>
        el(
          'div',
          { className: `ta-stk-intro-item plate-sm${p.accent ? ' is-accent' : ''}` },
          el(
            'div',
            { className: 'ta-stk-intro-head' },
            el('span', { className: 'ta-stk-intro-num' }, p.index),
            el('span', { className: 'label' }, p.title),
          ),
          el('p', { className: 'ta-stk-intro-copy' }, p.copy),
        ),
      ),
    ),
  );
}
