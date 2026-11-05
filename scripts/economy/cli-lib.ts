import { ECONOMY_EXIT_CODES } from '@terra/contracts';
import { CliError, type ApiContext } from './api-client';
import { parseArgs } from './args';
import { COMMANDS, type CliIo, type CliResult } from './commands';

const USAGE = `usage: npm run economy -- <command> [flags] --json
  schema | profile export --id <p>:<v> [--out f] | profile clone --from <p>:<v> [--name text] | profile patch --id <p>:<v> --file f|-
  profile resolve [--planet id] [--sector id] [--planet-type t] [--sector-archetype a] | validate --profile <p>:<v>
  simulate --manifest f|- | experiment status|cancel|resume|list|artifact --id <exp> [--name file]
  compare --baseline <exp> --candidate <exp> | recommend --experiment <exp> [--baseline <exp>]
  activate --version <p>:<v> --expected-previous <p>:<v>|none [--effective-tick n] [--evidence-run id] [--non-production] | rollback --id <activation>
exit codes: 0 ok, 2 invalid input / no permission, 3 failed gates, 4 execution failure`;

/** Runs one CLI invocation: never throws; always returns the exit code and the structured stdout document. */
export async function runCli(argv: readonly string[], ctx: ApiContext, io: CliIo): Promise<CliResult & { readonly diagnostics?: string }> {
  try {
    const p = parseArgs(argv);
    const words = p.words.join(' ');
    const handler = COMMANDS[words];
    if (!handler) throw new CliError(ECONOMY_EXIT_CODES.invalidInput, 'usage', `unknown command "${words}"\n${USAGE}`);
    return await handler(p, ctx, io);
  } catch (e) {
    if (e instanceof CliError) return { code: e.exitCode, out: { ok: false, error: { kind: e.kind, message: e.message, ...(e.details === undefined ? {} : { details: e.details }) } }, diagnostics: `${e.kind}: ${e.message}` };
    const msg = e instanceof Error ? e.message : String(e);
    return { code: ECONOMY_EXIT_CODES.executionFailure, out: { ok: false, error: { kind: 'execution_failure', message: msg } }, diagnostics: msg };
  }
}
