import { STAKING_RULES, STAKING_TIERS, type AiBudgetView } from '@terra/contracts';
import { verifyTeeAttestationClient } from '../../../../design/pilot/teeVerifier';
import { isProductionBuild } from '../../../core/buildEnv';
import { aiAccessState, modelLabel, stakeCtaHref, type AiAccessState } from './aiAccessBadge';

export interface TeeProofModalOptions {
  readonly container?: HTMLElement;
  readonly budget?: AiBudgetView | null;
}

export interface TeeAttestationRecord {
  readonly id: string;
  readonly colonyId: string;
  readonly chatId: string;
  readonly model: string;
  readonly requestHash: string;
  readonly responseHash: string;
  readonly signingAlgo: string;
  readonly signingAddress: string | null;
  readonly signature: string | null;
  readonly signatureText?: string | null;
  readonly signatureKind: string;
  readonly verified: boolean;
  readonly cryptoVerified: boolean;
  readonly createdAt: string;
}

function makeFieldRow(label: string, value: string): HTMLElement {
  const row = document.createElement('div');
  row.className = 'ta-tee-modal__row';
  const k = document.createElement('span');
  k.className = 'label';
  k.textContent = label;
  const v = document.createElement('span');
  v.className = 'ta-tee-modal__val';
  v.textContent = value;
  row.append(k, v);
  return row;
}

function renderModalAiBanner(state: AiAccessState): HTMLElement | null {
  if (state.kind === 'legacy') return null;
  const wrap = document.createElement('div');
  wrap.className = 'plate-sm ta-tee-modal__access';
  wrap.dataset.testid = 'tee-modal-ai-access';
  wrap.dataset.state = state.kind;
  wrap.style.cssText = 'padding:10px 12px;margin-bottom:12px;display:flex;flex-direction:column;gap:6px;';
  const title = document.createElement('strong');
  const detail = document.createElement('span');
  detail.className = 'ta-me-muted';
  if (state.kind === 'trial') {
    title.textContent = `FREE TEE TRIAL (${state.left} / ${state.total} TURNS LEFT · ${modelLabel(state.model)})`;
    detail.textContent = 'Hardware-attested NEAR.AI Cloud enclave turns active for your verified pilot.';
    wrap.append(title, detail);
  } else if (state.kind === 'tee') {
    const usd = (n: number) => `$${n.toFixed(n >= 1 ? 2 : 4)}`;
    title.textContent = `NEAR.AI TEE · TIER ${state.tier}`;
    detail.textContent = `Wallet budget: ${usd(state.usedUsd)} / ${usd(state.capUsd)} today · ${state.calls}/${state.callLimit} calls · Colony slots ${state.slotsUsed}/${state.slotsMax}`;
    wrap.append(title, detail);
  } else if (state.kind === 'byok') {
    title.textContent = 'BYOK · PERSONAL ENCRYPTED NEAR.AI KEY';
    detail.textContent = 'Running on your personal NEAR.AI Cloud API key ($0 protocol budget cost).';
    wrap.append(title, detail);
  } else {
    title.textContent = 'SCRIPT AI (FREE) · LOCAL DETERMINISTIC POLICY';
    detail.textContent = state.guest
      ? `Sign in as a verified pilot to unlock ${STAKING_RULES.freeTrialTurns} free NEAR.AI TEE trial turns, or stake ${STAKING_TIERS[1]!.minStakeNear} NEAR.`
      : `Stake ${STAKING_TIERS[1]!.minStakeNear} NEAR (100% refundable + APY) to activate hardware-attested NEAR.AI TEE turns.`;
    const cta = document.createElement('a');
    cta.className = 'btn btn-primary btn-sm';
    cta.dataset.testid = 'tee-modal-stake-cta';
    cta.href = stakeCtaHref();
    cta.textContent = state.trialComplete
      ? `Trial Complete — Stake ${STAKING_TIERS[1]!.minStakeNear} NEAR → Keep NEAR.AI TEE Active`
      : `Stake ${STAKING_TIERS[1]!.minStakeNear} NEAR → Unlock NEAR.AI TEE`;
    wrap.append(title, detail, cta);
  }
  return wrap;
}

async function populateAttestationList(colonyId: string, bodyEl: HTMLElement, state: AiAccessState): Promise<void> {
  bodyEl.replaceChildren();
  const isOfflineLocal =
    !isProductionBuild() &&
    typeof location !== 'undefined' &&
    new URLSearchParams(location.search).get('host') === 'local';
  if (isOfflineLocal) {
    const empty = document.createElement('p');
    empty.textContent =
      state.kind === 'script'
        ? 'No NEAR.AI TEE attestations recorded yet — this colony runs Script AI (Free) locally until NEAR.AI TEE is unlocked.'
        : 'No NEAR.AI TEE attestations recorded for this colony yet.';
    bodyEl.appendChild(empty);
    return;
  }
  const loading = document.createElement('p');
  loading.className = 'ta-me-muted';
  loading.textContent = `Fetching TEE proofs for ${colonyId}…`;
  bodyEl.appendChild(loading);
  try {
    const res = await fetch(`/v1/near/ai/attestations?colonyId=${encodeURIComponent(colonyId)}&limit=5`);
    const data = (await res.json().catch(() => ({}))) as { attestations?: TeeAttestationRecord[] };
    const rows = data.attestations ?? [];
    bodyEl.replaceChildren();
    if (rows.length === 0) {
      const empty = document.createElement('p');
      empty.textContent =
        state.kind === 'script'
          ? `No NEAR.AI TEE attestations recorded yet — this colony runs Script AI (Free) locally until NEAR.AI TEE is unlocked.`
          : 'No NEAR.AI TEE attestations recorded for this colony yet.';
      bodyEl.appendChild(empty);
      return;
    }
    for (const item of rows) {
      const card = document.createElement('div');
      card.className = 'plate-sm ta-tee-modal__card';
      card.style.padding = '10px';
      card.style.marginBottom = '8px';
      const check = await verifyTeeAttestationClient(item);
      card.append(
        makeFieldRow('Model / Chat', `${item.model} · ${item.chatId}`),
        makeFieldRow('Signer', item.signingAddress ?? 'TEE Gateway'),
        makeFieldRow('Request SHA-256', `${item.requestHash.slice(0, 24)}…`),
        makeFieldRow('Response SHA-256', `${item.responseHash.slice(0, 24)}…`),
        makeFieldRow('Verification', check.valid ? `VERIFIED ✓ (${check.reason})` : `UNVERIFIED (${check.reason})`),
      );
      bodyEl.appendChild(card);
    }
  } catch {
    bodyEl.replaceChildren();
    const err = document.createElement('p');
    err.textContent = 'Unable to reach /v1/near/ai/attestations.';
    bodyEl.appendChild(err);
  }
}

function normalizeModalOptions(containerOrOpts?: HTMLElement | TeeProofModalOptions): TeeProofModalOptions {
  if (!containerOrOpts) return {};
  if (typeof HTMLElement !== 'undefined' && containerOrOpts instanceof HTMLElement) {
    return { container: containerOrOpts };
  }
  return containerOrOpts as TeeProofModalOptions;
}

export function openTeeProofModal(colonyId: string, containerOrOpts?: HTMLElement | TeeProofModalOptions): void {
  const opts = normalizeModalOptions(containerOrOpts);
  const host = opts.container ?? document.body;
  const accessState = aiAccessState(opts.budget ?? null);
  const backdrop = document.createElement('div');
  backdrop.className = 'ta-modal-backdrop';
  backdrop.dataset.testid = 'tee-proof-modal';
  backdrop.style.cssText =
    'position:fixed;inset:0;z-index:9999;display:flex;align-items:center;justify-content:center;background:color-mix(in srgb, var(--ta-void) 82%, transparent);padding:16px;';

  const box = document.createElement('section');
  box.className = 'plate ta-tee-modal';
  box.setAttribute('role', 'dialog');
  box.setAttribute('aria-modal', 'true');
  box.setAttribute('aria-labelledby', 'ta-tee-modal-title');
  box.style.cssText =
    'max-width:560px;width:100%;padding:16px;background:var(--ta-plate);color:var(--ta-text);border:1px solid var(--ta-orange);';

  const close = (): void => {
    window.removeEventListener('keydown', onKey, true);
    backdrop.remove();
  };
  const onKey = (ev: KeyboardEvent): void => {
    if (ev.key === 'Escape') {
      ev.preventDefault();
      ev.stopImmediatePropagation();
      close();
    }
  };
  window.addEventListener('keydown', onKey, true);
  backdrop.addEventListener('click', (ev) => {
    if (ev.target === backdrop) close();
  });

  const head = document.createElement('div');
  head.style.cssText = 'display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;';
  const title = document.createElement('h3');
  title.id = 'ta-tee-modal-title';
  title.textContent = 'NEAR.AI TEE ATTESTATION PROOFS';
  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.className = 'btn btn-ghost btn-sm';
  closeBtn.textContent = 'Close';
  closeBtn.onclick = close;
  head.append(title, closeBtn);

  const banner = renderModalAiBanner(accessState);
  const body = document.createElement('div');
  if (banner) box.append(head, banner, body);
  else box.append(head, body);
  backdrop.appendChild(box);
  host.appendChild(backdrop);
  closeBtn.focus();
  void populateAttestationList(colonyId, body, accessState);
}
