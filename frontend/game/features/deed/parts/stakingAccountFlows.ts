import type { RealNearNetwork } from '../realNearSignerModal';
import type { OpenSignerModalHandle, SignerModalRequest } from '../signerModal';
import { DEFAULT_STAKING_POOLS, extractStakingApiError } from './stakingPanelParts';
import { sendStakingWalletTx, type StakingSelectorFactory } from './stakingWalletTx';

export interface ClaimAccountFlowDeps {
  readonly colonyId: string;
  readonly net: 'mock' | RealNearNetwork;
  readonly initialAccountId: string | null;
  readonly fetchFn: typeof fetch;
  readonly openSigner: (req: SignerModalRequest) => OpenSignerModalHandle;
  readonly statusMsgEl: HTMLElement;
  readonly onClaimed: (claimedByAccountId: string, claimed: boolean) => Promise<void>;
}

export async function runClaimAccountFlow(deps: ClaimAccountFlowDeps): Promise<boolean> {
  const { colonyId, net, fetchFn, openSigner, statusMsgEl, onClaimed } = deps;
  const fallbackAcct = net === 'mainnet' ? 'pilot.near' : net === 'testnet' ? 'pilot.testnet' : 'pilot.mock';
  const initialAcct = deps.initialAccountId ?? fallbackAcct;
  const recipient = net === 'mainnet' ? 'terraagent.near' : net === 'testnet' ? 'terraagent.testnet' : 'terraagent.mock';
  const outcome = await openSigner({
    title: `NEAR WALLET SIGNER (${net.toUpperCase()})`,
    subtitle: 'Approve NEP-413 signature to claim your colony account',
    actionSummary: net === 'mock' ? `Claim colony account for ${colonyId} as ${initialAcct}` : `Claim colony account for ${colonyId} (${net})`,
    accountId: initialAcct,
    recipient,
    message: net === 'mock' ? `claim:${colonyId}:${initialAcct}` : `claim:${colonyId}`,
  }).promise;
  if (outcome.status !== 'approved') {
    statusMsgEl.textContent = outcome.reason;
    return false;
  }
  const walletAccountId = net === 'mock' ? initialAcct : outcome.signature.accountId || initialAcct;
  try {
    const res = await fetchFn('/v1/near/claim-account', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ colonyId, walletAccountId, newPublicKey: outcome.signature.publicKey, walletSignature: outcome.signature }),
    });
    const body = (await res.json().catch(() => ({}))) as { claimed?: boolean; claimedByAccountId?: string };
    if (res.ok) {
      await onClaimed(body.claimedByAccountId ?? walletAccountId, body.claimed ?? true);
      return true;
    }
    statusMsgEl.textContent = extractStakingApiError(body, 'Account claim failed');
  } catch {
    if (net === 'mock') {
      await onClaimed(walletAccountId, true);
      return true;
    }
    statusMsgEl.textContent = 'Account claim failed';
  }
  return false;
}

export interface WalletDepositFlowDeps {
  readonly net: 'mock' | RealNearNetwork;
  readonly fetchFn: typeof fetch;
  readonly selectorFactory?: StakingSelectorFactory;
  readonly poolId: string;
  readonly amountNear: string;
  readonly accountId: string | null | undefined;
  readonly statusMsgEl: HTMLElement;
  readonly onSuccess: () => Promise<unknown>;
}

export async function runWalletDepositFlow(deps: WalletDepositFlowDeps): Promise<void> {
  if (deps.net === 'mock') return;
  await sendStakingWalletTx({
    fetchFn: deps.fetchFn,
    network: deps.net,
    action: 'stake_payable',
    selectorFactory: deps.selectorFactory,
    poolId: deps.poolId || DEFAULT_STAKING_POOLS[0].poolId,
    amountNear: deps.amountNear || '10',
    accountId: deps.accountId ?? null,
    statusMsgEl: deps.statusMsgEl,
    onSuccess: deps.onSuccess,
  });
}

export interface NominatePlanetFlowDeps {
  readonly w28: boolean;
  readonly fetchFn: typeof fetch;
  readonly accountId: string | null | undefined;
  readonly planetId: string | null | undefined;
  readonly statusMsgEl: HTMLElement;
  readonly onNominated: () => Promise<unknown>;
}

export async function runNominatePlanetFlow(deps: NominatePlanetFlowDeps): Promise<boolean> {
  if (!deps.w28) return false;
  const accountId = deps.accountId?.trim();
  const planetId = deps.planetId?.trim();
  if (!accountId || !planetId) {
    deps.statusMsgEl.textContent = !accountId ? 'Connect or stake with a wallet first' : 'Join a public planet to nominate it';
    return false;
  }
  try {
    const res = await deps.fetchFn('/v1/near/staking/patron/nominate', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ accountId, planetId }),
    });
    const body = (await res.json().catch(() => ({}))) as {
      isLeadPatron?: boolean;
      leadPatron?: { accountId?: string; carrierName?: string } | null;
    };
    if (!res.ok) {
      deps.statusMsgEl.textContent = extractStakingApiError(body, `Nomination failed (${res.status})`);
      return false;
    }
    deps.statusMsgEl.textContent = body.isLeadPatron
      ? `Lead Patron of ${planetId} (${body.leadPatron?.carrierName ?? 'ISS'})`
      : `Backed ${planetId} in Lead Patron race`;
    await deps.onNominated();
    return true;
  } catch {
    deps.statusMsgEl.textContent = 'Nomination failed';
    return false;
  }
}
