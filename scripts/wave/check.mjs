// `wave:check`: bring the wave branch up to date with main, run the gates and tell the owner what to play.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { out, tryOut, fail } from './sh.mjs';
import { ensureWorktreeEnv, clientUrl } from './isolation.mjs';
import { runGates } from './gates.mjs';

export function demoSteps(root, w) {
  const lines = readFileSync(join(root, w.file), 'utf8').split('\n');
  const start = lines.findIndex((l) => /^##\s+Demo story/i.test(l));
  if (start < 0) return `(no "Demo story" section in ${w.file})`;
  const end = lines.findIndex((l, i) => i > start && /^##\s/.test(l));
  return lines.slice(start, end < 0 ? undefined : end).join('\n').trim();
}

export function checkWave(root, w, { dryRun, e2e }) {
  if (!w.open) fail(`${w.id} has no branch ${w.branch}`);
  const n = Number(w.id.slice(1));
  if (dryRun) {
    console.log(`would merge main into ${w.branch} in ${w.worktree}, then run ci:fast${e2e ? ` and e2e --waves ..${w.id.slice(1)} --hack` : ''}`);
    return console.log(`\n${demoSteps(root, w)}\n\nURL: ${clientUrl(w.worktree, `/play.html?scenario=w${w.id.slice(1)}`)}`);
  }
  if (out('git', ['status', '--porcelain', '--untracked-files=no'], { cwd: w.worktree })) fail(`${w.worktree} has uncommitted changes`);
  ensureWorktreeEnv(root, w.worktree, w.branch);
  try {
    console.log(out('git', ['merge', '--no-edit', 'main'], { cwd: w.worktree }));
  } catch (e) {
    tryOut('git', ['merge', '--abort'], { cwd: w.worktree });
    fail(`merging main into ${w.branch} conflicts (merge aborted, nothing changed): resolve it by hand in ${w.worktree}, then re-run.\n${String(e.stdout || e.stderr || '').trim()}`);
  }
  runGates(w.worktree, { waveNumber: n, e2e });
  console.log(`\n✔ ${w.id} is ready for your check.\n\n${demoSteps(root, w)}\n\nStart the stack: cd ${w.worktree} && npm run dev\nURL: ${clientUrl(w.worktree, `/play.html?scenario=w${w.id.slice(1)}`)}`);
}
