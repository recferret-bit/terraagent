#!/usr/bin/env node
// Runs `npm run build` and fails on any build warning except Vite's chunk-size notice (W00 DoD: "warning-free").
import { spawnSync } from 'node:child_process';

const r = spawnSync('npm', ['run', 'build'], { encoding: 'utf8', shell: process.platform === 'win32' });
const out = `${r.stdout}\n${r.stderr}`;
process.stdout.write(out);
if (r.status !== 0) process.exit(r.status ?? 1);
const warnings = out.split('\n').filter((l) => /\(!\)|\bwarn(ing)?\b/i.test(l) && !/chunks are larger|chunkSizeWarningLimit|manualChunks|dynamic import\(\)/i.test(l));
if (warnings.length) {
  console.error(`\nbuild produced ${warnings.length} warning line(s):\n  ${warnings.join('\n  ')}`);
  process.exit(1);
}
console.log('build ok: no warnings apart from chunk size');
