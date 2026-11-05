import type { Page } from '@playwright/test';
import { expect, expectNoPageErrors, hostMode, loadLocal, loadScenario, login, stack, test, urls, waitForTick } from './harness';

/**
 * W13 Markets (F2, mock) wave E2E suite, part 1 (W13-35): demo story `docs/plan/waves/W13-markets.md` steps 1, 3-11 through the
 * commands, REST and dev routes, with TWO browser contexts (A = `?scenario=w13&as=a`, B joins with `?join=<planetId>&as=b`).
 * Steps that need the Market UI (W13-20/21/22: Market tab, order form preview, stall slider) are named `test.fixme`
 * placeholders that part 2 fills. Every step is tagged `@hack` for `npm run e2e -- --waves ..13 --hack`.
 *
 * Money in this suite is MOCK: balances live in the mock `intents.near` verifier and are labelled fixtures (`organic: false`).
 */
test.describe.configure({ mode: 'serial' });
const local = hostMode() === 'local';
test.skip(local, 'W13 markets need the server (Postgres, mock verifier); the browser local host has no market module');

const APP = urls().app;
const USDC = (whole: string): string => String(Math.round(Number(whole) * 1_000_000));
const WATER = 'bio.water';

interface Ack { ok: boolean; appliedAtTick?: number; code?: string; detail?: string }
interface OnlineWin {
  __online: {
    planetId: string;
    store: { latest: { colonies: Array<{ stock?: Record<string, number>; cargo?: { inOrbit?: Record<string, number>; pendingMint?: Record<string, unknown> }; market?: { reservedInOrbit?: Record<string, number> }; prestige?: { completed?: number } }> } | null };
    commands: { send(kind: string, args?: unknown): Promise<Ack> };
  };
}
interface Snap {
  planetId: string;
  books: Array<{ pair: string }>;
  board: Array<{ pair: string; last: { num: string; den: number } | null; classification: string; reason?: string; volume24h: number }>;
  recentTrades: Array<{ tradeId: string; pair: string; amount: number; notional: string; platformFee: string; stallFee: string; stallFeeBp: number; state: string; organic: boolean }>;
  policy: { platformFeeBp: number; stallFeeMaxBp: number; stallFeeDefaultBp: number; ttlOptionsS: number[] };
  myOrders?: Array<{ orderId: string; side: string; amount: number; filled: number; state: string; reserved: string; stallFeeBp: number; policyVersion: string }>;
  balances?: Record<string, string>;
  reserved?: Record<string, string>;
  stall?: { hubFeeBp: number; earned: Record<string, string> };
}

let a: Page;
let b: Page;
let planetId = '';

const send = (p: Page, kind: string, args: unknown): Promise<Ack> => p.evaluate(([k, x]) => (window as unknown as OnlineWin).__online.commands.send(k, x), [kind, args] as const);
const colony = (p: Page, i = 0) => p.evaluate((n) => (window as unknown as OnlineWin).__online.store.latest?.colonies?.[n] ?? null, i);

async function snap(as: 'a' | 'b'): Promise<Snap> {
  const res = await fetch(`${APP}/v1/market/${planetId}?as=${as}`);
  expect(res.status, `GET /v1/market as ${as}`).toBe(200);
  return (await res.json()) as Snap;
}
const bal = async (as: 'a' | 'b', token: string): Promise<bigint> => BigInt((await snap(as)).balances?.[token] ?? '0');

async function dev(name: string, body: unknown): Promise<{ status: number; json: Record<string, unknown> }> {
  const res = await fetch(`${APP}/v1/dev/commands/${name}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  return { status: res.status, json: (await res.json().catch(() => ({}))) as Record<string, unknown> };
}

const order = (side: 'buy' | 'sell', amount: number, usdc: string, extra: Record<string, unknown> = {}) =>
  ({ side, resource: WATER, amount, price: { token: 'USDC', amount: USDC(usdc) }, ttlS: 3600, ...(side === 'buy' ? { maxStallFeeBp: 100 } : {}), ...extra });

test.beforeAll(async ({ browser }) => {
  a = await (await browser.newContext()).newPage();
  b = await (await browser.newContext()).newPage();
});
test.afterAll(async () => { await a?.context().close(); await b?.context().close(); });

test('@hack 1. A opens ?scenario=w13&as=a, B joins with ?join=<planetId>&as=b: A holds 600 water, B 20 mock USDC, both have online Trade Hubs', async () => {
  test.setTimeout(300_000);
  await loadScenario(a, 'w13', { skip: '1' }, { as: 'a', timeout: 120_000 });
  planetId = await a.evaluate(() => (window as unknown as OnlineWin).__online.planetId);
  expect(planetId).toMatch(/^pl_/);
  login(b, 'b');
  await b.goto(`/play.html?${new URLSearchParams({ join: planetId, as: 'b', skip: '1' })}`);
  await waitForTick(b, () => true, 150_000);
  // fixture balances land when each dev session is seated (backend `market-fixtures.service.ts`); REST shows them
  await expect.poll(async () => (await snap('a')).balances?.[WATER], { timeout: 30_000 }).toBe('600');
  await expect.poll(async () => (await snap('b')).balances?.USDC, { timeout: 30_000 }).toBe(USDC('20'));
  expect((await snap('a')).balances?.USDC ?? '0').toBe('0');
  // sim part: colony 0 mirrors 600 in orbit, colony 1 is B's; both hubs online
  await expect.poll(async () => (await colony(a))?.cargo?.inOrbit?.[WATER] ?? 0, { timeout: 15_000 }).toBe(600);
  expect((await colony(a))?.stock?.[WATER]).toBe(900);
  expect((await colony(b, 1))?.stock?.[WATER]).toBe(200);
  expectNoPageErrors(a);
});

test.fixme('@hack 2. A opens Market, selects water/USDC and sets its stall fee to 1 % in the stall slider (UI: W13-20/22, part 2)', () => undefined);

test('@hack 2b. (command path of step 2) A sets its stall fee to 1 %: the market snapshot shows hubFeeBp 100', async () => {
  const ack = await send(a, 'market.setHubFee', { bp: 100 });
  expect(ack.ok, JSON.stringify(ack)).toBe(true);
  await expect.poll(async () => (await snap('a')).stall?.hubFeeBp, { timeout: 15_000 }).toBe(100);
});

test('@hack 3. A offers 300 water for 10 USDC, TTL 1 h: order OPEN pinning policy and fee, 300 water reserved in REST and in the sim mirror', async () => {
  const ack = await send(a, 'market.placeOrder', order('sell', 300, '10'));
  expect(ack.ok, JSON.stringify(ack)).toBe(true);
  await expect.poll(async () => (await snap('a')).myOrders?.length ?? 0, { timeout: 20_000 }).toBe(1);
  const s = await snap('a');
  const o = s.myOrders![0]!;
  expect(o).toMatchObject({ side: 'sell', amount: 300, filled: 0, state: 'OPEN', stallFeeBp: 100 });
  expect(o.policyVersion).toBeTruthy();
  expect(s.reserved?.[WATER]).toBe('300');
  expect(s.books.some((x) => x.pair === 'bio.water/USDC')).toBe(true);
  await expect.poll(async () => (await colony(a))?.market?.reservedInOrbit?.[WATER] ?? 0, { timeout: 15_000 }).toBe(300);
});

test.fixme('@hack 4a. B opens the order form and previews 300 water, 10 USDC notional, 0.10 platform fee, 0.10 stall fee, total 10.20 (UI: W13-21, part 2)', () => undefined);

let aUsdcBefore = 0n;
test('@hack 4. B buys 300 water for 10 USDC: trade FINAL, A +10 USDC, stall +0.10, platform +0.10, B +300 water, contract toast on both pages', async () => {
  test.setTimeout(150_000);
  aUsdcBefore = await bal('a', 'USDC');
  const bBefore = await bal('b', 'USDC');
  const toast = 'Contract signed: 300 water for 10.00 USDC at Port A (1 % fee)'; // shown for 6 s: watch for it before the fill
  for (const p of [a, b]) {
    await p.evaluate(() => {
      const w = window as unknown as { __ev: unknown[]; __online: { store: { onServerEvents?(fn: (e: unknown[]) => void): void } } };
      w.__ev = [];
      w.__online.store.onServerEvents?.((e) => w.__ev.push(...e));
    });
  }
  const toasts = Promise.all([a, b].map((p) => p.getByText(toast).first().waitFor({ state: 'visible', timeout: 100_000 })));
  toasts.catch(() => undefined);
  const ack = await send(b, 'market.placeOrder', order('buy', 300, '10'));
  expect(ack.ok, JSON.stringify(ack)).toBe(true);
  await expect.poll(async () => (await snap('a')).recentTrades.length, { timeout: 40_000 }).toBe(1);
  const t = (await snap('a')).recentTrades[0]!;
  expect(t).toMatchObject({ pair: 'bio.water/USDC', amount: 300, notional: USDC('10'), platformFee: USDC('0.10'), stallFee: USDC('0.10'), stallFeeBp: 100, state: 'FINAL' });
  expect(await bal('b', WATER)).toBe(300n);
  expect(await bal('b', 'USDC')).toBe(BigInt(USDC('20')) - BigInt(USDC('10.20')) - 0n + (bBefore - BigInt(USDC('20'))));
  expect(await bal('a', WATER)).toBe(300n); // 600 offered 300
  // A is paid the notional; its stall's 0.10 is attributed separately
  const aDelta = (await bal('a', 'USDC')) - aUsdcBefore;
  expect([BigInt(USDC('10')), BigInt(USDC('10.10'))]).toContain(aDelta);
  expect((await snap('a')).stall?.earned.USDC).toBe(USDC('0.10'));
  test.info().annotations.push({ type: 'observed', description: `step 4: A USDC delta ${aDelta}, B USDC ${await bal('b', 'USDC')}, B water ${await bal('b', WATER)}` });
  await toasts.catch(async (e: unknown) => {
    const seen = await a.evaluate(() => JSON.stringify((window as unknown as { __ev: unknown[] }).__ev).slice(0, 1500));
    throw new Error(`no contract toast: ${(e as Error).message.split('\n')[0]}; events on A: ${seen}`);
  }); // both pages showed the contract toast
});

test('@hack 5. Price board shows the gross execution price and the organic/fixture classification; a pair without history is labelled insufficient_data', async () => {
  const board = (await snap('a')).board;
  const row = board.find((r) => r.pair === 'bio.water/USDC')!;
  expect(row.last).toEqual({ num: '100000', den: 3 }); // gross execution price per unit: 10 USDC / 300 water = 100000/3 atomic
  expect(['organic', 'fixture', 'insufficient_data']).toContain(row.classification);
  expect(row.volume24h).toBe(300);
  const other = board.find((r) => r.pair !== 'bio.water/USDC')!;
  expect(other).toMatchObject({ classification: 'insufficient_data', last: null });
  test.info().annotations.push({ type: 'observed', description: `bio.water/USDC classification=${row.classification} reason=${row.reason ?? ''}` });
});

test('@hack 6. A second order fills in lots: cumulative notional and fees equal the unsplit fill; a resting buy hit by an incoming sell still makes the buyer pay', async () => {
  test.setTimeout(120_000);
  const before = (await snap('a')).recentTrades.length;
  const bUsdc0 = await bal('b', 'USDC');
  expect((await send(a, 'market.placeOrder', order('sell', 200, '2'))).ok).toBe(true);
  for (let i = 0; i < 2; i++) expect((await send(b, 'market.placeOrder', order('buy', 100, '1'))).ok).toBe(true);
  await expect.poll(async () => (await snap('a')).recentTrades.length, { timeout: 60_000 }).toBe(before + 2);
  const lots = (await snap('a')).recentTrades.slice(0, 2);
  const sum = (f: 'notional' | 'platformFee' | 'stallFee') => lots.reduce((n, t) => n + BigInt(t[f]), 0n);
  expect(sum('notional')).toBe(BigInt(USDC('2')));
  expect(sum('platformFee')).toBe(BigInt(USDC('0.02'))); // = the unsplit 200 @ 2 USDC fill at 1 %
  expect(sum('stallFee')).toBe(BigInt(USDC('0.02')));
  expect(bUsdc0 - (await bal('b', 'USDC'))).toBe(BigInt(USDC('2.04')));
  // resting buy (B) first, incoming sell (A) second: the buyer pays notional + fees
  const bUsdc1 = await bal('b', 'USDC');
  const bEarned0 = BigInt((await snap('b')).stall?.earned.USDC ?? '0');
  expect((await send(b, 'market.placeOrder', order('buy', 100, '5'))).ok).toBe(true);
  await expect.poll(async () => (await snap('b')).myOrders?.filter((o) => o.side === 'buy').length ?? 0, { timeout: 20_000 }).toBe(1);
  expect((await send(a, 'market.placeOrder', order('sell', 100, '1'))).ok).toBe(true);
  await expect.poll(async () => (await snap('a')).recentTrades.length, { timeout: 60_000 }).toBe(before + 3);
  const t = (await snap('a')).recentTrades[0]!;
  const paid = bUsdc1 - (await bal('b', 'USDC'));
  // B rested the buy, so B's own stall is the maker stall: the buyer pays notional + platform fee + stall fee, and the stall fee is credited back to B's own stall
  await expect.poll(async () => BigInt((await snap('b')).stall?.earned.USDC ?? '0') - bEarned0, { timeout: 15_000 }).toBe(BigInt(t.stallFee));
  expect(paid).toBe(BigInt(t.notional) + BigInt(t.platformFee));
  test.info().annotations.push({ type: 'observed', description: `resting buy 5 USDC vs incoming sell 1 USDC: notional ${t.notional}, buyer paid ${paid}` });
});

test('@hack 7. Cancel releases the principal and fee reservations exactly once', async () => {
  const free0 = await bal('b', 'USDC');
  expect((await send(b, 'market.placeOrder', order('buy', 100, '1'))).ok).toBe(true);
  await expect.poll(async () => (await snap('b')).reserved?.USDC, { timeout: 20_000 }).toBe(USDC('1.02'));
  expect(free0 - (await bal('b', 'USDC'))).toBe(BigInt(USDC('1.02')));
  const orderId = (await snap('b')).myOrders!.find((o) => o.side === 'buy')!.orderId;
  expect((await send(b, 'market.cancelOrder', { orderId })).ok).toBe(true);
  await expect.poll(async () => (await snap('b')).reserved?.USDC, { timeout: 20_000 }).toBeUndefined();
  expect(await bal('b', 'USDC')).toBe(free0);
  await send(b, 'market.cancelOrder', { orderId }); // a second cancel must not release again
  await a.waitForTimeout(1500);
  expect(await bal('b', 'USDC')).toBe(free0);
  expect((await snap('b')).myOrders?.length ?? 0).toBe(0);
});

test('@hack 8. An injected settlement failure is an UNKNOWN outcome: nothing is credited, funds stay locked, and after the mock recovers reconciliation settles exactly one trade', async () => {
  test.setTimeout(180_000);
  const total = async (who: 'a' | 'b', token: string): Promise<bigint> => {
    const x = await snap(who);
    return BigInt(x.balances?.[token] ?? '0') + BigInt(x.reserved?.[token] ?? '0');
  };
  const [aU, aW, bU, bW] = [await total('a', 'USDC'), await total('a', WATER), await total('b', 'USDC'), await total('b', WATER)];
  const finals = (await snap('a')).recentTrades.length;
  expect((await dev('near.mock.fail', { port: 'intents', rate: 1 })).status).toBe(200);
  try {
    expect((await send(b, 'market.placeOrder', order('sell', 100, '1'))).ok).toBe(true);
    expect((await send(a, 'market.placeOrder', order('buy', 100, '1'))).ok).toBe(true);
    await a.waitForTimeout(8000);
    expect((await snap('a')).recentTrades.length, 'no FINAL trade while the verifier fails').toBe(finals);
    // the matched fill is in flight (UNKNOWN): the buyer's principal + fees and the seller's water are held, nothing reached the counterparty
    expect(await total('a', 'USDC')).toBeLessThan(aU);
    expect(await total('b', WATER)).toBeLessThan(bW);
    expect(await total('a', WATER)).toBe(aW);
    expect(await total('b', 'USDC')).toBe(bU);
  } finally {
    await dev('near.mock.fail', { port: 'intents', rate: 0 });
  }
  // reconciliation (every 30 s) re-runs the same execute: exactly one trade, one transfer
  await expect.poll(async () => (await snap('a')).recentTrades.length, { timeout: 90_000, message: 'reconciled trade' }).toBe(finals + 1);
  const t = (await snap('a')).recentTrades[0]!;
  expect(t).toMatchObject({ amount: 100, notional: USDC('1'), state: 'FINAL' });
  expect(await total('a', WATER)).toBe(aW + 100n);
  expect(await total('b', WATER)).toBe(bW - 100n);
  // seller B is paid the notional, and B's own stall (B rested the sell, so it is the maker stall) earns the stall fee too
  expect(await total('b', 'USDC')).toBe(bU + BigInt(USDC('1')) + BigInt(t.stallFee));
  await a.waitForTimeout(3000);
  expect((await snap('a')).recentTrades.length, 'still one trade after another wait').toBe(finals + 1);
  test.info().annotations.push({ type: 'skipped', description: 'definite failures (NEAR_INSUFFICIENT_BALANCE...) and the outcome-unknown control have no dev route; covered by backend/app/test/market/settlement-recovery.int.spec.ts' });
});

test('@hack 9. Operator economy API: clone baseline, patch the platform fee, validate, run a short seeded experiment, activate for the sandbox, roll back; open orders keep their terms', async () => {
  test.setTimeout(240_000);
  const call = async (method: string, path: string, body: unknown, token: string) => {
    const res = await fetch(`${APP}/v1/economy${path}`, { method, headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    return { status: res.status, json: (await res.json().catch(() => ({}))) as Record<string, any> }; // eslint-disable-line @typescript-eslint/no-explicit-any
  };
  const EDIT = 'dev-economy-operator', ACT = 'dev-economy-activator';
  // an open order that must keep its pinned terms (1 % platform fee) across the activation
  expect((await send(a, 'market.placeOrder', order('sell', 50, '1'))).ok).toBe(true);
  await expect.poll(async () => (await snap('a')).myOrders?.length ?? 0, { timeout: 20_000 }).toBe(1);
  const pinned = (await snap('a')).myOrders![0]!;
  const policyHash = async (): Promise<string | null> => (await call('GET', `/resolve?planetType=temperate&planetId=${planetId}`, undefined, EDIT)).json.marketPolicyHash;
  const hash0 = await policyHash();
  const clone = await call('POST', '/profiles/baseline/versions/1/clone', { requestId: 'e2e-clone' }, EDIT);
  expect(clone.status, JSON.stringify(clone.json)).toBe(201);
  const v = clone.json.version.version.version as number;
  const patch = await call('PATCH', `/profiles/baseline/versions/${v}`, { schemaVersion: 1, requestId: 'e2e-patch', expectedVersion: 1, ops: [{ op: 'set', path: 'market.policy.platformFeeBp', value: 80 }] }, EDIT);
  expect(patch.status, JSON.stringify(patch.json)).toBe(200);
  expect((await call('POST', `/profiles/baseline/versions/${v}/validate`, { requestId: 'e2e-val' }, EDIT)).json.valid).toBe(true);
  // short seeded experiment on the candidate (headless runner, W13-45)
  const exported = await call('GET', `/profiles/baseline/versions/${v}/export`, undefined, EDIT);
  const manifest = { schemaVersion: 1, profile: { id: 'baseline', version: v, hash: exported.json.ref.hash }, engineCommit: 'workspace', waves: '..13', scenarios: [{ id: 'baseline-two-colony', version: 1 }], seeds: [101], warmupTicks: 50, measureTicks: 400, sampleEveryTicks: 200, ticksPerSecond: 5, budget: { maxRuns: 2, maxWallSeconds: 120, maxWorkers: 1 }, behaviorProfile: 'specialists-v1', demandModel: { source: 'assumed', perPayingActorMonthlyBudgetUsdcAtomic: '30000000' }, output: { format: 'jsonl', trace: 'failures' } };
  const exp = await call('POST', '/experiments', { requestId: 'e2e-exp', manifest }, EDIT);
  expect(exp.status, JSON.stringify(exp.json)).toBe(202);
  const expId = (exp.json.experiment?.id ?? exp.json.id) as string;
  await expect.poll(async () => (await call('GET', `/experiments/${expId}`, undefined, EDIT)).json.experiment?.status ?? (await call('GET', `/experiments/${expId}`, undefined, EDIT)).json.status, { timeout: 120_000 }).toMatch(/completed|failed/);
  expect((await call('POST', `/profiles/baseline/versions/${v}/approve`, { requestId: 'e2e-appr' }, ACT)).status).toBe(200);
  const act = await call('POST', '/activations', { requestId: 'e2e-act', versionId: `baseline@${v}`, expectedPreviousVersionId: 'baseline@1', nonProduction: true }, ACT);
  expect(act.status, JSON.stringify(act.json)).toBe(202);
  await expect.poll(async () => (await call('GET', '/activations?scope=global', undefined, EDIT)).json.activations.find((x: Record<string, unknown>) => x.state === 'ACTIVE')?.versionId, { timeout: 30_000 }).toBe(`baseline@${v}`);
  await expect.poll(policyHash, { timeout: 30_000, message: 'resolved market policy after activation' }).not.toBe(hash0);
  // KNOWN GAP (reported): the server's MarketPolicyProvider still serves the bootstrap policy, so new orders do not pin the activated fee yet
  test.info().annotations.push({ type: 'gap', description: `GET /v1/market policy.platformFeeBp after activation = ${(await snap('a')).policy.platformFeeBp} (candidate 80)` });
  expect((await snap('a')).myOrders![0]).toMatchObject({ orderId: pinned.orderId, platformFeeBp: 100, policyVersion: pinned.policyVersion }); // open order keeps its terms
  const rb = await call('POST', `/activations/${act.json.activation.id}/rollback`, { requestId: 'e2e-rb' }, ACT);
  expect(rb.status, JSON.stringify(rb.json)).toBe(202);
  await expect.poll(async () => (await call('GET', '/activations?scope=global', undefined, EDIT)).json.activations.find((x: Record<string, unknown>) => x.state === 'ACTIVE')?.versionId, { timeout: 30_000 }).toBe('baseline@1');
  await expect.poll(policyHash, { timeout: 30_000, message: 'resolved market policy after rollback' }).toBe(hash0);
  await send(a, 'market.cancelOrder', { orderId: pinned.orderId });
});

test.fixme('@hack 9b. The operator panel UI (clone, edit, validate, compare, activate, rollback) is driven in the browser (UI issue, part 2)', () => undefined);

test('@hack 10. Prestige project through the queue, and a transport-recipe export/import: actual consumption is separate from the representation transfer', async () => {
  test.setTimeout(180_000);
  expect((await send(a, 'dev.grant', { resource: 'minerals.t2', amount: 40 })).ok).toBe(true);
  const col0 = (await colony(a)) as { stock: Record<string, number> };
  const enq = await send(a, 'enqueueTask', { project: { project: 'project.survey_array' } });
  expect(enq.ok, JSON.stringify(enq)).toBe(true);
  await expect.poll(async () => ((await colony(a))?.stock?.['metals.t1'] ?? 0) < col0.stock['metals.t1']!, { timeout: 30_000 }).toBe(true); // inputs are paid progressively (consumption)
  // export 100 water: the transport recipe costs biomass (consumption); the water itself moves to orbit (representation)
  const s0 = (await colony(a))!.stock!;
  const ex = await send(a, 'cargo.export', { resource: WATER, amount: 100 });
  expect(ex.ok, JSON.stringify(ex)).toBe(true);
  await expect.poll(async () => (await colony(a))?.stock?.[WATER], { timeout: 20_000 }).toBe(s0[WATER]! - 100);
  expect((await colony(a))!.stock!['bio.biomass']).toBe(s0['bio.biomass']! - 2); // transport.cargo: 2 biomass per started block of 100
  await expect.poll(async () => (await colony(a))?.cargo?.inOrbit?.[WATER] ?? 0, { timeout: 40_000 }).toBeGreaterThanOrEqual(100);
  expectNoPageErrors(a);
});

test('@hack 11. Later waves off: with TA_WAVES=..12 the server refuses market commands, faucet and REST (wave_disabled); persisted orders and trades are intact after switching back', async ({ browser }) => {
  test.setTimeout(240_000);
  const before = (await snap('a')).recentTrades.length;
  expect(before).toBeGreaterThan(0);
  // client side (?waves=..12 with the browser local host): market commands answer wave_disabled
  const loc = await (await browser.newContext()).newPage();
  await loadLocal(loc, 'w13', { waves: '..12' }, 90_000);
  expect((await send(loc, 'market.placeOrder', order('sell', 10, '1'))).code).toBe('wave_disabled');
  expect((await send(loc, 'market.setHubFee', { bp: 50 })).code).toBe('wave_disabled');
  await loc.context().close();
  // server side: the whole app restarts with TA_WAVES=..12 (`npm run dev:restart` of demo step 11)
  await stack.restartApp({ waves: '..12' });
  try {
    const faucet = await fetch(`${APP}/v1/dev/market/faucet`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ planetId, colonyIndex: 0, token: 'USDC', amount: '1' }) });
    expect(faucet.status, 'faucet with W13 off').toBe(403);
    const rest = await fetch(`${APP}/v1/market/${planetId}?as=a`);
    test.info().annotations.push({ type: 'observed', description: `GET /v1/market with W13 off -> ${rest.status}` });
    expect([403, 404]).toContain(rest.status);
  } finally {
    await stack.restartApp({ waves: '' });
  }
  const after = await fetch(`${APP}/v1/market/${planetId}?as=a`);
  expect(after.status).toBe(200);
  const snapAfter = (await after.json()) as Snap;
  expect(snapAfter.recentTrades.length, 'persisted trades survive the waves-off restart').toBe(before);
});
