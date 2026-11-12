import { buildNearWalletLoginUrl, type MockToken } from './mockToken';

export interface SavedNearWallet {
  readonly walletId: string;
  readonly walletName: string;
  readonly accountId: string;
  readonly publicKey?: string;
  readonly connectedAt: number;
}

const STORAGE_KEY = 'ta_near_wallet';
const NEAR_ACCOUNT_RE = /^(([a-z\d]+[-_])*[a-z\d]+\.)*([a-z\d]+[-_])*[a-z\d]+$/;

const MODAL_CSS = `
.near-modal{margin:auto;padding:var(--ta-s5);width:min(440px,92vw);background:var(--ta-plate);color:var(--ta-text);border:1px solid var(--ta-seam-2);overscroll-behavior:contain}
.near-modal::backdrop{background:rgba(5,6,8,.78);backdrop-filter:blur(4px)}
.near-modal-head{display:flex;align-items:center;justify-content:space-between;gap:var(--ta-s3);margin-bottom:var(--ta-s4)}
.near-modal-sub{font-size:13px;color:var(--ta-text-3);margin:0 0 var(--ta-s4)}
.near-wallet-grid{display:grid;grid-template-columns:1fr 1fr;gap:var(--ta-s2);margin-bottom:var(--ta-s3)}
.near-wallet-opt{display:flex;flex-direction:column;align-items:flex-start;gap:2px;padding:10px 12px;text-align:left;background:var(--ta-plate-2);border:1px solid var(--ta-seam);color:var(--ta-text);cursor:pointer;font-family:var(--ta-font-display)}
.near-wallet-opt:hover{border-color:var(--ta-orange);background:rgba(255,106,19,.08)}
.near-wallet-opt b{font-size:14px;font-weight:600;letter-spacing:.04em;text-transform:uppercase}
.near-wallet-opt span{font-family:var(--ta-font-mono);font-size:11px;color:var(--ta-text-3)}
.near-wallet-panel{padding:12px;background:var(--ta-plate-2);border:1px solid var(--ta-seam-2);display:flex;flex-direction:column;gap:10px;margin-top:var(--ta-s2)}
.near-wallet-panel code{display:block;padding:8px 10px;background:#07080A;border:1px solid var(--ta-seam);font-family:var(--ta-font-mono);font-size:11px;color:var(--ta-orange-hi);word-break:break-all;user-select:all}
.near-wallet-panel input{width:100%;box-sizing:border-box}
.near-wallet-saved{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:10px 12px;margin-bottom:var(--ta-s3);background:rgba(255,106,19,.1);border:1px solid var(--ta-orange)}
.near-wallet-saved span{font-family:var(--ta-font-mono);font-size:12px;color:var(--ta-text)}
.near-wallet-err{font-family:var(--ta-font-mono);font-size:12px;color:var(--ta-fault-text);margin:0}
`;

function ensureModalCss(): void {
  if (typeof document === 'undefined' || document.getElementById('near-wallet-modal-css')) return;
  const style = document.createElement('style');
  style.id = 'near-wallet-modal-css';
  style.textContent = MODAL_CSS;
  document.head.appendChild(style);
}

export function readSavedNearWallet(): SavedNearWallet | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<SavedNearWallet>;
    if (typeof parsed.accountId === 'string' && NEAR_ACCOUNT_RE.test(parsed.accountId)) {
      return {
        walletId: parsed.walletId ?? 'near-cli',
        walletName: parsed.walletName ?? 'NEAR Wallet',
        accountId: parsed.accountId,
        publicKey: typeof parsed.publicKey === 'string' ? parsed.publicKey : undefined,
        connectedAt: typeof parsed.connectedAt === 'number' ? parsed.connectedAt : Date.now(),
      };
    }
  } catch {
    /* ignore storage errors */
  }
  return null;
}

export function saveNearWallet(entry: SavedNearWallet): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(entry));
  } catch {
    /* ignore storage errors */
  }
}

function buildWebWalletUrl(baseLoginUrl: string, origin: string, returnPath: string): string {
  const generic = new URL(buildNearWalletLoginUrl(origin, returnPath));
  const target = new URL(baseLoginUrl);
  generic.searchParams.forEach((v, k) => target.searchParams.set(k, v));
  return target.toString();
}

export interface NearWalletSelectorCallbacks {
  onPopupOpened(popup: Window | null): void;
  onDirectToken(hit: MockToken): void;
}

interface InjectedOkxNear {
  requestSignIn?: (params?: { contractId?: string }) => Promise<{ accountId?: string; publicKey?: string } | void>;
  getAccountId?: () => string | null;
}

function createOptionButton(testId: string, title: string, subtitle: string, onClick: () => void): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'near-wallet-opt';
  btn.dataset.testid = testId;
  const b = document.createElement('b');
  b.textContent = title;
  const s = document.createElement('span');
  s.textContent = subtitle;
  btn.append(b, s);
  btn.onclick = onClick;
  return btn;
}

function renderAccountConnectPanel(
  panelHost: HTMLElement,
  opts: {
    readonly walletId: string;
    readonly walletName: string;
    readonly headline: string;
    readonly commandHint?: string;
    readonly deepLinkUrl?: string;
    readonly onConnect: (accountId: string, publicKey?: string) => void;
  },
): void {
  panelHost.replaceChildren();
  const box = document.createElement('div');
  box.className = 'near-wallet-panel';
  box.dataset.testid = `near-panel-${opts.walletId}`;

  const label = document.createElement('div');
  label.className = 'label';
  label.textContent = opts.headline;
  box.append(label);

  if (opts.commandHint) {
    const code = document.createElement('code');
    code.textContent = opts.commandHint;
    box.append(code);
  }

  if (opts.deepLinkUrl) {
    const deepBtn = document.createElement('a');
    deepBtn.className = 'btn btn-ghost btn-sm';
    deepBtn.href = opts.deepLinkUrl;
    deepBtn.target = '_blank';
    deepBtn.rel = 'noopener noreferrer';
    deepBtn.textContent = `Launch ${opts.walletName} ↗`;
    box.append(deepBtn);
  }

  const acctInput = document.createElement('input');
  acctInput.type = 'text';
  acctInput.className = 'input';
  acctInput.placeholder = 'pilot.testnet or pilot.near';
  acctInput.dataset.testid = 'near-account-input';
  const saved = readSavedNearWallet();
  if (saved?.accountId) acctInput.value = saved.accountId;

  const keyInput = document.createElement('input');
  keyInput.type = 'text';
  keyInput.className = 'input';
  keyInput.placeholder = 'Optional public key (ed25519:...)';
  keyInput.dataset.testid = 'near-pubkey-input';

  const err = document.createElement('p');
  err.className = 'near-wallet-err';
  err.style.display = 'none';

  const submit = document.createElement('button');
  submit.type = 'button';
  submit.className = 'btn btn-primary btn-sm';
  submit.dataset.testid = 'near-account-submit';
  submit.textContent = `Connect ${opts.walletName}`;

  const finish = (): void => {
    const rawAcct = acctInput.value.trim().toLowerCase();
    const rawKey = keyInput.value.trim();
    if (!NEAR_ACCOUNT_RE.test(rawAcct) || rawAcct.length < 2 || rawAcct.length > 64) {
      err.textContent = 'Enter a valid NEAR account ID (e.g. alice.testnet).';
      err.style.display = 'block';
      return;
    }
    opts.onConnect(rawAcct, rawKey || undefined);
  };

  acctInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') finish(); });
  submit.onclick = finish;
  box.append(acctInput, keyInput, err, submit);
  panelHost.append(box);
}

/** Builds and opens the multi-wallet NEAR selector dialog (Meteor, OKX, NEAR Mobile, NEAR CLI, Intear, MyNearWallet). */
export function openNearWalletSelectorModal(callbacks: NearWalletSelectorCallbacks): HTMLDialogElement {
  ensureModalCss();
  const existing = document.querySelector<HTMLDialogElement>('dialog[data-testid="near-wallet-modal"]');
  existing?.remove();

  const dialog = document.createElement('dialog');
  dialog.className = 'plate near-modal';
  dialog.setAttribute('closedby', 'any');
  dialog.dataset.testid = 'near-wallet-modal';

  const close = (): void => {
    if (typeof dialog.close === 'function' && dialog.open) dialog.close();
    else dialog.removeAttribute('open');
    dialog.remove();
  };

  const head = document.createElement('div');
  head.className = 'near-modal-head';
  const title = document.createElement('span');
  title.className = 'label';
  title.textContent = 'CONNECT NEAR WALLET';
  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.className = 'btn btn-ghost btn-sm';
  closeBtn.textContent = '✕';
  closeBtn.onclick = close;
  head.append(title, closeBtn);

  const sub = document.createElement('p');
  sub.className = 'near-modal-sub';
  sub.textContent = 'Choose your NEAR wallet, mobile app, or CLI account. Your selection is saved for instant sign-in.';

  const completeWithAccount = (walletId: string, walletName: string, accountId: string, publicKey?: string): void => {
    saveNearWallet({ walletId, walletName, accountId, publicKey, connectedAt: Date.now() });
    const token = publicKey ? `near-wallet:${accountId}:${publicKey}` : `near-wallet:${accountId}`;
    close();
    callbacks.onDirectToken({ provider: 'fastauth', token });
  };

  const saved = readSavedNearWallet();
  const savedRow = document.createElement('div');
  if (saved) {
    savedRow.className = 'near-wallet-saved';
    const info = document.createElement('span');
    info.textContent = `${saved.walletName}: ${saved.accountId}`;
    const resumeBtn = document.createElement('button');
    resumeBtn.type = 'button';
    resumeBtn.className = 'btn btn-primary btn-sm';
    resumeBtn.dataset.testid = 'near-wallet-resume';
    resumeBtn.textContent = 'Reconnect';
    resumeBtn.onclick = () => completeWithAccount(saved.walletId, saved.walletName, saved.accountId, saved.publicKey);
    savedRow.append(info, resumeBtn);
  }

  const panelHost = document.createElement('div');
  const grid = buildWalletGrid(panelHost, callbacks, completeWithAccount, close);

  dialog.onclick = (e) => { if (e.target === dialog) close(); };
  dialog.append(head, sub, ...(saved ? [savedRow] : []), grid, panelHost);
  document.body.appendChild(dialog);
  if (typeof dialog.showModal === 'function') dialog.showModal();
  else dialog.setAttribute('open', '');
  return dialog;
}

function buildWalletGrid(
  panelHost: HTMLElement,
  callbacks: NearWalletSelectorCallbacks,
  completeWithAccount: (walletId: string, walletName: string, accountId: string, publicKey?: string) => void,
  close: () => void,
): HTMLElement {
  const grid = document.createElement('div');
  grid.className = 'near-wallet-grid';
  const returnPath = typeof location !== 'undefined' ? location.pathname + location.search : '/';
  const origin = typeof location !== 'undefined' ? location.origin : 'https://terraagent.fun';

  grid.append(
    createOptionButton('near-wallet-meteor', 'Meteor Wallet', 'EXTENSION / WEB', () => {
      const url = buildWebWalletUrl('https://wallet.meteorwallet.app/connect/testnet/login', origin, returnPath);
      const pop = window.open(url, 'terra-near-wallet', 'popup,width=500,height=680');
      callbacks.onPopupOpened(pop);
      close();
    }),
    createOptionButton('near-wallet-okx', 'OKX Wallet', 'EXTENSION / MULTI-CHAIN', () => {
      const okx = (window as unknown as { okxwallet?: { near?: InjectedOkxNear } }).okxwallet?.near;
      if (okx?.requestSignIn) {
        void okx.requestSignIn({ contractId: 'res.terraagent.testnet' }).then((res) => {
          const acct = (res && typeof res === 'object' ? res.accountId : undefined) ?? okx.getAccountId?.() ?? '';
          if (acct) completeWithAccount('okx', 'OKX Wallet', acct, res && typeof res === 'object' ? res.publicKey : undefined);
        });
        return;
      }
      renderAccountConnectPanel(panelHost, {
        walletId: 'okx',
        walletName: 'OKX Wallet',
        headline: 'OKX WALLET · CONNECT NEAR ACCOUNT',
        deepLinkUrl: 'https://web3.okx.com/download',
        onConnect: (acct, pub) => completeWithAccount('okx', 'OKX Wallet', acct, pub),
      });
    }),
    createOptionButton('near-wallet-mobile', 'NEAR Mobile', 'IOS / ANDROID APP', () => {
      renderAccountConnectPanel(panelHost, {
        walletId: 'near-mobile',
        walletName: 'NEAR Mobile App',
        headline: 'NEAR MOBILE APP · PAIR ACCOUNT',
        deepLinkUrl: 'https://nearmobile.app',
        onConnect: (acct, pub) => completeWithAccount('near-mobile', 'NEAR Mobile', acct, pub),
      });
    }),
    createOptionButton('near-wallet-cli', 'NEAR CLI (rs)', 'TERMINAL / KEYSTORE', () => {
      renderAccountConnectPanel(panelHost, {
        walletId: 'near-cli',
        walletName: 'NEAR CLI',
        headline: 'NEAR-CLI-RS · LINK ACCOUNT',
        commandHint: 'near account view-account-summary <account>.testnet network-config testnet now',
        onConnect: (acct, pub) => completeWithAccount('near-cli', 'NEAR CLI', acct, pub),
      });
    }),
    createOptionButton('near-wallet-intear', 'Intear Wallet', 'DESKTOP / WEB', () => {
      const url = buildWebWalletUrl('https://wallet.intear.tech/connect/testnet/login', origin, returnPath);
      const pop = window.open(url, 'terra-near-wallet', 'popup,width=500,height=680');
      callbacks.onPopupOpened(pop);
      close();
    }),
    createOptionButton('near-wallet-mynearwallet', 'MyNearWallet', 'TESTNET WEB WALLET', () => {
      const url = buildNearWalletLoginUrl(origin, returnPath);
      const pop = window.open(url, 'terra-near-wallet', 'popup,width=500,height=680');
      callbacks.onPopupOpened(pop);
      close();
    }),
  );
  return grid;
}
