import type { StakingPerformanceResponse } from '@terra/contracts';
import { readSavedNearWallet } from '../../../../../../../design/pilot/nearWalletStorage';
import { sendTxWithInjectedExtraWallet } from '../../../../../../../design/pilot/walletSelectorExtras';
import { createRealSignerWalletSelector } from '../../../../../../features/deed/parts/realNearWalletDriver';
import {
  getCachedNearActionCreators,
  loadNearActionCreators,
  type StakingSelectorFactory,
} from '../../../../../../features/deed/parts/stakingWalletTx';
import { el } from '../../../../dom';
import { buildBlockHeaderWithTip } from '../../../../parts/helpTip';
import { formatNear, formatPct } from '../../stakingMath';
import type { StakingNetwork } from '../dashboardActions';
import { patronFacts, patronNearSocialTx, patronShareText, patronTwitterIntentUrl } from '../patronShare';

export interface PatronCardOptions {
  readonly accountId: string;
  readonly network: StakingNetwork;
  readonly origin: string;
  readonly defaultPlanetId?: string;
  readonly selectorFactory?: StakingSelectorFactory;
  readonly openWindow?: (url: string) => void;
  readonly onNominate?: (planetId: string) => void;
}

type SocialTx = ReturnType<typeof patronNearSocialTx>;

async function sendSocialTx(tx: SocialTx, net: 'testnet' | 'mainnet', factory?: StakingSelectorFactory): Promise<void> {
  const gasYocto = `${tx.gasTgas}000000000000`;
  const sentViaInjected = !factory
    ? await sendTxWithInjectedExtraWallet(readSavedNearWallet()?.walletId, {
        receiverId: tx.contractId,
        methodName: tx.methodName,
        args: tx.args,
        gasYocto,
        depositYocto: tx.attachedDepositYocto,
      })
    : false;
  if (sentViaInjected) return;
  const cachedCreators = getCachedNearActionCreators();
  const [actionCreators, selector] = cachedCreators
    ? [cachedCreators, await (factory ?? createRealSignerWalletSelector)(net)]
    : await Promise.all([
        loadNearActionCreators(),
        (factory ?? createRealSignerWalletSelector)(net),
      ]);
  const wallet = await selector.wallet();
  await wallet.signAndSendTransaction({
    receiverId: tx.contractId,
    actions: [actionCreators.functionCall(tx.methodName, tx.args, BigInt(gasYocto), BigInt(tx.attachedDepositYocto))],
  });
}

/** Post-to-NEAR-Social: mock records the tx and opens the profile; a real network signs it with the active wallet. */
async function postToNearSocial(
  btn: HTMLElement,
  statusNode: HTMLElement,
  p: StakingPerformanceResponse,
  o: PatronCardOptions,
): Promise<void> {
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
  statusNode.hidden = false;
  statusNode.dataset.tone = 'ok';
  statusNode.textContent =
    o.network === 'mock'
      ? 'Prepared NEAR Social post (local mock) and opened profile preview.'
      : 'Submitted NEAR Social post and opened profile preview.';
  if (o.openWindow) o.openWindow(tx.nearSocialUrl);
  else if (typeof window.open === 'function') window.open(tx.nearSocialUrl, '_blank', 'noopener,noreferrer');
}

/** Shareable Orbital Patron Card; every number is the server's self-fill-excluded figure. */
export function renderPatronCard(p: StakingPerformanceResponse, o: PatronCardOptions): HTMLElement {
  const facts = patronFacts(p);
  const planets = facts.leadPlanets.length > 0 ? facts.leadPlanets.join(' · ') : 'No lead-patron seat yet';
  const statusNode = el('p', {
    className: 'ta-stk-status',
    role: 'status',
    dataset: { testid: 'staking-patron-status' },
  });
  statusNode.hidden = true;
  const x = el('a', { className: 'btn btn-primary btn-sm', href: patronTwitterIntentUrl(facts, o.origin), target: '_blank', rel: 'noopener noreferrer', dataset: { testid: 'staking-share-x' } }, 'Share on X');
  const social = el('button', { className: 'btn btn-ghost btn-sm', type: 'button', dataset: { testid: 'staking-share-social' }, onClick: () => void postToNearSocial(social, statusNode, p, o) }, 'Post to NEAR Social');
  const planetInput = el('input', {
    className: 'input ta-stk-input',
    type: 'text',
    aria: { label: 'Planet ID to nominate for Lead Patron' },
    dataset: { testid: 'staking-nominate-planet' },
  });
  planetInput.placeholder = 'Public planet ID (e.g. pl_...)';
  planetInput.value = facts.leadPlanets[0] ?? o.defaultPlanetId ?? '';
  const nominateBtn = el(
    'button',
    {
      className: 'btn btn-ghost btn-sm',
      type: 'button',
      dataset: { testid: 'staking-nominate-btn' },
      onClick: () => o.onNominate?.(planetInput.value.trim()),
    },
    '★ Nominate Planet',
  );
  const header = buildBlockHeaderWithTip(
    {
      id: 'staking-patron',
      title: 'ORBITAL PATRON CARD',
      description:
        'Stake ≥500 NEAR (Tier 4) and nominate any public planet to compete for its King-of-the-Hill Lead Patron seat — naming the orbital carrier (ISS <pilot>) and earning 15% of the planet’s protocol trade fees.',
    },
    el('span', { className: 'label' }, 'ORBITAL PATRON CARD'),
  );
  return el(
    'div',
    { className: 'ta-stk-block ta-stk-patron plate', dataset: { testid: 'staking-patron-card', tier: p.perks.tier } },
    header.head,
    header.panel,
    el('b', { className: 'ta-stk-patron-tier' }, `T${p.perks.tier} ${facts.tierName}`),
    el('div', { className: 'ta-stk-patron-stats' },
      el('div', {}, el('span', { className: 'label' }, 'STAKED'), el('b', { dataset: { testid: 'staking-patron-staked' } }, formatNear(facts.totalStakedNear))),
      el('div', {}, el('span', { className: 'label' }, 'EFFECTIVE APY'), el('b', { dataset: { testid: 'staking-patron-apy' } }, formatPct(facts.effectiveApyBp))),
    ),
    el('span', { className: 'ta-stk-sub', dataset: { testid: 'staking-patron-planets' } }, `Lead patron: ${planets}`),
    el('div', { className: 'ta-stk-top', dataset: { testid: 'staking-nominate-row' } }, planetInput, nominateBtn),
    statusNode,
    el('p', { className: 'ta-stk-share-text', dataset: { testid: 'staking-share-text' } }, patronShareText(facts)),
    el('div', { className: 'ta-stk-chips' }, x, social),
  );
}
