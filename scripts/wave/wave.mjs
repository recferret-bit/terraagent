#!/usr/bin/env node
// One command for the wave pipeline (docs/plan/PRODUCT_WAVES.md §7).
//   npm run wave                      resume the open wave, or open the next ready one, and start Claude Code in its worktree
//   npm run wave -- next --new        open another wave in parallel even if one is open
//   npm run wave -- next 06           open (or resume) a specific wave
//   npm run wave -- status            landed / open / ready / blocked per wave
//   npm run wave -- land [NN]         after your manual check: merge into main, tag, push, remove worktree + branch
// Options: --tags H,H+  (default: the H rows if the wave has any, else every row) · --parallel 4 · --no-launch · --dry-run
import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { out, run, tryOut, fail } from './sh.mjs';
import { mainRoot, loadPlan, ordered, withState, readiness, currentWave, waveTitle } from './plan.mjs';
import { wavePrompt } from './prompt.mjs';

const args = process.argv.slice(2);
const flag = (n) => args.includes(n);
const opt = (n, d) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
const positional = args.filter((a, i) => !a.startsWith('--') && !['--tags', '--parallel'].includes(args[i - 1]));
const [command = 'next', waveArg] = positional;

const root = mainRoot();
const plan = withState(root, loadPlan(root));
const byId = (n) => plan.waves.find((w) => w.id === `W${String(n).padStart(2, '0')}`) ?? fail(`unknown wave ${n}`);

function status() {
  for (const w of ordered(plan)) {
    const r = readiness(plan, w);
    const state = w.landed && !w.open ? 'landed' : w.open ? 'OPEN' : r.ready ? 'ready' : `blocked by ${r.missing.map((d) => d.id).join(', ')}`;
    const h = w.tags.H ? `${w.tags.H} H` : '—';
    console.log(`${w.id}  ${state.padEnd(24)} ${h.padEnd(6)} ${w.slug}`);
  }
}

function pickNext() {
  if (waveArg) return byId(waveArg);
  const list = ordered(plan);
  const open = list.find((w) => w.open);
  if (open && !flag('--new')) return open;
  const next = list.find((w) => !w.landed && !w.open && readiness(plan, w).ready);
  return next ?? fail('no wave is ready: every remaining wave waits for a dependency (see `npm run wave -- status`)');
}

function openWave(w) {
  const r = readiness(plan, w);
  if (!r.ready) fail(`${w.id} waits for ${r.missing.map((d) => d.id).join(', ')}: open those first`);
  if (w.open) {
    if (!existsSync(w.worktree)) run('git', ['worktree', 'add', w.worktree, w.branch], { cwd: root });
    return r.stack;
  }
  run('git', ['worktree', 'add', w.worktree, '-b', w.branch, 'main'], { cwd: root });
  for (const d of r.stack) run('git', ['merge', '--no-edit', d.branch], { cwd: w.worktree });
  if (!existsSync(join(w.worktree, 'node_modules'))) run('npm', ['ci'], { cwd: w.worktree });
  return r.stack;
}

function dryRun(w) {
  const r = readiness(plan, w);
  if (!r.ready) return console.log(`${w.id} is blocked by ${r.missing.map((d) => d.id).join(', ')}`);
  console.log(`would ${w.open ? 'resume' : 'open'} ${w.id} ${w.slug} in ${w.worktree}${r.stack.length ? ` stacked on ${r.stack.map((d) => d.id).join(', ')}` : ''}`);
}

function next() {
  const w = pickNext();
  if (flag('--dry-run')) return dryRun(w);
  const stacked = openWave(w).map((d) => d.id);
  const tags = opt('--tags', null)?.split(',') ?? (w.tags.H ? ['H'] : Object.keys(w.tags).filter((t) => t !== 'H2'));
  const prompt = wavePrompt(w, waveTitle(root, w), { tags, parallel: Number(opt('--parallel', 4)), stacked });
  console.log(`\n▶ ${w.id} ${w.slug} — worktree ${w.worktree} — rows ${tags.join(', ')}${stacked.length ? ` — stacked on ${stacked.join(', ')}` : ''}`);
  if (flag('--no-launch')) { console.log(`\ncd ${w.worktree} && claude "<prompt below>"\n\n${prompt}`); return; }
  const r = spawnSync('claude', [prompt], { cwd: w.worktree, stdio: 'inherit' });
  if (r.error) fail(`could not start \`claude\` (${r.error.message}); run with --no-launch and start it yourself`);
}

function landTarget() {
  if (waveArg) return byId(waveArg);
  const here = currentWave(plan);
  if (here) return here;
  const open = plan.waves.filter((w) => w.open);
  if (open.length === 1) return open[0];
  return fail(open.length ? `several waves are open (${open.map((w) => w.id).join(', ')}): name one, e.g. \`npm run wave -- land ${open[0].id.slice(1)}\`` : 'no open wave to land');
}

function checkLandable(w) {
  if (!w.open) fail(`${w.id} has no branch ${w.branch}`);
  const blockers = readiness(plan, w).stack.concat(readiness(plan, w).missing);
  if (blockers.length) fail(`${w.id} depends on ${blockers.map((d) => d.id).join(', ')}, which are not in main yet: land them first`);
  if (existsSync(w.worktree) && out('git', ['status', '--porcelain'], { cwd: w.worktree })) fail(`${w.worktree} has uncommitted changes`);
  if (out('git', ['branch', '--show-current'], { cwd: root }) !== 'main') fail(`the main checkout ${root} is not on main`);
  if (tryOut('git', ['remote'], { cwd: root })) run('git', ['pull', '--ff-only'], { cwd: root });
  const touched = new Set(out('git', ['diff', '--name-only', `main...${w.branch}`], { cwd: root }).split('\n'));
  const dirty = out('git', ['status', '--porcelain'], { cwd: root }).split('\n').map((l) => l.slice(3)).filter((f) => touched.has(f));
  if (dirty.length) fail(`the merge would touch uncommitted files in the main checkout:\n  ${dirty.join('\n  ')}`);
}

function land() {
  const w = landTarget();
  checkLandable(w);
  const tag = w.landed ? `${w.tag}.${1 + out('git', ['tag', '--list', `${w.tag}*`], { cwd: root }).split('\n').length}` : w.tag;
  run('git', ['merge', '--no-ff', w.branch, '-m', waveTitle(root, w)], { cwd: root });
  run('git', ['tag', tag], { cwd: root });
  if (tryOut('git', ['remote'], { cwd: root })) run('git', ['push', 'origin', 'main', tag], { cwd: root });
  if (existsSync(w.worktree)) run('git', ['worktree', 'remove', w.worktree], { cwd: root });
  run('git', ['branch', '-d', w.branch], { cwd: root });
  const others = plan.waves.filter((x) => x.open && x !== w).map((x) => x.id);
  console.log(`\n✔ ${w.id} landed as ${tag}.${others.length ? ` Open waves to merge main next: ${others.join(', ')}.` : ''}`);
}

({ next, status, land }[command] ?? (() => fail(`unknown command "${command}" (next | status | land)`)))();
