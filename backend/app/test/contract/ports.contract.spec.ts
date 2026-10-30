import 'reflect-metadata';
import type { INestApplication } from '@nestjs/common';
import { createTestDatabase, type TestDatabase } from '@terra/db/testing';
import { afterAll, beforeAll, describe, it } from 'vitest';
import { createApp } from '../../src/app';
import { adapterFor } from '../../src/near/__contract__/harness';
import { PORTS } from '../../src/near/application/ports/index';
import { nearAdapters } from '../../src/near/infrastructure/near-infrastructure.module';
import { discoverContracts } from './discover';

/**
 * Contract runner (`npm run test:contract`): every `__contract__/*.contract.ts` runs against the adapter the env selects for
 * its port, resolved from the booted app. CI default is the Postgres mock on a fresh test database.
 * `npm run contract:real -- --port X` sets `NEAR_ADAPTER_<X>=testnet|mainnet` and `CONTRACT_PORT=X`.
 */
// The mock chain reads its config from process.env (not from the app source): no latency or injected failures in contract runs.
Object.assign(process.env, { MOCK_LATENCY_MIN_MS: '0', MOCK_LATENCY_MAX_MS: '0', MOCK_FAIL_RATE: '0' });
const only = process.env.CONTRACT_PORT;
const found = (await discoverContracts()).filter((c) => !only || c.contract.port === only);

let db: TestDatabase;
let app: INestApplication;
const plan = found.map(({ file, contract }) => {
  const kind = contract.select(process.env);
  const token = PORTS.find((p) => p.name === contract.port)?.token;
  return { file, contract, kind, token, registered: !!token && nearAdapters.some((a) => a.port === token && a.kind === kind) };
});
// Booting with a selected-but-unregistered adapter aborts boot; report that as the clear per-port failure below instead.
const bootable = plan.length > 0 && plan.every((p) => p.registered);

beforeAll(async () => {
  if (!bootable) return;
  db = await createTestDatabase();
  ({ app } = await createApp({
    source: { ...process.env, NODE_ENV: 'test', LOG_LEVEL: 'silent', DATABASE_URL: db.url, SIM_THREADS: '1' },
  }));
}, 60_000);
afterAll(async () => {
  await app?.close();
  await db?.drop();
});

if (!plan.length) {
  it(`a contract suite exists for ${only ?? 'any port'}`, () => {
    throw new Error(`no contract suite found for ${only ?? 'any port'} (add near/__contract__/<port>.contract.ts)`);
  });
}

for (const { file, contract, kind, token, registered } of plan) {
  if (!token || !registered) {
    describe(`${contract.port} port contract: ${kind}`, () => {
      it(`${kind} adapter is registered`, () => {
        throw new Error(`no ${kind} adapter registered for ${contract.port} (${file.split('/').pop()}); add infrastructure/adapters/**/*.adapter.ts with adapterOf({ port, kind: '${kind}' })`);
      });
    });
    continue;
  }
  contract.run(`${kind} adapter`, async (env) => adapterFor(contract, app.get(token, { strict: false }), kind)(env));
}
