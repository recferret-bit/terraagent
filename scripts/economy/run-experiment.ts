// `npx tsx scripts/economy/run-experiment.ts --manifest m.json --out dir [--profile p.json] [--scenario id] [--seed n]`
// Headless integrated experiment runner (W13-44, ECONOMY §6). Exit codes: 0 pass, 2 invalid input, 3 failed gates,
// 4 execution failure or budget exhausted (`incomplete`, never a pass). Diagnostics on stderr, one JSON line on stdout.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseExperimentManifest, parseWaves, type ExperimentManifest } from '@terra/contracts';
import {
  buildSummary, ExperimentInputError, hashJson, metricsCsv, metricsJsonl, replayText, resolveScenarios, runExperiment, tryCompileProfile, canonical,
  type CompiledProfile,
} from '@terra/sim';
import { loadExperimentScenarios } from '../../tests/economy/scenarios';

interface Args { manifest: string; out: string; profile?: string; scenario?: string; seed?: number }

const USAGE = 'usage: run-experiment.ts --manifest <file.json> --out <dir> [--profile <profile.json>] [--scenario <id>] [--seed <n>]';

function fail(code: number, kind: string, message: string): never {
  process.stderr.write(`${JSON.stringify({ error: kind, message })}\n`);
  process.exit(code);
}

function parseArgs(argv: string[]): Args {
  const get = (name: string): string | undefined => {
    const i = argv.indexOf(`--${name}`);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const manifest = get('manifest');
  const out = get('out');
  if (!manifest || !out) fail(2, 'usage', USAGE);
  const seed = get('seed');
  if (seed !== undefined && !Number.isInteger(Number(seed))) fail(2, 'usage', '--seed must be an integer');
  return { manifest, out, profile: get('profile'), scenario: get('scenario'), ...(seed !== undefined ? { seed: Number(seed) } : {}) };
}

const readJson = (path: string, what: string): unknown => {
  try { return JSON.parse(readFileSync(path, 'utf8')); } catch (e) { return fail(2, 'unreadable_input', `${what} ${path}: ${(e as Error).message}`); }
};

function engineCommit(manifest: ExperimentManifest): { commit: string; pinned: boolean } {
  const pinned = /^[0-9a-f]{7,40}$/i.test(manifest.engineCommit);
  if (!pinned) return { commit: manifest.engineCommit, pinned: false };
  const head = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  if (!head.startsWith(manifest.engineCommit.toLowerCase())) fail(2, 'engine_mismatch', `manifest pins engine ${manifest.engineCommit} but the checkout is ${head}`);
  return { commit: head, pinned: true };
}

function compileFor(manifest: ExperimentManifest, profilePath: string | undefined): CompiledProfile {
  const content = profilePath ? (readJson(profilePath, 'profile') as { parameters?: Record<string, never> }) : { parameters: {} };
  const compiled = tryCompileProfile(content, parseWaves(manifest.waves).list);
  if (!compiled.ok) return fail(2, 'invalid_profile', JSON.stringify(compiled.errors));
  return compiled.compiled;
}

/** The manifest of an output directory is immutable: a different manifest never overwrites it. */
function writeArtifacts(out: string, manifest: ExperimentManifest, files: Record<string, string>): void {
  mkdirSync(out, { recursive: true });
  const manifestFile = join(out, 'manifest.json');
  if (existsSync(manifestFile) && canonical(JSON.parse(readFileSync(manifestFile, 'utf8'))) !== canonical(manifest)) {
    fail(2, 'manifest_immutable', `${manifestFile} holds a different manifest; use a fresh --out directory`);
  }
  writeFileSync(manifestFile, `${JSON.stringify(manifest, null, 2)}\n`);
  for (const [name, text] of Object.entries(files)) writeFileSync(join(out, name), text);
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  const parsed = parseExperimentManifest(readJson(args.manifest, 'manifest'));
  if (!parsed.ok) fail(2, 'invalid_manifest', JSON.stringify(parsed.errors));
  const manifest = parsed.value;
  const engine = engineCommit(manifest);
  if (!engine.pinned) process.stderr.write(`warning: engineCommit "${manifest.engineCommit}" is not a git sha; the run is not engine-pinned\n`);
  const compiled = compileFor(manifest, args.profile);
  const started = Date.now();
  try {
    const scenarios = resolveScenarios(manifest, loadExperimentScenarios());
    const result = runExperiment(manifest, scenarios, compiled, {
      shouldStop: () => Date.now() - started > manifest.budget.maxWallSeconds * 1000,
      replay: { manifestPath: args.manifest, ...(args.profile ? { profilePath: args.profile } : {}), outDir: args.out },
    }, { ...(args.scenario ? { scenarioId: args.scenario } : {}), ...(args.seed !== undefined ? { seed: args.seed } : {}) });
    const wallSeconds = (Date.now() - started) / 1000;
    const environment = { node: process.version, wallSeconds, ticksPerSecondActual: Number((result.runs.reduce((a, r) => a + r.run.summary.ticks, 0) / Math.max(wallSeconds, 1e-9)).toFixed(1)) };
    writeArtifacts(resolve(args.out), manifest, {
      'summary.json': `${JSON.stringify(buildSummary(result, { manifest, engine, environment }), null, 2)}\n`,
      'metrics.jsonl': metricsJsonl(result),
      'metrics.csv': metricsCsv(result),
      'replay.txt': replayText(result),
    });
    if (result.failing.length > 0) process.stderr.write(`failing seeds, replay with:\n${replayText(result)}`);
    process.stdout.write(`${JSON.stringify({ status: result.status, outcome: result.outcome, runs: result.runs.length, plannedRuns: result.plannedRuns, failing: result.failing.length, out: resolve(args.out), manifestHash: hashJson(manifest) })}\n`);
    process.exit(result.outcome === 'pass' ? 0 : result.outcome === 'fail' ? 3 : 4);
  } catch (e) {
    if (e instanceof ExperimentInputError) fail(2, e.code, e.message);
    fail(4, 'execution_failure', e instanceof Error ? (e.stack ?? e.message) : String(e));
  }
}

main();
