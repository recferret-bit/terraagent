// `npm run trade:bot -- --key <key> --strategy scripted` (W13-66): scripted trader bot over `/v1/trade/*`
// using the deterministic quote library (`/v1/trade/agent/quote`), never a free price.
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseEnv } from 'node:util';
import { pathToFileURL } from 'node:url';
import type { AgentQuoteResponse, PlaceTradeOrderResponse, ResourceKey, TradeMeResponse, TradeOrdersResponse } from '@terra/contracts';
import { resolveStrategyArg, SCRIPTED_STRATEGIES, type AgentResourceTarget, type AgentStrategyInput } from '@terra/sim';

export { resolveStrategyArg, SCRIPTED_STRATEGIES };

export interface TraderStepPlaced {
  readonly resource: ResourceKey;
  readonly side: 'buy' | 'sell';
  readonly status: string;
  readonly requestId: string;
  readonly orderId?: string;
}

export interface TraderStepSkipped {
  readonly resource: ResourceKey;
  readonly side: 'buy' | 'sell';
  readonly reasons: readonly string[];
}

export interface TraderStepResult {
  readonly halted: boolean;
  readonly haltReason?: string;
  readonly me: TradeMeResponse;
  readonly placed: readonly TraderStepPlaced[];
  readonly skipped: readonly TraderStepSkipped[];
}

export interface TraderBotOptions {
  readonly baseUrl: string;
  readonly apiKey: string;
  readonly strategy: AgentStrategyInput;
  readonly stepSeq?: number;
  readonly fetchImpl?: typeof fetch;
}

const ratioParam = (r: { readonly num: bigint; readonly den: bigint } | null | undefined): string | undefined =>
  r ? `${r.num.toString()}/${r.den.toString()}` : undefined;

async function apiGet<T>(baseUrl: string, path: string, apiKey: string, fetchImpl: typeof fetch): Promise<T> {
  const res = await fetchImpl(`${baseUrl}${path}`, { headers: { authorization: `Bearer ${apiKey}` } });
  const body = (await res.json().catch(() => ({}))) as T & { error?: { code?: string; message?: string } };
  if (!res.ok) throw new Error(`${path} failed (${res.status}): ${body?.error?.code ?? 'http_error'} ${body?.error?.message ?? ''}`.trim());
  return body;
}

function quoteQueryFor(resource: ResourceKey, t: AgentResourceTarget, ttlS: number): string {
  const q = new URLSearchParams({
    resource,
    ttlS: String(ttlS),
    reserve: t.reserve.toString(),
    target: t.target.toString(),
    keep: t.keep.toString(),
    planned: (t.planned ?? 0n).toString(),
    expectedOwn: (t.expectedOwn ?? 0n).toString(),
  });
  const own = ratioParam(t.ownUnitCost);
  const local = ratioParam(t.localUnitCost);
  const tr = ratioParam(t.transportPerUnit);
  if (own) q.set('ownUnitCost', own);
  if (local) q.set('localUnitCost', local);
  if (tr) q.set('transportPerUnit', tr);
  return q.toString();
}

/** Runs one deterministic decision step of the scripted trader bot over `/v1/trade/*`. */
export async function runScriptedTraderStep(opts: TraderBotOptions): Promise<TraderStepResult> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const seq = opts.stepSeq ?? 1;
  const me = await apiGet<TradeMeResponse>(opts.baseUrl, '/v1/trade/me', opts.apiKey, fetchImpl);
  if (me.killSwitch) return { halted: true, haltReason: 'kill_switch', me, placed: [], skipped: [] };

  const openRes = await apiGet<TradeOrdersResponse>(opts.baseUrl, '/v1/trade/orders?state=open', opts.apiKey, fetchImpl);
  const openSideByRes = new Set(openRes.orders.map((o) => `${o.resource}:${o.side}`));
  const placed: TraderStepPlaced[] = [];
  const skipped: TraderStepSkipped[] = [];
  const ttlS = opts.strategy.maxOrderTtlS ?? 3600;

  for (const [resKey, target] of Object.entries(opts.strategy.reserveTargets) as [ResourceKey, AgentResourceTarget][]) {
    if (!target) continue;
    const qs = quoteQueryFor(resKey, target, ttlS);
    const quote = await apiGet<AgentQuoteResponse>(opts.baseUrl, `/v1/trade/agent/quote?${qs}`, opts.apiKey, fetchImpl);

    const trySide = async (side: 'buy' | 'sell', allowed: boolean, sideQuote: AgentQuoteResponse['bid'], reasons: readonly string[]) => {
      if (!allowed) { skipped.push({ resource: resKey, side, reasons: ['goal_disabled'] }); return; }
      if (openSideByRes.has(`${resKey}:${side}`)) { skipped.push({ resource: resKey, side, reasons: ['order_already_open'] }); return; }
      if (!sideQuote) { skipped.push({ resource: resKey, side, reasons }); return; }
      const idem = `bot-${seq}-${resKey}-${side}`;
      const r = await fetchImpl(`${opts.baseUrl}/v1/trade/orders`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${opts.apiKey}`, 'idempotency-key': idem },
        body: JSON.stringify(sideQuote.order),
      });
      const body = (await r.json().catch(() => ({}))) as PlaceTradeOrderResponse;
      if (r.status === 201 || r.status === 202) {
        placed.push({ resource: resKey, side, status: body.status, requestId: body.requestId, ...(body.order ? { orderId: body.order.orderId } : {}) });
      } else {
        skipped.push({ resource: resKey, side, reasons: [body.error?.code ?? `http_${r.status}`] });
      }
    };

    await trySide('sell', opts.strategy.goals.includes('surplus_export') && opts.strategy.specialisation !== 'autarky', quote.ask, quote.askReasons);
    await trySide('buy', opts.strategy.goals.includes('shortfall_cover') || opts.strategy.goals.includes('reserve_build'), quote.bid, quote.bidReasons);
  }

  return { halted: false, me, placed, skipped };
}

function parseBotFlags(argv: readonly string[]): Map<string, string> {
  const out = new Map<string, string>();
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (!a.startsWith('--')) continue;
    const k = a.slice(2);
    const v = argv[i + 1];
    if (v === undefined || v.startsWith('--')) { out.set(k, 'true'); continue; }
    out.set(k, v);
    i++;
  }
  return out;
}

async function main(): Promise<void> {
  const root = resolve(import.meta.dirname, '../..');
  const wtFile = resolve(root, 'infra/.env.worktree');
  const env = { ...(existsSync(wtFile) ? (parseEnv(readFileSync(wtFile, 'utf8')) as Record<string, string>) : {}), ...process.env };
  const flags = parseBotFlags(process.argv.slice(2));
  const apiKey = flags.get('key') ?? env.TA_TRADE_BOT_KEY;
  if (!apiKey) {
    process.stderr.write('usage: npm run trade:bot -- --key <ta_bot_...> [--strategy scripted|exporter] [--base <url>] [--steps <n>]\n');
    process.exit(2);
  }
  const strategy = resolveStrategyArg(flags.get('strategy') ?? 'scripted');
  const baseUrl = flags.get('base') ?? env.TA_TRADE_API ?? `http://127.0.0.1:${Number(env.PORT ?? Number(env.TA_PORT_BASE ?? 4000) + 1)}`;
  const steps = Math.max(1, Number(flags.get('steps') ?? '1'));
  const results: TraderStepResult[] = [];
  for (let s = 1; s <= steps; s++) {
    const step = await runScriptedTraderStep({ baseUrl, apiKey, strategy, stepSeq: s });
    results.push(step);
    if (step.halted) break;
  }
  process.stdout.write(`${JSON.stringify({ ok: true, steps: results.length, last: results[results.length - 1] }, null, 2)}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  void main().catch((err: unknown) => {
    process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(1);
  });
}
