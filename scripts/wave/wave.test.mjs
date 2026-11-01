// Tests for the wave pipeline scripts, run in a throwaway sandbox repository (never the real one): `npm run test:wave`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { makeSandbox, openWaveBranch, git } from './testkit.mjs';
import { dbNameFor, readWorktreeEnv } from './isolation.mjs';
import { resolvePreset, buildRunnerCommand, wavePrompt } from './prompt.mjs';

const wave = (id) => ({ id, tags: { H: 1 }, file: 'docs/plan/waves/x.md', branch: `wave/${id}` });

test('--runner grok launches grok with a mapped model, permission mode and the prompt verbatim', () => {
  const sonnet = resolvePreset(wave('W08'), { runner: 'grok', model: 'sonnet' });
  assert.equal(sonnet.runner, 'grok');
  assert.equal(sonnet.model, 'grok-4.7-build-fast');
  assert.equal(sonnet.advisor, null);
  assert.equal(sonnet.label, 'grok:grok-4.7-build-fast');
  const opus = resolvePreset(wave('W13'), { runner: 'grok', effort: 'high' });
  assert.equal(opus.model, 'grok-4.7');
  const explicit = resolvePreset(wave('W08'), { runner: 'grok', model: 'grok-4.6' });
  assert.equal(explicit.cliModel, 'grok-4.6');
  const cmd = buildRunnerCommand(explicit, 'You are the lead for wave W08', ['/tmp/wt', '/tmp/root']);
  assert.equal(cmd.cmd, 'grok');
  assert.deepEqual(cmd.args.slice(0, 4), ['--model', 'grok-4.6', '--permission-mode', 'auto']);
  assert.equal(cmd.args.includes('--add-dir'), false);
  assert.ok(cmd.args.includes('--verbatim'));
  assert.deepEqual(cmd.env, { GROK_DEBUG_CONTEXT_WINDOW: '500000' });
  assert.equal(cmd.args.at(-1), 'You are the lead for wave W08');
  assert.equal(cmd.args.includes('--advisor'), false);
  const prompted = wavePrompt(wave('W08'), 'Goals', { preset: sonnet, progress: { done: [], total: ['W08-01'], remaining: ['W08-01'] } });
  assert.match(prompted, /Grok `grok-4\.7-build-fast` lead/);
  assert.doesNotMatch(prompted, /advisor=`null`/);
});

test('W26 preset starts grok-4.7 with no advisor', () => {
  const preset = resolvePreset(wave('W26'), {});
  assert.equal(preset.label, 'grok:grok-4.7');
  assert.equal(preset.advisor, null);
  assert.equal(preset.parallel, 4);
  const cmd = buildRunnerCommand(preset, 'You are the lead for wave W26', []);
  assert.equal(cmd.cmd, 'grok');
  assert.ok(cmd.args.includes('--model') && cmd.args.includes('grok-4.7'));
});

test('claude and agy commands stay on their own flags', () => {
  const claude = resolvePreset(wave('W13'), {});
  assert.equal(claude.label, 'claude:opus+fable');
  const claudeCmd = buildRunnerCommand(claude, 'prompt', []);
  assert.equal(claudeCmd.cmd, 'claude');
  assert.ok(claudeCmd.args.includes('--advisor') && claudeCmd.args.includes('fable'));
  assert.ok(claudeCmd.args.includes('--permission-mode'));
  const agy = resolvePreset(wave('W01'), {});
  assert.equal(agy.label, 'agy:argon');
  const agyCmd = buildRunnerCommand({ ...agy, mode: 'acceptEdits', effort: 'low' }, 'prompt', []);
  assert.equal(agyCmd.cmd, 'agy');
  assert.ok(agyCmd.args.includes('--mode') && agyCmd.args.includes('accept-edits'));
  assert.ok(agyCmd.args.includes('-i'));
  assert.equal(agyCmd.args.includes('--permission-mode'), false);
  assert.throws(() => buildRunnerCommand({ ...claude, runner: 'nope' }, 'prompt', []), /unknown runner/);
});

test('wave:land -- 07 refuses while W03 is not in main and names W03', () => {
  const sb = makeSandbox();
  openWaveBranch(sb, '07');
  const r = sb.run(['land', '07']);
  assert.notEqual(r.status, 0);
  assert.match(r.out, /W03/);
  assert.match(r.out, /not in main yet/);
  assert.equal(sb.git('tag', '--list'), '');
});

test('wave:open -- 07 refuses while its dependency W03 is open but not landed in main (no stacking)', () => {
  const sb = makeSandbox();
  openWaveBranch(sb, '03');
  const r = sb.run(['open', '07']);
  assert.notEqual(r.status, 0);
  assert.match(r.out, /W07 waits for W03 to land in main/);
  assert.equal(sb.git('branch', '--list', 'wave/w07-*'), '');
});

test('wave:land refuses a wave that stacks an unlanded wave', () => {
  const sb = makeSandbox();
  const w02 = openWaveBranch(sb, '02');
  sb.git('worktree', 'add', sb.wt('w02'), w02);
  writeFileSync(join(sb.wt('w02'), 'a.txt'), 'a');
  git(sb.wt('w02'), 'add', '-A'); git(sb.wt('w02'), 'commit', '-m', 'W02-01: a');
  const w03 = openWaveBranch(sb, '03');
  sb.git('worktree', 'add', sb.wt('w03'), w03);
  git(sb.wt('w03'), 'merge', '--no-edit', w02);
  const r = sb.run(['land', '03']);
  assert.notEqual(r.status, 0);
  assert.match(r.out, /W02/);
});

test('wave:land refuses when a main-checkout file touched by the merge is dirty, and when gates fail', () => {
  const sb = makeSandbox();
  const branch = openWaveBranch(sb, '00');
  sb.git('worktree', 'add', sb.wt('w00'), branch);
  writeFileSync(join(sb.wt('w00'), 'docs', 'plan', 'PRODUCT_WAVES.md'), 'changed\n');
  git(sb.wt('w00'), 'add', '-A'); git(sb.wt('w00'), 'commit', '-m', 'W00-01: change');
  writeFileSync(join(sb.root, 'docs', 'plan', 'PRODUCT_WAVES.md'), 'dirty in main\n');
  let r = sb.run(['land', '00']);
  assert.notEqual(r.status, 0);
  assert.match(r.out, /uncommitted files in the main checkout[\s\S]*PRODUCT_WAVES\.md/);
  sb.git('checkout', '--', 'docs/plan/PRODUCT_WAVES.md');
  r = sb.run(['land', '00'], { TA_WAVE_GATES: 'false' });
  assert.notEqual(r.status, 0);
  assert.match(r.out, /gate failed/);
  assert.equal(sb.git('tag', '--list'), '');
});

test('wave:land merges, tags wave-00, pushes main + tag, removes worktree and branch, lists open waves', () => {
  const sb = makeSandbox();
  const branch = openWaveBranch(sb, '00');
  openWaveBranch(sb, '01');
  sb.git('worktree', 'add', sb.wt('w00'), branch);
  writeFileSync(join(sb.wt('w00'), 'a.txt'), 'a');
  git(sb.wt('w00'), 'add', '-A'); git(sb.wt('w00'), 'commit', '-m', 'W00-01: add a');
  const r = sb.run(['land', '00']);
  assert.equal(r.status, 0, r.out);
  assert.match(r.out, /landed as wave-00/);
  assert.match(r.out, /Open waves to merge main next: W01/);
  assert.equal(sb.git('tag', '--list'), 'wave-00');
  assert.equal(git(sb.origin, 'tag', '--list'), 'wave-00');
  assert.equal(git(sb.origin, 'rev-parse', 'main'), sb.git('rev-parse', 'main'));
  assert.equal(existsSync(sb.wt('w00')), false);
  assert.equal(sb.git('branch', '--list', branch), '');
});

test('.env.worktree gets unique port bases and database names per worktree', () => {
  const sb = makeSandbox();
  const w00 = openWaveBranch(sb, '00'), w01 = openWaveBranch(sb, '01');
  assert.equal(sb.run(['open', '00']).status, 0);
  assert.equal(sb.run(['open', '01']).status, 0);
  const a = readWorktreeEnv(sb.wt('w00')), b = readWorktreeEnv(sb.wt('w01'));
  assert.equal(a.TA_PORT_BASE, '4100');
  assert.equal(b.TA_PORT_BASE, '4200');
  assert.equal(a.TA_DB_NAME, dbNameFor(w00));
  assert.equal(b.TA_DB_NAME, dbNameFor(w01));
  assert.notEqual(a.TA_DB_NAME, b.TA_DB_NAME);
  assert.equal(sb.run(['open', '00']).status, 0); // resume keeps the values
  assert.deepEqual(readWorktreeEnv(sb.wt('w00')), a);
  assert.match(dbNameFor('issue/W07-03'), /^terra_issue_w07_03$/);
  const long = dbNameFor(`wave/${'x'.repeat(100)}`);
  assert.ok(long.length <= 63 && /^[a-z][a-z0-9_]*$/.test(long));
});

test('wave:issue creates the worktree, wave:issue:land merges with the "WNN-XX: title" subject', () => {
  const sb = makeSandbox();
  const wave = openWaveBranch(sb, '00');
  assert.equal(sb.run(['open', '00']).status, 0);
  assert.equal(sb.run(['issue', 'W00-01']).status, 0);
  const dir = sb.wt('W00-01');
  assert.equal(sb.git('branch', '--list', 'issue/W00-01').includes('issue/W00-01'), true);
  assert.equal(readWorktreeEnv(dir).TA_PORT_BASE, '4200');
  assert.equal(readWorktreeEnv(dir).TA_DB_NAME, 'terra_issue_w00_01');
  writeFileSync(join(dir, 'b.txt'), 'b');
  let r = sb.run(['issue:land', 'W00-01']);
  assert.notEqual(r.status, 0); // dirty (untracked file counts)
  assert.match(r.out, /uncommitted/);
  git(dir, 'add', '-A'); git(dir, 'commit', '-m', 'add b');
  r = sb.run(['issue:land', 'W00-01']);
  assert.equal(r.status, 0, r.out);
  const subject = git(sb.wt('w00'), 'log', '-1', '--format=%s');
  assert.match(subject, /^W00-01: \S/);
  assert.equal(existsSync(dir), false);
  assert.equal(sb.git('branch', '--list', 'issue/W00-01'), '');
  assert.equal(sb.git('rev-parse', '--abbrev-ref', wave), wave);
  assert.match(sb.run(['status']).out, /W00 +OPEN \(1\//);
});

test('wave:issue:land stops on a conflict without resolving it', () => {
  const sb = makeSandbox();
  const wave = openWaveBranch(sb, '00');
  sb.run(['open', '00']); sb.run(['issue', 'W00-02']);
  writeFileSync(join(sb.wt('W00-02'), 'c.txt'), 'issue\n');
  git(sb.wt('W00-02'), 'add', '-A'); git(sb.wt('W00-02'), 'commit', '-m', 'issue side');
  writeFileSync(join(sb.wt('w00'), 'c.txt'), 'wave\n');
  git(sb.wt('w00'), 'add', '-A'); git(sb.wt('w00'), 'commit', '-m', 'wave side');
  const r = sb.run(['issue:land', 'W00-02']);
  assert.notEqual(r.status, 0);
  assert.match(r.out, /conflicts/);
  assert.equal(git(sb.wt('w00'), 'status', '--porcelain'), '');
  assert.equal(existsSync(sb.wt('W00-02')), true);
  assert.ok(wave);
});

test('status counts only commit subjects that start with the issue id', () => {
  const sb = makeSandbox();
  const wave = openWaveBranch(sb, '00');
  sb.git('worktree', 'add', sb.wt('w00'), wave);
  const c = (msg) => { writeFileSync(join(sb.wt('w00'), `${Math.random()}.txt`), 'x'); git(sb.wt('w00'), 'add', '-A'); git(sb.wt('w00'), 'commit', '-m', msg); };
  c('W00-01: real one');
  c('lead fix\n\nfollow-up to W00-02 and W00-03: not an issue merge');
  c('see W00-04: mentioned mid-subject');
  const line = sb.run(['status']).out.split('\n').find((l) => l.startsWith('W00 '));
  assert.match(line, /OPEN \(1\//);
});

test('wave:check prints the owner check guide (or the demo story) and the worktree URL (dry run)', () => {
  const sb = makeSandbox();
  openWaveBranch(sb, '00');
  sb.run(['open', '00']);
  const r = sb.run(['check', '00', '--dry-run']);
  assert.equal(r.status, 0, r.out);
  assert.match(r.out, /W00 — Platform Skeleton: owner check|Demo story/);
  assert.match(r.out, /http:\/\/127\.0\.0\.1:5273\/play\.html\?scenario=w00/);
  assert.ok(readFileSync(join(sb.wt('w00'), '.env.worktree'), 'utf8').includes('4100'));
});
