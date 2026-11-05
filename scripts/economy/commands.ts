import { createHash, randomUUID } from 'node:crypto';
import { ECONOMY_EXIT_CODES, type EconomyExitCode } from '@terra/contracts';
import { api, CliError, type ApiContext } from './api-client';
import { need, parseRef, type Parsed } from './args';

/** File and stdin access, injected so tests need no real files. */
export interface CliIo {
  readFile(path: string): string;
  writeFile(path: string, text: string): void;
  readStdin(): string;
}
export interface CliResult { readonly code: EconomyExitCode; readonly out: unknown }
type Handler = (p: Parsed, ctx: ApiContext, io: CliIo) => Promise<CliResult>;

const ok = (out: unknown): CliResult => ({ code: ECONOMY_EXIT_CODES.ok, out });
const requestId = (p: Parsed, seed?: string): string => p.flags.get('request-id') ?? (seed ? `cli-${createHash('sha256').update(seed).digest('hex').slice(0, 24)}` : `cli-${randomUUID()}`);
const vp = (id: string, v: number): string => `/profiles/${encodeURIComponent(id)}/versions/${v}`;

function readJson(p: Parsed, flag: string, io: CliIo): unknown {
  const src = need(p, flag);
  try { return JSON.parse(src === '-' ? io.readStdin() : io.readFile(src)); } catch (e) {
    throw new CliError(ECONOMY_EXIT_CODES.invalidInput, 'unreadable_input', `--${flag} ${src}: ${e instanceof Error ? e.message : String(e)}`);
  }
}

const schema: Handler = async (_p, ctx) => ok(await api(ctx, 'GET', '/schema'));

const profileExport: Handler = async (p, ctx, io) => {
  const ref = parseRef(need(p, 'id'), p.flags.get('version'));
  const data = (await api(ctx, 'GET', `${vp(ref.id, ref.version)}/export`)) as { ref: unknown };
  const out = p.flags.get('out');
  if (out) io.writeFile(out, `${JSON.stringify(data, null, 2)}\n`);
  return ok(out ? { ref: data.ref, out } : data);
};

/** `--name` is the clone's rationale: the API clones within a profile (a new DRAFT version), it does not create a profile. */
const profileClone: Handler = async (p, ctx) => {
  const from = parseRef(need(p, 'from'));
  const name = p.flags.get('name');
  return ok(await api(ctx, 'POST', `${vp(from.id, from.version)}/clone`, { role: 'edit', body: { requestId: requestId(p), ...(name ? { rationale: name } : {}) } }));
};

/** The patch file needs only `ops`; `schemaVersion`, `requestId` and `expectedVersion` are filled in (the draft's current revision). */
const profilePatch: Handler = async (p, ctx, io) => {
  const ref = parseRef(need(p, 'id'), p.flags.get('version'));
  const raw = readJson(p, 'file', io) as Record<string, unknown>;
  let expected = raw.expectedVersion;
  if (expected === undefined) expected = ((await api(ctx, 'GET', vp(ref.id, ref.version))) as { revision: number }).revision;
  const body = { schemaVersion: 1, requestId: requestId(p, JSON.stringify(raw)), ...raw, expectedVersion: expected };
  return ok(await api(ctx, 'PATCH', vp(ref.id, ref.version), { role: 'edit', body }));
};

const profileResolve: Handler = async (p, ctx) => ok(await api(ctx, 'GET', '/resolve', {
  query: { planetId: p.flags.get('planet'), sectorId: p.flags.get('sector'), planetType: p.flags.get('planet-type'), sectorArchetype: p.flags.get('sector-archetype') },
}));

/** Invalid content is exit 2 (errors); a clean draft becomes VALIDATED. */
const validate: Handler = async (p, ctx) => {
  const ref = parseRef(need(p, 'profile'), p.flags.get('version'));
  const res = (await api(ctx, 'POST', `${vp(ref.id, ref.version)}/validate`, { role: 'edit', body: { requestId: requestId(p) } })) as { valid: boolean };
  return { code: res.valid ? ECONOMY_EXIT_CODES.ok : ECONOMY_EXIT_CODES.invalidInput, out: res };
};

/** Submit only: answers an id, never a completion. The default requestId is the manifest hash, so a re-run is idempotent. */
const simulate: Handler = async (p, ctx, io) => {
  const manifest = readJson(p, 'manifest', io);
  return ok(await api(ctx, 'POST', '/experiments', { role: 'edit', body: { requestId: requestId(p, JSON.stringify(manifest)), manifest } }));
};

const TERMINAL_FAIL = new Set(['failed', 'incomplete']);
/** 0 for queued/running/cancelled/completed-pass, 3 for completed with failing gates, 4 for failed or incomplete. */
const expStatus: Handler = async (p, ctx) => {
  const st = (await api(ctx, 'GET', `/experiments/${encodeURIComponent(need(p, 'id'))}`)) as { status: string; progress?: { outcome?: string } };
  const code = TERMINAL_FAIL.has(st.status) ? ECONOMY_EXIT_CODES.executionFailure : st.status === 'completed' && st.progress?.outcome === 'fail' ? ECONOMY_EXIT_CODES.failedGates : ECONOMY_EXIT_CODES.ok;
  return { code, out: st };
};
const expCancel: Handler = async (p, ctx) => ok(await api(ctx, 'POST', `/experiments/${encodeURIComponent(need(p, 'id'))}/cancel`, { role: 'edit', body: {} }));
const expResume: Handler = async (p, ctx) => ok(await api(ctx, 'POST', `/experiments/${encodeURIComponent(need(p, 'id'))}/resume`, { role: 'edit', body: {} }));
const expList: Handler = async (_p, ctx) => ok(await api(ctx, 'GET', '/experiments'));
const expArtifact: Handler = async (p, ctx) => ok(await api(ctx, 'GET', `/experiments/${encodeURIComponent(need(p, 'id'))}/artifacts/${encodeURIComponent(need(p, 'name'))}`));

/** Exit 3 when the candidate regresses a gate that passed on the baseline, 2 when the experiments cannot be paired. */
const sensitivityOf = (p: Parsed, io: CliIo): { sensitivity?: unknown } => (p.flags.get('sensitivity') ? { sensitivity: readJson(p, 'sensitivity', io) } : {});

const compare: Handler = async (p, ctx, io) => {
  const res = (await api(ctx, 'POST', '/comparisons', { role: 'edit', body: { baselineId: need(p, 'baseline'), candidateId: need(p, 'candidate'), ...sensitivityOf(p, io) } })) as { ok: boolean; verdict: string };
  return { code: !res.ok ? ECONOMY_EXIT_CODES.invalidInput : res.verdict === 'regression' ? ECONOMY_EXIT_CODES.failedGates : ECONOMY_EXIT_CODES.ok, out: res };
};
const recommend: Handler = async (p, ctx, io) => ok(await api(ctx, 'POST', '/recommendations', { role: 'edit', body: { experimentId: need(p, 'experiment'), ...(p.flags.get('baseline') ? { baselineId: p.flags.get('baseline') } : {}), ...sensitivityOf(p, io) } }));

/** Operator only: uses the activate token. The AI's edit token gets 403, which is exit 2. */
const activate: Handler = async (p, ctx) => {
  const version = parseRef(need(p, 'version'));
  const prev = need(p, 'expected-previous');
  return ok(await api(ctx, 'POST', '/activations', {
    role: 'activate',
    body: {
      requestId: requestId(p), versionId: `${version.id}@${version.version}`, expectedPreviousVersionId: prev === 'none' ? null : prev.replace(':', '@'),
      ...(p.flags.get('scope') ? { scope: p.flags.get('scope') } : {}), effectiveTick: Number(p.flags.get('effective-tick') ?? 0),
      ...(p.flags.get('evidence-run') ? { evidenceRunId: p.flags.get('evidence-run') } : {}), ...(p.flags.get('non-production') ? { nonProduction: true } : {}),
    },
  }));
};
const rollback: Handler = async (p, ctx) => ok(await api(ctx, 'POST', `/activations/${encodeURIComponent(need(p, 'id'))}/rollback`, { role: 'activate', body: { requestId: requestId(p), effectiveTick: Number(p.flags.get('effective-tick') ?? 0) } }));

/** Command words to handler, exactly the ECONOMY §6 list plus `experiment list|resume|artifact`. */
export const COMMANDS: Readonly<Record<string, Handler>> = {
  schema, 'profile export': profileExport, 'profile clone': profileClone, 'profile patch': profilePatch, 'profile resolve': profileResolve, validate,
  simulate, 'experiment status': expStatus, 'experiment cancel': expCancel, 'experiment resume': expResume, 'experiment list': expList, 'experiment artifact': expArtifact,
  compare, recommend, activate, rollback,
};
