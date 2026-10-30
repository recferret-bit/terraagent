// `wave:issue` / `wave:issue:land`: one issue = one worktree `../TerraAgent-wt/WNN-XX` on `issue/WNN-XX`, branched from its wave branch.
import { cpSync, existsSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { out, run, tryOut, fail } from './sh.mjs';
import { issueTitle } from './plan.mjs';
import { ensureWorktreeEnv } from './isolation.mjs';
import { runGates } from './gates.mjs';

const ISSUE_RE = /^W\d{2}-\d{2}$/;
export const issueWorktree = (root, id) => resolve(root, '..', 'TerraAgent-wt', id);
const parse = (id) => (ISSUE_RE.test(id ?? '') ? id : fail(`expected an issue id like W07-03, got "${id ?? ''}"`));

/** APFS copy-on-write clone of the wave worktree's node_modules (root and workspaces); `npm ci` when that is not possible. */
function installDeps(from, to, dryRun) {
  if (process.env.TA_WAVE_NO_INSTALL) return;
  const dirs = ['.', ...['frontend', 'shared', 'backend'].flatMap((g) => (existsSync(join(from, g)) ? readdirSync(join(from, g)).map((d) => join(g, d)) : []))];
  const have = dirs.filter((d) => existsSync(join(from, d, 'node_modules')));
  if (!have.includes('.')) return dryRun ? console.log('would run npm ci') : run('npm', ['ci'], { cwd: to });
  for (const d of have) {
    if (dryRun) { console.log(`would clone ${join(from, d, 'node_modules')}`); continue; }
    const r = tryOut('cp', ['-Rc', join(from, d, 'node_modules'), join(to, d, 'node_modules')]);
    if (r === null) { cpSync(join(from, d, 'node_modules'), join(to, d, 'node_modules'), { recursive: true, verbatimSymlinks: true }); }
  }
}

export function openIssue(root, plan, id, { dryRun }) {
  parse(id);
  const w = plan.waves.find((x) => x.id === id.slice(0, 3)) ?? fail(`unknown wave ${id.slice(0, 3)}`);
  if (!w.open) fail(`${w.id} has no branch ${w.branch}: run \`npm run wave:open -- ${w.id.slice(1)}\` first`);
  const dir = issueWorktree(root, id), branch = `issue/${id}`;
  const exists = tryOut('git', ['rev-parse', '--verify', '--quiet', branch], { cwd: root }) !== null;
  if (dryRun) return console.log(`would ${existsSync(dir) ? 'resume' : 'create'} ${dir} on ${branch} from ${w.branch}, clone node_modules and write .env.worktree`);
  if (!existsSync(dir)) run('git', ['worktree', 'add', dir, ...(exists ? [branch] : ['-b', branch, w.branch])], { cwd: root });
  installDeps(w.worktree, dir, false);
  const env = ensureWorktreeEnv(root, dir, branch);
  console.log(`\n▶ ${id} ready in ${dir} (TA_PORT_BASE=${env.TA_PORT_BASE}, TA_DB_NAME=${env.TA_DB_NAME})`);
}

export function landIssue(root, plan, id, { dryRun, e2e }) {
  parse(id);
  const w = plan.waves.find((x) => x.id === id.slice(0, 3)) ?? fail(`unknown wave ${id.slice(0, 3)}`);
  const dir = issueWorktree(root, id), branch = `issue/${id}`;
  if (!w.open || !existsSync(w.worktree)) fail(`wave ${w.id} has no worktree ${w.worktree}`);
  if (!existsSync(dir)) fail(`issue worktree ${dir} does not exist`);
  if (out('git', ['status', '--porcelain'], { cwd: dir })) fail(`${dir} has uncommitted changes: commit them first`);
  if (out('git', ['branch', '--show-current'], { cwd: w.worktree }) !== w.branch) fail(`${w.worktree} is not on ${w.branch}`);
  if (out('git', ['status', '--porcelain', '--untracked-files=no'], { cwd: w.worktree })) fail(`${w.worktree} has uncommitted changes`);
  const message = `${id}: ${issueTitle(root, plan, id)}`;
  runGates(dir, { waveNumber: Number(w.id.slice(1)), e2e, dryRun });
  if (dryRun) return console.log(`would merge ${branch} into ${w.branch} as "${message}", remove ${dir} and delete ${branch}`);
  try {
    out('git', ['merge', '--no-ff', branch, '-m', message], { cwd: w.worktree });
  } catch (e) {
    tryOut('git', ['merge', '--abort'], { cwd: w.worktree });
    fail(`merging ${branch} into ${w.branch} conflicts (merge aborted, nothing changed).\n  Merge ${w.branch} into ${branch} in ${dir}, resolve by hand, re-run the gates and retry.\n${String(e.stderr || e.stdout || '').trim()}`);
  }
  run('git', ['worktree', 'remove', dir], { cwd: root });
  run('git', ['branch', '-d', branch], { cwd: w.worktree });
  console.log(`\n✔ ${message} merged into ${w.branch}`);
}
