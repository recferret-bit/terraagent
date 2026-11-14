// Minimal synthetic `docs/plan/` fixture for throwaway `/tmp/wave-sandbox-*` git repositories
// when `docs/` has been removed from the main repo under Clean Root (`D-41`).
import { mkdirSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

const ACTIVE_WAVES = [
  {
    id: 'W00',
    slug: 'W00-platform-skeleton',
    title: 'W00 — Platform Skeleton',
    deps: 'None',
    rows: [
      ['W00-01', 'Bootstrap platform skeleton', 'ops', 'S', 'H', '—'],
      ['W00-02', 'Shared contracts generator', 'contract', 'S', 'H', 'W00-01'],
      ['W00-03', 'Wave e2e', 'test', 'S', 'H', 'W00-01, W00-02'],
    ],
  },
  {
    id: 'W01',
    slug: 'W01-landfall',
    title: 'W01 — Landfall',
    deps: 'W00',
    rows: [
      ['W01-01', 'Orbital landfall sequence', 'client', 'S', 'H', 'W00-01'],
      ['W01-02', 'Wave e2e', 'test', 'S', 'H', 'W01-01'],
    ],
  },
  {
    id: 'W02',
    slug: 'W02-first-light',
    title: 'W02 — First Light',
    deps: 'W01',
    rows: [
      ['W02-01', 'Solar & harvester loop', 'sim', 'S', 'H', 'W01-01'],
      ['W02-02', 'Wave e2e', 'test', 'S', 'H', 'W02-01'],
    ],
  },
  {
    id: 'W03',
    slug: 'W03-surface-and-build',
    title: 'W03 — Surface & Build',
    deps: 'W02',
    rows: [
      ['W03-01', 'Surface placement & build ghost', 'sim', 'S', 'H', 'W02-01'],
      ['W03-02', 'Wave e2e', 'test', 'S', 'H', 'W03-01'],
    ],
  },
  {
    id: 'W07',
    slug: 'W07-first-contact',
    title: 'W07 — First Contact',
    deps: 'W03',
    rows: [
      ['W07-01', 'Hive fauna & battle v1', 'sim', 'M', 'H', 'W03-01'],
      ['W07-02', 'Wave e2e', 'test', 'S', 'H', 'W07-01'],
    ],
  },
  {
    id: 'W23',
    slug: 'W23-real-near',
    title: 'W23 — Real NEAR Switch',
    deps: 'W00',
    rows: [
      ['W23-01', 'Switchable `NEAR_MODE=mock\\|testnet\\|devnet\\|mainnet` matrix', 'server', 'S', 'H', 'W00-01'],
      ['W23-02', 'Wave e2e', 'test', 'S', 'H', 'W23-01'],
    ],
  },
];

const POSTPONED_WAVES = [
  ['W14', 'W14-fortify', 'W14 — Fortify [POSTPONED]', 'W07', 'W07-01'],
  ['W17', 'W17-second-tier', 'W17 — Second Tier [POSTPONED]', 'W07', 'W07-01'],
  ['W19', 'W19-air-and-endgame', 'W19 — Air & Endgame [POSTPONED]', 'W17', 'W17-01'],
  ['W21', 'W21-rocket-and-settlement', 'W21 — Rocket & Settlement [POSTPONED]', 'W07', 'W07-01'],
  ['W24', 'W24-mobile-and-pwa', 'W24 — Mobile & PWA [POSTPONED]', 'W01', 'W01-01'],
  ['W27', 'W27-planet-streaming', 'W27 — Planet Streaming [POSTPONED]', 'W03', 'W03-01'],
];

function renderWaveDoc({ id, title, deps, rows }) {
  const num = id.slice(1);
  return [
    `# ${title}`,
    '',
    `> **Flag:** \`${id}\` · **Scenario:** \`tests/scenarios/w${num}.ts\` · **Tag:** \`wave-${num}\` · **Depends on:** ${deps}`,
    '',
    '## Demo story',
    `1. Open \`/play.html?scenario=w${num}\` → verify ${id} flow.`,
    '',
    '## Issues',
    '| ID | Title | Type | Size | H | Deps | Acceptance | Spec | Replaces |',
    '|---|---|---|---|---|---|---|---|---|',
    ...rows.map(([iid, t, type, size, tag, d]) => `| ${iid} | ${t} | ${type} | ${size} | ${tag} | ${d} | Verify ${iid} | — | — |`),
    '',
  ].join('\n');
}

export function seedSandboxPlan(root) {
  const wavesDir = join(root, 'docs', 'plan', 'waves');
  mkdirSync(wavesDir, { recursive: true });
  writeFileSync(join(root, 'docs', 'plan', 'PRODUCT_WAVES.md'), '# Product Waves\n\nSandbox wave plan fixture.\n', 'utf8');

  for (const w of ACTIVE_WAVES) {
    writeFileSync(join(wavesDir, `${w.slug}.md`), renderWaveDoc(w), 'utf8');
  }
  for (const [id, slug, title, deps, baseDep] of POSTPONED_WAVES) {
    const doc = renderWaveDoc({
      id,
      title,
      deps,
      rows: [
        [`${id}-01`, `${id} deferred scope`, 'sim', 'S', '', baseDep],
        [`${id}-02`, 'Wave e2e', 'test', 'S', '', `${id}-01`],
      ],
    });
    writeFileSync(join(wavesDir, `${slug}.md`), doc, 'utf8');
  }

  const idx = spawnSync('python3', ['scripts/plan/index_waves.py', '--write'], { cwd: root, encoding: 'utf8' });
  if (idx.status !== 0) {
    throw new Error(`sandbox index_waves.py failed: ${idx.stderr || idx.stdout}`);
  }
}
