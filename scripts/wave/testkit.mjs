// Sandbox for the wave script tests: a throwaway git repo (plan files copied from the real repo) with a bare `origin`,
// laid out like the real one (`<sandbox>/TerraAgent` + `<sandbox>/TerraAgent-wt`). Nothing here touches the real repository.
import { cpSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const wave = join(repo, 'scripts', 'wave', 'wave.mjs');
const env = { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t', TA_WAVE_NO_INSTALL: '1', TA_WAVE_GATES: 'true' };

export function git(cwd, ...args) {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8', env });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${r.stderr}`);
  return r.stdout.trim();
}

export function makeSandbox() {
  const base = mkdtempSync(join(process.env.TA_WAVE_TEST_TMP ?? tmpdir(), 'wave-sandbox-'));
  const root = join(base, 'TerraAgent');
  mkdirSync(root, { recursive: true });
  mkdirSync(join(base, 'TerraAgent-wt'));
  cpSync(join(repo, 'docs', 'plan'), join(root, 'docs', 'plan'), { recursive: true });
  cpSync(join(repo, 'scripts', 'plan'), join(root, 'scripts', 'plan'), { recursive: true });
  writeFileSync(join(root, '.gitignore'), '.env.worktree\n');
  git(base, 'init', '--bare', '-b', 'main', 'origin.git');
  git(root, 'init', '-b', 'main');
  git(root, 'add', '-A');
  git(root, 'commit', '-m', 'sandbox base');
  git(root, 'remote', 'add', 'origin', join(base, 'origin.git'));
  git(root, 'push', '-u', 'origin', 'main');
  const run = (args, extraEnv = {}) => {
    const r = spawnSync('node', [wave, ...args, '--root', root], { encoding: 'utf8', env: { ...env, ...extraEnv } });
    return { status: r.status, out: `${r.stdout}${r.stderr}` };
  };
  return { base, root, wt: (name) => join(base, 'TerraAgent-wt', name), run, git: (...a) => git(root, ...a), origin: join(base, 'origin.git') };
}

/** Wave branch for a wave number straight from main, e.g. `wave/w07-first-contact`. */
export function openWaveBranch(sb, nn) {
  const files = sb.git('ls-files', 'docs/plan/waves').split('\n');
  const slug = files.map((f) => f.split('/').pop().replace(/\.md$/, '').toLowerCase()).find((s) => s.startsWith(`w${nn}-`));
  sb.git('branch', `wave/${slug}`, 'main');
  return `wave/${slug}`;
}
