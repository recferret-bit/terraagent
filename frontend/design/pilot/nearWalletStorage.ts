import type { WalletSelectorModuleId } from './walletSelectorRuntime';

export interface SavedNearWallet {
  readonly walletId: string;
  readonly walletName: string;
  readonly accountId: string;
  readonly publicKey?: string;
  readonly connectedAt: number;
}

export interface SelectorWalletDef {
  readonly testId: string;
  readonly moduleId: WalletSelectorModuleId;
  readonly name: string;
  readonly subtitle: string;
  readonly signupUrl: string;
  readonly signupActionLabel: string;
}

const STORAGE_KEY = 'ta_near_wallet';
const NEAR_ACCOUNT_RE = /^(([a-z\d]+[-_])*[a-z\d]+\.)*([a-z\d]+[-_])*[a-z\d]+$/;

export const SELECTOR_WALLETS: readonly SelectorWalletDef[] = [
  {
    testId: 'near-wallet-meteor',
    moduleId: 'meteor-wallet',
    name: 'Meteor Wallet',
    subtitle: 'EXTENSION / WEB · NEAR',
    signupUrl: 'https://wallet.meteorwallet.app',
    signupActionLabel: 'Open Meteor Wallet ↗',
  },
  {
    testId: 'near-wallet-okx',
    moduleId: 'okx-wallet',
    name: 'OKX Wallet',
    subtitle: 'EXTENSION · NEAR',
    signupUrl: 'https://web3.okx.com/download',
    signupActionLabel: 'Install OKX Extension ↗',
  },
  {
    testId: 'near-wallet-mobile',
    moduleId: 'near-mobile-wallet',
    name: 'NEAR Mobile',
    subtitle: 'QR / APP PAIR · NEAR',
    signupUrl: 'https://nearmobile.app',
    signupActionLabel: 'Get NEAR Mobile (iOS / Android) ↗',
  },
  {
    testId: 'near-wallet-intear',
    moduleId: 'intear-wallet',
    name: 'Intear Wallet',
    subtitle: 'WEB / DESKTOP · NEAR',
    signupUrl: 'https://wallet.intear.tech',
    signupActionLabel: 'Open Intear Wallet ↗',
  },
  {
    testId: 'near-wallet-mynearwallet',
    moduleId: 'my-near-wallet',
    name: 'MyNearWallet',
    subtitle: 'WEB WALLET · NEAR',
    signupUrl: 'https://testnet.mynearwallet.com/create',
    signupActionLabel: 'Create MyNearWallet ↗',
  },
];

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
