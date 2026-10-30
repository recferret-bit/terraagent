// Wave plan + git state: which waves exist, which are landed (tag), open (branch) or ready to open.
import { basename, dirname, join, resolve } from 'node:path';
import { out, tryOut, fail } from './sh.mjs';

/** Absolute path of the main checkout (works from inside any worktree). */
export function mainRoot() {
  const common = out('git', ['rev-parse', '--path-format=absolute', '--git-common-dir']);
  return dirname(common);
}

export const worktreeDir = (root, wave) => resolve(root, '..', 'TerraAgent-wt', wave.toLowerCase());

/** Waves from `index_waves.py --waves-json`, each with id, file, slug, branch, tag base and hard deps. */
export function loadPlan(root) {
  const json = JSON.parse(out('python3', ['scripts/plan/index_waves.py', '--waves-json'], { cwd: root }));
  if (json.problems.length) fail(`the plan has problems; run: python3 scripts/plan/index_waves.py\n${json.problems.slice(0, 5).join('\n')}`);
  const waves = Object.entries(json.waves).map(([id, w]) => {
    const slug = basename(w.file, '.md').toLowerCase();
    return { id, file: w.file, slug, branch: `wave/${slug}`, tag: `wave-${id.slice(1)}`, deps: [...new Set(w.deps)], tags: w.tags };
  });
  return { waves, valueOrder: json.valueOrder };
}

/** Hackathon value order first, then every other wave by number. */
export function ordered(plan) {
  const rank = (w) => { const i = plan.valueOrder.indexOf(w.id); return i < 0 ? 100 + Number(w.id.slice(1)) : i; };
  return [...plan.waves].sort((a, b) => rank(a) - rank(b));
}

const branches = (root) => new Set(out('git', ['branch', '--format=%(refname:short)'], { cwd: root }).split('\n').filter(Boolean));
const tags = (root) => new Set(out('git', ['tag', '--list', 'wave-*'], { cwd: root }).split('\n').filter(Boolean));

/** Adds `landed`, `open` and `worktree` to every wave. */
export function withState(root, plan) {
  const b = branches(root), t = tags(root);
  for (const w of plan.waves) {
    w.landed = [...t].some((x) => x === w.tag || x.startsWith(`${w.tag}.`));
    w.open = b.has(w.branch);
    w.worktree = worktreeDir(root, w.id);
  }
  return plan;
}

/** Deps that are open but not landed yet: they get stacked (merged into the new wave branch). */
export function readiness(plan, w) {
  const byId = Object.fromEntries(plan.waves.map((x) => [x.id, x]));
  const deps = w.deps.map((d) => byId[d]).filter(Boolean);
  const missing = deps.filter((d) => !d.landed && !d.open);
  return { ready: missing.length === 0, missing, stack: deps.filter((d) => !d.landed && d.open) };
}

/** The wave whose worktree contains the current directory, if any. */
export function currentWave(plan) {
  const top = tryOut('git', ['rev-parse', '--show-toplevel']);
  return plan.waves.find((w) => top && resolve(top) === w.worktree) ?? null;
}

export const waveTitle = (root, w) => tryOut('head', ['-1', join(root, w.file)])?.replace(/^#\s*/, '') ?? w.id;
