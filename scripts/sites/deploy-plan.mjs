// Deploy plan for one host (DEPLOYMENT §6, DEP-08, DEP-11).
// Git compose files stay repo-relative. The uploaded copy is rewritten to /srv/terraagent paths.
// DEP-11: BatchMode SSH only. No -i, no ssh-copy-id, no key file.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { hostsByStack } from '../../infra/hosts/load-catalog.mjs';

/** Placeholder in the compose rsync argv. The executor swaps in a rewritten temp file. */
export const REWRITE_SRC = 'REWRITE_SRC';

const SSH_OPTS = ['-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=accept-new'];
const SSH_RSH = `ssh ${SSH_OPTS.join(' ')}`;
const REMOTE_COMPOSE = '/srv/terraagent/compose';
const REMOTE_NGINX = '/srv/terraagent/nginx';
const REMOTE_SRC = '/srv/terraagent/src';
// Do not upload the operator .env. The server keeps /srv/terraagent/.env.
const SRC_EXCLUDES = ['node_modules', '.git', 'dist', '.dev', 'e2e/.out', 'playwright-report', '.env', '.env.*'];

export function rewriteCompose(text) {
  return text.replaceAll('context: ../..', 'context: /srv/terraagent/src').replaceAll('../nginx/', `${REMOTE_NGINX}/`);
}

export function buildPlan({ env, stacks, catalog, root }) {
  const target = `${env.DEPLOY_USER}@${env.DEPLOY_HOST}`;
  const steps = [ssh(target, 'echo ok'), ssh(target, mkdirRemote()), ssh(target, ensureServerEnv())];
  for (const stack of stacks) steps.push(...stackPlan(stack, target, catalog, root));
  return assertSafe(steps);
}

function stackPlan(stack, target, catalog, root) {
  const remoteFile = `${REMOTE_COMPOSE}/${stack}.yml`;
  const rel = `infra/compose/${stack}.yml`;
  const text = readFileSync(join(root, rel), 'utf8');
  return [
    { line: '' },
    { line: `stack ${stack}` },
    ...rewriteNotes(remoteFile, text),
    composeRsync(target, rel, remoteFile),
    ...nginxRsyncs(stack, target, catalog),
    contextRsync(target),
    ssh(target, composeUp(stack, remoteFile)),
    ssh(target, nginxReload()),
    ...afterUp(stack, target, catalog),
  ];
}

const SERVER_ENV = '/srv/terraagent/.env';
const SERVER_DATABASE_URL = 'postgresql://terra:terra@postgres:5432/terraagent';

/** Create the server env if needed. Never overwrite a key the operator already set. */
function ensureServerEnv() {
  const urlLine = `DATABASE_URL=${SERVER_DATABASE_URL}`;
  return [
    `touch ${SERVER_ENV}`,
    `chmod 600 ${SERVER_ENV}`,
    `grep -q '^DATABASE_URL=' ${SERVER_ENV} || echo '${urlLine}' >> ${SERVER_ENV}`,
    `grep -q '^NODE_ENV=' ${SERVER_ENV} || echo 'NODE_ENV=production' >> ${SERVER_ENV}`,
  ].join(' && ');
}

function nginxReload() {
  return 'n=0; until docker exec terra-nginx nginx -s reload; do n=$((n+1)); [ "$n" -gt 30 ] && exit 1; sleep 1; done';
}

function mkdirRemote() {
  return `mkdir -p ${REMOTE_COMPOSE} ${REMOTE_NGINX}/hosts ${REMOTE_NGINX}/snippets ${REMOTE_SRC}`;
}

function rewriteNotes(remoteFile, text) {
  const notes = [];
  if (text.includes('context: ../..')) notes.push({ line: `rewrite ${remoteFile} context: /srv/terraagent/src` });
  if (text.includes('../nginx/')) notes.push({ line: `rewrite ${remoteFile} ../nginx/ -> ${REMOTE_NGINX}/` });
  return notes;
}

function composeUp(stack, remoteFile) {
  const profile = stack === 'infra' ? '--profile server ' : '';
  return `docker compose --env-file ${SERVER_ENV} ${profile}-f ${remoteFile} up -d --build`;
}

function afterUp(stack, target, catalog) {
  const steps = [];
  if (stack === 'backend') {
    steps.push(ssh(target, healthWait()));
    steps.push(ssh(target, 'docker exec terra-app npx prisma migrate deploy --schema shared/db/prisma/schema.prisma'));
  }
  for (const host of hostsByStack(catalog, stack)) steps.push(ssh(target, curlHost(host)));
  return steps;
}

function healthWait() {
  const probe = 'docker inspect -f {{.State.Health.Status}} terra-app 2>/dev/null';
  return `n=0; until [ "$(${probe})" = healthy ]; do n=$((n+1)); [ "$n" -gt 60 ] && exit 1; sleep 2; done`;
}

function curlHost(host) {
  const path = host.health ?? host.index;
  if (!path) throw new Error(`deploy: ${host.host} has no curl path`);
  return `curl -fsS -H "Host: ${host.host}" http://127.0.0.1${path}`;
}

function nginxRsyncs(stack, target, catalog) {
  const pairs = [
    ['infra/nginx/nginx.conf', `${REMOTE_NGINX}/nginx.conf`],
    ['infra/nginx/snippets/', `${REMOTE_NGINX}/snippets/`],
  ];
  if (stack === 'infra') pairs.push(['infra/nginx/hosts/00-default.conf', `${REMOTE_NGINX}/hosts/00-default.conf`]);
  for (const host of hostsByStack(catalog, stack)) {
    pairs.push([`infra/nginx/hosts/${host.vhost}`, `${REMOTE_NGINX}/hosts/${host.vhost}`]);
  }
  return pairs.map(([rel, remote]) => rsync([rel, `${target}:${remote}`]));
}

function contextRsync(target) {
  const excludes = SRC_EXCLUDES.flatMap((pattern) => ['--exclude', pattern]);
  return rsync([...excludes, './', `${target}:${REMOTE_SRC}/`]);
}

function composeRsync(target, rel, remoteFile) {
  const dest = `${target}:${remoteFile}`;
  const step = rsync([REWRITE_SRC, dest]);
  step.line = formatCmd('rsync', ['-az', '-e', SSH_RSH, `<rewritten ${rel}>`, dest]);
  step.rewrite = { rel, remoteFile };
  return step;
}

function rsync(tail) {
  const args = ['-az', '-e', SSH_RSH, ...tail];
  return { line: formatCmd('rsync', args), cmd: 'rsync', args };
}

function ssh(target, remote) {
  const args = [...SSH_OPTS, target, remote];
  return { line: formatCmd('ssh', args), cmd: 'ssh', args };
}

function formatCmd(cmd, args) {
  return [cmd, ...args.map(shQuote)].join(' ');
}

function shQuote(arg) {
  if (arg === '' || /[\s"$\\*?]/.test(arg)) return `"${arg.replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`;
  return arg;
}

function assertSafe(steps) {
  const text = steps.map((step) => step.line).join('\n');
  if (text.includes('ssh-copy-id') || text.includes(' -i '))
    throw new Error('deploy: plan selects or copies an SSH key');
  for (const step of steps) {
    if ((step.args ?? []).some((arg) => arg === '-i' || arg.startsWith('-i=') || arg.startsWith('-i/'))) {
      throw new Error('deploy: plan selects or copies an SSH key');
    }
  }
  return steps;
}
