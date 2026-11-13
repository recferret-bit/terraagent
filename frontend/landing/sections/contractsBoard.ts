// Deployed NEAR Testnet smart contract showcase (5 Rust near-sdk 5.7 contracts + 3 protocol accounts)
// with smooth scroll-driven reveal across Section 06 (#chain).
import { clamp, prefersReducedMotion } from '@terra/render/core/StageHost';

interface DeployedContract {
  readonly step: string;
  readonly accountId: string;
  readonly badge: string;
  readonly badgeClass: string;
  readonly accent: string;
  readonly kicker: string;
  readonly title: string;
  readonly summary: string;
  readonly inGameTrigger: string;
  readonly onChainAction: string;
  readonly codeHash: string;
  readonly txHash: string;
  readonly iconSvg: string;
}

const EXPLORER = 'https://testnet.nearblocks.io';

const CONTRACTS: readonly DeployedContract[] = [
  {
    step: '01',
    accountId: 'res.terraagent.testnet',
    badge: 'NEP-245',
    badgeClass: 'badge-ok',
    accent: 'var(--ta-terra)',
    kicker: 'REAL RESOURCE TOKENS',
    title: 'Orbital Cargo Multi-Token',
    summary: 'Exported resources mint as real NEP-245 tokens and settle cross-colony swaps through NEAR Intents.',
    inGameTrigger: 'Trade Hub Export',
    onChainAction: 'mt_mint · intents.near',
    codeHash: '9KrGRQKkAMUP8qCEGk5CC6pgK9E79V1js46EipXTsvym',
    txHash: '7r2V4bttfkSjKBuFc2y4hKHjmd8FDQuDexnfLNSNUTFh',
    iconSvg: `<svg viewBox="0 0 48 48" fill="none" aria-hidden="true">
      <polygon points="24,6 40,15 40,33 24,42 8,33 8,15" fill="#0E1A14" stroke="#3DDC84" stroke-width="1.8"/>
      <path d="M8 15 L24 24 L40 15 M24 24 V42" stroke="#3DDC84" stroke-width="1.4" stroke-opacity=".7"/>
      <circle cx="24" cy="15" r="3" fill="#3DDC84"/>
    </svg>`,
  },
  {
    step: '02',
    accountId: 'deed.terraagent.testnet',
    badge: 'NEP-171',
    badgeClass: 'badge-new',
    accent: 'var(--ta-blue-hi)',
    kicker: 'LIVING COLONY IDENTITY',
    title: 'Colony Deeds & Badges NFT',
    summary: 'Soulbound Colony Deeds evolve automatically as your colony unlocks terraforming stages and milestone badges.',
    inGameTrigger: 'Stage Milestone',
    onChainAction: 'mint_deed · update_metadata',
    codeHash: 'GFB5WgL1hMiCSFZSNjiXdYhui68ptf2AyDvFHZGUR6pB',
    txHash: '72R9C6pU6HKw25HBpX4XSFHXQhGxFhoCE1SQzTgkiUUW',
    iconSvg: `<svg viewBox="0 0 48 48" fill="none" aria-hidden="true">
      <polygon points="24,5 39,13 39,31 24,43 9,31 9,13" fill="#0F1626" stroke="#5B8CFF" stroke-width="1.8"/>
      <polygon points="24,13 31,18 31,28 24,34 17,28 17,18" stroke="#39D0FF" stroke-width="1.4"/>
      <circle cx="24" cy="23" r="3.5" fill="#5B8CFF"/>
    </svg>`,
  },
  {
    step: '03',
    accountId: 'bounty.terraagent.testnet',
    badge: 'ESCROW',
    badgeClass: 'badge-recruiting',
    accent: 'var(--ta-orange)',
    kicker: 'TRUSTLESS MERCENARIES',
    title: 'Mercenary & Raid Bounty Escrow',
    summary: 'Lock cargo escrows to fund counter-raids and defense bounties with deterministic claim verification.',
    inGameTrigger: 'Post Raid Bounty',
    onChainAction: 'open_escrow · claim_escrow',
    codeHash: '6VGAZh8udooNjj85LyzBZT4jY1959FWFBJ3KBugGVtuH',
    txHash: 'GDDYUk826TgGxDWiTq9y6PdNKW7HpfGoe8hQrMXccNFG',
    iconSvg: `<svg viewBox="0 0 48 48" fill="none" aria-hidden="true">
      <circle cx="24" cy="24" r="15" fill="#1B120C" stroke="#FF6A13" stroke-width="1.8" stroke-dasharray="6 3"/>
      <circle cx="24" cy="24" r="7" stroke="#FF8A3D" stroke-width="1.5"/>
      <path d="M24 5V12M24 36V43M5 24H12M36 24H43" stroke="#FF6A13" stroke-width="1.6"/>
      <circle cx="24" cy="24" r="2.5" fill="#FF6A13"/>
    </svg>`,
  },
  {
    step: '04',
    accountId: 'staking.terraagent.testnet',
    badge: 'HUMAN ONLY',
    badgeClass: 'badge-ai',
    accent: 'var(--ta-energy)',
    kicker: 'GUARDRAILED YIELD VAULT',
    title: 'Validator Staking Vault',
    summary: 'Stake NEAR through your colony for validator rewards—strictly gated to human pilots (AI callers blocked 403).',
    inGameTrigger: 'Pilot Vault Deposit',
    onChainAction: 'stake · withdraw (403 AI)',
    codeHash: '9K2xHY4QZh7wfXAdf8pxogviBortXP4mM722W3k97NeC',
    txHash: 'CJAeXB8YVZqrXPQQRRMMY2s6sBY7Ma17gE1thZ9CHAyX',
    iconSvg: `<svg viewBox="0 0 48 48" fill="none" aria-hidden="true">
      <rect x="11" y="20" width="26" height="20" fill="#0D1924" stroke="#39D0FF" stroke-width="1.8"/>
      <path d="M16 20V14C16 9.6 19.6 6 24 6C28.4 6 32 9.6 32 14V20" stroke="#5B8CFF" stroke-width="1.8"/>
      <circle cx="24" cy="29" r="3" fill="#39D0FF"/>
      <path d="M24 32V36" stroke="#39D0FF" stroke-width="1.8"/>
    </svg>`,
  },
  {
    step: '05',
    accountId: 'dao.terraagent.testnet',
    badge: 'TREASURY DAO',
    badgeClass: 'badge-tier',
    accent: 'var(--ta-orange-hi)',
    kicker: 'PLANETARY GOVERNANCE',
    title: 'Planet Council Treasury DAO',
    summary: 'Colonies pool taxes into a shared planetary treasury and vote on hazard shields and sector grants.',
    inGameTrigger: 'Council Proposal',
    onChainAction: 'propose · vote · finalize',
    codeHash: 'ByT7esMkAqrtAi7SceUhDM5aauA1XfoUPt88fVvz5L8r',
    txHash: '4DVcXY5cV4uGRA5rtcoy6HhqPAhi2QwuKgwtjTvJedHn',
    iconSvg: `<svg viewBox="0 0 48 48" fill="none" aria-hidden="true">
      <circle cx="24" cy="24" r="16" fill="#161412" stroke="#FF8A3D" stroke-width="1.6"/>
      <polygon points="24,12 34,29 14,29" stroke="#F2F4F7" stroke-width="1.5" fill="none"/>
      <circle cx="24" cy="12" r="3" fill="#FF6A13"/>
      <circle cx="34" cy="29" r="3" fill="#5B8CFF"/>
      <circle cx="14" cy="29" r="3" fill="#3DDC84"/>
    </svg>`,
  },
];

const ACCOUNTS = [
  { label: 'ROOT', id: 'terraagent.testnet' },
  { label: 'NEP-366 RELAYER', id: 'relayer.terraagent.testnet' },
  { label: 'OPERATOR / MINTER', id: 'minter.terraagent.testnet' },
] as const;

function renderContractRow(c: DeployedContract, index: number): string {
  return `<div class="chain-row-wrap" data-chain-item style="--cf-accent:${c.accent};--cf-delay:${index * 75}ms">
    <span class="chain-node" aria-hidden="true"></span>
    <article class="contract-row chain-feature plate-sm" data-code-hash="${c.codeHash}">
      <div class="chain-icon plate-sm">${c.iconSvg}</div>
      <div class="chain-main">
        <div class="contract-top">
          <span class="chain-step">${c.step} · ${c.kicker}</span>
          <span class="badge ${c.badgeClass}">${c.badge}</span>
        </div>
        <h3>${c.title}</h3>
        <p>${c.summary}</p>
      </div>
      <div class="chain-side">
        <div class="chain-flow plate-sm" aria-label="Gameplay to on-chain flow">
          <span class="flow-from">${c.inGameTrigger}</span>
          <span class="flow-arrow" aria-hidden="true">→</span>
          <code class="flow-to">${c.onChainAction}</code>
        </div>
        <div class="chain-links">
          <a class="contract-id" href="${EXPLORER}/address/${c.accountId}" target="_blank" rel="noopener noreferrer">${c.accountId} <span aria-hidden="true">↗</span></a>
          <a class="contract-tx" href="${EXPLORER}/txns/${c.txHash}" target="_blank" rel="noopener noreferrer" title="Code hash: ${c.codeHash}">TX ${c.txHash.slice(0, 8)}… <span aria-hidden="true">↗</span></a>
        </div>
      </div>
    </article>
  </div>`;
}

function bindChainScrollReveal(section: HTMLElement, stream: HTMLElement): void {
  const topCards = [...section.querySelectorAll<HTMLElement>('.grid-auto > .card')];
  const rows = [...stream.querySelectorAll<HTMLElement>('[data-chain-item]')];
  const reduced = prefersReducedMotion();
  if (reduced) {
    stream.style.setProperty('--chain-p', '1');
    topCards.forEach((el) => el.classList.add('is-visible'));
    rows.forEach((el) => el.classList.add('is-active'));
    return;
  }
  section.classList.add('js-chain');
  topCards.forEach((el, i) => el.style.setProperty('--card-delay', `${i * 110}ms`));

  const update = () => {
    const trigger = innerHeight * 0.78;
    for (const card of topCards) {
      if (card.getBoundingClientRect().top < trigger) card.classList.add('is-visible');
    }
    const r = stream.getBoundingClientRect();
    const p = clamp((innerHeight * 0.68 - r.top) / Math.max(r.height, 1), 0, 1);
    stream.style.setProperty('--chain-p', p.toFixed(3));
    for (const row of rows) {
      row.classList.toggle('is-active', row.getBoundingClientRect().top < trigger);
    }
  };

  let queued = false;
  const onScroll = () => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => {
      queued = false;
      update();
    });
  };
  addEventListener('scroll', onScroll, { passive: true });
  addEventListener('resize', onScroll);
  update();
}

export function initContractsBoard(): void {
  const host = document.getElementById('contracts-board');
  if (!host) return;

  const cards = CONTRACTS.map(renderContractRow).join('');
  const acctLinks = ACCOUNTS.map(
    (a) =>
      `<span class="acct-pill plate-sm"><b>${a.label}</b><a href="${EXPLORER}/address/${a.id}" target="_blank" rel="noopener noreferrer">${a.id} ↗</a></span>`,
  ).join('');

  host.innerHTML = `<div class="board-h contracts-board-h">
      <span><i class="dot-live"></i> DEPLOYED ON NEAR TESTNET · 5 RUST SMART CONTRACTS (NEAR-SDK 5.7)</span>
      <span>11 / 11 PORTS LIVE · TEST.RPC.FASTNEAR.COM</span>
    </div>
    <div class="chain-stream" id="chain-stream">
      <div class="chain-spine" aria-hidden="true"><i class="chain-spine-fill"></i></div>
      <div class="contracts-list">${cards}</div>
    </div>
    <div class="contract-accounts">
      ${acctLinks}
      <span class="acct-pill plate-sm"><b>INTENTS</b><code>intents.near (NEP-413 token_diff) + 1Click</code></span>
    </div>`;

  const section = host.closest<HTMLElement>('#chain') ?? host;
  const stream = host.querySelector<HTMLElement>('#chain-stream');
  if (stream) bindChainScrollReveal(section, stream);
}
