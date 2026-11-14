import { makeEl, makeFormattedEl } from './domHelpers';

const SVG_NS = 'http://www.w3.org/2000/svg';

function svgEl<K extends keyof SVGElementTagNameMap>(
  tag: K,
  attrs: Record<string, string>,
  text?: string,
): SVGElementTagNameMap[K] {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  if (text !== undefined) node.textContent = text;
  return node;
}

export function createTrustStackSchema(): HTMLElement {
  const wrap = makeEl('div', 'wp-schema plate wp-reveal');
  const head = makeEl('div', 'wp-schema-head');
  head.append(
    makeEl('span', 'wp-schema-kicker', 'SCHEMA 01 // THREE-LAYER TRUST ARCHITECTURE'),
    makeEl('span', 'badge badge-ok', 'ZERO BLOCKING'),
  );

  const grid = makeEl('div', 'wp-flow-3');
  const layers = [
    {
      step: 'LAYER 1 · CLIENT (60 FPS)',
      title: 'Three.js WebGL2 Diorama',
      accent: 'is-steel',
      truth: 'Zero Authority',
      copy: 'Renders Unifier terrain, instanced debris chunks, GPU robot gaits, and smooth local camera input without trusting client state.',
    },
    {
      step: 'LAYER 2 · SIM SERVER (5 Hz)',
      title: '@terra/sim + PostgreSQL ACID',
      accent: 'is-blue',
      truth: 'Game Physics Truth',
      copy: 'Runs hex physics, grid power shedding, combat, CLOB order matching, and strict daily bot spend locks at 200 ms deterministic ticks.',
    },
    {
      step: 'LAYER 3 · NEAR + NEAR.AI TEE',
      title: '6 Rust Contracts + Attested AI',
      accent: 'is-orange',
      truth: 'Finality & Custody',
      copy: 'Holds NEP-245 orbital cargo, NEP-171 soulbound deeds, 90/10 diplomacy escrows, Day-1 staking principal, and signed AI decisions.',
    },
  ];

  for (const item of layers) {
    const box = makeEl('article', `wp-flow-node plate-sm ${item.accent}`);
    const top = makeEl('div', 'wp-flow-node-top');
    top.append(makeEl('span', 'wp-flow-step', item.step), makeEl('span', 'wp-flow-truth', item.truth));
    box.append(top, makeEl('h4', 'wp-flow-title', item.title), makeFormattedEl('p', 'wp-flow-copy', item.copy));
    grid.appendChild(box);
  }

  wrap.append(head, grid);
  return wrap;
}

export function createCustodyLifecycleSchema(): HTMLElement {
  const wrap = makeEl('div', 'wp-schema is-web3-schema plate wp-reveal');
  const head = makeEl('div', 'wp-schema-head');
  head.append(
    makeEl('span', 'wp-schema-kicker', 'SCHEMA 02 // PROGRESSIVE SELF-CUSTODY LIFECYCLE'),
    makeEl('span', 'badge badge-recruiting', 'NEP-366 GASLESS'),
  );

  const steps = [
    { num: '01 · LAND', title: 'Cold-Root Sub-Account', body: 'Player joins via OAuth or wallet and receives `{pilot}.pilots.terraagent.testnet` immediately.' },
    { num: '02 · PLAY', title: 'Zero-Popup Meta-Txs', body: '`relayer.terraagent.testnet` sponsors `NEP-366` DelegateActions so orders feel like Web2.' },
    { num: '03 · TRADE', title: 'NEP-245 + NEP-413 Clears', body: 'Trade Hub exports mint real orbital tokens cleared in zero-sum `token_diff` swaps.' },
    { num: '04 · CLAIM', title: 'Atomic Key Ownership', body: 'Pilot executes `claimAccount` (`[AddKey, DeleteKey]`) to take 100% full-access key control.' },
  ];

  const row = makeEl('div', 'wp-flow-4');
  for (const s of steps) {
    const card = makeEl('div', 'wp-flow-node plate-sm is-orange');
    card.append(makeEl('span', 'wp-flow-step', s.num), makeEl('h4', 'wp-flow-title', s.title), makeFormattedEl('p', 'wp-flow-copy', s.body));
    row.appendChild(card);
  }

  const example = makeEl('div', 'wp-example-box plate-sm');
  example.append(
    makeEl('span', 'wp-example-label', 'WORKED EXAMPLE // EXPORTING 400 TITANIUM TO NEAR TESTNET'),
  );
  const trace = makeEl('ol', 'wp-example-list');
  const items = [
    'Command Hub reaches 70% Living terrain and smelts `400` Titanium inside `@terra/sim`.',
    'Export click creates an ACID escrow lock and sends `mt_mint` (`400` units of Titanium) on `res.terraagent.testnet` via `relayer.terraagent.testnet`.',
    'Seller lists `400` Titanium on `/trade.html` for `120 USDC`; a `NEP-413` `token_diff` fill delivers `120 USDC` (100% principal) straight to seller.',
    'Whenever desired, `claimAccount` removes the app key on `pilots.terraagent.testnet` so only the player hardware wallet signs withdrawals.',
  ];
  for (const line of items) trace.appendChild(makeFormattedEl('li', undefined, line));
  example.appendChild(trace);

  wrap.append(head, row, example);
  return wrap;
}

function buildCoreConduitSvg(): SVGSVGElement {
  const svg = svgEl('svg', {
    class: 'wp-proto-svg',
    viewBox: '0 0 360 220',
    role: 'img',
    'aria-label': 'Three protocol inflows feeding protocol.terraagent.testnet treasury core to fund gasless relays and NEAR.AI TEE',
  });
  const bgPaths = [
    'M 8 36 C 78 36, 86 92, 132 100',
    'M 8 110 L 132 110',
    'M 8 184 C 78 184, 86 128, 132 120',
    'M 228 102 C 276 102, 286 60, 352 60',
    'M 228 118 C 276 118, 286 160, 352 160',
  ];
  for (const d of bgPaths) svg.appendChild(svgEl('path', { class: 'wp-pipe-bg', d }));

  const activePaths = [
    { stream: 'trade', stroke: 'var(--ta-terra)', d: bgPaths[0]! },
    { stream: 'staking', stroke: 'var(--ta-blue-hi)', d: bgPaths[1]! },
    { stream: 'bonds', stroke: 'var(--ta-orange)', d: bgPaths[2]! },
    { stream: 'all', stroke: 'var(--ta-energy)', d: bgPaths[3]! },
    { stream: 'all', stroke: 'var(--ta-orange-hi)', d: bgPaths[4]! },
  ];
  for (const p of activePaths) {
    const el = svgEl('path', { class: 'wp-pipe-active', stroke: p.stroke, d: p.d });
    el.dataset.stream = p.stream;
    svg.appendChild(el);
  }

  const dots = [
    ['8', '36', 'var(--ta-terra)'],
    ['8', '110', 'var(--ta-blue-hi)'],
    ['8', '184', 'var(--ta-orange)'],
    ['352', '60', 'var(--ta-energy)'],
    ['352', '160', 'var(--ta-orange-hi)'],
  ];
  for (const [cx, cy, fill] of dots) svg.appendChild(svgEl('circle', { cx: cx!, cy: cy!, r: '4', fill: fill! }));

  svg.append(
    svgEl('polygon', { points: '180,48 228,76 228,144 180,172 132,144 132,76', fill: 'var(--ta-black-hole)', stroke: 'var(--ta-orange)', 'stroke-width': '2' }),
    svgEl('polygon', { points: '180,58 219,81 219,139 180,162 141,139 141,81', fill: 'var(--ta-plate-2)', stroke: 'var(--ta-seam-3)', 'stroke-width': '1.2' }),
    svgEl('text', { x: '180', y: '98', 'text-anchor': 'middle', fill: 'var(--ta-energy)', 'font-family': 'var(--ta-font-mono)', 'font-size': '9', 'font-weight': '600', 'letter-spacing': '1.4' }, 'PROTOCOL'),
    svgEl('text', { x: '180', y: '116', 'text-anchor': 'middle', fill: 'var(--ta-text)', 'font-family': 'var(--ta-font-display)', 'font-size': '14', 'font-weight': '700', 'letter-spacing': '1' }, 'TREASURY'),
    svgEl('text', { x: '180', y: '133', 'text-anchor': 'middle', fill: 'var(--ta-steel)', 'font-family': 'var(--ta-font-mono)', 'font-size': '8.5' }, 'ZERO INFLATION'),
  );
  return svg;
}

function makePipeNode(
  title: string,
  rate: string,
  body: string,
  stream: string,
  extraCls = '',
): HTMLElement {
  const card = makeEl('article', `wp-proto-node plate-sm ${extraCls}`.trim());
  card.dataset.stream = stream;
  const top = makeEl('div', 'wp-proto-node-top');
  top.append(makeEl('b', undefined, title), makeEl('span', 'wp-proto-rate', rate));
  card.append(top, makeFormattedEl('p', undefined, body));
  return card;
}

export function createProtocolEconomySchema(): HTMLElement {
  const wrap = makeEl('div', 'wp-schema is-web3-schema plate wp-reveal');
  wrap.id = 'sub-econ-schematic';
  const board = makeEl('div', 'wp-proto-board');
  board.dataset.activeStream = 'all';

  const toolbar = makeEl('div', 'wp-proto-toolbar');
  const filters = makeEl('div', 'wp-proto-filters');
  const filterDefs = [
    ['all', 'ALL FLOWS'],
    ['trade', '01 · 4-WAY TRADE'],
    ['staking', '02 · 80/20 STAKING'],
    ['bonds', '03 · 90/10 BONDS'],
  ] as const;

  for (const [key, label] of filterDefs) {
    const btn = makeEl('button', `wp-filter-btn${key === 'all' ? ' is-active' : ''}`, label);
    btn.type = 'button';
    btn.dataset.protoStream = key;
    btn.setAttribute('aria-pressed', String(key === 'all'));
    btn.addEventListener('click', () => {
      board.dataset.activeStream = key;
      for (const b of filters.querySelectorAll<HTMLButtonElement>('[data-proto-stream]')) {
        const active = b === btn;
        b.classList.toggle('is-active', active);
        b.setAttribute('aria-pressed', String(active));
      }
    });
    filters.appendChild(btn);
  }

  const acct = makeEl('div', 'wp-proto-acct');
  acct.append(makeEl('span', undefined, 'TREASURY'), makeEl('code', undefined, 'protocol.terraagent.testnet'));
  toolbar.append(filters, acct);

  const flowGrid = makeEl('div', 'wp-proto-grid');
  const leftCol = makeEl('div', 'wp-proto-col');
  leftCol.append(
    makeEl('span', 'wp-proto-col-lbl is-in', '▲ THREE ORGANIC INFLOWS'),
    makePipeNode('80% of Platform Trade Fee', '0.80% / 0.40%', 'Cleared on CLOB & Guild fills via `NEP-413` `token_diff`. Remaining 20% funds Planet DAO.', 'trade'),
    makePipeNode('20% of Validator Yield', '1.80% APY', 'Routed from `staking.terraagent.testnet` 9.0% pool while pilots keep 100% principal + 7.20% APY.', 'staking'),
    makePipeNode('10% Bond Arbitration Slash', '10% Breach', 'Collected if a treaty breaker cancels early or a 6h War Bond fails its siege goal.', 'bonds'),
  );

  const coreCol = makeEl('div', 'wp-proto-core plate-sm');
  coreCol.append(makeEl('span', 'wp-proto-col-lbl is-core', '◆ ON-CHAIN CLEARING CORE'), buildCoreConduitSvg());
  const stats = makeEl('div', 'wp-proto-stats');
  for (const [lbl, val] of [['TOKEN MINT', '0%'], ['COMBAT P2W', '0%'], ['STAKER PERKS', '>= 10 NEAR']]) {
    const cell = makeEl('div', 'wp-proto-stat');
    cell.append(makeEl('span', undefined, lbl), makeEl('strong', undefined, val));
    stats.appendChild(cell);
  }
  coreCol.appendChild(stats);

  const rightCol = makeEl('div', 'wp-proto-col');
  rightCol.append(
    makeEl('span', 'wp-proto-col-lbl is-out', '▼ INFRASTRUCTURE & DAO OUTFLOWS'),
    makePipeNode('NEP-366 Gasless Relayer', 'relayer.terraagent.*', 'Sponsors pilot sub-account storage deposits and popup-free gameplay transactions.', 'all', 'is-out'),
    makePipeNode('Managed NEAR.AI Cloud TEE', 'z-ai/glm-5.3-flash', 'Pays batched hardware-attested directives for Rival NPCs and >= 10 NEAR Staker Autopilot.', 'all', 'is-out-ai'),
    makePipeNode('Planet Council DAO Vault', '20% of Platform Fee', 'Funds `meteor_shield`, `terraform_boost`, and regional subsidies voted on `dao.terraagent.testnet`.', 'trade', 'is-out'),
  );

  flowGrid.append(leftCol, coreCol, rightCol);
  board.append(flowGrid);
  wrap.append(toolbar, board);
  return wrap;
}

export function createReceiptExamplesGrid(): HTMLElement {
  const grid = makeEl('div', 'wp-receipts-grid wp-reveal');
  grid.id = 'sub-econ-examples';
  const receipts = [
    {
      num: 'EXAMPLE A · 4-WAY TRADE RECEIPT',
      badge: 'NEP-413',
      title: '$100 USDC Cargo Fill (Staker, 0.50% Stall)',
      bars: [['50%', 'is-terra'], ['40%', 'is-orange'], ['10%', 'is-blue']],
      rows: [
        ['Seller Principal (100%)', '$100.00 USDC'],
        ['Trade Hub Stall Royalty', '+$0.50 USDC'],
        ['TerraAgent Protocol (80% fee)', '+$0.40 USDC'],
        ['Planet Council DAO (20% fee)', '+$0.10 USDC'],
      ],
    },
    {
      num: 'EXAMPLE B · DAY-1 LOSSLESS STAKE',
      badge: '9.0% POOL APY',
      title: '50 NEAR Staked on Day 1 (No Wait)',
      bars: [['80%', 'is-blue'], ['20%', 'is-energy']],
      rows: [
        ['Locked Principal (2d Unbond)', '50.00 NEAR (100% Safe)'],
        ['Pilot Net Yield (80% split)', '+3.60 NEAR / yr (7.20%)'],
        ['Protocol Infra Slice (20%)', '+0.90 NEAR / yr'],
        ['Unlocked Perks (>= 10 NEAR)', 'Managed AI + 0.50% Fee'],
      ],
    },
    {
      num: 'EXAMPLE C · BOND SLASH SETTLEMENT',
      badge: '90 / 10 SLASH',
      title: '20 NEAR Breached Truce or Failed 6h War',
      bars: [['90%', 'is-terra'], ['10%', 'is-orange']],
      rows: [
        ['Betrayed Ally / War Defender', '+18.00 NEAR (90%)'],
        ['Protocol Arbitration Fee', '+2.00 NEAR (10%)'],
        ['Victim Bond Return', '20.00 NEAR (100% Refund)'],
        ['AI Guardrail Rule (AW-13)', 'Blocked from Canceling'],
      ],
    },
  ];

  for (const r of receipts) {
    const card = makeEl('article', 'wp-receipt-card plate-sm');
    const head = makeEl('div', 'wp-flow-node-top');
    head.append(makeEl('span', 'wp-flow-step', r.num), makeEl('span', 'badge badge-ok', r.badge));
    const bar = makeEl('div', 'wp-seg-bar');
    for (const [w, cls] of r.bars) {
      const seg = makeEl('span', `wp-seg ${cls}`);
      seg.style.width = w!;
      bar.appendChild(seg);
    }
    const list = makeEl('div', 'wp-receipt-rows');
    for (const [k, v] of r.rows) {
      const row = makeEl('div', 'wp-receipt-row');
      row.append(makeEl('span', undefined, k!), makeEl('strong', undefined, v!));
      list.appendChild(row);
    }
    card.append(head, makeEl('h4', 'wp-flow-title', r.title), bar, list);
    grid.appendChild(card);
  }
  return grid;
}

export function createAiPipelineSchema(): HTMLElement {
  const wrap = makeEl('div', 'wp-schema is-ai-schema plate wp-reveal');
  wrap.id = 'sub-ai-pipeline';
  const head = makeEl('div', 'wp-schema-head');
  head.append(
    makeEl('span', 'wp-schema-kicker', 'SCHEMA 03 // ATTESTED NEAR.AI DECISION & GUARDRAIL PIPELINE'),
    makeEl('span', 'badge badge-ai', 'INTEL TDX + NVIDIA TEE'),
  );

  const stages = [
    { num: '01 · DIGEST', title: '180s Colony Snapshot', body: 'Summarizes net grid E/s, stock levels, active treaties, and resting `/trade.html` quotes.' },
    { num: '02 · TEE INFERENCE', title: 'ECDSA Attested Turn', body: '`z-ai/glm-5.3-flash` or BYOK key signs decisions via `/v1/signature/{chat_id}`.' },
    { num: '03 · HARD GATES', title: '4 Server Assertions', body: 'Enforces `403 AI_STAKING_FORBIDDEN`, `AW-10`, `AW-13`, ACID token caps, and `intentRevision`.' },
    { num: '04 · ENQUEUE', title: '@terra/sim Orders', body: 'Only passing actions touch the hex queue; human clicks immediately abort stale AI intents.' },
  ];

  const row = makeEl('div', 'wp-flow-4');
  for (const s of stages) {
    const card = makeEl('div', 'wp-flow-node plate-sm is-blue');
    card.append(makeEl('span', 'wp-flow-step', s.num), makeEl('h4', 'wp-flow-title', s.title), makeFormattedEl('p', 'wp-flow-copy', s.body));
    row.appendChild(card);
  }

  const example = makeEl('div', 'wp-compare-grid');
  example.id = 'sub-ai-example';

  const allowed = makeEl('div', 'wp-compare-col is-allow plate-sm');
  allowed.append(makeEl('span', 'wp-compare-head', '✔ AUTONOMOUS 8H AWAY TRACE (ATTESTED)'));
  const allowList = makeEl('ul', 'wp-example-list');
  for (const txt of [
    'Built 2 Capacitors before orbital dusk to keep Command Hub online (`+14 E/s` margin).',
    'Sold 150 surplus Water at `1.08×` 24h VWAP (`16.2 / 25.0 USDC` daily bot cap used).',
    'Stored TEE proof at `/v1/signature/cht_8f3a91` for owner audit on return.',
  ]) allowList.appendChild(makeFormattedEl('li', undefined, txt));
  allowed.appendChild(allowList);

  const blocked = makeEl('div', 'wp-compare-col is-block plate-sm');
  blocked.append(makeEl('span', 'wp-compare-head', '✕ BLOCKED BY SERVER & CONTRACT GUARDRAILS'));
  const blockList = makeEl('ul', 'wp-example-list');
  for (const txt of [
    '`staking.stake(50 NEAR)` → Rejected `403 AI_STAKING_FORBIDDEN` (humans only).',
    '`diplomacy.cancelTruce("kestrel-9")` → Blocked by `AW-13` (zero bond forfeiture).',
    '`building.dismantle("commandHub")` → Blocked by `AW-10` (buildings protected).',
  ]) blockList.appendChild(makeFormattedEl('li', undefined, txt));
  blocked.appendChild(blockList);

  example.append(allowed, blocked);
  wrap.append(head, row, example);
  return wrap;
}
