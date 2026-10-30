import { describe, expect, it, type TestContext } from 'vitest';
import { nearAdapterFor, type NearAdapterKind } from '../infrastructure/adapter-selection';
import type { ChainReceipt, NearPortName } from '../domain/types';

export type Env = Readonly<Record<string, string | undefined>>;
export type AdapterKind = NearAdapterKind;

/** What `makeAdapter` returns: the port under test, which kind of adapter it is, plus any port-specific helpers. */
export type AdapterUnderTest<P, H extends object = object> = { readonly port: P; readonly kind: AdapterKind; cleanup?(): Promise<void> } & H;

export type MakeAdapter<P, H extends object = object> = (env: Env) => Promise<AdapterUnderTest<P, H>>;

/** The test API a suite gets. Every test builds a fresh adapter; `mockOnly`/`realOnly` skip when the adapter kind does not fit. */
export interface ContractApi<P, H extends object = object> {
  readonly portName: string;
  test(title: string, fn: (a: AdapterUnderTest<P, H>) => void | Promise<void>): void;
  mockOnly(title: string, fn: (a: AdapterUnderTest<P, H>) => void | Promise<void>): void;
  realOnly(title: string, fn: (a: AdapterUnderTest<P, H>) => void | Promise<void>): void;
}

export type ContractSuite<P, H extends object = object> = (api: ContractApi<P, H>) => void;

/**
 * Generic port contract (any port: NEAR, LLM, notifier). The same `suite` assertions run against whatever adapter
 * `makeAdapter(env)` returns: a Postgres mock in CI, an in-memory fake in unit tests, a real adapter via `npm run contract:real`.
 */
export function describePortContract<P, H extends object = object>(
  portName: string, label: string, makeAdapter: MakeAdapter<P, H>, suite: ContractSuite<P, H>, env: Env = process.env,
): void {
  const wrap = (only: 'any' | 'mock' | 'real') => (title: string, fn: (a: AdapterUnderTest<P, H>) => void | Promise<void>) =>
    it(only === 'any' ? title : `${title} [${only}Only]`, async (tc: TestContext) => {
      const a = await makeAdapter(env);
      try {
        if ((only === 'mock' && a.kind !== 'mock') || (only === 'real' && a.kind === 'mock')) tc.skip();
        await fn(a);
      } finally {
        await a.cleanup?.();
      }
    });
  describe(`${portName} port contract: ${label}`, () => {
    suite({ portName, test: wrap('any'), mockOnly: wrap('mock'), realOnly: wrap('real') });
  });
}

const REAL_HASH_RE = /^[1-9A-HJ-NP-Za-km-z]{43,44}$/;
const MOCK_HASH_RE = /^mock:[1-9A-HJ-NP-Za-km-z]{44}$/;

/** Receipt shape check: `mock:` hash and network `mock` for mocks, a real base58 hash on testnet/mainnet otherwise. */
export function expectReceipt(r: ChainReceipt, opts: { mock: boolean; status?: ChainReceipt['status'] }): void {
  expect(r.txHash).toMatch(opts.mock ? MOCK_HASH_RE : REAL_HASH_RE);
  expect(opts.mock ? r.network === 'mock' : r.network !== 'mock').toBe(true);
  if (opts.status) expect(r.status).toBe(opts.status);
}

export interface NearContractApi<P, H extends object = object> extends ContractApi<P, H> {
  expectReceipt(r: ChainReceipt, a: { kind: AdapterKind }, status?: ChainReceipt['status']): void;
}
export type NearContractSuite<P, H extends object = object> = (api: NearContractApi<P, H>) => void;

/** `describePortContract` for a NEAR port, adding the receipt assertion helper. */
export function describeNearPortContract<P, H extends object = object>(
  port: NearPortName, label: string, makeAdapter: MakeAdapter<P, H>, suite: NearContractSuite<P, H>, env: Env = process.env,
): void {
  describePortContract<P, H>(port, label, makeAdapter, (api) =>
    suite({ ...api, expectReceipt: (r, a, status) => expectReceipt(r, { mock: a.kind === 'mock', status }) }), env);
}

/** A discoverable port suite. Each `near/__contract__/<port>.contract.ts` exports one as `contract`. */
export interface PortContract<P = unknown, H extends object = object> {
  readonly port: string;
  /** Adapter kind selected for this port by `env` (same rule as the app binding). */
  select(env: Env): AdapterKind;
  /** Adds port-specific helpers (e.g. a way to write a receipt) to an adapter the runner resolved. */
  helpers(port: P, kind: AdapterKind, env: Env): H | Promise<H>;
  run(label: string, makeAdapter: MakeAdapter<P, H>, env?: Env): void;
}

export function defineNearContract<P, H extends object = object>(spec: {
  port: NearPortName;
  helpers(port: P, kind: AdapterKind, env: Env): H | Promise<H>;
  suite: NearContractSuite<P, H>;
}): PortContract<P, H> {
  return {
    port: spec.port,
    select: (env) => nearAdapterFor(spec.port, env),
    helpers: spec.helpers,
    run: (label, make, env) => describeNearPortContract(spec.port, label, make, spec.suite, env),
  };
}

/** Wraps a bare port into a `makeAdapter` for a contract (used by the in-memory runs and the runner). */
export const adapterFor = <P, H extends object>(c: PortContract<P, H>, port: P, kind: AdapterKind, cleanup?: () => Promise<void>): MakeAdapter<P, H> =>
  async (env) => ({ port, kind, cleanup, ...(await c.helpers(port, kind, env)) }) as AdapterUnderTest<P, H>;
