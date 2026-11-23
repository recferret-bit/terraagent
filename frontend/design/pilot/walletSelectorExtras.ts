export type WalletExtraModuleId =
  | 'bitte-wallet'
  | 'hot-wallet'
  | 'here-wallet'
  | 'nightly'
  | 'sender';

export interface InjectedWalletDescriptor {
  readonly id: WalletExtraModuleId;
  readonly name: string;
  readonly available: boolean;
}

interface InjectedNearProvider {
  getAccounts?: () => Promise<Array<{ accountId: string }>>;
  requestSignIn?: (opts: { contractId?: string }) => Promise<unknown>;
  signAndSendTransaction?: (params: {
    receiverId: string;
    actions: unknown[];
  }) => Promise<unknown>;
  signMessage?: (params: {
    message: string;
    nonce: Uint8Array;
    recipient: string;
    callbackUrl?: string;
  }) => Promise<{ accountId: string; publicKey: string; signature: string }>;
}

function globalRecord(): Record<string, unknown> {
  return (typeof window !== 'undefined' ? window : globalThis) as unknown as Record<string, unknown>;
}

function getInjectedProvider(id: Exclude<WalletExtraModuleId, 'bitte-wallet'>): InjectedNearProvider | null {
  const w = globalRecord();
  if (id === 'hot-wallet') return (w.hotWallet as InjectedNearProvider | undefined) ?? null;
  if (id === 'here-wallet') return (w.here as InjectedNearProvider | undefined) ?? null;
  if (id === 'nightly') {
    const n = w.nightly as { near?: InjectedNearProvider } | undefined;
    return n?.near ?? null;
  }
  return (w.near as InjectedNearProvider | undefined) ?? null;
}

export function detectInjectedNearWallets(): readonly InjectedWalletDescriptor[] {
  return [
    { id: 'bitte-wallet', name: 'Bitte AI Wallet', available: true },
    { id: 'hot-wallet', name: 'HOT Wallet', available: Boolean(getInjectedProvider('hot-wallet')) },
    { id: 'here-wallet', name: 'HERE Wallet', available: Boolean(getInjectedProvider('here-wallet')) },
    { id: 'nightly', name: 'Nightly Wallet', available: Boolean(getInjectedProvider('nightly')) },
    { id: 'sender', name: 'Sender Wallet', available: Boolean(getInjectedProvider('sender')) },
  ];
}

export function buildBitteSignMessageUrl(opts: {
  readonly message: string;
  readonly nonce: string;
  readonly recipient: string;
  readonly callbackUrl: string;
  readonly network: 'testnet' | 'mainnet';
}): string {
  const host = opts.network === 'mainnet' ? 'https://wallet.bitte.ai' : 'https://testnet.wallet.bitte.ai';
  const qs = new URLSearchParams({
    message: opts.message,
    nonce: opts.nonce,
    recipient: opts.recipient,
    callbackUrl: opts.callbackUrl,
  });
  return `${host}/sign-message?${qs.toString()}`;
}

export async function signWithExtraWallet(
  id: WalletExtraModuleId,
  req: {
    readonly message: string;
    readonly nonceBase64: string;
    readonly nonceBytes: Uint8Array;
    readonly recipient: string;
    readonly callbackUrl: string;
    readonly network: 'testnet' | 'mainnet';
  },
): Promise<{ readonly accountId: string; readonly publicKey: string; readonly signature: string; readonly callbackUrl?: string }> {
  if (id === 'bitte-wallet') {
    const url = buildBitteSignMessageUrl({
      message: req.message,
      nonce: req.nonceBase64,
      recipient: req.recipient,
      callbackUrl: req.callbackUrl,
      network: req.network,
    });
    if (typeof window !== 'undefined') window.open?.(url, 'bitte-wallet', 'width=460,height=720');
    throw new Error(`Opened Bitte AI Wallet (${url}) — approve and complete callback.`);
  }
  const provider = getInjectedProvider(id);
  if (!provider || typeof provider.signMessage !== 'function') {
    throw new Error(`${id} browser extension is not installed.`);
  }
  const signed = await provider.signMessage({
    message: req.message,
    nonce: req.nonceBytes,
    recipient: req.recipient,
    callbackUrl: req.callbackUrl,
  });
  return {
    accountId: signed.accountId,
    publicKey: signed.publicKey,
    signature: signed.signature,
    callbackUrl: req.callbackUrl,
  };
}

export async function sendTxWithInjectedExtraWallet(
  walletId: string | undefined,
  tx: {
    readonly receiverId: string;
    readonly methodName: string;
    readonly args: Record<string, unknown>;
    readonly gasYocto: string;
    readonly depositYocto: string;
  },
): Promise<boolean> {
  if (walletId !== 'hot-wallet' && walletId !== 'here-wallet' && walletId !== 'nightly' && walletId !== 'sender') {
    return false;
  }
  const provider = getInjectedProvider(walletId);
  if (!provider || typeof provider.signAndSendTransaction !== 'function') {
    return false;
  }
  await provider.signAndSendTransaction({
    receiverId: tx.receiverId,
    actions: [
      {
        type: 'FunctionCall',
        params: {
          methodName: tx.methodName,
          args: tx.args,
          gas: tx.gasYocto,
          deposit: tx.depositYocto,
        },
      },
    ],
  });
  return true;
}
