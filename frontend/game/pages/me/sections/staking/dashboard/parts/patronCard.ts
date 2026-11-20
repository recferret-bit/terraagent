import type { StakingPerformanceResponse } from '@terra/contracts';
import { createRealSignerWalletSelector } from '../../../../../../features/deed/parts/realNearWalletDriver';
import type { StakingSelectorFactory } from '../../../../../../features/deed/parts/stakingWalletTx';
import { el } from '../../../../dom';
import { formatNear, formatPct } from '../../stakingMath';
import type { StakingNetwork } from '../dashboardActions';
import { patronFacts, patronNearSocialTx, patronShareText, patronTwitterIntentUrl } from '../patronShare';

export interface PatronCardOptions {
  readonly accountId: string;
  readonly network: StakingNetwork;
  readonly origin: string;
  readonly selectorFactory?: StakingSelectorFactory;
  readonly openWindow?: (url: string) => void;
}

type SocialTx = ReturnType<typeof patronNearSocialTx>;

async function sendSocialTx(tx: SocialTx, net: 'testnet' | 'mainnet', factory?: StakingSelectorFactory): Promise<void> {
  const [{ actionCreators }, selector] = await Promise.all([
    import('@near-wallet-selector/core'),
    (factory ?? createRealSignerWalletSelector)(net),
  ]);
  const wallet = await selector.wallet();
  await wallet.signAndSendTransaction({
    receiverId: tx.contractId,
    actions: [actionCreators.functionCall(tx.methodName, tx.args, BigInt(`${tx.gasTgas}000000000000`), BigInt(tx.attachedDepositYocto))],
  });
}

/** Post-to-NEAR-Social: mock records the tx and opens the profile; a real network signs it with the active wallet. */
async function postToNearSocial(btn: HTMLElement, p: StakingPerformanceResponse, o: PatronCardOptions): Promise<void> {
  const net = o.network === 'mainnet' ? 'mainnet' : 'testnet';
  const tx = patronNearSocialTx(patronFacts(p), o.origin, o.accountId, net);
  btn.dataset.lastSocialTx = JSON.stringify({ contractId: tx.contractId, methodName: tx.methodName, attachedDepositYocto: tx.attachedDepositYocto, gasTgas: tx.gasTgas });
  if (o.network !== 'mock') {
    try {
      await sendSocialTx(tx, net, o.selectorFactory);
    } catch {
      /* no wallet connected: still open the profile view like the deed share */
    }
  }
  if (o.openWindow) o.openWindow(tx.nearSocialUrl);
  else if (typeof window.open === 'function') window.open(tx.nearSocialUrl, '_blank', 'noopener,noreferrer');
}

/** Shareable Orbital Patron Card; every number is the server's self-fill-excluded figure. */
export function renderPatronCard(p: StakingPerformanceResponse, o: PatronCardOptions): HTMLElement {
  const facts = patronFacts(p);
  const planets = facts.leadPlanets.length > 0 ? facts.leadPlanets.join(' · ') : 'No lead-patron seat yet';
  const x = el('a', { className: 'btn btn-primary btn-sm', href: patronTwitterIntentUrl(facts, o.origin), target: '_blank', rel: 'noopener noreferrer', dataset: { testid: 'staking-share-x' } }, 'Share on X');
  const social = el('button', { className: 'btn btn-sm', type: 'button', dataset: { testid: 'staking-share-social' }, onClick: () => void postToNearSocial(social, p, o) }, 'Post to NEAR Social');
  return el(
    'div',
    { className: 'ta-stk-block ta-stk-patron plate', dataset: { testid: 'staking-patron-card', tier: p.perks.tier } },
    el('span', { className: 'label' }, 'ORBITAL PATRON CARD'),
    el('b', { className: 'ta-stk-patron-tier' }, `T${p.perks.tier} ${facts.tierName}`),
    el('div', { className: 'ta-stk-patron-stats' },
      el('div', {}, el('span', { className: 'label' }, 'STAKED'), el('b', { dataset: { testid: 'staking-patron-staked' } }, formatNear(facts.totalStakedNear))),
      el('div', {}, el('span', { className: 'label' }, 'EFFECTIVE APY'), el('b', { dataset: { testid: 'staking-patron-apy' } }, formatPct(facts.effectiveApyBp))),
    ),
    el('span', { className: 'ta-stk-sub', dataset: { testid: 'staking-patron-planets' } }, `Lead patron: ${planets}`),
    el('p', { className: 'ta-stk-share-text', dataset: { testid: 'staking-share-text' } }, patronShareText(facts)),
    el('div', { className: 'ta-stk-chips' }, x, social),
  );
}
