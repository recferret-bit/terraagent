#!/usr/bin/env node
// Launches official PostHog remote MCP via mcp-remote (or @posthog/wizard mcp add) using infra/.env.posthog without putting secrets in git.
import { spawn } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadPostHogEnv } from '../../posthog-dashboard-sync/scripts/posthog-env.mjs';

const FEATURES = 'dashboards,insights,product_analytics,sql,workspace,events';
const REMOTE_URL = `https://mcp.posthog.com/mcp?features=${FEATURES}`;

export function buildWizardArgs(cfg) {
  const args = ['--yes', '@posthog/wizard', 'mcp', 'add', '--features', FEATURES];
  if (cfg.projectId) args.push('--project-id', String(cfg.projectId));
  return args;
}

export function buildWizardEnv(cfg) {
  return cfg.personalApiKey ? { POSTHOG_WIZARD_API_KEY: cfg.personalApiKey } : {};
}

export function formatWizardCommand(cfg) {
  const projectFlag = cfg.projectId ? ` --project-id ${cfg.projectId}` : '';
  return `POSTHOG_WIZARD_API_KEY="<phx_from_infra/.env.posthog>" npx --yes @posthog/wizard mcp add --features ${FEATURES}${projectFlag}`;
}

function invokedDirectly() {
  const entry = process.argv[1];
  return Boolean(entry) && fileURLToPath(import.meta.url) === resolve(entry);
}

if (invokedDirectly()) {
  const args = process.argv.slice(2);
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
  const cfg = loadPostHogEnv(root);

  if (args.includes('--print-wizard')) {
    console.log('Install official PostHog MCP into user-level AI clients (keep configs outside git / repo root per D-41):');
    console.log(`  ${formatWizardCommand(cfg)}`);
    console.log('Or launch directly with:');
    console.log('  npm run analytics:mcp -- --wizard');
    process.exit(0);
  }

  if (!cfg.personalApiKey) {
    console.error('Missing personal_api_key / project_api_key (phx_...) in infra/.env.posthog or POSTHOG_PERSONAL_API_KEY.');
    process.exit(1);
  }

  if (args.includes('--wizard')) {
    const child = spawn('npx', buildWizardArgs(cfg), {
      stdio: 'inherit',
      env: { ...process.env, ...buildWizardEnv(cfg) },
    });
    child.on('exit', (code) => process.exit(code ?? 0));
  } else {
    const child = spawn(
      'npx',
      ['-y', 'mcp-remote@latest', REMOTE_URL, '--header', 'Authorization:${POSTHOG_AUTH_HEADER}'],
      {
        stdio: 'inherit',
        env: { ...process.env, POSTHOG_AUTH_HEADER: `Bearer ${cfg.personalApiKey}` },
      },
    );
    child.on('exit', (code) => process.exit(code ?? 0));
  }
}
