#!/usr/bin/env node
// Verifies TerraAgent PostHog deployment readiness and git/frontend credential isolation.
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadPostHogEnv } from './posthog-env.mjs';

const SECRET_RE = /\bph[cx]_[A-Za-z0-9]{10,}/;
const WORKSPACE_MCP_PATHS = [
  '.mcp.json',
  'mcp.json',
  '.cursor/mcp.json',
  '.claude/mcp.json',
  '.claude/settings.local.json',
  '.vscode/mcp.json',
  '.codex/config.toml',
];

export function checkWorkspaceMcpSafety(root) {
  const failures = [];
  for (const rel of WORKSPACE_MCP_PATHS) {
    const abs = join(root, rel);
    if (!existsSync(abs) || statSync(abs).isDirectory()) continue;
    if (rel === '.mcp.json' || rel === 'mcp.json') {
      failures.push(`repo root ${rel} violates D-41; keep MCP configs user-scoped outside git`);
    }
    const text = readFileSync(abs, 'utf8');
    if (SECRET_RE.test(text)) {
      failures.push(`workspace MCP config contains PostHog token pattern: ${rel}`);
    }
  }
  return failures;
}

function walkFiles(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules') continue;
    const abs = join(dir, name);
    if (statSync(abs).isDirectory()) walkFiles(abs, out);
    else out.push(abs);
  }
  return out;
}

export function checkDeployReadiness(root = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..')) {
  const failures = [];
  const warnings = [];
  const cfg = loadPostHogEnv(root);

  if (!cfg.fileExists) warnings.push('infra/.env.posthog not present (required for operator sync)');
  else {
    if (!cfg.projectToken?.startsWith('phc_')) failures.push('infra/.env.posthog missing valid project_token (phc_...)');
    if (!cfg.projectId) failures.push('infra/.env.posthog missing project_id');
    if (!cfg.personalApiKey?.startsWith('phx_')) {
      warnings.push('infra/.env.posthog has no personal_api_key (phx_...) yet; required for PostHog dashboard API & MCP sync');
    }
  }

  const ignored = spawnSync('git', ['check-ignore', '-q', 'infra/.env.posthog'], { cwd: root }).status === 0;
  if (!ignored) failures.push('.gitignore does not ignore infra/.env.posthog');

  const tracked = spawnSync('git', ['ls-files', '--error-unmatch', 'infra/.env.posthog'], { cwd: root, stdio: 'ignore' }).status === 0;
  if (tracked) failures.push('infra/.env.posthog is tracked in git');

  const lsFiles = spawnSync('git', ['ls-files'], { cwd: root, encoding: 'utf8' });
  if (lsFiles.status === 0) {
    for (const rel of lsFiles.stdout.split('\n').filter(Boolean)) {
      if (/\.(spec|test)\./.test(rel) || rel.endsWith('.md')) continue;
      const abs = join(root, rel);
      if (!existsSync(abs) || statSync(abs).isDirectory()) continue;
      const text = readFileSync(abs, 'utf8');
      if (SECRET_RE.test(text)) failures.push(`tracked file contains PostHog token pattern: ${rel}`);
    }
  }

  failures.push(...checkWorkspaceMcpSafety(root));

  const distDir = join(root, 'frontend/dist');
  const distChecked = existsSync(distDir);
  if (distChecked) {
    for (const abs of walkFiles(distDir)) {
      if (!/\.(html|js|css|json|txt)$/.test(abs)) continue;
      const text = readFileSync(abs, 'utf8');
      if (SECRET_RE.test(text)) failures.push(`built bundle leaks token: ${relative(root, abs)}`);
      if (text.includes('posthog.com')) failures.push(`built bundle references posthog.com: ${relative(root, abs)}`);
    }
  } else {
    warnings.push('frontend/dist not found; run vite build before deploy-check to scan production bundle');
  }

  for (const dockerIgnore of ['infra/docker/Dockerfile.app.dockerignore', 'infra/docker/Dockerfile.frontend.dockerignore']) {
    const abs = join(root, dockerIgnore);
    if (!existsSync(abs) || !readFileSync(abs, 'utf8').includes('.env.*')) {
      failures.push(`${dockerIgnore} missing .env.* exclude`);
    }
  }

  const deployPlan = readFileSync(join(root, 'scripts/sites/deploy-plan.mjs'), 'utf8');
  if (!deployPlan.includes("'.env.*'")) failures.push('deploy-plan.mjs missing .env.* exclude');
  if (!deployPlan.includes('TA_TRUST_PROXY=1')) failures.push('deploy-plan.mjs missing TA_TRUST_PROXY=1 in ensureServerEnv');

  for (const vhost of ['apex.conf', 'play.conf', 'whitepaper.conf', 'pitchdeck.conf', 'playground.conf', 'design.conf']) {
    const text = readFileSync(join(root, 'infra/nginx/hosts', vhost), 'utf8');
    if (!/location\s+(?:\^~\s+)?\/v1\/(?:analytics\/)?\s*\{[\s\S]*?proxy-app\.conf;/.test(text)) {
      failures.push(`infra/nginx/hosts/${vhost} missing /v1/analytics/ proxy`);
    }
  }

  return {
    ok: failures.length === 0,
    distChecked,
    failures,
    warnings,
    relayEnvTemplate: [
      'POSTHOG_ENABLED=true',
      'POSTHOG_DISABLED=false',
      `POSTHOG_HOST=${cfg.ingestHost}`,
      'POSTHOG_KEY=<project_token from infra/.env.posthog>',
      'POSTHOG_PERSON_SALT=<random 32-byte hex>',
      'TA_TRUST_PROXY=1',
    ],
  };
}

function invokedDirectly() {
  const entry = process.argv[1];
  return Boolean(entry) && fileURLToPath(import.meta.url) === resolve(entry);
}

if (invokedDirectly()) {
  const args = process.argv.slice(2);
  const res = checkDeployReadiness();
  if (args.includes('--json')) {
    console.log(JSON.stringify(res, null, 2));
  } else {
    if (res.warnings.length) for (const w of res.warnings) console.warn(`WARN ${w}`);
    if (!res.ok) {
      for (const f of res.failures) console.error(`FAIL ${f}`);
      process.exit(1);
    }
    console.log('deploy-check ok: creds hidden from git/dist, nginx proxies /v1/analytics/, TA_TRUST_PROXY=1 enabled');
    if (args.includes('--print-server-env-guide')) {
      console.log('\nAdd to /srv/terraagent/.env on server (never commit):');
      for (const line of res.relayEnvTemplate) console.log(`  ${line}`);
    }
  }
}
