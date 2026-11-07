#!/usr/bin/env node
// Standalone CLI harness for `.agents/skills/wave-land-and-sync`:
//   node .agents/skills/wave-land-and-sync/scripts/wave-harness.mjs land <NN> [--iterations 3] [--e2e] [--require-plan-sync] [--dry-run]
//   node .agents/skills/wave-land-and-sync/scripts/wave-harness.mjs sync <NN|--all> [--iterations 3] [--sync-issues] [--e2e] [--dry-run]
//   node .agents/skills/wave-land-and-sync/scripts/wave-harness.mjs audit <NN> [--sync] [--json]
//   node .agents/skills/wave-land-and-sync/scripts/wave-harness.mjs propagate <NN> [--json] [--add-issue <WMM> --title "..." ...]
import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
const waveScript = resolve(root, 'scripts/wave/wave.mjs');
const args = process.argv.slice(2);

if (args.length === 0 || args.includes('--help') || args.includes('-h')) {
  console.log(`wave-land-and-sync harness
Usage:
  wave-harness.mjs land <NN> [--iterations 3] [--e2e] [--require-plan-sync] [--dry-run]
  wave-harness.mjs sync <NN|--all> [--iterations 3] [--sync-issues] [--e2e] [--dry-run]
  wave-harness.mjs audit <NN> [--sync] [--json]
  wave-harness.mjs propagate <NN> [--json] [--add-issue <WMM> --title "<title>" --type <type> --size <S|M> --tag <H|H+|-> --deps "<deps>" --accept "<do X -> see Y>"]
  wave-harness.mjs status`);
  process.exit(0);
}

const r = spawnSync(process.execPath, [waveScript, ...args], { cwd: root, stdio: 'inherit' });
process.exit(r.status ?? 1);
