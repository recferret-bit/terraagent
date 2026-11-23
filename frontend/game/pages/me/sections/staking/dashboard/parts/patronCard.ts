import {
  formatPatronagePlanetLabel,
  PATRONAGE_PLANETS,
  resolveDefaultPatronagePlanetId,
  type StakingPerformanceResponse,
} from '@terra/contracts';
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

export interface PatronZoneHandle {
  readonly zoneEl: HTMLElement;
  readonly stakedText: string;
  readonly effectiveApyText: string;
  setBusy(busy: boolean): void;
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

function buildEligibilityBadge(tier: number, stakedNear: number, leadCount: number): HTMLElement {
  const gap = Math.max(0, 500 - stakedNear);
  const cls = tier >= 4 ? (leadCount > 0 ? 'is-lead' : 'is-eligible') : 'is-locked';
  const label =
    tier >= 4
      ? leadCount > 0
        ? '★ ACTIVE LEAD PATRON'
        : 'ELIGIBLE · TIER 4 ACTIVE'
      : `LOCKED · NEEDS ≥500 NEAR (+${formatNear(gap)})`;
  return el(
    'span',
    {
      className: `ta-stk-badge ta-stk-patron-badge ${cls}`,
      dataset: { testid: 'staking-patron-eligibility', eligible: tier >= 4 ? '1' : '0' },
    },
    label,
  );
}

function buildNominationRules(): HTMLElement {
  return el(
    'ul',
    { className: 'ta-stk-patron-rules plate-sm' },
    el('li', {}, el('b', {}, 'Seat Rule: '), 'Highest active Tier 4 (≥500 NEAR) nominator holds a canonical planet’s 1 Lead Patron seat.'),
    el('li', {}, el('b', {}, 'Canonical Worlds Only: '), 'Applies strictly to Kharon Dunes, Thalassa Verde, and Granite Hollow — paid NFT sovereign planets are excluded.'),
    el('li', {}, el('b', {}, 'Perks & Switching: '), 'Names the planet flagship (ISS <pilot>) & earns 15% of its trade fees; re-nominating switches backing at once.'),
  );
}

function buildCanonicalPlanetField(
  selectedPlanetId: string,
  leadPlanets: readonly string[],
  onNominate?: (planetId: string) => void,
) {
  const planetInputId = 'staking-nominate-planet-input';
  const planetSelect = el(
    'select',
    {
      id: planetInputId,
      className: 'input ta-stk-patron-input',
      aria: { label: 'Canonical planet to nominate for Lead Patron' },
      dataset: { testid: 'staking-nominate-planet' },
    },
    ...PATRONAGE_PLANETS.map((def) => {
      const opt = el('option', {}, `${def.name} · ${def.type.toUpperCase()}`);
      opt.value = def.id;
      return opt;
    }),
  );
  planetSelect.value = selectedPlanetId;

  const chips = PATRONAGE_PLANETS.map((def) => {
    const active = def.id === selectedPlanetId;
    const isLeadOnWorld = leadPlanets.includes(def.id);
    return el(
      'button',
      {
        type: 'button',
        className: `ta-stk-planet-chip plate-sm${active ? ' is-selected' : ''}`,
        aria: { pressed: active ? 'true' : 'false' },
        dataset: {
          testid: `staking-planet-chip-${def.type}`,
          planetId: def.id,
          taArea: 'staking',
          taAction: 'select_patron_planet',
          taTarget: def.type,
        },
        onClick: () => {
          planetSelect.value = def.id;
          syncChips(def.id);
        },
      },
      el('span', { className: 'ta-stk-planet-chip-name' }, `${isLeadOnWorld ? '★ ' : ''}${def.name}`),
      el('span', { className: 'ta-stk-planet-chip-meta' }, def.type.toUpperCase()),
    );
  });
  const syncChips = (targetId: string): void => {
    for (const chip of chips) {
      const on = chip.dataset.planetId === targetId;
      chip.classList.toggle('is-selected', on);
      chip.setAttribute('aria-pressed', on ? 'true' : 'false');
    }
  };
  planetSelect.addEventListener('change', () => syncChips(planetSelect.value));

  const nominateBtn = el(
    'button',
    {
      className: 'btn btn-ghost btn-sm',
      type: 'button',
      dataset: { testid: 'staking-nominate-btn' },
      onClick: () => onNominate?.(planetSelect.value.trim()),
    },
    '★ Nominate Planet',
  );
  const inputLabel = el('label', { className: 'label' }, 'TARGET CANONICAL PLANET · 3 PUBLIC WORLDS ONLY');
  inputLabel.htmlFor = planetInputId;

  const fieldWrap = el(
    'div',
    { className: 'ta-stk-patron-field-wrap' },
    inputLabel,
    el('div', { className: 'ta-stk-planet-chips', dataset: { testid: 'staking-planet-chips' } }, ...chips),
    el('div', { className: 'ta-stk-patron-nominate', dataset: { testid: 'staking-nominate-row' } }, planetSelect, nominateBtn),
  );
  return { fieldWrap, planetSelect, chips, nominateBtn };
}

/**
 * Combined Lead Patron nomination & Social Broadcast section embedded inside the unified Active Tier & Patron hero card.
 */
export function renderPatronZone(p: StakingPerformanceResponse, o: PatronCardOptions): PatronZoneHandle {
  const facts = patronFacts(p);
  const selectedPlanetId = resolveDefaultPatronagePlanetId(facts.leadPlanets[0] ?? o.defaultPlanetId);
  const planets = facts.leadPlanets.length > 0 ? facts.leadPlanets.map(formatPatronagePlanetLabel).join(' · ') : 'No lead-patron seat yet';
  const statusNode = el('p', {
    className: 'ta-stk-status',
    role: 'status',
    dataset: { testid: 'staking-patron-status' },
  });
  statusNode.hidden = true;
  const x = el(
    'a',
    {
      className: 'btn btn-primary btn-sm',
      href: patronTwitterIntentUrl(facts, o.origin),
      target: '_blank',
      rel: 'noopener noreferrer',
      dataset: { testid: 'staking-share-x' },
    },
    'Share on X',
  );
  const social = el(
    'button',
    {
      className: 'btn btn-ghost btn-sm',
      type: 'button',
      dataset: { testid: 'staking-share-social' },
      onClick: () => void postToNearSocial(social, statusNode, p, o),
    },
    'Post to NEAR Social',
  );
  const selector = buildCanonicalPlanetField(selectedPlanetId, facts.leadPlanets, o.onNominate);

  const nominateCol = el(
    'div',
    { className: 'ta-stk-patron-col' },
    el(
      'div',
      { className: 'ta-stk-patron-head' },
      el('span', { className: 'label' }, 'PLANET NOMINATION · KING-OF-THE-HILL'),
      buildEligibilityBadge(p.perks.tier, facts.totalStakedNear, facts.leadPlanets.length),
    ),
    buildNominationRules(),
    el('span', { className: 'ta-stk-patron-seat', dataset: { testid: 'staking-patron-planets' } }, `Lead patron: ${planets}`),
    selector.fieldWrap,
    statusNode,
  );
  const shareCol = el(
    'div',
    { className: 'ta-stk-patron-col ta-stk-patron-col--share' },
    el('span', { className: 'label' }, 'PATRON BROADCAST · SELF-FILLS EXCLUDED'),
    el('div', { className: 'ta-stk-patron-quote plate-sm' }, el('p', { className: 'ta-stk-share-text', dataset: { testid: 'staking-share-text' } }, patronShareText(facts))),
    el('div', { className: 'ta-stk-chips' }, x, social),
  );

  const zoneEl = el(
    'div',
    { className: 'ta-stk-patron-zone', dataset: { testid: 'staking-patron-card', tier: p.perks.tier } },
    el('div', { className: 'ta-stk-patron-grid' }, nominateCol, shareCol),
  );

  return {
    zoneEl,
    stakedText: formatNear(facts.totalStakedNear),
    effectiveApyText: formatPct(facts.effectiveApyBp),
    setBusy(busy: boolean) {
      selector.nominateBtn.disabled = busy;
      social.disabled = busy;
      selector.planetSelect.disabled = busy;
      for (const chip of selector.chips) chip.disabled = busy;
    },
  };
}

/** Standalone wrapper preserved for isolated component tests (`walletSelectorExtras.spec.ts`). */
export function renderPatronCard(p: StakingPerformanceResponse, o: PatronCardOptions): HTMLElement {
  const facts = patronFacts(p);
  const zone = renderPatronZone(p, o);
  const header = buildBlockHeaderWithTip(
    {
      id: 'staking-patron',
      title: 'ORBITAL PATRON CARD',
      description:
        'Stake ≥500 NEAR (Tier 4) and nominate one of the 3 canonical worlds (Kharon Dunes, Thalassa Verde, Granite Hollow) to compete for its Lead Patron seat; sovereign NFT planets are excluded.',
    },
    el('span', { className: 'label' }, 'ORBITAL PATRON CARD'),
  );
  return el(
    'div',
    { className: 'ta-stk-block ta-stk-patron plate', dataset: { testid: 'staking-patron-card-standalone', tier: p.perks.tier } },
    header.head,
    header.panel,
    el('b', { className: 'ta-stk-patron-tier' }, `T${p.perks.tier} ${facts.tierName}`),
    el(
      'div',
      { className: 'ta-stk-patron-stats' },
      el('div', {}, el('span', { className: 'label' }, 'STAKED'), el('b', { dataset: { testid: 'staking-patron-staked' } }, zone.stakedText)),
      el('div', {}, el('span', { className: 'label' }, 'EFFECTIVE APY'), el('b', { dataset: { testid: 'staking-patron-apy' } }, zone.effectiveApyText)),
    ),
    zone.zoneEl,
  );
}
