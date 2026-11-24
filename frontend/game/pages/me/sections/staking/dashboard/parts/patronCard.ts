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
import { totalStakedNear } from '../dashboardMath';
import type { StakingNetwork } from '../dashboardActions';
import { patronFacts, patronNearSocialTx, patronShareText, patronTwitterIntentUrl } from '../patronShare';
import { renderPatronTables, type PatronHistoryScope } from './patronTables';

export interface PatronCardOptions {
  readonly accountId: string;
  readonly network: StakingNetwork;
  readonly origin: string;
  readonly defaultPlanetId?: string;
  readonly initialHistoryScope?: PatronHistoryScope;
  readonly selectorFactory?: StakingSelectorFactory;
  readonly openWindow?: (url: string) => void;
  readonly onSelectPlanet?: (planetId: string) => void;
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
  let walletSigned = true;
  if (o.network !== 'mock') {
    try {
      await sendSocialTx(tx, net, o.selectorFactory);
    } catch {
      walletSigned = false;
    }
  }
  statusNode.hidden = false;
  if (o.network === 'mock') {
    statusNode.dataset.tone = 'ok';
    statusNode.textContent = 'Prepared NEAR Social post (local mock) and opened profile preview.';
  } else if (walletSigned) {
    statusNode.dataset.tone = 'ok';
    statusNode.textContent = 'Submitted NEAR Social post and opened profile preview.';
  } else {
    statusNode.dataset.tone = 'warn';
    statusNode.textContent = 'Wallet did not sign NEAR Social post — opened profile preview.';
  }
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
    el('li', {}, el('b', {}, 'Automatic Seat Rule: '), 'Top active Tier 4 (≥500 NEAR) staker backing a canonical planet automatically holds its Lead Patron seat.'),
    el('li', {}, el('b', {}, 'Canonical Worlds Only: '), 'Applies strictly to Kharon Dunes, Thalassa Verde, and Granite Hollow — paid NFT sovereign planets are excluded.'),
    el('li', {}, el('b', {}, 'Perks & Switching: '), 'Names the planet flagship (ISS <pilot>) & earns 15% of the Protocol’s trade-fee cut (12% of gross on standard 20% DAO fills; self-fills excluded). Switch tabs below to inspect each world.'),
  );
}

function tabSeatSummary(
  p: StakingPerformanceResponse,
  planetId: string,
  leadPlanets: readonly string[],
): { readonly text: string; readonly tone: 'mine' | 'occupied' | 'vacant' } {
  const lead = p.patronage?.planets.find((pl) => pl.planetId === planetId)?.leadPatron ?? null;
  if (leadPlanets.includes(planetId)) {
    const nearTxt = lead ? formatNear(Number(lead.activeStakedNear)) : formatNear(totalStakedNear(p.balances));
    return { text: `★ YOUR SEAT (${nearTxt})`, tone: 'mine' };
  }
  if (lead) return { text: `Lead: ${lead.carrierName} (${formatNear(Number(lead.activeStakedNear))})`, tone: 'occupied' };
  return { text: 'Seat vacant · ≥500 NEAR', tone: 'vacant' };
}

function buildCanonicalPlanetTabs(
  p: StakingPerformanceResponse,
  selectedPlanetId: string,
  leadPlanets: readonly string[],
  onSelectPlanet?: (planetId: string) => void,
) {
  const tabs = PATRONAGE_PLANETS.map((def) => {
    const active = def.id === selectedPlanetId;
    const isLeadOnWorld = leadPlanets.includes(def.id);
    const seat = tabSeatSummary(p, def.id, leadPlanets);
    return el(
      'button',
      {
        type: 'button',
        id: `staking-patron-tab-${def.type}`,
        className: `ta-stk-patron-tab${active ? ' is-selected' : ''}`,
        role: 'tab',
        aria: { selected: active ? 'true' : 'false', controls: 'staking-patron-tabpanel' },
        dataset: {
          testid: `staking-planet-chip-${def.type}`,
          planetId: def.id,
          taArea: 'staking',
          taAction: 'select_patron_planet',
          taTarget: def.type,
        },
        onClick: () => {
          for (const tab of tabs) {
            const on = tab.dataset.planetId === def.id;
            tab.classList.toggle('is-selected', on);
            tab.setAttribute('aria-selected', on ? 'true' : 'false');
          }
          onSelectPlanet?.(def.id);
        },
      },
      el(
        'div',
        { className: 'ta-stk-patron-tab-top' },
        el('span', { className: 'ta-stk-planet-chip-name' }, `${isLeadOnWorld ? '★ ' : ''}${def.name}`),
        el('span', { className: 'ta-stk-planet-chip-meta' }, def.type.toUpperCase()),
      ),
      el('span', { className: 'ta-stk-patron-tab-seat', dataset: { tone: seat.tone } }, seat.text),
    );
  });

  const tablistEl = el(
    'div',
    {
      className: 'ta-stk-patron-tablist',
      role: 'tablist',
      aria: { label: 'Canonical worlds patronage competition and history' },
      dataset: { testid: 'staking-planet-chips' },
    },
    ...tabs,
  );
  return { tablistEl, tabs };
}

/**
 * Standalone Planetary Patronage block with 3 connected content-switch world tabs, Current Competition & History tables,
 * automatic backing on stake/tab switch, and Social Broadcast sharing.
 */
export function renderPatronZone(p: StakingPerformanceResponse, o: PatronCardOptions): PatronZoneHandle {
  const facts = patronFacts(p);
  const selectedPlanetId = resolveDefaultPatronagePlanetId(
    o.defaultPlanetId ?? facts.leadPlanets[0] ?? p.patronage?.nominatedPlanetId,
  );
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
  const tables = renderPatronTables(p, selectedPlanetId, o.initialHistoryScope);
  const planetTabs = buildCanonicalPlanetTabs(p, selectedPlanetId, facts.leadPlanets, (planetId) => {
    tables.setPlanet(planetId);
    o.onSelectPlanet?.(planetId);
  });

  const nominateCol = el(
    'div',
    { className: 'ta-stk-patron-col' },
    el(
      'div',
      { className: 'ta-stk-patron-head' },
      el('span', { className: 'label' }, 'PLANETARY PATRONAGE · KING-OF-THE-HILL'),
      buildEligibilityBadge(p.perks.tier, facts.totalStakedNear, facts.leadPlanets.length),
    ),
    buildNominationRules(),
    el(
      'div',
      { className: 'ta-stk-patron-foot' },
      el('span', { className: 'ta-stk-patron-seat', dataset: { testid: 'staking-patron-planets' } }, `Lead patron: ${planets}`),
      statusNode,
    ),
  );
  const shareCol = el(
    'div',
    { className: 'ta-stk-patron-col ta-stk-patron-col--share' },
    el('div', { className: 'ta-stk-patron-head' }, el('span', { className: 'label' }, 'PATRON BROADCAST · SELF-FILLS EXCLUDED')),
    el('div', { className: 'ta-stk-patron-quote plate-sm' }, el('p', { className: 'ta-stk-share-text', dataset: { testid: 'staking-share-text' } }, patronShareText(facts))),
    el('div', { className: 'ta-stk-chips' }, x, social),
  );

  const tabPanel = el(
    'div',
    {
      id: 'staking-patron-tabpanel',
      className: 'ta-stk-patron-tabpanel',
      role: 'tabpanel',
      dataset: { testid: 'staking-patron-tabpanel' },
    },
    tables.el,
  );

  const zoneEl = el(
    'div',
    { className: 'ta-stk-block plate-sm ta-stk-pad ta-stk-patron-block', dataset: { testid: 'staking-patron-card', tier: p.perks.tier } },
    el('div', { className: 'ta-stk-patron-grid' }, nominateCol, shareCol),
    el('div', { className: 'ta-stk-patron-tabs-wrap' }, planetTabs.tablistEl, tabPanel),
  );

  return {
    zoneEl,
    stakedText: formatNear(facts.totalStakedNear),
    effectiveApyText: formatPct(facts.effectiveApyBp),
    setBusy(_busy: boolean) {
      /* Tab switching and social broadcast never lock during unrelated dashboard mutations. */
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
