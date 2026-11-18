import { verifyTeeAttestationClient } from '../../../../design/pilot/teeVerifier';

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

async function populateAttestationList(colonyId: string, bodyEl: HTMLElement): Promise<void> {
  bodyEl.replaceChildren();
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
      empty.textContent = 'No NEAR.AI TEE attestations recorded for this colony yet.';
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
        makeFieldRow('Request SHA-256', item.requestHash.slice(0, 24) + '…'),
        makeFieldRow('Response SHA-256', item.responseHash.slice(0, 24) + '…'),
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

export function openTeeProofModal(colonyId: string, container?: HTMLElement): void {
  const host = container ?? document.body;
  const backdrop = document.createElement('div');
  backdrop.className = 'ta-modal-backdrop';
  backdrop.dataset.testid = 'tee-proof-modal';
  backdrop.style.cssText = 'position:fixed;inset:0;z-index:9999;display:flex;align-items:center;justify-content:center;background:rgba(10,12,16,0.78);padding:16px;';

  const box = document.createElement('section');
  box.className = 'plate ta-tee-modal';
  box.style.cssText = 'max-width:560px;width:100%;padding:16px;background:var(--ta-bg-panel, #14171f);color:var(--ta-text-primary, #f5f5f5);border:1px solid var(--ta-border-active, #ff6a00);';

  const head = document.createElement('div');
  head.style.cssText = 'display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;';
  const title = document.createElement('h3');
  title.textContent = 'NEAR.AI TEE ATTESTATION PROOFS';
  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.className = 'btn btn-ghost btn-sm';
  closeBtn.textContent = 'Close';
  closeBtn.onclick = () => backdrop.remove();
  head.append(title, closeBtn);

  const body = document.createElement('div');
  box.append(head, body);
  backdrop.appendChild(box);
  host.appendChild(backdrop);
  void populateAttestationList(colonyId, body);
}
