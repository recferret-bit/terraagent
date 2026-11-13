import { formatAtomic, type MarketTokenKey } from '@terra/contracts';
import type { TradeState } from '../model/state';
import { gate, h, note, table, td } from './dom';

const REF_USDC_MICRO_PER_UNIT: Readonly<Record<string, bigint>> = {
  'metals.t1': 1_200_000n,
  'metals.t2': 3_500_000n,
  'minerals.t1': 1_500_000n,
  'minerals.t2': 4_000_000n,
  'bio.water': 1_000_000n,
  'bio.biomass': 1_800_000n,
  'bio.oil': 2_500_000n,
};

function estimateCargoUsdcMicro(s: TradeState): bigint {
  if (!s.balances) return 0n;
  let sumMicro = 0n;
  for (const [resKey, bal] of Object.entries(s.balances.inOrbit)) {
    const units = BigInt(bal.total || '0');
    if (units <= 0n) continue;
    const topRow = s.top[`${resKey}/USDC`];
    const bestBid = topRow?.bid;
    const liveBid = bestBid ? (BigInt(bestBid.num) / BigInt(Math.max(1, bestBid.den))) : null;
    const unitMicro = liveBid ?? REF_USDC_MICRO_PER_UNIT[resKey] ?? 1_000_000n;
    sumMicro += units * unitMicro;
  }
  return sumMicro;
}

/** Quote tokens plus ONLY the caller's own in-orbit cargo (free vs reserved). `stall` is the Stall Owner Fee editor. */
export function renderBalances(body: HTMLElement, s: TradeState, stall: HTMLElement): void {
  if (!gate(body, s.panels.balances, null)) return;
  const b = s.balances;
  if (!b) { body.replaceChildren(note('No colony of yours on this planet. Join it from the game first, then your balances appear here.', 'warn')); return; }
  const quote = Object.entries(b.quote).map(([k, v]) => h('tr', {}, td(k), td(formatAtomic(k as MarketTokenKey, v.free), 'num'), td(formatAtomic(k as MarketTokenKey, v.reserved), 'num'), td(formatAtomic(k as MarketTokenKey, v.total), 'num')));
  const cargo = Object.entries(b.inOrbit).map(([k, v]) => h('tr', {}, td(k), td(v.free, 'num'), td(v.reserved, 'num'), td(v.total, 'num')));
  const estUsdcMicro = estimateCargoUsdcMicro(s);
  const valCard = h('div', { class: 'tr-val-card', 'data-testid': 'est-orbital-cargo-value' },
    h('span', { class: 'tr-hint' }, 'EST. ORBITAL CARGO VALUE'),
    h('strong', { class: 'num' }, `${formatAtomic('USDC', estUsdcMicro)} USDC`));
  body.replaceChildren(
    h('div', { class: 'tr-row tr-between' }, h('p', { class: 'tr-hint' }, `Your colony on ${b.planetId}`), valCard),
    quote.length ? table([{ label: 'QUOTE TOKEN' }, { label: 'FREE', num: true }, { label: 'RESERVED', num: true }, { label: 'TOTAL', num: true }], quote, 'Quote balances') : note('No quote tokens yet.'),
    cargo.length ? table([{ label: 'IN ORBIT (NEP-245)' }, { label: 'FREE', num: true }, { label: 'RESERVED', num: true }, { label: 'TOTAL', num: true }], cargo, 'In-orbit cargo') : note('No cargo in orbit yet. Export surface stock from your Trade Hub in-game.'),
    stall,
    note('Only NEP-245 cargo exported to orbit can be sold here. In-game: select Trade Hub -> EXPORT TO ORBIT (gasless via NEP-366).'));
}
