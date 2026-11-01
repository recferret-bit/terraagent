// Spawn deploy.mjs. Dry-run must not ssh or rsync.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadCatalog } from '../../infra/hosts/load-catalog.mjs';
import { REWRITE_SRC, buildPlan, rewriteCompose } from './deploy-plan.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const script = join(root, 'scripts/sites/deploy.mjs');

function run(extraEnv = {}, args = ['--dry-run']) {
  const bin = mkdtempSync(join(tmpdir(), 'terra-deploy-test-'));
  const log = join(bin, 'called');
  const stub = `#!/bin/sh\necho "$0" >> '${log}'\nexit 99\n`;
  for (const name of ['ssh', 'rsync']) {
    const path = join(bin, name);
    writeFileSync(path, stub);
    chmodSync(path, 0o755);
  }
  const result = spawnSync(process.execPath, [script, ...args], {
    cwd: root,
    encoding: 'utf8',
    timeout: 15000,
    env: {
      ...process.env,
      PATH: `${bin}:${process.env.PATH ?? ''}`,
      TA_DOMAIN: 'terraagent.fun',
      DEPLOY_HOST: '203.0.113.10',
      DEPLOY_USER: 'deploy',
      ...extraEnv,
    },
  });
  const called = existsSync(log) ? readFileSync(log, 'utf8') : '';
  rmSync(bin, { recursive: true, force: true });
  return { ...result, called, out: `${result.stdout ?? ''}${result.stderr ?? ''}` };
}

function refused(extraEnv) {
  const result = run(extraEnv);
  assert.notEqual(result.status, 0);
  assert.equal(result.out.includes('rsync'), false);
  assert.equal(result.called, '');
  return result;
}

test('dry-run names the four compose files and the ssh target', () => {
  const result = run();
  assert.equal(result.status, 0, result.out);
  assert.equal(result.called, '');
  for (const file of ['infra.yml', 'frontend.yml', 'backend.yml', 'chain.yml']) {
    assert.match(result.stdout, new RegExp(`/srv/terraagent/compose/${file}`));
  }
  assert.match(result.stdout, /deploy@203\.0\.113\.10/);
  assert.equal(result.out.includes('ssh-copy-id'), false);
  assert.equal(result.out.includes(' -i '), false);
  assert.match(result.stdout, /context: \/srv\/terraagent\/src/);
  assert.match(result.stdout, /--exclude \.env/);
});

test('empty DEPLOY_HOST fails and names DEPLOY_HOST', () => {
  assert.match(refused({ DEPLOY_HOST: '' }).out, /DEPLOY_HOST is empty/);
});

test('empty DEPLOY_USER fails and names DEPLOY_USER', () => {
  assert.match(refused({ DEPLOY_USER: '' }).out, /DEPLOY_USER is empty/);
});

test('CHANGE_ME DEPLOY_HOST fails and names DEPLOY_HOST', () => {
  assert.match(refused({ DEPLOY_HOST: 'CHANGE_ME' }).out, /DEPLOY_HOST is a CHANGE_ME placeholder/);
});

test('infra enables profile server and frontend does not', () => {
  const infra = run({}, ['infra', '--dry-run']);
  assert.equal(infra.status, 0, infra.out);
  assert.equal(infra.called, '');
  assert.match(infra.stdout, /--profile server/);
  assert.match(infra.stdout, /\/srv\/terraagent\/compose\/infra\.yml/);
  assert.match(infra.stdout, /00-default\.conf/);
  assert.equal(infra.stdout.includes('prisma migrate deploy'), false);
  const frontend = run({}, ['frontend', '--dry-run']);
  assert.equal(frontend.status, 0, frontend.out);
  assert.equal(frontend.stdout.includes('--profile server'), false);
  assert.match(frontend.stdout, /\/srv\/terraagent\/compose\/frontend\.yml/);
  assert.match(frontend.stdout, /context: \/srv\/terraagent\/src/);
  assert.equal(frontend.stdout.includes('prisma migrate deploy'), false);
});

test('prisma migrate deploy is only on the backend step', () => {
  const full = run();
  assert.equal(full.status, 0, full.out);
  const sections = Object.fromEntries(
    full.stdout
      .split('\nstack ')
      .slice(1)
      .map((part) => [part.slice(0, part.indexOf('\n')), part]),
  );
  assert.match(sections.backend, /prisma migrate deploy/);
  for (const name of ['infra', 'frontend', 'chain'])
    assert.equal(sections[name].includes('prisma migrate deploy'), false);
  const backend = run({}, ['backend', '--dry-run']);
  assert.match(backend.stdout, /Host: api\.terraagent\.fun/);
  assert.match(backend.stdout, /http:\/\/127\.0\.0\.1\/v1\/healthz/);
});

test('rewriteCompose points context and nginx at /srv/terraagent without editing git', () => {
  const frontend = readFileSync(join(root, 'infra/compose/frontend.yml'), 'utf8');
  const rewritten = rewriteCompose(frontend);
  assert.match(rewritten, /context: \/srv\/terraagent\/src/);
  assert.equal(rewritten.includes('context: ../..'), false);
  assert.match(frontend, /context: \.\.\/\.\./);
  const infra = rewriteCompose(readFileSync(join(root, 'infra/compose/infra.yml'), 'utf8'));
  assert.match(infra, /\/srv\/terraagent\/nginx\/nginx\.conf:/);
  assert.equal(infra.includes('../nginx/'), false);
  const chain = rewriteCompose(readFileSync(join(root, 'infra/compose/chain.yml'), 'utf8'));
  assert.match(chain, /\/srv\/terraagent\/nginx\/hosts\/devchain\.conf:/);
  const steps = buildPlan({
    env: { TA_DOMAIN: 'terraagent.fun', DEPLOY_HOST: '203.0.113.10', DEPLOY_USER: 'deploy' },
    stacks: ['backend'],
    catalog: loadCatalog(),
    root,
  });
  const compose = steps.find((step) => step.rewrite);
  assert.equal(compose.args.includes(REWRITE_SRC), true);
  assert.equal(compose.args.includes('infra/compose/backend.yml'), false);
});
