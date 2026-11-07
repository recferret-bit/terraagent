// Wave task parity, deliverables, owned-path drift, and Client + Server + Sim wiring checks.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tryOut } from './sh.mjs';

const SHARED_LEAD_PREFIXES = [
  'docs/',
  'shared/contracts/',
  'scripts/',
  'tests/',
  'package.json',
  'package-lock.json',
  'AGENTS.md',
  'CLAUDE.md',
  '.agents/',
  'infra/.env',
];

/** Expand brace globs like `shared/sim/src/systems/{a,b}/` into concrete prefixes. */
export function expandBracePattern(pattern) {
  const clean = pattern.replace(/^`|`$/g, '').trim();
  const m = /^(.*?)\{([^{}]+)\}(.*)$/.exec(clean);
  if (!m) return [clean];
  const [, pre, body, post] = m;
  return body.split(',').flatMap((part) => expandBracePattern(`${pre}${part.trim()}${post}`));
}

function parseOwnedPathsFromLines(lines) {
  const ownedPaths = [];
  let inOwned = false;
  for (const l of lines) {
    if (/^>\s*\*\*Owned paths:\*\*/i.test(l)) { inOwned = true; continue; }
    if (!inOwned) continue;
    if (!/^>\s*-\s+/.test(l)) {
      if (/^>\s*\*\*/.test(l) || !l.startsWith('>')) inOwned = false;
      continue;
    }
    const rawList = [...l.matchAll(/`([^`]+)`/g)].map((m) => m[1]);
    for (const raw of rawList.filter((r) => r.includes('/') || r.endsWith('.ts') || r.endsWith('.js'))) {
      ownedPaths.push(...expandBracePattern(raw));
    }
  }
  return ownedPaths;
}

export function parseWaveSpec(markdown) {
  const lines = markdown.split('\n');
  const flag = /\*\*Flag:\*\*\s*`([^`]+)`/.exec(markdown)?.[1] ?? null;
  const scenario = /\*\*Scenario:\*\*\s*`([^`]+)`/.exec(markdown)?.[1] ?? null;
  const ownedPaths = parseOwnedPathsFromLines(lines);

  const demoSteps = [];
  let inDemo = false;
  for (const l of lines) {
    if (/^##\s+Demo story/i.test(l)) { inDemo = true; continue; }
    if (inDemo && /^##\s+/.test(l)) { inDemo = false; continue; }
    if (inDemo) {
      const m = /^(\d+)\.\s+(.*)$/.exec(l.trim());
      if (m) demoSteps.push({ num: Number(m[1]), text: m[2] });
    }
  }

  const issueRows = [];
  for (const l of lines) {
    const m = /^\|\s*(W\d{2}-\d{2})\s*\|(.+)\|$/.exec(l.trim());
    if (!m) continue;
    const cells = m[2].split('|').map((c) => c.trim());
    if (cells.length >= 6) {
      issueRows.push({
        id: m[1],
        title: cells[0],
        type: cells[1],
        size: cells[2].replace(/`/g, ''),
        tag: cells[3],
        deps: cells[4],
        acceptance: cells[5],
      });
    }
  }

  return { flag, scenario, ownedPaths, demoSteps, issueRows };
}

function matchesOwnedPath(rel, ownedPaths) {
  if (SHARED_LEAD_PREFIXES.some((p) => rel === p || rel.startsWith(p))) return true;
  if (ownedPaths.length === 0) return true;
  return ownedPaths.some((pat) => {
    const norm = pat.replace(/\*+$/g, '');
    return rel === norm || rel.startsWith(norm);
  });
}

function walkTextMatches(dir, needle) {
  if (!existsSync(dir)) return false;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name === 'generated') continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (walkTextMatches(full, needle)) return true;
    } else if (/\.(ts|js|mjs)$/.test(entry.name)) {
      if (readFileSync(full, 'utf8').includes(needle)) return true;
    }
  }
  return false;
}

function checkContractWiring(cwd, changedFiles, issues) {
  const cmdFiles = changedFiles.filter((f) => /^shared\/contracts\/src\/commands\/[^/]+\.ts$/.test(f) && !f.endsWith('/index.ts'));
  for (const rel of cmdFiles) {
    const abs = join(cwd, rel);
    if (!existsSync(abs)) continue;
    const text = readFileSync(abs, 'utf8');
    const kinds = [...text.matchAll(/z\.literal\(\s*['"]([a-zA-Z0-9_.]+)['"]\s*\)/g)].map((m) => m[1]);
    for (const kind of kinds) {
      if (kind.startsWith('dev.')) continue;
      const inSim = walkTextMatches(join(cwd, 'shared', 'sim', 'src'), kind);
      if (!inSim) {
        issues.push({
          code: 'CONTRACT_UNWIRED_SIM',
          severity: 'error',
          file: rel,
          line: 1,
          message: `Command kind '${kind}' declared in contracts is never referenced in shared/sim/src/.`,
          fix: `Wire command handler for '${kind}' in shared/sim/src/systems/ so server, client prediction, and local host execute it (D-31).`,
        });
      }
      const inClient = walkTextMatches(join(cwd, 'frontend'), kind);
      const inServer = walkTextMatches(join(cwd, 'backend'), kind);
      if (!inClient && !inServer) {
        issues.push({
          code: 'CONTRACT_UNWIRED_CLIENT_SERVER',
          severity: 'warn',
          file: rel,
          line: 1,
          message: `Command kind '${kind}' has no caller or handler in frontend/ or backend/.`,
          fix: `Verify '${kind}' is dispatched by the client UI/store or processed by the backend service.`,
        });
      }
    }
  }
}

function checkOwnerGuideAndDevTools(cwd, wave, spec, changedFiles, issues) {
  const nn = wave.id.slice(1);
  const guideRel = `docs/plan/checks/w${nn}-check.md`;
  const guideAbs = join(cwd, guideRel);
  if (!existsSync(guideAbs)) {
    issues.push({
      code: 'MISSING_OWNER_GUIDE',
      severity: 'warn',
      file: guideRel,
      line: 1,
      message: `Owner check guide '${guideRel}' has not been created yet.`,
      fix: `Play the wave demo story on the worktree's running stack and write '${guideRel}' following docs/plan/checks/README.md.`,
    });
  } else {
    const text = readFileSync(guideAbs, 'utf8');
    if (!/Before you start/i.test(text) || !/Automated checks/i.test(text) || !/wave.*land/i.test(text)) {
      issues.push({
        code: 'INCOMPLETE_OWNER_GUIDE',
        severity: 'warn',
        file: guideRel,
        line: 1,
        message: `Owner check guide '${guideRel}' is missing required sections ('Before you start', 'Automated checks', or 'npm run wave -- land ${nn}').`,
        fix: `Include all required sections from docs/plan/checks/README.md in '${guideRel}'.`,
      });
    }
  }

  const devToolsAbs = join(cwd, 'docs/dev/DEV_TOOLS.md');
  const devToolsText = existsSync(devToolsAbs) ? readFileSync(devToolsAbs, 'utf8') : '';
  if (devToolsText) {
    for (const rel of changedFiles.filter((f) => /^frontend\/.*\.(ts|js)$/.test(f))) {
      const abs = join(cwd, rel);
      if (!existsSync(abs)) continue;
      const src = readFileSync(abs, 'utf8');
      for (const m of src.matchAll(/searchParams\.(?:get|has)\(\s*['"]([a-zA-Z0-9_]+)['"]\s*\)/g)) {
        const param = m[1];
        if (!devToolsText.includes(param)) {
          issues.push({
            code: 'DEV_TOOLS_UNDOCUMENTED',
            severity: 'warn',
            file: rel,
            line: 1,
            message: `URL query parameter '?${param}=' used in '${rel}' is not documented in docs/dev/DEV_TOOLS.md.`,
            fix: `Document '?${param}=' in docs/dev/DEV_TOOLS.md in the same change (AGENTS.md §4).`,
          });
        }
      }
    }
  }
}

function resolveAuditGitRange(root, cwd, wave, baseRef) {
  if (wave.open) {
    const hasBranch = tryOut('git', ['rev-parse', '--verify', '--quiet', wave.branch], { cwd }) !== null;
    if (hasBranch) return { diffRange: `${baseRef}...${wave.branch}`, logRange: `${baseRef}..${wave.branch}` };
    return { diffRange: `${baseRef}...HEAD`, logRange: `${baseRef}..HEAD` };
  }
  const tagPrefix = wave.tag ?? `wave-${wave.id.slice(1)}`;
  const tags = (tryOut('git', ['tag', '--list', `${tagPrefix}*`], { cwd: root }) ?? '').split('\n').filter(Boolean).sort();
  const tag = tags.at(-1);
  if (tag) {
    const hasTwoParents = tryOut('git', ['rev-parse', '--verify', '--quiet', `${tag}^2`], { cwd: root }) !== null;
    if (hasTwoParents) return { diffRange: `${tag}^1...${tag}^2`, logRange: `${tag}^1..${tag}^2`, landedTag: tag };
    return { diffRange: `${tag}~1...${tag}`, logRange: `${tag}~1..${tag}`, landedTag: tag };
  }
  return { diffRange: `${baseRef}...HEAD`, logRange: `${baseRef}..HEAD` };
}

export function auditWaveTaskAndWiring(root, cwd, wave, { progress, baseRef = 'main' } = {}) {
  const issues = [];
  const waveFileAbs = [join(cwd, wave.file), join(root, wave.file)].find(existsSync);
  const spec = waveFileAbs ? parseWaveSpec(readFileSync(waveFileAbs, 'utf8')) : { flag: wave.id, scenario: null, ownedPaths: [], demoSteps: [], issueRows: [] };

  const { diffRange, landedTag } = resolveAuditGitRange(root, cwd, wave, baseRef);
  const diffOut = tryOut('git', ['diff', '--name-only', diffRange], { cwd }) ?? '';
  const statusOut = wave.open ? (tryOut('git', ['status', '--porcelain', '--untracked-files=no'], { cwd }) ?? '') : '';
  const dirtyFiles = statusOut.split('\n').filter(Boolean).map((l) => l.replace(/^\s*\S+\s+/, '').trim());
  const changedFiles = [...new Set([...diffOut.split('\n').filter(Boolean), ...dirtyFiles])];

  if (!landedTag && progress && progress.remaining.length > 0) {
    issues.push({
      code: 'ISSUES_INCOMPLETE',
      severity: 'error',
      file: wave.file,
      line: 1,
      message: `${wave.id} has ${progress.remaining.length}/${progress.total.length} in-scope issues not yet merged: ${progress.remaining.slice(0, 10).join(', ')}${progress.remaining.length > 10 ? '…' : ''}.`,
      fix: `Build and merge each remaining issue with subject '${wave.id}-XX: <title>' before landing.`,
    });
  }

  if (spec.scenario && !existsSync(join(cwd, spec.scenario))) {
    issues.push({
      code: 'MISSING_SCENARIO',
      severity: 'error',
      file: spec.scenario,
      line: 1,
      message: `Wave scenario '${spec.scenario}' declared in ${wave.file} does not exist.`,
      fix: `Create '${spec.scenario}' to seed the wave's starting planet state (PRODUCT_WAVES §3).`,
    });
  }

  const nn = wave.id.slice(1);
  const e2eRel = `tests/e2e/w${nn}.spec.ts`;
  if (existsSync(join(cwd, 'tests', 'e2e')) && !existsSync(join(cwd, e2eRel))) {
    issues.push({
      code: 'MISSING_E2E',
      severity: 'warn',
      file: e2eRel,
      line: 1,
      message: `Wave E2E suite '${e2eRel}' does not exist yet.`,
      fix: `Add '${e2eRel}' covering the wave's demo story and '@hack' slice.`,
    });
  }

  const drifted = changedFiles.filter((f) => !matchesOwnedPath(f, spec.ownedPaths));
  if (drifted.length > 0 && spec.ownedPaths.length > 0) {
    issues.push({
      code: 'OWNED_PATH_DRIFT',
      severity: 'warn',
      file: drifted[0],
      line: 1,
      message: `${drifted.length} modified file(s) fall outside ${wave.id}'s declared Owned paths: ${drifted.slice(0, 5).join(', ')}${drifted.length > 5 ? '…' : ''}.`,
      fix: `Verify cross-track edits are intentional and permitted by ${wave.file}, or revert unintended changes.`,
    });
  }

  checkContractWiring(cwd, changedFiles, issues);
  checkOwnerGuideAndDevTools(cwd, wave, spec, changedFiles, issues);

  const touchedModels = changedFiles.some((f) => f.startsWith('frontend/render/kitbash/'));
  const touchedParticles = changedFiles.some((f) => f.startsWith('frontend/render/particles/'));

  return {
    spec,
    changedFiles,
    touchedModels,
    touchedParticles,
    issues,
  };
}
