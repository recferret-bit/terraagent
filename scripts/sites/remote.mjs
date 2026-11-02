// Executes a deploy plan over SSH and rsync. --dry-run never loads this module.
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { REWRITE_SRC, rewriteCompose } from './deploy-plan.mjs';

export function executePlan(steps, root) {
  for (const step of steps) runStep(step, root);
}

function runStep(step, root) {
  console.log(step.line);
  if (!step.cmd) return;
  const dir = step.rewrite ? mkdtempSync(join(tmpdir(), 'terra-deploy-')) : '';
  try {
    const result = spawnSync(step.cmd, dir ? rewrittenArgs(step, root, dir) : step.args, {
      cwd: root,
      stdio: 'inherit',
    });
    if (result.error) fail(`deploy: ${result.error.message}`);
    if ((result.status ?? 1) !== 0) process.exit(result.status ?? 1);
  } finally {
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
}

function rewrittenArgs(step, root, dir) {
  const tmp = join(dir, step.rewrite.remoteFile.split('/').at(-1));
  writeFileSync(tmp, rewriteCompose(readFileSync(join(root, step.rewrite.rel), 'utf8')));
  return step.args.map((arg) => (arg === REWRITE_SRC ? tmp : arg));
}

function fail(message) {
  console.error(message);
  process.exit(1);
}
