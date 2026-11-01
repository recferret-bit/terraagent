import { expect, test } from './harness';
import { curlResolve } from './w26-curl';
import { docker, healthOf, npm, waitHealthy, type ProcResult } from './w26-proc';

/**
 * W26 Sites demo (docs/plan/waves/W26-sites.md) against `npm run stack:local`.
 * Curls use `--resolve` to 127.0.0.1 and do not install `infra/hosts/local.hosts`.
 * The site database is `terra_w26_e2e` (see `w26-proc.ts`); the game suite keeps its own.
 */
test.describe.configure({ mode: 'serial', timeout: 600_000 });

const PAGES = [
  'terraagent.fun',
  'pitchdeck.terraagent.fun',
  'whitepaper.terraagent.fun',
  'design.terraagent.fun',
  'play.terraagent.fun',
  'playground.terraagent.fun',
  'devchain.terraagent.fun',
];

const WS_HEADERS = [
  'Connection: Upgrade',
  'Upgrade: websocket',
  'Sec-WebSocket-Version: 13',
  'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==',
];

const DEPLOY = {
  TA_DOMAIN: 'terraagent.fun',
  DEPLOY_HOST: '203.0.113.10',
  DEPLOY_USER: 'deploy',
};

const COMPOSE_FILES = ['infra.yml', 'frontend.yml', 'backend.yml', 'chain.yml'];

function must(result: ProcResult, label: string): void {
  if (result.status !== 0) throw new Error(`${label} exited ${result.status}`);
}

test.beforeAll(() => {
  test.setTimeout(600_000);
  must(npm(['run', 'db:migrate']), 'db:migrate');
  must(npm(['run', 'stack:local']), 'stack:local');
});

test.afterAll(() => {
  test.setTimeout(600_000);
  must(npm(['run', 'stack:local:down']), 'stack:local:down');
});

test('@hack 1. stack:local: nginx, static and the app are up, and there is no second Postgres', () => {
  for (const name of ['terra-nginx', 'terra-static', 'terra-app']) {
    expect(healthOf(name)?.startsWith('running'), name).toBe(true);
  }
  expect(healthOf('terra-sites-pg'), 'terra-sites-pg should be absent').toBeNull();
  expect(healthOf('terra-pg'), 'dev Postgres terra-pg').toBe('running healthy');
  const published = docker(['port', 'terra-pg', '5432']);
  expect(published.status, published.stderr).toBe(0);
  expect(published.stdout).toContain('15434');
});

test('@hack 2. curl --resolve: each site is 200 and api healthz is ok', () => {
  for (const host of PAGES) {
    const res = curlResolve(host, '/');
    expect(res.status, host).toBe(200);
    if (host === 'terraagent.fun') expect(res.body).toContain('Drop one robot');
  }
  const health = curlResolve('api.terraagent.fun', '/v1/healthz');
  expect(health.status).toBe(200);
  expect(JSON.parse(health.body)).toMatchObject({ ok: true });
});

test('@hack 3. design index contains Faction Plate and tokens.css contains --ta-void', () => {
  const index = curlResolve('design.terraagent.fun', '/design/');
  expect(index.status).toBe(200);
  expect(index.body).toContain('Faction Plate');
  const tokens = curlResolve('design.terraagent.fun', '/design/css/tokens.css');
  expect(tokens.status).toBe(200);
  expect(tokens.body).toContain('--ta-void');
});

test('@hack 4. play healthz is 200, /ws upgrades with 101, and api root is 404', () => {
  expect(curlResolve('play.terraagent.fun', '/v1/healthz').status).toBe(200);
  const ws = curlResolve('play.terraagent.fun', '/ws', { headers: WS_HEADERS, maxTime: 5, allowTimeout: true });
  expect(ws.status).toBe(101);
  expect(curlResolve('api.terraagent.fun', '/').status).toBe(404);
});

test('@hack 5. devchain explorer stays up with the app stopped, then receipts are a JSON array', () => {
  must(docker(['stop', 'terra-app']), 'docker stop terra-app');
  try {
    const page = curlResolve('devchain.terraagent.fun', '/dev/chain/');
    expect(page.status).toBe(200);
    expect(page.body).toContain('Mock Chain Explorer');
  } finally {
    must(docker(['start', 'terra-app']), 'docker start terra-app');
    waitHealthy('terra-app');
  }
  const receipts = curlResolve('devchain.terraagent.fun', '/v1/dev/chain/receipts');
  expect(receipts.status).toBe(200);
  expect(Array.isArray(JSON.parse(receipts.body))).toBe(true);
});

test('@hack 6. deploy --dry-run names the ssh target and the four compose files, and an empty DEPLOY_HOST fails', () => {
  const plan = npm(['run', 'deploy', '--', '--dry-run'], DEPLOY, true);
  expect(plan.status, plan.stderr || plan.stdout).toBe(0);
  expect(plan.stdout).toContain('deploy@203.0.113.10');
  for (const file of COMPOSE_FILES) expect(plan.stdout, file).toContain(file);
  expect(plan.stdout.includes('ssh-copy-id'), 'dry-run must not copy a key').toBe(false);
  expect(plan.stdout.includes(' -i '), 'dry-run must not pass ssh -i').toBe(false);
  const refused = npm(['run', 'deploy', '--', '--dry-run'], { ...DEPLOY, DEPLOY_HOST: '' }, true);
  expect(refused.status).not.toBe(0);
  expect(refused.stderr).toContain('DEPLOY_HOST');
});
