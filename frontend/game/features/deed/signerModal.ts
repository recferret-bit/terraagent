import type { Nep413Signature } from '@terra/contracts';
import './signerModal.css';

export interface SignerModalRequest {
  readonly title?: string;
  readonly subtitle?: string;
  readonly actionSummary: string;
  readonly accountId: string;
  readonly recipient: string;
  readonly message: string;
  readonly nonce?: string;
  readonly timeoutMs?: number;
  readonly container?: HTMLElement;
}

export type SignerModalOutcome =
  | { readonly status: 'approved'; readonly signature: Nep413Signature }
  | { readonly status: 'rejected'; readonly reason: 'Cancelled in wallet' }
  | { readonly status: 'timeout'; readonly reason: 'Wallet request timed out' };

export interface OpenSignerModalHandle {
  readonly promise: Promise<SignerModalOutcome>;
  readonly approve: () => void;
  readonly reject: () => void;
  readonly close: () => void;
  readonly root: HTMLElement;
}

interface ModalElements {
  readonly header: HTMLElement;
  readonly summary: HTMLElement;
  readonly fields: HTMLElement;
  readonly notice: HTMLElement;
  readonly statusEl: HTMLElement;
  readonly actions: HTMLElement;
  readonly approveBtn: HTMLButtonElement;
  readonly rejectBtn: HTMLButtonElement;
}

export function createMockNep413Nonce(seed?: string): string {
  if (seed !== undefined) {
    let h1 = 0x811c9dc5;
    let h2 = 0x27d4eb2f;
    for (let i = 0; i < seed.length; i++) {
      const code = seed.charCodeAt(i);
      h1 = Math.imul(h1 ^ code, 0x01000193) >>> 0;
      h2 = Math.imul(h2 ^ ((code << 5) | (code >>> 3)), 0x5bd1e995) >>> 0;
    }
    const bytes = new Uint8Array(32);
    let s = (h1 ^ h2) || 1;
    for (let i = 0; i < 32; i++) {
      s = Math.imul(s ^ (s >>> 15), 1 | s);
      s ^= s + Math.imul(s ^ (s >>> 7), 61 | s);
      bytes[i] = (s ^ (s >>> 14)) & 0xff;
    }
    return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  }

  const bytes = new Uint8Array(32);
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < 32; i++) {
      bytes[i] = Math.floor(Math.random() * 256);
    }
  }
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

export function buildMockNep413Signature(req: {
  accountId: string;
  recipient: string;
  message: string;
  nonce?: string;
}): Nep413Signature {
  const nonce = req.nonce ?? createMockNep413Nonce(`nonce:${req.accountId}:${req.message}`);
  const pkPayload = req.accountId.replace(/[^a-zA-Z0-9._-]/g, '').slice(0, 48);
  const publicKey = `ed25519:mock-${pkPayload || 'account'}`;
  const sigPayload = createMockNep413Nonce(`sig:${req.accountId}:${req.recipient}:${req.message}:${nonce}`);
  const signature = `mock-sig:${sigPayload}`;

  return {
    accountId: req.accountId,
    publicKey,
    signature,
    message: req.message,
    nonce,
    recipient: req.recipient,
  };
}

function createFieldRow(labelText: string, testId: string, valueText: string): HTMLElement {
  const row = document.createElement('div');
  row.className = 'ta-signer-modal__field-row';

  const label = document.createElement('span');
  label.className = 'ta-signer-modal__field-label';
  label.textContent = labelText;

  const value = document.createElement('code');
  value.className = 'ta-signer-modal__field-value';
  value.setAttribute('data-testid', testId);
  value.textContent = valueText;

  row.appendChild(label);
  row.appendChild(value);
  return row;
}

function createModalElements(req: SignerModalRequest, nonce: string): ModalElements {
  const header = document.createElement('div');
  header.className = 'ta-signer-modal__header';

  const title = document.createElement('h2');
  title.id = 'mock-signer-modal-title';
  title.className = 'ta-signer-modal__title';
  title.textContent = req.title ?? 'NEAR Wallet Signature Request (Mock)';
  header.appendChild(title);

  if (req.subtitle) {
    const subtitle = document.createElement('p');
    subtitle.className = 'ta-signer-modal__subtitle';
    subtitle.textContent = req.subtitle;
    header.appendChild(subtitle);
  }

  const summary = document.createElement('div');
  summary.className = 'ta-signer-modal__summary';
  summary.setAttribute('data-testid', 'signer-action-summary');
  summary.textContent = req.actionSummary;

  const fields = document.createElement('div');
  fields.className = 'ta-signer-modal__fields';
  fields.appendChild(createFieldRow('Signer Account', 'signer-account', req.accountId));
  fields.appendChild(createFieldRow('Recipient', 'signer-recipient', req.recipient));
  fields.appendChild(createFieldRow('Message', 'signer-message', req.message));
  fields.appendChild(createFieldRow('Nonce', 'signer-nonce', nonce));

  const notice = document.createElement('div');
  notice.className = 'ta-signer-modal__notice';
  notice.textContent = 'Real NEAR from your wallet — not game currency, no in-game bonus';

  const statusEl = document.createElement('div');
  statusEl.className = 'ta-signer-modal__status';
  statusEl.setAttribute('data-testid', 'signer-status');
  statusEl.textContent = '';

  const actions = document.createElement('div');
  actions.className = 'ta-signer-modal__actions';

  const rejectBtn = document.createElement('button');
  rejectBtn.type = 'button';
  rejectBtn.className = 'ta-signer-modal__btn-reject btn btn-ghost btn-sm';
  rejectBtn.setAttribute('data-testid', 'signer-reject-btn');
  rejectBtn.textContent = 'Reject';

  const approveBtn = document.createElement('button');
  approveBtn.type = 'button';
  approveBtn.className = 'ta-signer-modal__btn-approve btn btn-primary btn-sm';
  approveBtn.setAttribute('data-testid', 'signer-approve-btn');
  approveBtn.textContent = 'Approve in Wallet';

  actions.appendChild(rejectBtn);
  actions.appendChild(approveBtn);

  return { header, summary, fields, notice, statusEl, actions, approveBtn, rejectBtn };
}

function buildModalRoot(els: ModalElements): HTMLElement {
  const root = document.createElement('div');
  root.className = 'ta-signer-overlay';
  root.setAttribute('data-testid', 'mock-wallet-signer-modal');
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-modal', 'true');
  root.setAttribute('aria-labelledby', 'mock-signer-modal-title');

  const card = document.createElement('div');
  card.className = 'ta-signer-modal plate';
  card.appendChild(els.header);
  card.appendChild(els.summary);
  card.appendChild(els.fields);
  card.appendChild(els.notice);
  card.appendChild(els.statusEl);
  card.appendChild(els.actions);
  root.appendChild(card);
  return root;
}

export function openMockWalletSignerModal(req: SignerModalRequest): OpenSignerModalHandle {
  const nonce = req.nonce ?? createMockNep413Nonce(`modal:${req.accountId}:${req.message}`);
  const container = req.container ?? document.body;
  const els = createModalElements(req, nonce);
  const root = buildModalRoot(els);
  container.appendChild(root);

  let settled = false;
  let timerId: ReturnType<typeof setTimeout> | null = null;
  let resolveOutcome!: (value: SignerModalOutcome) => void;
  const promise = new Promise<SignerModalOutcome>((res) => {
    resolveOutcome = res;
  });

  const cleanup = () => {
    if (timerId !== null) {
      clearTimeout(timerId);
      timerId = null;
    }
    document.removeEventListener('keydown', onKeyDown);
    if (root.parentElement) {
      root.parentElement.removeChild(root);
    }
  };

  const approve = () => {
    if (settled) return;
    settled = true;
    const signature = buildMockNep413Signature({
      accountId: req.accountId,
      recipient: req.recipient,
      message: req.message,
      nonce,
    });
    cleanup();
    resolveOutcome({ status: 'approved', signature });
  };

  const reject = () => {
    if (settled) return;
    settled = true;
    els.statusEl.textContent = 'Cancelled in wallet';
    cleanup();
    resolveOutcome({ status: 'rejected', reason: 'Cancelled in wallet' });
  };

  const onTimeout = () => {
    if (settled) return;
    settled = true;
    els.statusEl.textContent = 'Wallet request timed out';
    cleanup();
    resolveOutcome({ status: 'timeout', reason: 'Wallet request timed out' });
  };

  const close = () => {
    if (!settled) reject();
    else cleanup();
  };

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      reject();
    }
  };

  els.approveBtn.addEventListener('click', approve);
  els.rejectBtn.addEventListener('click', reject);
  root.addEventListener('click', (e) => {
    if (e.target === root) reject();
  });
  document.addEventListener('keydown', onKeyDown);

  const timeoutMs = req.timeoutMs ?? 60_000;
  if (typeof timeoutMs === 'number' && timeoutMs >= 0) {
    timerId = setTimeout(onTimeout, timeoutMs);
  }

  return { promise, approve, reject, close, root };
}
