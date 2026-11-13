// Deployed NEAR Testnet smart contract registry (5 Rust near-sdk 5.7 contracts + 3 protocol accounts).

interface DeployedContract {
  readonly accountId: string;
  readonly badge: string;
  readonly badgeClass: string;
  readonly title: string;
  readonly summary: string;
  readonly methods: string;
  readonly codeHash: string;
  readonly txHash: string;
}

const EXPLORER = 'https://testnet.nearblocks.io';

const CONTRACTS: readonly DeployedContract[] = [
  {
    accountId: 'res.terraagent.testnet',
    badge: 'NEP-245',
    badgeClass: 'badge-ok',
    title: 'Orbital Cargo Multi-Token',
    summary:
      'Mints on Trade Hub export and burns on import for all 10 resource classes (metals, minerals, bio, t1-t3) settled via intents.near.',
    methods: 'mt_mint · mt_burn · mt_transfer · operator_transfer',
    codeHash: '9KrGRQKkAMUP8qCEGk5CC6pgK9E79V1js46EipXTsvym',
    txHash: '7r2V4bttfkSjKBuFc2y4hKHjmd8FDQuDexnfLNSNUTFh',
  },
  {
    accountId: 'deed.terraagent.testnet',
    badge: 'NEP-171',
    badgeClass: 'badge-new',
    title: 'Colony Deeds & Badges NFT',
    summary:
      'Soulbound living Colony Deed NFTs (nft_transfer blocked while active) tracking milestones, terraform progress, and badge achievements.',
    methods: 'mint_deed · update_metadata · nft_token · owner_of',
    codeHash: 'GFB5WgL1hMiCSFZSNjiXdYhui68ptf2AyDvFHZGUR6pB',
    txHash: '72R9C6pU6HKw25HBpX4XSFHXQhGxFhoCE1SQzTgkiUUW',
  },
  {
    accountId: 'bounty.terraagent.testnet',
    badge: 'ESCROW',
    badgeClass: 'badge-recruiting',
    title: 'Mercenary & Raid Bounty Escrow',
    summary:
      'Locks colony cargo escrows for raid defense, counter-raids, and automated bot bounties with deterministic op_id claim and expiry refunds.',
    methods: 'open_escrow · claim_escrow · refund_escrow · get_escrow',
    codeHash: '6VGAZh8udooNjj85LyzBZT4jY1959FWFBJ3KBugGVtuH',
    txHash: 'GDDYUk826TgGxDWiTq9y6PdNKW7HpfGoe8hQrMXccNFG',
  },
  {
    accountId: 'staking.terraagent.testnet',
    badge: 'HUMAN ONLY',
    badgeClass: 'badge-ai',
    title: 'Validator Staking Vault',
    summary:
      'Overflow-free yoctoNEAR reward accrual and 2 game-day unbonding strictly gated to human pilots (AI callers blocked 403 AI_STAKING_FORBIDDEN).',
    methods: 'credit_near · stake · unstake · withdraw · get_position',
    codeHash: '9K2xHY4QZh7wfXAdf8pxogviBortXP4mM722W3k97NeC',
    txHash: 'CJAeXB8YVZqrXPQQRRMMY2s6sBY7Ma17gE1thZ9CHAyX',
  },
  {
    accountId: 'dao.terraagent.testnet',
    badge: 'TREASURY DAO',
    badgeClass: 'badge-tier',
    title: 'Planet Council Treasury DAO',
    summary:
      'On-chain planet-wide treasury deposits, council membership, hazard-shield proposals, and quorum voting finalized from simulation events.',
    methods: 'create_dao · deposit · propose · vote · finalize',
    codeHash: 'ByT7esMkAqrtAi7SceUhDM5aauA1XfoUPt88fVvz5L8r',
    txHash: '4DVcXY5cV4uGRA5rtcoy6HhqPAhi2QwuKgwtjTvJedHn',
  },
];

const ACCOUNTS = [
  { label: 'ROOT', id: 'terraagent.testnet' },
  { label: 'NEP-366 RELAYER', id: 'relayer.terraagent.testnet' },
  { label: 'OPERATOR / MINTER', id: 'minter.terraagent.testnet' },
] as const;

export function initContractsBoard(): void {
  const host = document.getElementById('contracts-board');
  if (!host) return;

  const cards = CONTRACTS.map(
    (c) => `<article class="contract-row">
      <div class="contract-top">
        <a class="contract-id" href="${EXPLORER}/address/${c.accountId}" target="_blank" rel="noopener noreferrer">${c.accountId}</a>
        <span class="badge ${c.badgeClass}">${c.badge}</span>
      </div>
      <h3>${c.title}</h3>
      <p>${c.summary}</p>
      <div class="contract-meta">
        <span>METHODS: <code>${c.methods}</code></span>
        <span>CODE_HASH: <code>${c.codeHash}</code></span>
        <span>DEPLOY TX: <a href="${EXPLORER}/txns/${c.txHash}" target="_blank" rel="noopener noreferrer"><code>${c.txHash.slice(0, 12)}…</code></a></span>
      </div>
    </article>`,
  ).join('');

  const acctLinks = ACCOUNTS.map(
    (a) =>
      `<span><b>${a.label}</b><a href="${EXPLORER}/address/${a.id}" target="_blank" rel="noopener noreferrer">${a.id}</a></span>`,
  ).join('');

  host.innerHTML = `<div class="board-h">
      <span><i class="dot-live"></i> DEPLOYED ON NEAR TESTNET · 5 RUST SMART CONTRACTS (NEAR-SDK 5.7)</span>
      <span>11 / 11 PORTS LIVE · TEST.RPC.FASTNEAR.COM</span>
    </div>
    <div class="contracts-list">${cards}</div>
    <div class="contract-accounts">
      ${acctLinks}
      <span><b>INTENTS</b><code>intents.near (NEP-413 token_diff) + 1Click</code></span>
    </div>`;
}
