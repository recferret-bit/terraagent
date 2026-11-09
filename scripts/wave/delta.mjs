// As-Built vs Planned feature delta analyzer and Future-Wave impact calculator (supports both `land` and `sync` modes).
import { existsSync, readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { tryOut } from './sh.mjs';

function resolveWaveGitRange(root, w) {
  if (w.open) return { diffRange: `main...${w.branch}`, logRange: `main..${w.branch}`, ref: w.branch };
  const tags = (tryOut('git', ['tag', '--list', `${w.tag}*`], { cwd: root }) ?? '').split('\n').filter(Boolean).sort();
  const tag = tags.at(-1);
  if (!tag) return { diffRange: 'main...HEAD', logRange: 'main..HEAD', ref: 'HEAD' };
  const hasTwoParents = tryOut('git', ['rev-parse', '--verify', '--quiet', `${tag}^2`], { cwd: root }) !== null;
  if (hasTwoParents) return { diffRange: `${tag}^1...${tag}^2`, logRange: `${tag}^1..${tag}^2`, ref: `${tag}^2` };
  return { diffRange: `${tag}~1...${tag}`, logRange: `${tag}~1..${tag}`, ref: tag };
}

function classifyDiffFiles(diffLines) {
  const buckets = {
    commands: [],
    events: [],
    dataTables: [],
    simSystems: new Set(),
    clientFeatures: new Set(),
    kitbashModels: [],
    particles: [],
    devTools: [],
    prismaModels: [],
    backendModules: new Set(),
    e2eSpecs: [],
    scenarios: [],
    allAddedFiles: [],
    allTouchedFiles: [],
  };
  for (const line of diffLines) {
    const [status, file] = line.split(/\t+/);
    if (!file) continue;
    buckets.allTouchedFiles.push(file);
    if (status?.startsWith('A')) buckets.allAddedFiles.push(file);
    let m;
    if ((m = /^shared\/contracts\/src\/commands\/([^/]+)\.ts$/.exec(file)) && !m[1].startsWith('index') && m[1] !== 'define') {
      if (status?.startsWith('A')) buckets.commands.push(m[1]);
    } else if ((m = /^shared\/contracts\/src\/events\/([^/]+)\.ts$/.exec(file)) && !m[1].startsWith('index') && m[1] !== 'define') {
      if (status?.startsWith('A')) buckets.events.push(m[1]);
    } else if ((m = /^shared\/sim\/src\/data\/([^/]+)\.ts$/.exec(file)) && !m[1].startsWith('index') && !m[1].startsWith('_')) {
      if (status?.startsWith('A')) buckets.dataTables.push(m[1]);
    } else if ((m = /^shared\/sim\/src\/systems\/([^/]+)\//.exec(file)) && !m[1].startsWith('_')) {
      buckets.simSystems.add(m[1]);
    } else if ((m = /^frontend\/game\/features\/([^/]+)\//.exec(file)) && m[1] !== 'shared') {
      buckets.clientFeatures.add(m[1]);
    } else if (/^frontend\/render\/kitbash\/archetypes\/.+\.ts$/.test(file) && !file.endsWith('index.ts')) {
      buckets.kitbashModels.push(file);
    } else if (/^frontend\/render\/particles\/.+\.ts$/.test(file) && !file.endsWith('index.ts')) {
      buckets.particles.push(file);
    } else if (/^(shared\/sim\/src\/systems\/dev\/|frontend\/game\/features\/devtools|frontend\/game\/dev\/)/.test(file)) {
      buckets.devTools.push(file);
    } else if ((m = /^shared\/db\/prisma\/([^/]+)\.prisma$/.exec(file)) && m[1] !== 'schema') {
      buckets.prismaModels.push(m[1]);
    } else if ((m = /^backend\/app\/src\/([^/]+)\//.exec(file))) {
      buckets.backendModules.add(m[1]);
    } else if (/^tests\/e2e\/w\d\d\.spec\.ts$/.test(file)) {
      buckets.e2eSpecs.push(file);
    } else if (/^tests\/scenarios\/w\d\d[^/]*\.ts$/.test(file)) {
      buckets.scenarios.push(file);
    }
  }
  return {
    ...buckets,
    simSystems: [...buckets.simSystems].sort(),
    clientFeatures: [...buckets.clientFeatures].sort(),
    backendModules: [...buckets.backendModules].sort(),
  };
}

function parseWaveTableRows(markdownText, waveId) {
  const rows = new Map();
  const idRe = new RegExp(`^${waveId}-\\d{2}$`);
  for (const line of markdownText.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('|')) continue;
    const cells = trimmed.split(/(?<!\\)\|/).map((c) => c.trim());
    const id = cells[1];
    if (!id || !idRe.test(id) || cells.length < 8) continue;
    rows.set(id, {
      id,
      title: cells[2],
      type: cells[3],
      size: cells[4],
      tag: cells[5],
      deps: cells[6],
      acceptance: cells[7],
    });
  }
  return rows;
}

function computeFutureWaveImpacts(root, plan, w, buckets, selfReviewCommits) {
  const byId = Object.fromEntries(plan.waves.map((x) => [x.id, x]));
  const transitiveDeps = (target) => {
    const seen = new Set();
    const stack = [...(target.deps ?? [])];
    while (stack.length) {
      const cur = stack.pop();
      if (seen.has(cur)) continue;
      seen.add(cur);
      for (const d of byId[cur]?.deps ?? []) stack.push(d);
    }
    return seen;
  };
  const impacts = [];
  for (const fw of plan.waves) {
    if (fw.id === w.id || fw.landed || fw.postponed) continue;
    const fwNum = Number(fw.id.slice(1)), wNum = Number(w.id.slice(1));
    const direct = fw.deps.includes(w.id);
    const trans = !direct && transitiveDeps(fw).has(w.id);
    const fwPath = join(root, fw.file);
    const fwText = existsSync(fwPath) ? readFileSync(fwPath, 'utf8') : '';
    const mentionsWave = new RegExp(`\\b${w.id}\\b`).test(fwText);
    if (!direct && !trans && !mentionsWave && fwNum < wNum) continue;
    if (!direct && !trans && !mentionsWave) continue;
    const rows = [...parseWaveTableRows(fwText, fw.id).values()];
    const nums = rows.map((r) => Number(r.id.split('-')[1])).filter(Number.isFinite);
    const nextNum = nums.length ? Math.max(...nums) + 1 : 1;
    const e2eRow = rows.find((r) => /wave e2e/i.test(r.title)) ?? rows.at(-1);
    const reasons = [];
    if (direct) reasons.push(`Direct dependency on ${w.id}`);
    else if (trans) reasons.push(`Transitive dependency on ${w.id}`);
    if (mentionsWave) reasons.push(`References ${w.id} in ${fw.file}`);
    if (buckets.commands.length || buckets.events.length) {
      reasons.push(`New ${w.id} contracts (${[...buckets.commands, ...buckets.events].slice(0, 5).join(', ')})`);
    }
    if (buckets.simSystems.length) reasons.push(`Touched sim systems (${buckets.simSystems.slice(0, 5).join(', ')})`);
    if (buckets.clientFeatures.length) reasons.push(`Touched UI features (${buckets.clientFeatures.slice(0, 5).join(', ')})`);
    if (selfReviewCommits.length) reasons.push(`${selfReviewCommits.length} self-review/extension commit(s) in ${w.id}`);
    impacts.push({
      waveId: fw.id,
      file: fw.file,
      open: Boolean(fw.open),
      relationship: direct ? 'direct' : trans ? 'transitive' : 'soft-ref',
      issueCount: rows.length,
      nextIssueId: `${fw.id}-${String(nextNum).padStart(2, '0')}`,
      e2eIssueId: e2eRow?.id ?? null,
      reasons,
    });
  }
  return impacts;
}

function computeIncomingMainPlanDelta(root, w, cwd) {
  const unmergedIncoming = (tryOut('git', ['log', '--oneline', `${w.branch}..main`], { cwd: root }) ?? '').split('\n').filter(Boolean);
  const backupRef = `refs/wave-sync-backup/${w.id}`;
  const hasBackup = tryOut('git', ['rev-parse', '--verify', '--quiet', backupRef], { cwd: cwd && existsSync(cwd) ? cwd : root }) !== null;
  const baseRef = unmergedIncoming.length === 0 && hasBackup ? backupRef : w.branch;
  const repoForRef = baseRef === backupRef && cwd && existsSync(cwd) ? cwd : root;

  const mainWaveText = tryOut('git', ['show', `main:${w.file}`], { cwd: root }) ?? '';
  const baseWaveText = tryOut('git', ['show', `${baseRef}:${w.file}`], { cwd: repoForRef }) ?? '';
  const mainRows = parseWaveTableRows(mainWaveText, w.id);
  const localRows = parseWaveTableRows(baseWaveText, w.id);
  const addedIssuesOnMain = [];
  const modifiedIssuesOnMain = [];
  for (const [id, mRow] of mainRows.entries()) {
    const lRow = localRows.get(id);
    if (!lRow) addedIssuesOnMain.push(mRow);
    else if (lRow.title !== mRow.title || lRow.acceptance !== mRow.acceptance || lRow.deps !== mRow.deps || lRow.tag !== mRow.tag) {
      modifiedIssuesOnMain.push({ id, before: lRow, after: mRow });
    }
  }
  const incomingCommits = (tryOut('git', ['log', '--oneline', `${baseRef}..main`], { cwd: repoForRef }) ?? '').split('\n').filter(Boolean);
  const planFilesChangedOnMain = (tryOut('git', ['diff', '--name-only', `${baseRef}...main`, '--', 'docs/plan', 'docs/spec'], { cwd: repoForRef }) ?? '').split('\n').filter(Boolean);
  return { incomingCommits, addedIssuesOnMain, modifiedIssuesOnMain, planFilesChangedOnMain };
}

export function analyzeWaveDelta(root, plan, w, { mode = 'land', cwd = w.worktree } = {}) {
  const { diffRange, logRange } = resolveWaveGitRange(root, w);
  const diffRaw = tryOut('git', ['diff', '--name-status', diffRange], { cwd: root }) ?? '';
  const buckets = classifyDiffFiles(diffRaw.split('\n').filter(Boolean));
  const commits = (tryOut('git', ['log', '--no-merges', '--format=%s', logRange], { cwd: root }) ?? '').split('\n').filter(Boolean);
  const issueRe = new RegExp(`^${w.id}-\\d{2}:`);
  const issueCommits = commits.filter((s) => issueRe.test(s));
  const selfReviewCommits = commits.filter((s) => !issueRe.test(s));

  const targetDir = cwd && existsSync(cwd) ? cwd : root;
  const waveDocPath = join(targetDir, w.file);
  const waveDoc = existsSync(waveDocPath) ? readFileSync(waveDocPath, 'utf8') : '';
  const normalize = (s) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
  const normDoc = normalize(waveDoc);

  const undocumentedExtensions = [
    ...buckets.commands.filter((c) => !normDoc.includes(normalize(c))).map((c) => ({ kind: 'command', name: c })),
    ...buckets.events.filter((e) => !normDoc.includes(normalize(e))).map((e) => ({ kind: 'event', name: e })),
    ...buckets.dataTables.filter((d) => !normDoc.includes(normalize(d))).map((d) => ({ kind: 'dataTable', name: basename(d) })),
    ...buckets.clientFeatures.filter((f) => !normDoc.includes(normalize(f))).map((f) => ({ kind: 'clientFeature', name: f })),
  ];

  const allH = w.issues?.H ?? [];
  const mergedSet = w.merged ?? new Set();
  const unmergedHIssues = allH.filter((id) => !mergedSet.has(id));
  const futureWaveImpacts = computeFutureWaveImpacts(targetDir, plan, w, buckets, selfReviewCommits);
  const incomingMain = mode === 'sync' && w.open ? computeIncomingMainPlanDelta(root, w, targetDir) : null;

  return {
    waveId: w.id,
    mode,
    diffRange,
    issueCommits,
    selfReviewCommits,
    buckets,
    undocumentedExtensions,
    unmergedHIssues,
    futureWaveImpacts,
    incomingMain,
  };
}
