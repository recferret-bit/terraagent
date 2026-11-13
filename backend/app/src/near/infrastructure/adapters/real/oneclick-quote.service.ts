export interface OneClickTokenInfo {
  readonly assetId: string;
  readonly symbol: string;
  readonly decimals: number;
  readonly blockchain: string;
  readonly price?: number;
}

export interface OneClickDryQuoteRequest {
  readonly originAsset?: string;
  readonly destinationAsset?: string;
  readonly amount?: string;
  readonly recipient?: string;
}

export interface OneClickDryQuoteResult {
  readonly ok: boolean;
  readonly dry: true;
  readonly source: 'live-1click' | 'fallback';
  readonly originAsset: string;
  readonly destinationAsset: string;
  readonly amountIn: string;
  readonly amountOut: string;
  readonly minAmountOut: string;
  readonly amountOutFormatted: string;
  readonly amountOutUsd?: string;
  readonly signature?: string;
  readonly timeEstimateSec: number;
  readonly quotedAt: string;
}

const DEFAULT_ORIGIN = 'nep141:wrap.near';
const DEFAULT_DEST = 'nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1'; // NEAR native USDC
const DEFAULT_MAINNET_PROBE_ACCOUNT = 'intents.near';

function normalizeDryQuoteRecipient(raw?: string): string {
  const trimmed = raw?.trim();
  if (!trimmed || trimmed.endsWith('.testnet') || trimmed.endsWith('.mock') || trimmed === 'terraagent.near') {
    return DEFAULT_MAINNET_PROBE_ACCOUNT;
  }
  return trimmed;
}

/**
 * Live NEAR Intents 1Click API client (`https://1click.chaindefuser.com/v0`, `W23-25`).
 * Always sets `dry: true` so hackathon judges & players see real cross-chain solver quotes with zero mainnet spend.
 */
export class OneClickQuoteClient {
  private tokensCache: { items: readonly OneClickTokenInfo[]; at: number } | null = null;

  constructor(
    private readonly baseUrl = 'https://1click.chaindefuser.com',
    private readonly apiKey?: string,
  ) {}

  private headers(): Record<string, string> {
    return {
      'Content-Type': 'application/json',
      ...(this.apiKey ? { Authorization: `Bearer ${this.apiKey}` } : {}),
    };
  }

  async listTokens(): Promise<readonly OneClickTokenInfo[]> {
    if (this.tokensCache && Date.now() - this.tokensCache.at < 300_000) {
      return this.tokensCache.items;
    }
    try {
      const res = await fetch(`${this.baseUrl}/v0/tokens`, {
        headers: this.headers(),
        signal: AbortSignal.timeout(5_000),
      });
      if (!res.ok) return [];
      const items = (await res.json()) as OneClickTokenInfo[];
      const list = Array.isArray(items) ? items.slice(0, 50) : [];
      this.tokensCache = { items: list, at: Date.now() };
      return list;
    } catch {
      return [];
    }
  }

  async dryQuote(req: OneClickDryQuoteRequest = {}): Promise<OneClickDryQuoteResult> {
    const originAsset = req.originAsset || DEFAULT_ORIGIN;
    const destinationAsset = req.destinationAsset || DEFAULT_DEST;
    const amount = req.amount || '1000000000000000000000000'; // 1 wNEAR
    const recipient = normalizeDryQuoteRecipient(req.recipient);
    const deadline = new Date(Date.now() + 15 * 60_000).toISOString();

    try {
      const res = await fetch(`${this.baseUrl}/v0/quote`, {
        method: 'POST',
        headers: this.headers(),
        signal: AbortSignal.timeout(6_000),
        body: JSON.stringify({
          dry: true,
          swapType: 'EXACT_INPUT',
          slippageTolerance: 100,
          originAsset,
          depositType: 'ORIGIN_CHAIN',
          destinationAsset,
          amount,
          refundTo: recipient,
          refundType: 'ORIGIN_CHAIN',
          recipient,
          recipientType: 'DESTINATION_CHAIN',
          deadline,
        }),
      });
      if (res.ok) {
        const data = (await res.json()) as {
          quote?: {
            amountIn?: string;
            amountOut?: string;
            minAmountOut?: string;
            amountOutFormatted?: string;
            amountOutUsd?: string;
            timeEstimate?: number;
          };
          signature?: string;
          timestamp?: string;
        };
        if (data.quote?.amountOut) {
          return {
            ok: true,
            dry: true,
            source: 'live-1click',
            originAsset,
            destinationAsset,
            amountIn: data.quote.amountIn ?? amount,
            amountOut: data.quote.amountOut,
            minAmountOut: data.quote.minAmountOut ?? data.quote.amountOut,
            amountOutFormatted: data.quote.amountOutFormatted ?? data.quote.amountOut,
            amountOutUsd: data.quote.amountOutUsd,
            signature: data.signature,
            timeEstimateSec: data.quote.timeEstimate ?? 15,
            quotedAt: data.timestamp ?? new Date().toISOString(),
          };
        }
      }
    } catch {
      // Fall through to deterministic synthetic fallback if offline / rate-limited
    }

    return {
      ok: true,
      dry: true,
      source: 'fallback',
      originAsset,
      destinationAsset,
      amountIn: amount,
      amountOut: '4150000',
      minAmountOut: '4108500',
      amountOutFormatted: '4.15',
      timeEstimateSec: 12,
      quotedAt: new Date().toISOString(),
    };
  }
}
