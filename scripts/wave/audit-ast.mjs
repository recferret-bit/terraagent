// Static AST, duplication, clean-architecture (orchestrator/service split), and hygiene checks for wave validation.
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import ts from 'typescript';

export const AST_LIMITS = Object.freeze({
  maxFileLines: 500,
  warnFileLines: 440,
  maxFuncLines: 100,
  warnFuncLines: 80,
  warnNesting: 4,
  minCloneTokens: 55,
  minCloneLines: 7,
  minBlockLines: 10,
});

const FUNC_KINDS = new Set([
  ts.SyntaxKind.FunctionDeclaration,
  ts.SyntaxKind.FunctionExpression,
  ts.SyntaxKind.ArrowFunction,
  ts.SyntaxKind.MethodDeclaration,
  ts.SyntaxKind.GetAccessor,
  ts.SyntaxKind.SetAccessor,
  ts.SyntaxKind.Constructor,
]);

const CONTROL_KINDS = new Set([
  ts.SyntaxKind.IfStatement,
  ts.SyntaxKind.ForStatement,
  ts.SyntaxKind.ForInStatement,
  ts.SyntaxKind.ForOfStatement,
  ts.SyntaxKind.WhileStatement,
  ts.SyntaxKind.DoStatement,
  ts.SyntaxKind.SwitchStatement,
  ts.SyntaxKind.TryStatement,
]);

const DELEGATE_PATH_RE = /\/(parts|services|stages|panels|sections|handlers|helpers|checks|adapters|ports|systems|subsystems)\//;
const SECRET_RES = [
  /-----BEGIN (?:RSA |EC |OPENSSH |PRIVATE )?PRIVATE KEY-----/,
  /\bsk-(?:live|proj)-[A-Za-z0-9_-]{24,}\b/,
  /\bghp_[A-Za-z0-9]{36}\b/,
];

const isTestOrFixture = (rel) => /\.(spec|test|fixture)\.[cm]?[jt]s$|^tests\/|\/test\/|\/__tests__\//.test(rel);
const isDataOrGen = (rel) => /\/data\/|\/generated\/|\.d\.ts$|^docs\//.test(rel);
const lineAt = (sf, pos) => sf.getLineAndCharacterOfPosition(pos).line + 1;

function fnName(node, sf) {
  if (node.name) return node.name.getText(sf);
  if (node.kind === ts.SyntaxKind.Constructor) return 'constructor';
  const p = node.parent;
  if (ts.isVariableDeclaration(p) || ts.isPropertyAssignment(p) || ts.isPropertyDeclaration(p)) return p.name.getText(sf);
  return '(anonymous)';
}

function collectTokensAndNesting(fnNode, sf) {
  const body = fnNode.body;
  if (!body) return { tokens: 0, fingerprint: '', maxNesting: 0 };
  const parts = [];
  let maxNesting = 0;
  const visit = (node, depth) => {
    if (node !== fnNode && FUNC_KINDS.has(node.kind)) return;
    const nextDepth = depth + (CONTROL_KINDS.has(node.kind) ? 1 : 0);
    if (nextDepth > maxNesting) maxNesting = nextDepth;
    const children = node.getChildren(sf);
    if (children.length > 0) {
      for (const c of children) visit(c, nextDepth);
      return;
    }
    if (node.kind <= ts.SyntaxKind.LastTriviaToken || node.kind === ts.SyntaxKind.EndOfFileToken) return;
    // Normalize identifiers to catch copy-pasted functions with renamed local variables
    const text = ts.isIdentifier(node) ? '$id' : node.getText(sf);
    parts.push(`${node.kind}:${text}`);
  };
  visit(body, 0);
  const fingerprint = parts.length ? createHash('sha1').update(parts.join('\0')).digest('hex').slice(0, 16) : '';
  return { tokens: parts.length, fingerprint, maxNesting };
}

function checkCatchAndAny(sf, rel, text, issues) {
  if (isTestOrFixture(rel)) return;
  const checkAny = /^(shared\/(contracts|sim|ledger)\/|backend\/app\/src\/)/.test(rel);
  const visit = (node) => {
    if (ts.isCatchClause(node) && node.block.statements.length === 0) {
      const raw = text.slice(node.block.getStart(sf), node.block.end);
      if (!/\/[/*]/.test(raw)) {
        issues.push({
          code: 'SWALLOWED_ERROR',
          severity: 'warn',
          file: rel,
          line: lineAt(sf, node.getStart(sf)),
          message: 'Empty `catch {}` block swallows error without logging, rethrowing, or explaining why.',
          fix: 'Rethrow, return a typed error/reject result, log with context, or document why ignoring is safe.',
        });
      }
    }
    if (checkAny && node.kind === ts.SyntaxKind.AnyKeyword) {
      issues.push({
        code: 'UNVALIDATED_BOUNDARY_ANY',
        severity: 'warn',
        file: rel,
        line: lineAt(sf, node.getStart(sf)),
        message: 'Explicit `any` in shared contract/sim or backend module bypasses boundary validation.',
        fix: 'Use a concrete interface, generic parameter, or `unknown` narrowed by a Zod schema.',
      });
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
}

function checkImportsAndOrchestration(sf, rel, lineCount, fnCount, maxClassMethods, issues) {
  if (isTestOrFixture(rel) || isDataOrGen(rel)) return;
  let delegateImports = 0;
  const featMatch = /^frontend\/game\/features\/([^/]+)\//.exec(rel);
  const visit = (node) => {
    const spec = (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) ? node.moduleSpecifier : null;
    if (spec && ts.isStringLiteral(spec)) {
      const target = spec.text;
      if (DELEGATE_PATH_RE.test(target) || /^\.\.?\/(parts|services|stages|panels|sections|handlers)\b/.test(target)) {
        delegateImports++;
      }
      if (featMatch && target.startsWith('.')) {
        const resolved = relative(process.cwd(), resolve(dirname(rel), target)).replace(/\\/g, '/');
        const other = /^frontend\/game\/features\/([^/]+)(?:\/|$)/.exec(resolved);
        if (other && other[1] !== featMatch[1] && other[1] !== 'shared') {
          issues.push({
            code: 'FEATURE_CROSS_IMPORT',
            severity: 'warn',
            file: rel,
            line: lineAt(sf, spec.getStart(sf)),
            message: `Client feature '${featMatch[1]}' directly imports sibling feature '${other[1]}' ('${target}').`,
            fix: 'Move shared client state/types to `frontend/game/core/`, `frontend/game/features/shared/`, or `shared/*`; features plug into registries independently.',
          });
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);

  const isProdLogic = /^(frontend\/(game|render|landing|playground)|backend\/app\/src|shared\/sim\/src)\//.test(rel);
  if (isProdLogic && ((lineCount > 360 && fnCount >= 12 && delegateImports === 0) || (maxClassMethods >= 10 && lineCount > 300 && delegateImports === 0))) {
    issues.push({
      code: 'GOD_ORCHESTRATOR',
      severity: 'warn',
      file: rel,
      line: 1,
      message: `Large module (${lineCount} lines, ${fnCount} functions, max ${maxClassMethods} class methods) mixes orchestration and implementation without delegating to services/parts.`,
      fix: 'Split into a thin orchestrator class/pipeline that wires single-purpose services or `parts/` modules (AGENTS.md §6).',
    });
  }
}

function checkTextHygiene(rel, text, issues) {
  if (isTestOrFixture(rel)) return;
  const lines = text.split('\n');
  const isUiCss = /^frontend\/(game|landing|playground)\/.*\.css$/.test(rel);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/(?:\/\/|\/\*).*\b(?:TODO|FIXME)\b/.test(line) && !/\b(?:W\d{2}-\d{2}|[A-Z]{2,5}-\d{2})\b/.test(line)) {
      issues.push({
        code: 'UNTRACKED_TODO',
        severity: 'warn',
        file: rel,
        line: i + 1,
        message: `Untracked TODO/FIXME comment without a wave issue ID (WNN-XX) or limitation ID: "${line.trim().slice(0, 70)}"`,
        fix: 'Resolve the TODO now, or tag it with its owning issue ID (`WNN-XX`) and record it in `docs/questions-and-limitations/`.',
      });
    }
    if (isUiCss && /#[0-9a-fA-F]{3,8}\b/.test(line) && !line.trim().startsWith('/*')) {
      issues.push({
        code: 'RAW_HEX_UI_TOKEN',
        severity: 'warn',
        file: rel,
        line: i + 1,
        message: `Raw hex colour in UI stylesheet: "${line.trim().slice(0, 60)}"`,
        fix: 'Use Faction Plate `--ta-*` CSS custom properties from `frontend/design/css/tokens.css` (AGENTS.md §4).',
      });
    }
    for (const re of SECRET_RES) {
      if (re.test(line)) {
        issues.push({
          code: 'SECRET_SHAPE',
          severity: 'error',
          file: rel,
          line: i + 1,
          message: 'Potential private key or live credential token detected in source file.',
          fix: 'Remove the secret immediately and read credentials from environment variables only.',
        });
      }
    }
  }
}

function detectBlockClones(fileEntries, issues) {
  const windowSize = AST_LIMITS.minBlockLines;
  const seen = new Map();
  const reported = new Set();
  for (const { rel, text } of fileEntries) {
    if (isTestOrFixture(rel) || isDataOrGen(rel) || !/\.[cm]?[jt]s$/.test(rel)) continue;
    const rawLines = text.split('\n');
    const norm = rawLines.map((l, idx) => ({
      line: idx + 1,
      v: l.replace(/\/\/.*$/, '').trim(),
    })).filter((x) => x.v.length > 12 && !/^(import|export|return\b|\}|interface\b|type\b)/.test(x.v));
    for (let i = 0; i + windowSize <= norm.length; i++) {
      const slice = norm.slice(i, i + windowSize);
      const key = createHash('sha1').update(slice.map((s) => s.v).join('\n')).digest('hex').slice(0, 16);
      const prev = seen.get(key);
      if (prev && prev.rel !== rel) {
        const pairKey = `${[prev.rel, rel].sort().join('::')}:${prev.line}`;
        if (!reported.has(pairKey)) {
          reported.add(pairKey);
          issues.push({
            code: 'DUPLICATE_BLOCK',
            severity: 'warn',
            file: rel,
            line: slice[0].line,
            message: `Normalized ${windowSize}-line code block duplicates ${prev.rel}:${prev.line}.`,
            fix: 'Extract the shared logic into a reusable helper, service, or registry entry (no copy/paste, AGENTS.md §6).',
          });
        }
      } else if (!prev) {
        seen.set(key, { rel, line: slice[0].line });
      }
    }
  }
}

function inspectFunctionsInAst(sf, rel, fnClones, issues) {
  let fnCount = 0;
  let maxClassMethods = 0;
  const visit = (node) => {
    if (ts.isClassDeclaration(node) || ts.isClassExpression(node)) {
      const methods = node.members.filter((m) => FUNC_KINDS.has(m.kind)).length;
      if (methods > maxClassMethods) maxClassMethods = methods;
    }
    if (FUNC_KINDS.has(node.kind) && node.body) {
      fnCount++;
      const start = lineAt(sf, node.getStart(sf));
      const span = lineAt(sf, node.end) - start + 1;
      const name = fnName(node, sf);
      if (span > AST_LIMITS.maxFuncLines) {
        issues.push({
          code: 'FUNC_OVER_LIMIT',
          severity: 'error',
          file: rel,
          line: start,
          message: `Function '${name}' has ${span} lines (hard limit ${AST_LIMITS.maxFuncLines}).`,
          fix: 'Extract helper functions or delegate to a dedicated service/part.',
        });
      } else if (span > AST_LIMITS.warnFuncLines && !isTestOrFixture(rel)) {
        issues.push({
          code: 'FUNC_NEAR_LIMIT',
          severity: 'warn',
          file: rel,
          line: start,
          message: `Function '${name}' has ${span} lines (approaching the ${AST_LIMITS.maxFuncLines}-line limit).`,
          fix: 'Decompose into smaller single-purpose steps.',
        });
      }
      const { tokens, fingerprint, maxNesting } = collectTokensAndNesting(node, sf);
      if (maxNesting > AST_LIMITS.warnNesting && span > 25 && !isTestOrFixture(rel)) {
        issues.push({
          code: 'DEEP_NESTING',
          severity: 'warn',
          file: rel,
          line: start,
          message: `Function '${name}' has control-flow nesting depth ${maxNesting} (>${AST_LIMITS.warnNesting}).`,
          fix: 'Use guard clauses / early returns or extract inner loop/branch handlers.',
        });
      }
      if (tokens >= AST_LIMITS.minCloneTokens && span >= AST_LIMITS.minCloneLines && !isTestOrFixture(rel) && !isDataOrGen(rel)) {
        const list = fnClones.get(fingerprint) ?? [];
        list.push({ file: rel, line: start, name, span, tokens });
        fnClones.set(fingerprint, list);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return { fnCount, maxClassMethods };
}

export function analyzeWaveFiles(cwd, relFiles) {
  const issues = [];
  const fnClones = new Map();
  const fileEntries = [];

  for (const rel of relFiles) {
    const abs = join(cwd, rel);
    if (!existsSync(abs) || !/\.(ts|js|mjs|css|html)$/.test(rel)) continue;
    const text = readFileSync(abs, 'utf8');
    fileEntries.push({ rel, text });
    const lineCount = text.split('\n').length;

    if (lineCount > AST_LIMITS.maxFileLines && !isDataOrGen(rel)) {
      issues.push({
        code: 'FILE_OVER_LIMIT',
        severity: 'error',
        file: rel,
        line: lineCount,
        message: `File has ${lineCount} lines (hard limit ${AST_LIMITS.maxFileLines}).`,
        fix: 'Extract cohesive sub-modules, services, or `parts/` files.',
      });
    } else if (lineCount > AST_LIMITS.warnFileLines && !isTestOrFixture(rel) && !isDataOrGen(rel)) {
      issues.push({
        code: 'FILE_NEAR_LIMIT',
        severity: 'warn',
        file: rel,
        line: lineCount,
        message: `File has ${lineCount} lines (approaching the ${AST_LIMITS.maxFileLines}-line limit).`,
        fix: 'Consider splitting responsibilities across orchestrator and service/part modules before it hits 500 lines.',
      });
    }

    checkTextHygiene(rel, text, issues);
    if (!/\.(ts|js|mjs)$/.test(rel)) continue;

    const sf = ts.createSourceFile(abs, text, ts.ScriptTarget.ES2022, true);
    const { fnCount, maxClassMethods } = inspectFunctionsInAst(sf, rel, fnClones, issues);
    checkCatchAndAny(sf, rel, text, issues);
    checkImportsAndOrchestration(sf, rel, lineCount, fnCount, maxClassMethods, issues);
  }

  for (const group of fnClones.values()) {
    if (group.length < 2) continue;
    const [first, ...rest] = group;
    for (const dup of rest) {
      if (dup.file === first.file && Math.abs(dup.line - first.line) < 5) continue;
      issues.push({
        code: 'DUPLICATE_FUNCTION',
        severity: 'warn',
        file: dup.file,
        line: dup.line,
        message: `Function '${dup.name}' (${dup.span} lines, ${dup.tokens} tokens) is structurally identical to '${first.name}' at ${first.file}:${first.line}.`,
        fix: 'Extract a single shared function/service instead of duplicating logic.',
      });
    }
  }

  detectBlockClones(fileEntries, issues);
  return { filesAnalyzed: fileEntries.length, issues };
}
