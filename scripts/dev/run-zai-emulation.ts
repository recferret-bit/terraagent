import { CASES, loadTestEnv, runEmulationCase } from './zai-emulation';

function formatRow(cols: string[], widths: number[]): string {
  return cols.map((col, i) => col.padEnd(widths[i] ?? 10)).join(' │ ');
}

async function main() {
  const env = loadTestEnv();
  const model = env.NEAR_AI_MODEL || env.NEARAI_MODEL || env.AI_MODEL || 'z-ai/glm-5.3';

  console.log('\n========================================================================================');
  console.log(`🤖 TerraAgent NEAR.AI Strategic Director Emulation — 10 Decision Benchmark (${model})`);
  console.log('========================================================================================\n');

  const results = [];
  let totalPromptTokens = 0;
  let totalCompTokens = 0;
  let totalReasoningTokens = 0;

  for (let i = 0; i < CASES.length; i++) {
    const c = CASES[i]!;
    process.stdout.write(`[${i + 1}/10] Evaluating: ${c.title}... `);
    const res = await runEmulationCase(c, env);
    results.push({ case: c, ...res });

    totalPromptTokens += res.tokens.prompt;
    totalCompTokens += res.tokens.completion;
    totalReasoningTokens += res.tokens.reasoning ?? 0;

    if (res.passed) {
      console.log(`\x1b[32m✔ PASS\x1b[0m (${res.latencyMs}ms, ${res.tokens.completion} tokens)`);
    } else {
      console.log(`\x1b[31m✖ FAIL\x1b[0m (${res.error ?? 'validation failed'})`);
    }

    if (res.decision) {
      const coordStr = res.decision.coordinates ? ` @ (${res.decision.coordinates.q}, ${res.decision.coordinates.r})` : '';
      const weightStr = res.decision.harvestWeights
        ? ` [M:${res.decision.harvestWeights.metals}% Min:${res.decision.harvestWeights.minerals}% Bio:${res.decision.harvestWeights.bio}%]`
        : '';
      console.log(`      ↳ Action: \x1b[36m${res.decision.actionKind}\x1b[0m [${res.decision.category}] → \x1b[33m${res.decision.target}\x1b[0m${coordStr}${weightStr}`);
      console.log(`      ↳ Rationale: "${res.decision.rationale.slice(0, 110)}..."\n`);
    }
  }

  // Summary Table
  console.log('\n' + '='.repeat(106));
  console.log('BENCHMARK SUMMARY & PERFORMANCE REPORT');
  console.log('='.repeat(106));

  const widths = [4, 34, 18, 16, 9, 8, 6];
  const headers = ['#', 'Case Title', 'Decision Action', 'Target', 'Latency', 'Tokens', 'Status'];
  console.log(formatRow(headers, widths));
  console.log('─'.repeat(106));

  for (let i = 0; i < results.length; i++) {
    const r = results[i]!;
    const row = [
      String(i + 1),
      r.case.title.slice(0, 34),
      r.decision ? r.decision.actionKind : 'N/A',
      r.decision ? r.decision.target.slice(0, 16) : 'N/A',
      `${r.latencyMs}ms`,
      String(r.tokens.completion),
      r.passed ? 'PASS' : 'FAIL',
    ];
    console.log(formatRow(row, widths));
  }

  console.log('─'.repeat(106));
  const passedCount = results.filter((r) => r.passed).length;
  const avgLatency = Math.round(results.reduce((s, r) => s + r.latencyMs, 0) / results.length);

  console.log(`Results: ${passedCount}/10 passed (${Math.round((passedCount / 10) * 100)}% accuracy)`);
  console.log(`Latency: Average ${avgLatency}ms | Total execution time: ${results.reduce((s, r) => s + r.latencyMs, 0)}ms`);
  console.log(`Tokens: Prompt: ${totalPromptTokens} | Output: ${totalCompTokens} (Reasoning tokens: ${totalReasoningTokens})`);
  console.log('='.repeat(106) + '\n');
}

main().catch((err) => {
  console.error('Fatal error running emulation:', err);
  process.exit(1);
});
