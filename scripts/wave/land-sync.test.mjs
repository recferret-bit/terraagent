// Sandbox tests for Mode 1 (`wave:land` 3-iteration harness), Mode 2 (`wave:sync` / `merge-main`), `wave:audit`, and `wave:propagate`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { makeSandbox, openWaveBranch, git } from './testkit.mjs';

function write(filePath, content) {
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, content, 'utf8');
}

test('Mode 1 (wave:land): runs 3 iterations, auto-heals generated file conflicts with main, and reports impacted future waves', () => {
  const sb = makeSandbox();
  const branch = openWaveBranch(sb, '00');
  sb.git('worktree', 'add', sb.wt('w00'), branch);

  // Both main and wave/w00 touch a generated barrel file differently
  const genRel = 'shared/contracts/src/commands/index.generated.ts';
  write(join(sb.root, genRel), '// main version\nexport const COMMANDS = ["a"];\n');
  sb.git('add', '-A');
  sb.git('commit', '-m', 'main updates generated commands');
  sb.git('push', 'origin', 'main');

  write(join(sb.wt('w00'), genRel), '// wave w00 version\nexport const COMMANDS = ["b"];\n');
  write(join(sb.wt('w00'), 'shared/contracts/src/commands/ping-probe.ts'), 'export const command = { kind: "pingProbe" };\n');
  git(sb.wt('w00'), 'add', '-A');
  git(sb.wt('w00'), 'commit', '-m', 'W00-01: add ping probe');
  write(join(sb.wt('w00'), 'shared/sim/src/systems/probe/index.ts'), 'export default {};\n');
  git(sb.wt('w00'), 'add', '-A');
  git(sb.wt('w00'), 'commit', '-m', 'W00: self-review probe system extension');

  const r = sb.run(['land', '00']);
  assert.equal(r.status, 0, r.out);
  assert.match(r.out, /Auto-healed generated file conflicts: shared\/contracts\/src\/commands\/index\.generated\.ts/);
  assert.match(r.out, /\[Iteration 1\/3\]/);
  assert.match(r.out, /\[Iteration 2\/3\]/);
  assert.match(r.out, /\[Iteration 3\/3\]/);
  assert.match(r.out, /✔ W00 landed as wave-00/);
  assert.match(r.out, /Future waves impacted by W00/);
  assert.equal(sb.git('tag', '--list'), 'wave-00');
});

test('Iteration 1 semantic audit catches duplicate ENTITY_KIND codes and duplicate Q&L IDs before landing', () => {
  const sb = makeSandbox();
  const branch = openWaveBranch(sb, '00');
  sb.git('worktree', 'add', sb.wt('w00'), branch);

  write(
    join(sb.wt('w00'), 'shared/sim/src/ecs/columns.ts'),
    `export const ENTITY_KIND = {\n  hq: 3,\n  tradeHub: 8,\n  builder: 8,\n} as const;\nexport const ENTITY_STATE = {\n  idle: 0,\n} as const;\n`,
  );
  write(
    join(sb.wt('w00'), 'docs/questions-and-limitations/cross-cutting.md'),
    `# Cross-cutting\n\n### XC-99 · First\n\n### XC-99 · Duplicate\n`,
  );
  git(sb.wt('w00'), 'add', '-A');
  git(sb.wt('w00'), 'commit', '-m', 'W00-01: colliding ids');

  const auditRes = sb.run(['audit', '00']);
  assert.notEqual(auditRes.status, 0);
  assert.match(auditRes.out, /ECS_ENTITY_KIND/);
  assert.match(auditRes.out, /QL_ENTRY_ID/);

  const landRes = sb.run(['land', '00']);
  assert.notEqual(landRes.status, 0);
  assert.match(landRes.out, /semantic collision\(s\) detected/);
  assert.equal(sb.git('tag', '--list'), '');
});

test('Mode 2 (wave:sync / merge-main): merges updated main into WIP wave, auto-heals generated files, reports new main issues, and syncs issue worktrees', () => {
  const sb = makeSandbox();
  openWaveBranch(sb, '00');
  sb.run(['open', '00']);
  sb.run(['issue', 'W00-01']);

  // WIP work in w00 worktree on a generated file
  const genRel = 'shared/sim/src/data/index.generated.ts';
  write(join(sb.wt('w00'), genRel), '// w00 generated data\n');
  git(sb.wt('w00'), 'add', '-A');
  git(sb.wt('w00'), 'commit', '-m', 'W00-02: wip data');

  // Meanwhile, main advances: modifies the same generated file AND adds a new issue row to W00's plan
  write(join(sb.root, genRel), '// main generated data\n');
  const w00PlanRel = 'docs/plan/waves/W00-platform-skeleton.md';
  const w00Plan = readFileSync(join(sb.root, w00PlanRel), 'utf8');
  const updatedPlan = w00Plan.replace(
    /(\|\s*W00-\d{2}\s*\|\s*Wave e2e)/i,
    '| W00-99 | Self-review follow-up telemetry hook added on main | sim | S | H | W00-01 | Trigger hook → see event | SIM §1 | — |\n$1',
  );
  writeFileSync(join(sb.root, w00PlanRel), updatedPlan, 'utf8');
  sb.git('add', '-A');
  sb.git('commit', '-m', 'main: add W00-99 follow-up issue and update generated data');
  sb.git('push', 'origin', 'main');

  const syncRes = sb.run(['sync', '00', '--sync-issues']);
  assert.equal(syncRes.status, 0, syncRes.out);
  assert.match(syncRes.out, /Auto-healed generated file conflicts: shared\/sim\/src\/data\/index\.generated\.ts/);
  assert.match(syncRes.out, /\[Iteration 1\/3\]/);
  assert.match(syncRes.out, /\[Iteration 2\/3\]/);
  assert.match(syncRes.out, /\[Iteration 3\/3\]/);
  assert.match(syncRes.out, /New W00 issues added on main: W00-99/);
  assert.match(syncRes.out, /issue worktree W00-01: synced with wave branch ✔/);
  assert.match(syncRes.out, /✔ W00 \(wave\/w00-platform-skeleton\) synced with main \(3\/3 iterations passed\)/);

  // Verify the backup ref was recorded and the issue worktree has main's new commit
  assert.ok(git(sb.wt('w00'), 'rev-parse', '--verify', 'refs/wave-sync-backup/W00'));
  assert.ok(readFileSync(join(sb.wt('W00-01'), w00PlanRel), 'utf8').includes('W00-99'));
  assert.equal( existsSync(sb.wt('W00-01')), true);
});

test('wave:propagate inspects self-review extensions and --add-issue injects a valid row before Wave e2e (and rolls back invalid deps)', () => {
  const sb = makeSandbox();
  const branch = openWaveBranch(sb, '00');
  sb.git('worktree', 'add', sb.wt('w00'), branch);

  write(join(sb.wt('w00'), 'shared/contracts/src/commands/orbital-beacon.ts'), 'export const command = { kind: "orbitalBeacon" };\n');
  git(sb.wt('w00'), 'add', '-A');
  git(sb.wt('w00'), 'commit', '-m', 'W00: self-review orbital beacon command');

  const propReport = sb.run(['propagate', '00', '--json']);
  assert.equal(propReport.status, 0, propReport.out);
  const delta = JSON.parse(propReport.out);
  assert.ok(delta.selfReviewCommits.includes('W00: self-review orbital beacon command'));
  assert.ok(delta.buckets.commands.includes('orbital-beacon'));
  assert.ok(delta.undocumentedExtensions.some((u) => u.name === 'orbital-beacon'));
  assert.ok(delta.futureWaveImpacts.some((fw) => fw.waveId === 'W01'));

  // Inject a new follow-up issue into future wave W01
  const addRes = sb.run([
    'propagate', '00',
    '--add-issue', 'W01',
    '--title', 'Wire orbital beacon command into landfall HUD',
    '--type', 'client',
    '--size', 'S',
    '--tag', 'H',
    '--deps', 'W01-01',
    '--accept', 'Activate orbital beacon → see landfall HUD indicator',
  ]);
  assert.equal(addRes.status, 0, addRes.out);
  assert.match(addRes.out, /✔ added W01-\d{2}/);

  const w01Content = readFileSync(join(sb.root, 'docs/plan/waves/W01-landfall.md'), 'utf8');
  const lines = w01Content.split('\n');
  const addedIdx = lines.findIndex((l) => l.includes('Wire orbital beacon command into landfall HUD'));
  const e2eIdx = lines.findIndex((l) => /^\|\s*W01-\d{2}\s*\|\s*Wave e2e/i.test(l));
  assert.ok(addedIdx > 0 && e2eIdx > addedIdx, 'new issue must be inserted before Wave e2e row');

  // Verify that a bare wave dependency (e.g. `W00` instead of `W00-01`) fails index_waves.py validation and rolls back
  const badRes = sb.run([
    'propagate', '00',
    '--add-issue', 'W01',
    '--title', 'Bad bare wave dep row',
    '--type', 'sim',
    '--size', 'S',
    '--tag', 'H',
    '--deps', 'W00',
  ]);
  assert.notEqual(badRes.status, 0);
  assert.match(badRes.out, /plan validation problems \(rolled back\)/);
  assert.equal(readFileSync(join(sb.root, 'docs/plan/waves/W01-landfall.md'), 'utf8').includes('Bad bare wave dep row'), false);
});
