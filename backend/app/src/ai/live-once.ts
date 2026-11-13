import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseEnv } from 'node:util';
import { DEFAULT_NEAR_AI_MODEL, NearAiLlmAdapter, normalizeNearAiModel } from './adapters/nearai-llm.adapter.js';

export interface LiveReport {
  readonly ok: boolean;
  readonly model: string;
  readonly latencyMs: number;
  readonly inputTokens: number | null;
  readonly outputTokens: number | null;
  readonly error: string | null;
}

function loadEnv(path: string): Record<string, string | undefined> {
  return parseEnv(readFileSync(path, 'utf8'));
}

function redactAll(text: string, secrets: readonly (string | undefined)[]): string {
  let out = text;
  for (const s of secrets) if (s) out = out.split(s).join('[redacted]');
  return out;
}

/** One live completion via NEAR AI Cloud (`z-ai/glm-5.3`). The report never includes the API key. */
export async function liveOnce(env: Record<string, string | undefined>): Promise<LiveReport> {
  const started = Date.now();
  const model = normalizeNearAiModel(env.NEAR_AI_MODEL || env.NEARAI_MODEL || env.AI_MODEL || DEFAULT_NEAR_AI_MODEL);
  try {
    const adapter = new NearAiLlmAdapter();
    const result = await adapter.complete(
      { system: 'Reply with the single word pong.', messages: [{ role: 'user', content: 'ping' }], maxTokens: 64, model },
      env,
    );
    return {
      ok: true,
      model: result.model,
      latencyMs: Date.now() - started,
      inputTokens: result.usage.inputTokens,
      outputTokens: result.usage.outputTokens,
      error: null,
    };
  } catch (error) {
    const name = error instanceof Error ? error.name : 'Error';
    return {
      ok: false,
      model,
      latencyMs: Date.now() - started,
      inputTokens: null,
      outputTokens: null,
      error: redactAll(name, [env.NEAR_AI_API_KEY, env.NEARAI_API_KEY, env.NEARAI_CLOUD_API_KEY]),
    };
  }
}

export function reportMarkdown(report: LiveReport): string {
  return [
    '# W16 live provider report',
    '',
    `- ok: ${report.ok}`,
    `- model: ${report.model}`,
    `- latencyMs: ${report.latencyMs}`,
    `- inputTokens: ${report.inputTokens ?? 'n/a'}`,
    `- outputTokens: ${report.outputTokens ?? 'n/a'}`,
    `- error: ${report.error ?? 'none'}`,
    '',
    'The API key is not in this file. Prompt and response text are omitted.',
    '',
  ].join('\n');
}

const envPath = process.argv[2];
const isMain = process.argv[1]?.includes('live-once');
if (isMain && envPath) {
  const env = loadEnv(envPath);
  const report = await liveOnce(env);
  const markdown = reportMarkdown(report);
  writeFileSync(resolve(process.cwd(), 'docs/plan/w16-live-report.md'), markdown);
  process.stdout.write(`${JSON.stringify({ ok: report.ok, model: report.model, latencyMs: report.latencyMs, inputTokens: report.inputTokens, outputTokens: report.outputTokens, error: report.error })}\n`);
}
