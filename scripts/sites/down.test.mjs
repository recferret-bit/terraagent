// stack:local:down is the four site projects only. It must not stop the dev Postgres or drop volumes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { COMPOSE, backendComposeEnv, downArgv, upArgv } from './compose.mjs';

test('down targets the four site projects and not the dev postgres', () => {
  const plan = downArgv();
  assert.deepEqual(
    plan.map((args) => args[2]),
    [COMPOSE.chain, COMPOSE.backend, COMPOSE.frontend, COMPOSE.infra],
  );
  for (const args of plan) {
    assert.equal(args.includes('-v'), false);
    assert.equal(args.includes('--volumes'), false);
    assert.equal(args.at(-1), 'down');
  }
  assert.equal(JSON.stringify(plan).includes('docker-compose.yml'), false);
});

test('local infra up does not enable profile server', () => {
  assert.equal(upArgv.infra.includes('--profile'), false);
  assert.equal(upArgv.infra.includes('server'), false);
  assert.equal(upArgv.infra.at(-2), 'up');
  assert.equal(upArgv.infra.at(-1), '-d');
  assert.ok(upArgv.backend.includes('--build'));
  assert.ok(upArgv.backend.includes('--wait'));
  assert.equal(upArgv.devPostgres[2], 'infra/docker-compose.yml');
});

test('local backend env ignores a shell production flag and a localhost database url', () => {
  const env = backendComposeEnv({
    TA_DB_NAME: 'terra_wave_w26_sites',
    NODE_ENV: 'production',
    DATABASE_URL: 'postgresql://terra:terra@127.0.0.1:15434/other',
  });
  assert.equal(env.NODE_ENV, 'development');
  assert.equal(env.DATABASE_URL, 'postgresql://terra:terra@host.docker.internal:15434/terra_wave_w26_sites');
});
