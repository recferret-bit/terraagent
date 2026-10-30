#!/usr/bin/env node
// Two-command wave pipeline (docs/plan/PRODUCT_WAVES.md §7):
//   npm run wave            auto-lands any completed open wave, then opens/resumes the next wave with its built-in preset
//   npm run wave -- status  full board: state, issue progress (done/total), preset (runner:model+advisor, effort, parallel) & track
// Single steps of the pipeline (each is also an npm script):
//   wave:open -- NN         open/resume the wave worktree (ports + database in .env.worktree), no agent started
//   wave:issue -- WNN-XX    create the issue worktree `issue/WNN-XX` from its wave branch
//   wave:issue:land -- WNN-XX   merge the issue into its wave branch (gates green, `--no-ff`, subject `WNN-XX: <title>`)
//   wave:check -- NN        merge main into the wave, run the gates, print the demo steps and URL
//   wave:land -- NN         land the wave in main (refusals, gates, tag, push, cleanup)
// Options: --dry-run, --root <dir> (or TA_WAVE_ROOT: another repository, e.g. a sandbox clone), --no-e2e.
import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { out, run, tryOut, fail } from './sh.mjs';
import { mainRoot, loadPlan, ordered, withState, waveProgress, readiness, currentWave, waveTitle } from './plan.mjs';
import { ensureWorktreeEnv } from './isolation.mjs';
import { openIssue, landIssue } from './issue.mjs';
import { checkWave } from './check.mjs';
import { runGates } from './gates.mjs';
import { wavePrompt, resolvePreset, buildRunnerCommand } from './prompt.mjs';

const args = process.argv.slice(2);
const VALUE_OPTS = ['--tags', '--parallel', '--runner', '--model', '--advisor', '--mode', '--effort', '--root'];
const flag = (n) => args.includes(n);
const opt = (n, d) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
const positional = args.filter((a, i) => !a.startsWith('--') && !VALUE_OPTS.includes(args[i - 1]));
const [command = 'next', waveArg] = positional;

const root = mainRoot();
let plan = withState(root, loadPlan(root));
const byId = (n) => plan.waves.find((w) => w.id === `W${String(n).padStart(2, '0')}`) ?? fail(`unknown wave ${n}`);
const overrides = () => ({
  runner: opt('--runner', null),
  model: opt('--model', null),
  advisor: opt('--advisor', null),
  mode: opt('--mode', null),
  effort: opt('--effort', null),
  parallel: opt('--parallel', null),
  tags: opt('--tags', null)?.split(',') ?? null,
});

function status() {
  for (const w of ordered(plan)) {
    const r = readiness(plan, w);
    const p = resolvePreset(w, overrides());
    const prog = waveProgress(w, p.tags);
    const tagLabel = w.tags.H ? `${prog.total.length} H` : `${prog.total.length} all`;
    const state = w.landed && !w.open
      ? 'landed'
      : w.open && prog.complete
        ? `READY TO LAND (${prog.done.length}/${prog.total.length})`
        : w.open && w.running
          ? `RUNNING (${prog.done.length}/${prog.total.length})`
          : w.open
            ? `OPEN (${prog.done.length}/${prog.total.length})`
            : r.ready
              ? 'ready'
              : `blocked by ${r.missing.map((d) => d.id).join(', ')}`;
    const agent = p.label.padEnd(19);
    const params = `par=${p.parallel}`.padEnd(7);
    console.log(`${w.id}  ${state.padEnd(25)} ${tagLabel.padEnd(7)} ${agent} ${params} ${p.track.padEnd(15)} ${w.slug}`);
  }
}

/** Open waves whose tip is part of `w.branch` but not of main: they were stacked into it, so they must land first. */
function stackedWaves(w) {
  const git = (...a) => spawnSync('git', a, { cwd: root }).status === 0;
  return plan.waves.filter((x) => x !== w && x.open && !git('merge-base', '--is-ancestor', x.branch, 'main') && git('merge-base', '--is-ancestor', x.branch, w.branch));
}

function checkLandable(w) {
  if (!w.open) fail(`${w.id} has no branch ${w.branch}`);
  const r = readiness(plan, w);
  const blockers = [...new Set([...r.stack, ...r.missing, ...stackedWaves(w)])];
  if (blockers.length) fail(`${w.id} depends on or stacks ${blockers.map((d) => d.id).join(', ')}, which are not in main yet: land them first`);
  if (existsSync(w.worktree) && out('git', ['status', '--porcelain'], { cwd: w.worktree })) fail(`${w.worktree} has uncommitted changes`);
  if (out('git', ['branch', '--show-current'], { cwd: root }) !== 'main') fail(`the main checkout ${root} is not on main`);
  if (tryOut('git', ['remote'], { cwd: root }) && !flag('--dry-run')) run('git', ['pull', '--ff-only'], { cwd: root });
  const touched = new Set(out('git', ['diff', '--name-only', `main...${w.branch}`], { cwd: root }).split('\n'));
  const dirty = out('git', ['status', '--porcelain'], { cwd: root }).split('\n').map((l) => l.replace(/^\s*\S{1,2}\s+/, '').replace(/^.* -> /, '')).filter((f) => touched.has(f)); // out() trims, so the first status line may lack its leading space
  if (dirty.length) fail(`the merge would touch uncommitted files in the main checkout:\n  ${dirty.join('\n  ')}`);
  if (!existsSync(w.worktree)) fail(`${w.id} has no worktree ${w.worktree} to run the gates in: run \`npm run wave:open -- ${w.id.slice(1)}\``);
  runGates(w.worktree, { dryRun: flag('--dry-run') });
}

function landWave(w) {
  checkLandable(w);
  const dry = flag('--dry-run');
  const tag = w.landed ? `${w.tag}.${1 + out('git', ['tag', '--list', `${w.tag}*`], { cwd: root }).split('\n').length}` : w.tag;
  if (dry) return console.log(`would merge ${w.branch} into main as "${waveTitle(root, w)}", tag ${tag}, push main + ${tag}, remove ${w.worktree}, delete ${w.branch}`);
  try {
    out('git', ['merge', '--no-ff', w.branch, '-m', waveTitle(root, w)], { cwd: root });
  } catch (e) {
    tryOut('git', ['merge', '--abort'], { cwd: root });
    fail(`merging ${w.branch} into main conflicts (merge aborted): merge main into ${w.branch} in ${w.worktree}, resolve by hand and re-run.\n${String(e.stdout || e.stderr || '').trim()}`);
  }
  run('git', ['tag', tag], { cwd: root });
  if (tryOut('git', ['remote'], { cwd: root })) run('git', ['push', 'origin', 'main', tag], { cwd: root });
  if (existsSync(w.worktree)) run('git', ['worktree', 'remove', w.worktree], { cwd: root });
  run('git', ['branch', '-d', w.branch], { cwd: root });
  plan = withState(root, loadPlan(root));
  const others = plan.waves.filter((x) => x.open).map((x) => x.id);
  console.log(`\n✔ ${w.id} landed as ${tag}.${others.length ? ` Open waves to merge main next: ${others.join(', ')}.` : ''}`);
}

function autoLandCompleted() {
  for (const w of ordered(plan).filter((x) => x.open)) {
    const p = resolvePreset(w, overrides());
    const prog = waveProgress(w, p.tags);
    if (!prog.complete) continue;
    if (flag('--dry-run')) {
      console.log(`would auto-land completed ${w.id} (${prog.done.length}/${prog.total.length} issues merged) as ${w.tag}`);
      continue;
    }
    console.log(`\n★ ${w.id} has all ${prog.done.length}/${prog.total.length} in-scope issues merged — landing into main…`);
    landWave(w);
  }
}

function pickNext() {
  if (waveArg) return byId(waveArg);
  const list = ordered(plan);
  const paused = list.find((w) => w.open && !w.running && !waveProgress(w, resolvePreset(w, overrides()).tags).complete);
  if (paused && !flag('--new')) return paused;
  const nextWave = list.find((w) => !w.landed && !w.open && readiness(plan, w).ready);
  return nextWave ?? fail('all ready waves are landed, already running, or waiting on dependencies (see `npm run wave -- status`)');
}

function openWave(w) {
  const r = readiness(plan, w);
  if (!r.ready) fail(`${w.id} waits for ${r.missing.map((d) => d.id).join(', ')}: open those first`);
  if (w.open) {
    if (!existsSync(w.worktree)) run('git', ['worktree', 'add', w.worktree, w.branch], { cwd: root });
    if (!out('git', ['status', '--porcelain'], { cwd: w.worktree })) {
      for (const d of r.stack) run('git', ['merge', '--no-edit', d.branch], { cwd: w.worktree });
    }
  } else {
    run('git', ['worktree', 'add', w.worktree, '-b', w.branch, 'main'], { cwd: root });
    for (const d of r.stack) run('git', ['merge', '--no-edit', d.branch], { cwd: w.worktree });
  }
  const env = ensureWorktreeEnv(root, w.worktree, w.branch);
  if (!existsSync(join(w.worktree, 'node_modules')) && !process.env.TA_WAVE_NO_INSTALL) run('npm', ['ci'], { cwd: w.worktree });
  console.log(`${w.id} worktree ${w.worktree}: TA_PORT_BASE=${env.TA_PORT_BASE}, TA_DB_NAME=${env.TA_DB_NAME}`);
  return r.stack;
}

function next() {
  if (!waveArg) autoLandCompleted();
  const w = pickNext();
  if (w.running && !flag('--force') && !flag('--dry-run')) {
    fail(`${w.id} is already running in another terminal (pass --force to launch another session on ${w.id})`);
  }
  const preset = resolvePreset(w, overrides());
  const progress = waveProgress(w, preset.tags);
  const r = readiness(plan, w);
  if (flag('--dry-run')) {
    if (!r.ready) return console.log(`${w.id} is blocked by ${r.missing.map((d) => d.id).join(', ')}`);
    console.log(
      `would ${w.open ? 'resume' : 'open'} ${w.id} ${w.slug} (${progress.done.length}/${progress.total.length} issues done) in ${w.worktree} ` +
      `with preset ${preset.label} (cli=${preset.cliModel}${preset.advisor ? `, advisor=${preset.advisor}` : ''}, mode=${preset.mode}, parallel=${preset.parallel}, plan=${preset.plan})`,
    );
    return;
  }
  const stacked = openWave(w);
  const prompt = wavePrompt(w, waveTitle(root, w), { preset, stacked, progress });
  const { cmd, args: cmdArgs } = buildRunnerCommand(preset, prompt, [dirname(w.worktree), root]);
  console.log(
    `\n▶ ${w.id} ${w.slug} (${progress.done.length}/${progress.total.length} done) — ${w.worktree}` +
    ` — preset ${preset.label} (parallel=${preset.parallel}, mode=${preset.mode})` +
    `${stacked.length ? ` — stacked on ${stacked.map((d) => d.id).join(', ')}` : ''}`,
  );
  if (flag('--no-launch')) {
    console.log(`\ncd ${w.worktree} && ${cmd} ${cmdArgs.slice(0, -1).join(' ')} "<prompt below>"\n\n${prompt}`);
    return;
  }
  const res = spawnSync(cmd, cmdArgs, { cwd: w.worktree, stdio: 'inherit' });
  if (res.error) fail(`could not start \`${cmd}\` (${res.error.message}); run with --no-launch and start it yourself`);
}

function land() {
  const target = waveArg ? byId(waveArg) : currentWave(plan) ?? plan.waves.find((w) => w.open) ?? fail('no open wave to land');
  landWave(target);
}

function open() {
  const w = waveArg ? byId(waveArg) : fail('usage: npm run wave:open -- NN');
  if (flag('--dry-run')) return console.log(`would ${w.open ? 'resume' : 'open'} ${w.id} ${w.slug} in ${w.worktree} (branch ${w.branch}, stacking ${readiness(plan, w).stack.map((d) => d.id).join(', ') || 'nothing'})`);
  openWave(w);
}

const check = () => checkWave(root, byId(waveArg ?? fail('usage: npm run wave:check -- NN')), { dryRun: flag('--dry-run'), e2e: !flag('--no-e2e') });
const issue = () => openIssue(root, plan, waveArg, { dryRun: flag('--dry-run') });
const issueLand = () => landIssue(root, plan, waveArg, { dryRun: flag('--dry-run'), e2e: !flag('--no-e2e') });

({ next, status, land, open, check, issue, 'issue:land': issueLand }[command] ?? (() => fail(`unknown command "${command}" (use \`npm run wave\` or \`npm run wave -- status\`)`)))();
