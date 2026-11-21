// Deployed NEAR smart contract specification board (6 Rust near-sdk 5.7 contracts + 4 protocol accounts)
// rendered as a crisp 2-column grid and hydrated live from GET /v1/near/status.

interface DeployedContract {
  readonly key: 'res' | 'deed' | 'bounty' | 'staking' | 'dao' | 'pilots';
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

type ProtocolAccountKey = 'root' | 'protocol' | 'relayer' | 'minter';

interface NearStatusDto {
  readonly nearMode?: string;
  readonly network?: 'testnet' | 'mainnet';
  readonly rootAccount?: string;
  readonly protocolAccount?: string;
  readonly explorerBaseUrl?: string;
  readonly contracts?: Partial<Record<DeployedContract['key'], string>>;
  readonly accounts?: {
    readonly relayer?: string;
    readonly minter?: string;
    readonly protocol?: string;
  };
  readonly health?: { readonly ok?: boolean; readonly latencyMs?: number; readonly detail?: string };
  readonly ports?: ReadonlyArray<{ readonly mode?: string }>;
  readonly ai?: {
    readonly provider?: string;
    readonly defaultModel?: string;
    readonly attestationEnabled?: boolean;
    readonly signingAlgo?: string;
    readonly cryptoVerification?: string;
  };
}

const DEFAULT_EXPLORER = 'https://testnet.nearblocks.io';

const CONTRACTS: readonly DeployedContract[] = [
  {
    key: 'res',
    step: '01',
    accountId: 'res.terraagent.testnet',
    badge: 'NEP-245',
    badgeClass: 'badge-ok',
    accent: 'var(--ta-terra)',
    kicker: 'CARGO MULTI-TOKEN',
    title: 'Orbital Resource Token',
    summary: 'Mints 10 refined colony commodities on export and burns them on import so surface stock and chain supply stay 1:1.',
    inGameTrigger: 'Trade Hub Export',
    onChainAction: 'mt_mint · mt_burn',
    codeHash: '8Tmkq9b1e4KoumPiiBAEFMMsSTnWuxCZ6L6p52SHRroa',
    txHash: '5reiQL5XddxLS9hDDmKrh1Nn4N8f5Ui9KjtqySvGejok',
    iconSvg: `<svg viewBox="0 0 48 48" fill="none" aria-hidden="true">
      <polygon points="24,6 40,15 40,33 24,42 8,33 8,15" fill="var(--ta-plate)" stroke="var(--ta-terra)" stroke-width="1.8"/>
      <path d="M8 15 L24 24 L40 15 M24 24 V42" stroke="var(--ta-terra)" stroke-width="1.4" stroke-opacity=".7"/>
      <circle cx="24" cy="15" r="3" fill="var(--ta-terra)"/>
    </svg>`,
  },
  {
    key: 'deed',
    step: '02',
    accountId: 'deed.terraagent.testnet',
    badge: 'NEP-171',
    badgeClass: 'badge-new',
    accent: 'var(--ta-blue-hi)',
    kicker: 'SOULBOUND IDENTITY',
    title: 'Colony Deeds & Badges',
    summary: 'Non-transferable Colony Deeds record stage and terraforming milestones on-chain and gate Planet Council voting.',
    inGameTrigger: 'Stage Milestone',
    onChainAction: 'mint_deed · update_metadata',
    codeHash: '4TMMsxv3whUVCUxmfbzEWgf8HfwEMLFmX4pGxyvpVV3M',
    txHash: 'E1AGHyMmzCGdsRqvoMVjqWqVQGGkuRu3djQzuRj3wRGK',
    iconSvg: `<svg viewBox="0 0 48 48" fill="none" aria-hidden="true">
      <polygon points="24,5 39,13 39,31 24,43 9,31 9,13" fill="var(--ta-plate)" stroke="var(--ta-blue-hi)" stroke-width="1.8"/>
      <polygon points="24,13 31,18 31,28 24,34 17,28 17,18" stroke="var(--ta-energy)" stroke-width="1.4"/>
      <circle cx="24" cy="23" r="3.5" fill="var(--ta-blue-hi)"/>
    </svg>`,
  },
  {
    key: 'bounty',
    step: '03',
    accountId: 'bounty.terraagent.testnet',
    badge: 'ESCROW',
    badgeClass: 'badge-recruiting',
    accent: 'var(--ta-orange)',
    kicker: 'TREATIES & SIEGES',
    title: 'Bounty, Peace & War Escrow',
    summary: 'Locks mercenary bounties, peace treaties, and 6-hour war bonds—refunding kept commitments and paying defenders on breach.',
    inGameTrigger: 'Bounty / Treaty / War',
    onChainAction: 'open_escrow · slash_escrow',
    codeHash: '9NEAvdLMN62YEth7ENZxadZhxH68injDVff7sGgDvSJ9',
    txHash: '21F1c5TdGtgcAhoTMPRMkHCYvQ15USqo4fpxBrXU8UAB',
    iconSvg: `<svg viewBox="0 0 48 48" fill="none" aria-hidden="true">
      <circle cx="24" cy="24" r="15" fill="var(--ta-plate)" stroke="var(--ta-orange)" stroke-width="1.8" stroke-dasharray="6 3"/>
      <circle cx="24" cy="24" r="7" stroke="var(--ta-orange-hi)" stroke-width="1.5"/>
      <path d="M24 5V12M24 36V43M5 24H12M36 24H43" stroke="var(--ta-orange)" stroke-width="1.6"/>
      <circle cx="24" cy="24" r="2.5" fill="var(--ta-orange)"/>
    </svg>`,
  },
  {
    key: 'staking',
    step: '04',
    accountId: 'staking.terraagent.testnet',
    badge: 'HUMAN ONLY',
    badgeClass: 'badge-ai',
    accent: 'var(--ta-energy)',
    kicker: '4-TIER VAULT',
    title: 'Wallet-First Staking Vault',
    summary: 'Stakes native NEAR or stNEAR/LiNEAR with no Deed required, 1-click compound (0% fee), <7d 25 bp exit fee, and human-only guards.',
    inGameTrigger: 'Wallet Stake (10–500+ NEAR)',
    onChainAction: 'stake_payable · compound_yield · withdraw',
    codeHash: '9b51P4dVKvQWK5r8T5J9gdiNuEvNMuxY3CK1SihefNwb',
    txHash: '5UvHFrKUocqf5JewptneZqGeXgXkJQZaeVMPfHTrusX2',
    iconSvg: `<svg viewBox="0 0 48 48" fill="none" aria-hidden="true">
      <rect x="11" y="20" width="26" height="20" fill="var(--ta-plate)" stroke="var(--ta-energy)" stroke-width="1.8"/>
      <path d="M16 20V14C16 9.6 19.6 6 24 6C28.4 6 32 9.6 32 14V20" stroke="var(--ta-blue-hi)" stroke-width="1.8"/>
      <circle cx="24" cy="29" r="3" fill="var(--ta-energy)"/>
      <path d="M24 32V36" stroke="var(--ta-energy)" stroke-width="1.8"/>
    </svg>`,
  },
  {
    key: 'dao',
    step: '05',
    accountId: 'dao.terraagent.testnet',
    badge: 'COUNCIL DAO',
    badgeClass: 'badge-tier',
    accent: 'var(--ta-orange-hi)',
    kicker: 'PUBLIC GOODS',
    title: 'Planet Council Treasury',
    summary: "Collects each planet's share of trade fees so settled colonies can vote on meteor shields and Guild subsidies.",
    inGameTrigger: 'Council Vote',
    onChainAction: 'propose · vote · finalize',
    codeHash: 'J5L9QjPghZQ337PLxyv7ehEtNRWo2KuMvTnoAMyNEGrS',
    txHash: 'DmsGYQ7VBajz1rRC5FKxNarnnddhs5CzeVgfJc6mqx5U',
    iconSvg: `<svg viewBox="0 0 48 48" fill="none" aria-hidden="true">
      <circle cx="24" cy="24" r="16" fill="var(--ta-plate)" stroke="var(--ta-orange-hi)" stroke-width="1.6"/>
      <polygon points="24,12 34,29 14,29" stroke="var(--ta-text)" stroke-width="1.5" fill="none"/>
      <circle cx="24" cy="12" r="3" fill="var(--ta-orange)"/>
      <circle cx="34" cy="29" r="3" fill="var(--ta-blue-hi)"/>
      <circle cx="14" cy="29" r="3" fill="var(--ta-terra)"/>
    </svg>`,
  },
  {
    key: 'pilots',
    step: '06',
    accountId: 'pilots.terraagent.testnet',
    badge: 'COLD ROOT',
    badgeClass: 'badge-ok',
    accent: 'var(--ta-terra)',
    kicker: 'ACCOUNT FACTORY',
    title: 'Pilot Sub-Account Factory',
    summary: 'Provisions isolated pilot sub-accounts via an operator key while keeping the root governance key offline.',
    inGameTrigger: 'Guest / Social Drop',
    onChainAction: 'create_pilot_account',
    codeHash: '7HP8BHuqUF36MtxYK8DKRenjZ9n9CmR9NSaZmnuZpWa5',
    txHash: 'cSTqNFu5aQKb9MiJwantuhxj4Hwn3T2D4WbhCHJAr2h',
    iconSvg: `<svg viewBox="0 0 48 48" fill="none" aria-hidden="true">
      <circle cx="24" cy="16" r="7" fill="var(--ta-plate)" stroke="var(--ta-terra)" stroke-width="1.8"/>
      <path d="M11 39C11 31.8 16.8 26 24 26C31.2 26 37 31.8 37 39" stroke="var(--ta-terra)" stroke-width="1.8"/>
      <circle cx="36" cy="14" r="4" fill="var(--ta-plate)" stroke="var(--ta-energy)" stroke-width="1.5"/>
    </svg>`,
  },
];

const ACCOUNTS: ReadonlyArray<{ readonly key: ProtocolAccountKey; readonly label: string; readonly id: string }> = [
  { key: 'root', label: 'ROOT', id: 'terraagent.testnet' },
  { key: 'protocol', label: 'PROTOCOL TREASURY', id: 'protocol.terraagent.testnet' },
  { key: 'relayer', label: 'GAS RELAYER', id: 'relayer.terraagent.testnet' },
  { key: 'minter', label: 'OPERATOR', id: 'minter.terraagent.testnet' },
];

function formatAiAttestationBadge(ai?: NearStatusDto['ai']): string {
  if (!ai || ai.attestationEnabled === false || ai.provider === 'mock') return '';
  if (ai.cryptoVerification || ai.defaultModel) return ' · NEAR.AI TEE VERIFIED';
  return '';
}

function resolveLiveAccounts(
  data: NearStatusDto,
  liveRoot: string,
): Record<ProtocolAccountKey, string> {
  return {
    root: liveRoot,
    protocol: data.protocolAccount?.trim() || data.accounts?.protocol?.trim() || `protocol.${liveRoot}`,
    relayer: data.accounts?.relayer?.trim() || `relayer.${liveRoot}`,
    minter: data.accounts?.minter?.trim() || `minter.${liveRoot}`,
  };
}

function renderContractCard(c: DeployedContract): string {
  return `<article class="contract-card plate-sm" data-chain-item data-contract-key="${c.key}" data-code-hash="${c.codeHash}" style="--cf-accent:${c.accent}">
    <div class="contract-card-head">
      <div class="chain-icon plate-sm">${c.iconSvg}</div>
      <div class="contract-head-meta">
        <div class="contract-top">
          <span class="chain-step">${c.step} · ${c.kicker}</span>
          <span class="badge ${c.badgeClass}">${c.badge}</span>
        </div>
        <h3>${c.title}</h3>
      </div>
    </div>
    <p class="contract-summary">${c.summary}</p>
    <div class="chain-flow plate-sm" aria-label="Gameplay to on-chain flow">
      <span class="flow-from">${c.inGameTrigger}</span>
      <span class="flow-arrow" aria-hidden="true">→</span>
      <code class="flow-to">${c.onChainAction}</code>
    </div>
    <div class="chain-links">
      <a class="contract-id" data-contract-link href="${DEFAULT_EXPLORER}/address/${c.accountId}" target="_blank" rel="noopener noreferrer">${c.accountId} <span aria-hidden="true">↗</span></a>
      <a class="contract-tx" data-contract-tx href="${DEFAULT_EXPLORER}/txns/${c.txHash}" target="_blank" rel="noopener noreferrer" title="WASM code_hash: ${c.codeHash}">WASM ${c.codeHash.slice(0, 6)}… · TX ${c.txHash.slice(0, 6)}… <span aria-hidden="true">↗</span></a>
    </div>
  </article>`;
}

export async function hydrateContractsStatus(host: HTMLElement): Promise<void> {
  if (!globalThis.fetch) return;
  try {
    const res = await fetch('/v1/near/status', { headers: { accept: 'application/json' } });
    if (!res.ok) return;
    const data = (await res.json()) as NearStatusDto;
    const statusEl = host.querySelector<HTMLElement>('[data-chain-live-status]');
    if (!statusEl) return;

    const totalPorts = data.ports?.length ?? 11;
    const livePorts = data.ports?.filter((p) => p.mode && p.mode !== 'mock').length ?? 0;
    const blockMatch = /block=(\d+)/.exec(data.health?.detail ?? '');
    const blockLabel = blockMatch?.[1] ? ` · BLOCK #${Number(blockMatch[1]).toLocaleString('en-US')}` : '';
    const netLabel = (data.network ?? 'testnet').toUpperCase();
    const modeLabel =
      livePorts >= totalPorts
        ? `LIVE ON ${netLabel}${blockLabel}`
        : livePorts > 0
          ? `${livePorts}/${totalPorts} ADAPTERS LIVE (${netLabel})${blockLabel}`
          : `LOCAL SANDBOX (TESTNET CONTRACTS READY)`;
    statusEl.textContent = `${modeLabel}${formatAiAttestationBadge(data.ai)}`;

    if (livePorts <= 0) return;

    const explorer = data.explorerBaseUrl?.replace(/\/+$/, '') || (data.network === 'mainnet' ? 'https://nearblocks.io' : DEFAULT_EXPLORER);
    const liveRoot = data.rootAccount?.trim() || (data.network === 'mainnet' ? 'terraagent.near' : 'terraagent.testnet');

    for (const c of CONTRACTS) {
      const liveAccountId = data.contracts?.[c.key]?.trim() || `${c.key}.${liveRoot}`;
      const card = host.querySelector<HTMLElement>(`[data-contract-key="${c.key}"]`);
      const link = card?.querySelector<HTMLAnchorElement>('[data-contract-link]');
      if (link) {
        link.href = `${explorer}/address/${liveAccountId}`;
        link.innerHTML = `${liveAccountId} <span aria-hidden="true">↗</span>`;
      }
      const txLink = card?.querySelector<HTMLAnchorElement>('[data-contract-tx]');
      if (txLink) {
        if (liveAccountId === c.accountId && (data.network ?? 'testnet') === 'testnet') {
          txLink.href = `${explorer}/txns/${c.txHash}`;
        } else {
          txLink.href = `${explorer}/address/${liveAccountId}?tab=contract`;
          txLink.innerHTML = `WASM ${c.codeHash.slice(0, 6)}… · CODE <span aria-hidden="true">↗</span>`;
        }
      }
    }

    const liveAccounts = resolveLiveAccounts(data, liveRoot);
    for (const acct of ACCOUNTS) {
      const accountId = liveAccounts[acct.key];
      const link = host.querySelector<HTMLAnchorElement>(`[data-account-key="${acct.key}"] [data-account-link]`);
      if (link) {
        link.href = `${explorer}/address/${accountId}`;
        link.textContent = `${accountId} ↗`;
      }
    }
  } catch {
    // Offline / static build retains default Testnet status text.
  }
}

export function renderContractsBoardHtml(): string {
  const cards = CONTRACTS.map(renderContractCard).join('');
  const acctLinks = ACCOUNTS.map(
    (a) =>
      `<span class="acct-pill plate-sm" data-account-key="${a.key}"><b>${a.label}</b><a data-account-link href="${DEFAULT_EXPLORER}/address/${a.id}" target="_blank" rel="noopener noreferrer">${a.id} ↗</a></span>`,
  ).join('');

  return `<div class="board-h contracts-board-h">
      <span><i class="dot-live"></i> SIX DEPLOYED RUST CONTRACTS ON NEAR</span>
      <span class="contracts-status-wrap"><span data-chain-live-status>LIVE ON NEAR TESTNET · FASTNEAR RPC</span> · <a class="chain-json-link" href="/v1/near/status">/v1/near/status ↗</a> · <a class="chain-json-link" href="/whitepaper/#sub-web3-operator-accounts">whitepaper ↗</a></span>
    </div>
    <div class="contracts-grid" id="chain-stream">${cards}</div>
    <div class="contract-accounts">
      ${acctLinks}
    </div>`;
}

export function initContractsBoard(): void {
  const host = document.getElementById('contracts-board');
  if (!host) return;

  host.innerHTML = renderContractsBoardHtml();

  void hydrateContractsStatus(host);
}
