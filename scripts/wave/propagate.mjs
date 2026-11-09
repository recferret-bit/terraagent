// Future-wave plan propagation: inspect downstream wave impact from as-built features and safely inject new issues.
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fail } from './sh.mjs';
import { analyzeWaveDelta } from './delta.mjs';

const VALID_TYPES = new Set(['contract', 'sim', 'server', 'client', 'visual', 'data', 'test', 'ops', 'docs']);
const VALID_SIZES = new Set(['S', 'M']);
const VALID_TAGS = new Set(['H', 'H+', 'H2', '']);

function normalizeWaveId(raw) {
  const m = /^w?(\d{1,2})$/i.exec(String(raw ?? '').trim());
  if (!m) fail(`expected a wave id like W05 or 05, got "${raw ?? ''}"`);
  return `W${m[1].padStart(2, '0')}`;
}

function findWaveFile(cwd, waveId) {
  const dir = join(cwd, 'docs/plan/waves');
  if (!existsSync(dir)) fail(`missing docs/plan/waves in ${cwd}`);
  const match = readdirSync(dir).find((f) => f.startsWith(`${waveId}-`) && f.endsWith('.md'));
  if (!match) fail(`no wave file for ${waveId} in ${dir}`);
  return join(dir, match);
}

/**
 * Safely appends a new issue row to a future wave file (`docs/plan/waves/WMM-*.md`) right before its `Wave e2e` row,
 * validates the DAG and tag-closure rules via `index_waves.py`, and regenerates `ISSUE_INDEX.md` + `HACKATHON_SCHEDULE.md`.
 */
export function addFutureWaveIssue(cwd, {
  waveId,
  title,
  type = 'sim',
  size = 'S',
  tag = 'H',
  deps = '',
  acceptance = '',
  spec = '—',
  replaces = '—',
  dryRun = false,
}) {
  const wid = normalizeWaveId(waveId);
  const cleanTitle = String(title ?? '').replace(/\|/g, '/').trim();
  if (!cleanTitle) fail('issue title is required (--title "<imperative title>")');
  const cleanType = String(type ?? 'sim').trim().toLowerCase();
  if (!VALID_TYPES.has(cleanType)) fail(`invalid issue type "${cleanType}" (expected one of: ${[...VALID_TYPES].join(', ')})`);
  const cleanSize = String(size ?? 'S').trim().toUpperCase();
  if (!VALID_SIZES.has(cleanSize)) fail(`invalid issue size "${cleanSize}" (expected S or M)`);
  const cleanTag = tag === '-' ? '' : String(tag ?? 'H').trim().toUpperCase();
  if (!VALID_TAGS.has(cleanTag)) fail(`invalid tag "${tag}" (expected H, H+, H2, or -)`);

  const filePath = findWaveFile(cwd, wid);
  const original = readFileSync(filePath, 'utf8');
  if (/^#\s+.*\[POSTPONED\]/m.test(original) && cleanTag === 'H') {
    fail(`cannot add an H-tagged issue to postponed wave ${wid} (pass --tag - or target an active wave)`);
  }
  const lines = original.split('\n');
  const rowRe = new RegExp(`^\\|\\s*(${wid}-(\\d{2}))\\s*\\|((?:\\\\\\||[^|])*)\\|`);

  let maxNum = 0;
  let lastRowIdx = -1;
  let e2eRowIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    const m = rowRe.exec(lines[i]);
    if (!m) continue;
    const n = Number(m[2]);
    if (n > maxNum) maxNum = n;
    lastRowIdx = i;
    if (/wave e2e/i.test(m[3])) e2eRowIdx = i;
  }
  if (lastRowIdx < 0) fail(`could not find any issue table rows in ${filePath}`);

  const newId = `${wid}-${String(maxNum + 1).padStart(2, '0')}`;
  const cleanDeps = (deps && String(deps).trim()) || `${wid}-01`;
  const cleanAccept = (acceptance && String(acceptance).replace(/\|/g, '/').trim()) || `Execute ${cleanTitle} → verify in sim and UI`;
  const cleanSpec = String(spec || '—').replace(/\|/g, '/').trim();
  const cleanReplaces = String(replaces || '—').replace(/\|/g, '/').trim();
  const newRow = `| ${newId} | ${cleanTitle} | ${cleanType} | ${cleanSize} | ${cleanTag} | ${cleanDeps} | ${cleanAccept} | ${cleanSpec} | ${cleanReplaces} |`;

  const insertIdx = e2eRowIdx >= 0 ? e2eRowIdx : lastRowIdx + 1;
  if (dryRun) {
    return { newId, waveId: wid, file: filePath, row: newRow, dryRun: true };
  }

  lines.splice(insertIdx, 0, newRow);
  writeFileSync(filePath, lines.join('\n'), 'utf8');

  if (existsSync(join(cwd, 'scripts/plan/index_waves.py'))) {
    const check = spawnSync('python3', ['scripts/plan/index_waves.py', '--waves-json'], { cwd, encoding: 'utf8' });
    if (check.status !== 0) {
      writeFileSync(filePath, original, 'utf8');
      fail(`index_waves.py failed after adding ${newId}:\n${check.stderr || check.stdout}`);
    }
    const parsed = JSON.parse(check.stdout || '{"problems":[]}');
    if ((parsed.problems ?? []).length > 0) {
      writeFileSync(filePath, original, 'utf8');
      fail(`adding ${newId} introduced plan validation problems (rolled back):\n  ${parsed.problems.join('\n  ')}`);
    }
    if (!process.env.TA_WAVE_NO_PLAN_WRITE) {
      spawnSync('python3', ['scripts/plan/index_waves.py', '--write'], { cwd, encoding: 'utf8' });
    }
  }
  return { newId, waveId: wid, file: filePath, row: newRow, dryRun: false };
}

export function formatPropagationReport(delta) {
  const lines = [
    `=== Wave ${delta.waveId} As-Built & Future-Wave Propagation Report (${delta.mode}) ===`,
    `Range: ${delta.diffRange}`,
    `Issue merges: ${delta.issueCommits.length} · Self-review / extension commits: ${delta.selfReviewCommits.length}`,
  ];
  if (delta.selfReviewCommits.length) {
    lines.push('Self-review commits:');
    for (const c of delta.selfReviewCommits.slice(0, 12)) lines.push(`  • ${c}`);
  }
  const b = delta.buckets;
  const summaryParts = [
    b.commands.length ? `commands(${b.commands.join(', ')})` : null,
    b.events.length ? `events(${b.events.join(', ')})` : null,
    b.dataTables.length ? `data(${b.dataTables.join(', ')})` : null,
    b.simSystems.length ? `sim(${b.simSystems.join(', ')})` : null,
    b.clientFeatures.length ? `features(${b.clientFeatures.join(', ')})` : null,
    b.kitbashModels.length ? `models(${b.kitbashModels.length})` : null,
    b.particles.length ? `particles(${b.particles.length})` : null,
  ].filter(Boolean);
  if (summaryParts.length) lines.push(`As-built artifacts: ${summaryParts.join(' · ')}`);
  if (delta.undocumentedExtensions.length) {
    lines.push(`Undocumented extensions in ${delta.waveId} wave file (${delta.undocumentedExtensions.length}):`);
    for (const u of delta.undocumentedExtensions) lines.push(`  ! [${u.kind}] ${u.name}`);
  }
  if (delta.futureWaveImpacts.length) {
    lines.push('\nDownstream Future Waves to Review & Update:');
    for (const fw of delta.futureWaveImpacts) {
      lines.push(`  → ${fw.waveId} (${fw.relationship}, ${fw.open ? 'OPEN WIP' : 'unopened'}, next ID: ${fw.nextIssueId}, before e2e: ${fw.e2eIssueId ?? 'end'}): ${fw.reasons.join('; ')}`);
    }
  }
  if (delta.incomingMain) {
    const im = delta.incomingMain;
    lines.push(`\nIncoming from main (${im.incomingCommits.length} commit(s)):`);
    if (im.addedIssuesOnMain.length) {
      lines.push(`  + New ${delta.waveId} issues added on main: ${im.addedIssuesOnMain.map((x) => `${x.id} (${x.title})`).join(', ')}`);
    }
    if (im.modifiedIssuesOnMain.length) {
      lines.push(`  ~ Modified ${delta.waveId} issues on main: ${im.modifiedIssuesOnMain.map((x) => x.id).join(', ')}`);
    }
  }
  return lines.join('\n');
}

export function runPropagateCommand(root, plan, w, { opt, flag }) {
  const addTarget = opt('--add-issue', null);
  if (addTarget) {
    const res = addFutureWaveIssue(root, {
      waveId: addTarget,
      title: opt('--title', ''),
      type: opt('--type', 'sim'),
      size: opt('--size', 'S'),
      tag: opt('--tag', 'H'),
      deps: opt('--deps', ''),
      acceptance: opt('--accept', ''),
      spec: opt('--spec', `${w.id} handoff`),
      replaces: opt('--replaces', '—'),
      dryRun: flag('--dry-run'),
    });
    if (flag('--json')) return console.log(JSON.stringify(res, null, 2));
    return console.log(`${res.dryRun ? 'would add' : '✔ added'} ${res.newId} to ${res.file}:\n  ${res.row}`);
  }
  const delta = analyzeWaveDelta(root, plan, w, { mode: 'land', cwd: w.open && existsSync(w.worktree) ? w.worktree : root });
  if (flag('--json')) return console.log(JSON.stringify(delta, null, 2));
  console.log(formatPropagationReport(delta));
}
