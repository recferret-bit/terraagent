// Smart git merge with generated-file auto-heal and semantic collision detection for wave land & sync.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { tryOut } from './sh.mjs';

export const GENERATED_CODE_FILES = [
  'shared/contracts/src/commands/index.generated.ts',
  'shared/contracts/src/events/index.generated.ts',
  'shared/contracts/schema/contracts.schema.json',
  'shared/db/prisma/schema.prisma',
  'tests/scenarios/index.generated.ts',
  'tests/scenarios/parity/index.generated.ts',
  'shared/sim/src/data/index.generated.ts',
  'shared/sim/src/systems/index.generated.ts',
];

export const GENERATED_PLAN_FILES = [
  'docs/plan/ISSUE_INDEX.md',
  'docs/plan/HACKATHON_SCHEDULE.md',
];

export const ALL_GENERATED_FILES = new Set([...GENERATED_CODE_FILES, ...GENERATED_PLAN_FILES]);

const KNOWN_KIND_ALIASES = new Set([
  'dropPod:pod',
  'commandHub:hub',
  'depot:supplyDepot',
  'mineralsQuarry:quarry',
  'waterExtractor:waterPump',
  'oilWell:petroleumWell',
  'droneArray:droneControlArray',
  'autocannon:turret',
  'laserTower:pulseTurret',
  'outpostBeacon:territoryBeacon',
  'hazardShield:shieldDome',
  'hydro:hydroGenerator',
]);

const KNOWN_MIGRATION_PREFIX_PAIRS = new Set([
  '0009_cargo_tx:0009_w12_progression',
]);

export function unmergedFiles(cwd) {
  const raw = tryOut('git', ['diff', '--name-only', '--diff-filter=U'], { cwd }) ?? '';
  return raw.split('\n').map((s) => s.trim()).filter(Boolean);
}

export function regenerateInWorktree(cwd) {
  const ran = [];
  if (!process.env.TA_WAVE_NO_GEN && existsSync(join(cwd, 'scripts', 'gen', 'run.mjs'))) {
    const r = spawnSync(process.execPath, ['scripts/gen/run.mjs'], { cwd, encoding: 'utf8' });
    if (r.status === 0) ran.push('npm run gen');
  }
  if (!process.env.TA_WAVE_NO_PLAN_WRITE && existsSync(join(cwd, 'scripts', 'plan', 'index_waves.py'))) {
    const check = spawnSync('python3', ['scripts/plan/index_waves.py', '--waves-json'], { cwd, encoding: 'utf8' });
    if (check.status === 0) {
      const parsed = JSON.parse(check.stdout || '{"problems":[]}');
      if ((parsed.problems ?? []).length === 0) {
        const w = spawnSync('python3', ['scripts/plan/index_waves.py', '--write'], { cwd, encoding: 'utf8' });
        if (w.status === 0) ran.push('index_waves.py --write');
      }
    }
  }
  return ran;
}

/**
 * Merges `branch` into `cwd`. When conflicts occur in generated files (`ALL_GENERATED_FILES`), resolves them
 * by taking `--ours`, re-running the generators (`npm run gen` + `index_waves.py --write`), and staging the result.
 */
export function mergeWithAutoHeal(cwd, branch, { noFf = false, message = null, abortOnConflict = false } = {}) {
  const args = ['merge', ...(noFf ? ['--no-ff'] : ['--no-edit']), ...(message ? ['-m', message] : []), branch];
  const r = spawnSync('git', args, { cwd, encoding: 'utf8' });
  if (r.status === 0) {
    return { ok: true, merged: true, autoHealed: [], remainingConflicts: [], output: `${r.stdout}${r.stderr}`.trim() };
  }
  const conflicts = unmergedFiles(cwd);
  if (conflicts.length === 0) {
    if (abortOnConflict) tryOut('git', ['merge', '--abort'], { cwd });
    return { ok: false, merged: false, autoHealed: [], remainingConflicts: [], output: `${r.stdout}${r.stderr}`.trim() };
  }
  const genConflicts = conflicts.filter((f) => ALL_GENERATED_FILES.has(f));
  const wavePlanConflicts = branch === 'main'
    ? conflicts.filter((f) => /^docs\/plan\/waves\/W\d{2}-.+\.md$/.test(f))
    : [];
  const autoHealed = [...genConflicts, ...wavePlanConflicts];
  if (autoHealed.length > 0) {
    for (const f of genConflicts) tryOut('git', ['checkout', '--ours', '--', f], { cwd });
    for (const f of wavePlanConflicts) tryOut('git', ['checkout', '--theirs', '--', f], { cwd });
    regenerateInWorktree(cwd);
    tryOut('git', ['add', '--', ...autoHealed, ...GENERATED_PLAN_FILES.filter((f) => existsSync(join(cwd, f)))], { cwd });
  }
  const remaining = unmergedFiles(cwd);
  if (remaining.length === 0) {
    const commitArgs = ['commit', ...(message ? ['-m', message] : ['--no-edit'])];
    const c = spawnSync('git', commitArgs, { cwd, encoding: 'utf8' });
    if (c.status === 0) {
      return { ok: true, merged: true, autoHealed, remainingConflicts: [], output: `${c.stdout}${c.stderr}`.trim() };
    }
  }
  if (abortOnConflict) tryOut('git', ['merge', '--abort'], { cwd });
  return { ok: false, merged: false, autoHealed, remainingConflicts: remaining, output: `${r.stdout}${r.stderr}`.trim() };
}

function parseNumericMap(text, constName) {
  const re = new RegExp(`export\\s+const\\s+${constName}\\s*=\\s*\\{([\\s\\S]*?)\\}\\s*as\\s+const`);
  const m = re.exec(text);
  if (!m) return [];
  const entries = [];
  for (const line of m[1].split('\n')) {
    const kv = /^\s*([A-Za-z0-9_]+)\s*:\s*(\d+)\s*,?/.exec(line);
    if (kv) entries.push({ key: kv[1], code: Number(kv[2]) });
  }
  return entries;
}

function checkEcsCollisions(cwd, collisions) {
  const colFile = join(cwd, 'shared/sim/src/ecs/columns.ts');
  if (!existsSync(colFile)) return;
  const text = readFileSync(colFile, 'utf8');
  const kinds = parseNumericMap(text, 'ENTITY_KIND');
  const states = parseNumericMap(text, 'ENTITY_STATE');
  const byKind = new Map();
  for (const { key, code } of kinds) {
    const prev = byKind.get(code) ?? [];
    for (const p of prev) {
      const pair = [p, key].sort().join(':');
      if (!KNOWN_KIND_ALIASES.has(pair)) {
        collisions.push({ kind: 'ECS_ENTITY_KIND', file: 'shared/sim/src/ecs/columns.ts', detail: `ENTITY_KIND.${p} and ENTITY_KIND.${key} both use numeric code ${code}` });
      }
    }
    byKind.set(code, [...prev, key]);
  }
  const byState = new Map();
  for (const { key, code } of states) {
    if (byState.has(code)) {
      collisions.push({ kind: 'ECS_ENTITY_STATE', file: 'shared/sim/src/ecs/columns.ts', detail: `ENTITY_STATE.${byState.get(code)} and ENTITY_STATE.${key} both use numeric code ${code}` });
    }
    byState.set(code, key);
  }
}

function checkMigrationAndDocCollisions(cwd, collisions) {
  const migDir = join(cwd, 'shared/db/prisma/migrations');
  if (existsSync(migDir)) {
    const byPrefix = new Map();
    for (const d of readdirSync(migDir, { withFileTypes: true }).filter((e) => e.isDirectory())) {
      const m = /^(\d{4})_/.exec(d.name);
      if (!m) continue;
      if (byPrefix.has(m[1])) {
        const pair = [byPrefix.get(m[1]), d.name].sort().join(':');
        if (!KNOWN_MIGRATION_PREFIX_PAIRS.has(pair)) {
          collisions.push({ kind: 'PRISMA_MIGRATION_PREFIX', file: 'shared/db/prisma/migrations', detail: `duplicate migration prefix ${m[1]}: ${byPrefix.get(m[1])} and ${d.name}` });
        }
      }
      byPrefix.set(m[1], d.name);
    }
  }
  const qlDir = join(cwd, 'docs/questions-and-limitations');
  if (existsSync(qlDir)) {
    const seen = new Map();
    for (const f of readdirSync(qlDir).filter((n) => n.endsWith('.md') && n !== 'README.md')) {
      const rel = `docs/questions-and-limitations/${f}`;
      for (const line of readFileSync(join(qlDir, f), 'utf8').split('\n')) {
        const m = /^###\s+([A-Z]{2,4}-\d{2,3})\b/.exec(line);
        if (!m) continue;
        if (seen.has(m[1])) collisions.push({ kind: 'QL_ENTRY_ID', file: rel, detail: `duplicate Q&L entry ID ${m[1]} (also in ${seen.get(m[1])})` });
        seen.set(m[1], rel);
      }
    }
  }
  const decFile = join(cwd, 'docs/spec/DECISIONS.md');
  if (existsSync(decFile)) {
    const seen = new Set();
    for (const line of readFileSync(decFile, 'utf8').split('\n')) {
      const m = /^##\s+(D-\d{2,3})\b/.exec(line);
      if (!m) continue;
      if (seen.has(m[1])) collisions.push({ kind: 'DECISION_ID', file: 'docs/spec/DECISIONS.md', detail: `duplicate decision heading ${m[1]}` });
      seen.add(m[1]);
    }
  }
}

export function scanSemanticCollisions(cwd, { root = cwd, wave = null } = {}) {
  const collisions = [];
  const warnings = [];
  for (const f of unmergedFiles(cwd)) {
    collisions.push({ kind: 'GIT_UNMERGED', file: f, detail: `unmerged git conflict in ${f}` });
  }
  checkEcsCollisions(cwd, collisions);
  checkMigrationAndDocCollisions(cwd, collisions);
  if (existsSync(join(cwd, 'scripts/plan/index_waves.py'))) {
    const raw = tryOut('python3', ['scripts/plan/index_waves.py', '--waves-json'], { cwd });
    if (raw) {
      const parsed = JSON.parse(raw);
      for (const p of parsed.problems ?? []) collisions.push({ kind: 'PLAN_INDEX', file: 'docs/plan/waves', detail: p });
    }
  }
  if (wave && existsSync(root)) {
    const branches = (tryOut('git', ['branch', '--list', `issue/${wave.id}-*`, '--format=%(refname:short)'], { cwd: root }) ?? '').split('\n').filter(Boolean);
    for (const b of branches) {
      const merged = spawnSync('git', ['merge-base', '--is-ancestor', b, wave.branch], { cwd: root }).status === 0;
      if (!merged) warnings.push({ kind: 'UNLANDED_ISSUE_BRANCH', branch: b, detail: `${b} has commits not merged into ${wave.branch}` });
    }
  }
  return { ok: collisions.length === 0, collisions, warnings };
}
