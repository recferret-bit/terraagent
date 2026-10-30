// Wave plan + git state: which waves exist, which are landed (tag), open (branch), ready to land, or ready to open.
import { readFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { out, tryOut, fail } from './sh.mjs';

/** Absolute path of the main checkout (works from inside any worktree). `--root <dir>` / `TA_WAVE_ROOT` point the scripts at another repository (tests, dry runs in a sandbox clone). */
export function mainRoot() {
  const i = process.argv.indexOf('--root');
  const override = (i >= 0 ? process.argv[i + 1] : null) ?? process.env.TA_WAVE_ROOT;
  if (override) return resolve(override);
  const common = out('git', ['rev-parse', '--path-format=absolute', '--git-common-dir']);
  return dirname(common);
}

export const worktreeDir = (root, wave) => resolve(root, '..', 'TerraAgent-wt', wave.toLowerCase());

/** Waves from `index_waves.py --waves-json`, each with id, file, slug, branch, tag base, hard deps and issue ids per tag. */
export function loadPlan(root) {
  const json = JSON.parse(out('python3', ['scripts/plan/index_waves.py', '--waves-json'], { cwd: root }));
  if (json.problems.length) fail(`the plan has problems; run: python3 scripts/plan/index_waves.py\n${json.problems.slice(0, 5).join('\n')}`);
  const waves = Object.entries(json.waves).map(([id, w]) => {
    const slug = basename(w.file, '.md').toLowerCase();
    return {
      id,
      file: w.file,
      slug,
      branch: `wave/${slug}`,
      tag: `wave-${id.slice(1)}`,
      deps: [...new Set(w.deps)],
      tags: w.tags,
      issues: w.issues ?? {},
    };
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

/** Waves whose lead session is running (a `claude`/`agy` process launched with the wave prompt). Not checked against a `--root`/`TA_WAVE_ROOT` sandbox: its waves are not the ones running here. */
function runningWaves() {
  if (process.argv.includes('--root') || process.env.TA_WAVE_ROOT) return new Set();
  const ps = tryOut('ps', ['-ax', '-o', 'pid=,command=']) ?? '';
  const active = new Set();
  for (const line of ps.split('\n')) {
    const m = line.match(/^\s*(\d+)\s+(.*)$/);
    if (!m) continue;
    const pid = Number(m[1]), cmd = m[2];
    if (pid === process.pid || pid === process.ppid) continue;
    if (!/\b(claude|agy)\b/.test(cmd)) continue;
    const waveMatch = cmd.match(/You are the lead for wave (W\d{2})\b/);
    if (waveMatch) active.add(waveMatch[1]);
  }
  return active;
}

/** Issue ids merged into the wave branch: only commit subjects that start with `WNN-XX:` count (a stray id in a body or later in a subject does not). */
export function mergedIssueIds(root, w) {
  const log = tryOut('git', ['log', `main..${w.branch}`, '--format=%s'], { cwd: root }) ?? '';
  const re = new RegExp(`^(${w.id}-\\d{2}):`);
  return new Set(log.split('\n').map((l) => re.exec(l)?.[1]).filter(Boolean));
}

/** Adds `landed`, `open`, `running`, `worktree` and `merged` (Set of merged issue IDs) to every wave. */
export function withState(root, plan) {
  const b = branches(root), t = tags(root), r = runningWaves();
  for (const w of plan.waves) {
    w.landed = [...t].some((x) => x === w.tag || x.startsWith(`${w.tag}.`));
    w.open = b.has(w.branch);
    w.running = r.has(w.id);
    w.worktree = worktreeDir(root, w.id);
    w.merged = w.open ? mergedIssueIds(root, w) : new Set();
  }
  return plan;
}

/** Computes in-scope issue completion (`done`, `remaining`, `complete`) for the given tag list. */
export function waveProgress(w, activeTags) {
  const total = activeTags.flatMap((t) => w.issues[t] ?? []);
  const done = total.filter((id) => w.merged?.has(id));
  const remaining = total.filter((id) => !w.merged?.has(id));
  return { total, done, remaining, complete: total.length > 0 && remaining.length === 0 };
}

/**
 * A wave may open only when every wave in its header "Depends on" has **landed in main** (tag `wave-NN`); there is no
 * stacking of unlanded wave branches (PRODUCT_WAVES §7). `waiting` = deps that are open but not landed yet,
 * `missing` = deps not even opened; `unlanded` = both.
 */
export function readiness(plan, w) {
  const byId = Object.fromEntries(plan.waves.map((x) => [x.id, x]));
  const deps = w.deps.map((d) => byId[d]).filter(Boolean);
  const missing = deps.filter((d) => !d.landed && !d.open);
  const waiting = deps.filter((d) => !d.landed && d.open);
  return { ready: missing.length === 0 && waiting.length === 0, missing, waiting, unlanded: [...waiting, ...missing] };
}

/** The wave whose worktree contains the current directory, if any. */
export function currentWave(plan) {
  const top = tryOut('git', ['rev-parse', '--show-toplevel']);
  return plan.waves.find((w) => top && resolve(top) === w.worktree) ?? null;
}

/** Title of one issue from its wave file row (`| W07-03 | title … | type |`), shortened for a merge subject. */
export function issueTitle(root, plan, issueId) {
  const w = plan.waves.find((x) => x.id === issueId.slice(0, 3)) ?? fail(`unknown wave for issue ${issueId}`);
  const row = readFileSync(join(root, w.file), 'utf8').split('\n').find((l) => l.startsWith(`| ${issueId} |`)) ?? fail(`issue ${issueId} is not in ${w.file}`);
  const full = row.split('|')[2].trim();
  const cut = full.split(/: |\s\(/)[0].trim() || full;
  return cut.length > 72 ? `${cut.slice(0, 71).replace(/\s+\S*$/, '')}…` : cut;
}

export const waveTitle = (root, w) => tryOut('head', ['-1', join(root, w.file)])?.replace(/^#\s*/, '') ?? w.id;
