// 3-iteration harness for Mode 1 (`land` wave into main) and Mode 2 (`sync` updated main into WIP wave), plus `audit`.
import { existsSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { out, run, tryOut, fail } from './sh.mjs';
import { ensureWorktreeEnv } from './isolation.mjs';
import { runGates } from './gates.mjs';
import { ALL_GENERATED_FILES, mergeWithAutoHeal, regenerateInWorktree, scanSemanticCollisions, unmergedFiles } from './reconcile.mjs';
import { analyzeWaveDelta } from './delta.mjs';
import { formatPropagationReport } from './propagate.mjs';

function failOnCollisions(cwd, sem) {
  if (sem.ok) return;
  const details = sem.collisions.map((c) => `[${c.kind}] ${c.file}: ${c.detail}`).join('\n  ');
  fail(`semantic collision(s) detected in ${cwd}:\n  ${details}`);
}

function commitRegeneratedIfDirty(cwd, waveId) {
  const dirty = (tryOut('git', ['status', '--porcelain', '--untracked-files=no'], { cwd }) ?? '')
    .split('\n')
    .map((l) => l.replace(/^\s*\S+\s+/, '').trim())
    .filter((f) => ALL_GENERATED_FILES.has(f));
  if (!dirty.length) return false;
  run('git', ['add', '--', ...dirty], { cwd });
  run('git', ['commit', '-m', `chore(${waveId.toLowerCase()}): regenerate registries after main sync`], { cwd });
  return true;
}

/**
 * Mode 1 pre-merge 3-iteration verification inside the wave worktree (`w.worktree`) before landing into `main`.
 */
export function runLandHarness(root, plan, w, { iterations = 3, e2e = false, dryRun = false, requirePlanSync = false } = {}) {
  const n = Number(w.id.slice(1));
  if (dryRun) {
    runGates(w.worktree, { waveNumber: e2e ? n : null, e2e, dryRun: true });
    return null;
  }
  const mainIsAncestor = spawnSync('git', ['merge-base', '--is-ancestor', 'main', w.branch], { cwd: root }).status === 0;
  if (!mainIsAncestor) {
    console.log(`── Merging latest main into ${w.branch} in ${w.worktree} ──`);
    const mRes = mergeWithAutoHeal(w.worktree, 'main', { abortOnConflict: true });
    if (!mRes.ok) {
      fail(
        `merging main into ${w.branch} conflicts in ${w.worktree} (merge aborted):\n` +
        `  ${mRes.remainingConflicts.join('\n  ') || mRes.output}\n` +
        `Run \`npm run wave:sync -- ${w.id.slice(1)}\`, resolve conflicts in ${w.worktree}, and retry.`,
      );
    }
    if (mRes.autoHealed.length) {
      console.log(`✔ Auto-healed generated file conflicts: ${mRes.autoHealed.join(', ')}`);
    }
  }

  let delta = null;
  const total = Math.max(1, Number(iterations) || 3);
  for (let i = 1; i <= total; i++) {
    if (i === 1) {
      console.log(`── [Iteration 1/${total}] Structural, Codegen & Semantic Collision Audit (${w.id}) ──`);
      const sem = scanSemanticCollisions(w.worktree, { root, wave: w });
      failOnCollisions(w.worktree, sem);
      for (const warn of sem.warnings) console.log(`  ! [${warn.kind}] ${warn.detail}`);
    } else if (i === 2) {
      console.log(`── [Iteration 2/${total}] Gate & Regression Verification (${w.id}) ──`);
      runGates(w.worktree, { waveNumber: e2e ? n : null, e2e, dryRun: false });
    } else {
      console.log(`── [Iteration ${i}/${total}] As-Built Scope Delta & Future-Wave Plan Check (${w.id}) ──`);
      if (unmergedFiles(w.worktree).length) fail(`${w.worktree} has unmerged files after iteration ${i}`);
      delta = analyzeWaveDelta(root, plan, w, { mode: 'land', cwd: w.worktree });
      if (requirePlanSync && delta.undocumentedExtensions.length) {
        const list = delta.undocumentedExtensions.map((u) => `${u.kind}:${u.name}`).join(', ');
        fail(`undocumented self-review extensions in ${w.file} (${list}); update ${w.file} and future waves first`);
      }
      console.log(
        `  As-built summary: ${delta.issueCommits.length} issue merge(s), ${delta.selfReviewCommits.length} self-review commit(s), ` +
        `${delta.futureWaveImpacts.length} downstream future wave(s) impacted`,
      );
    }
  }
  if (total < 2) runGates(w.worktree, { waveNumber: e2e ? n : null, e2e, dryRun: false });
  return delta ?? analyzeWaveDelta(root, plan, w, { mode: 'land', cwd: w.worktree });
}

function syncOpenIssueWorktrees(root, w) {
  const wtRoot = resolve(root, '..', 'TerraAgent-wt');
  if (!existsSync(wtRoot)) return [];
  const prefix = `${w.id}-`;
  const dirs = readdirSync(wtRoot, { withFileTypes: true })
    .filter((d) => d.isDirectory() && d.name.startsWith(prefix))
    .map((d) => ({ id: d.name, dir: join(wtRoot, d.name) }));
  const results = [];
  for (const { id, dir } of dirs) {
    if (out('git', ['status', '--porcelain', '--untracked-files=no'], { cwd: dir })) {
      results.push({ id, ok: false, reason: 'dirty worktree' });
      continue;
    }
    const m = mergeWithAutoHeal(dir, w.branch, { abortOnConflict: true });
    results.push({ id, ok: m.ok, autoHealed: m.autoHealed, conflicts: m.remainingConflicts });
  }
  return results;
}

/**
 * Mode 2 (`sync` / `merge-main`): merges updated `main` into a WIP wave branch (`w.branch` in `w.worktree`),
 * auto-heals generated files, runs 3 verification iterations, and reports new issues/features from `main`.
 */
export function syncWaveWithMain(root, plan, w, { iterations = 3, e2e = false, dryRun = false, syncIssues = false } = {}) {
  if (!w.open) fail(`${w.id} has no open branch ${w.branch}`);
  const total = Math.max(1, Number(iterations) || 3);
  if (dryRun) {
    console.log(
      `would merge main into ${w.branch} in ${w.worktree}, auto-heal generated conflicts, ` +
      `run ${total} verification iterations, and report incoming main plan deltas${syncIssues ? ' + sync issue worktrees' : ''}`,
    );
    return;
  }
  if (!existsSync(w.worktree)) run('git', ['worktree', 'add', w.worktree, w.branch], { cwd: root });
  ensureWorktreeEnv(root, w.worktree, w.branch);

  if (unmergedFiles(w.worktree).length === 0 && out('git', ['status', '--porcelain', '--untracked-files=no'], { cwd: w.worktree })) {
    fail(`${w.worktree} has uncommitted changes: commit or stash them before syncing main`);
  }
  tryOut('git', ['update-ref', `refs/wave-sync-backup/${w.id}`, 'HEAD'], { cwd: w.worktree });

  console.log(`\n▶ Syncing updated main into WIP wave ${w.id} (${w.branch}) in ${w.worktree}…`);
  const mRes = mergeWithAutoHeal(w.worktree, 'main', { abortOnConflict: false });
  if (!mRes.ok) {
    const healedNote = mRes.autoHealed.length ? ` (auto-healed generated files: ${mRes.autoHealed.join(', ')})` : '';
    fail(
      `merging main into ${w.branch} has unresolved conflict(s) in ${w.worktree}${healedNote}:\n` +
      `  ${mRes.remainingConflicts.join('\n  ') || mRes.output}\n` +
      `Resolve the conflicts in ${w.worktree}, commit the merge, and re-run \`npm run wave:sync -- ${w.id.slice(1)}\`.`,
    );
  }
  if (mRes.autoHealed.length) console.log(`✔ Auto-healed generated file conflicts: ${mRes.autoHealed.join(', ')}`);

  const n = Number(w.id.slice(1));
  let delta = null;
  for (let i = 1; i <= total; i++) {
    if (i === 1) {
      console.log(`── [Iteration 1/${total}] Merge Reconciliation & Semantic Collision Pass (${w.id}) ──`);
      regenerateInWorktree(w.worktree);
      commitRegeneratedIfDirty(w.worktree, w.id);
      const sem = scanSemanticCollisions(w.worktree, { root, wave: w });
      failOnCollisions(w.worktree, sem);
    } else if (i === 2) {
      console.log(`── [Iteration 2/${total}] WIP Gate & Integration Verification (${w.id}) ──`);
      runGates(w.worktree, { waveNumber: e2e ? n : null, e2e, dryRun: false });
    } else {
      console.log(`── [Iteration ${i}/${total}] Incoming Main Plan Delta & WIP Scope Alignment (${w.id}) ──`);
      delta = analyzeWaveDelta(root, plan, w, { mode: 'sync', cwd: w.worktree });
      console.log(formatPropagationReport(delta));
      if (syncIssues) {
        for (const r of syncOpenIssueWorktrees(root, w)) {
          console.log(`  issue worktree ${r.id}: ${r.ok ? 'synced with wave branch ✔' : `skipped/conflict (${r.reason || r.conflicts?.join(', ')})`}`);
        }
      }
    }
  }
  if (total < 2) runGates(w.worktree, { waveNumber: e2e ? n : null, e2e, dryRun: false });
  console.log(`\n✔ ${w.id} (${w.branch}) synced with main (${total}/${total} iterations passed).`);
  return delta;
}

export function runAuditCommand(root, plan, w, { mode = 'land', json = false } = {}) {
  const cwd = w.open && existsSync(w.worktree) ? w.worktree : root;
  const sem = scanSemanticCollisions(cwd, { root, wave: w });
  const delta = analyzeWaveDelta(root, plan, w, { mode, cwd });
  const report = { waveId: w.id, mode, cwd, semantic: sem, delta };
  if (json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(formatPropagationReport(delta));
    if (sem.warnings.length) {
      console.log('\nWarnings:');
      for (const warn of sem.warnings) console.log(`  ! [${warn.kind}] ${warn.detail}`);
    }
    if (!sem.ok) {
      console.log('\nSemantic Collisions:');
      for (const c of sem.collisions) console.log(`  ✖ [${c.kind}] ${c.file}: ${c.detail}`);
    } else {
      console.log('\nSemantic & Plan Audit: ✔ 0 collisions');
    }
  }
  if (!sem.ok) fail(`audit failed for ${w.id}: ${sem.collisions.length} semantic collision(s)`);
  return report;
}
