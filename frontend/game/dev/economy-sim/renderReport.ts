export interface EconomySimUiReport {
  seed: string;
  days: number;
  durationMs: number;
  generatedAt: string;
  colonies: Array<{
    colonyIndex: number;
    colonyId: string;
    name: string;
    persona: string;
    initialStock: Record<string, number>;
    finalStock: Record<string, number>;
    livingTiles: number;
    tradesExecuted: number;
    raidsLaunched: number;
    trucesSigned: number;
  }>;
  dailySeries: Array<{
    day: number;
    prices: Record<string, number>;
    totalLivingTiles: number;
    tradeVolumeUsdc: number;
    activeTruces: number;
  }>;
  timeline: Array<{
    day: number;
    kind: string;
    actor: string;
    summary: string;
    guildReason?: string;
    opId?: string;
  }>;
  guardrails: {
    cancelTruceBlocked: number;
    stakingBlocked: number;
    allowanceEnforced: number;
  };
  ai: {
    providerModel: string;
    summary: string;
    attestation?: {
      chatId: string;
      signingAddress?: string;
      verified: boolean;
    };
  };
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

export function renderAiBanner(report: EconomySimUiReport): HTMLElement {
  const box = el('section', 'es-ai-banner plate-sm');
  box.dataset.testid = 'econ-sim-ai-banner';
  const top = el('div', 'es-ai-top');
  top.appendChild(
    el('span', undefined, `AI SWARM ANALYSIS · MODEL: ${report.ai.providerModel} · COMPUTE: ${report.durationMs}ms · SEED: ${report.seed}`),
  );
  const att = report.ai.attestation;
  const badge = el(
    'span',
    'es-badge-tee',
    att?.verified ? `NEAR AI TEE VERIFIED (${att.chatId.slice(0, 12)})` : 'DETERMINISTIC + GUARDRAILS VERIFIED',
  );
  top.appendChild(badge);

  const summary = el('p', undefined, report.ai.summary);
  summary.style.margin = '0';
  const rails = el(
    'div',
    'es-event__meta',
    `Track 07 Safety Rails — AW-13 Oathbreaker Blocked: ${report.guardrails.cancelTruceBlocked} · D-18 Staking Blocked: ${report.guardrails.stakingBlocked} · Allowance Cap Enforced: ${report.guardrails.allowanceEnforced}`,
  );
  box.append(top, summary, rails);
  return box;
}

export function renderColonyCards(report: EconomySimUiReport): HTMLElement {
  const grid = el('section', 'es-grid-3');
  grid.dataset.testid = 'econ-sim-colonies';
  for (const col of report.colonies) {
    const card = el('article', 'es-colony-card plate-sm');
    const head = el('div', 'es-stat-row');
    head.append(el('span', 'label c-orange', col.persona.toUpperCase()), el('strong', undefined, col.name));
    card.appendChild(head);

    const rows: Array<[string, string]> = [
      ['Living Hexes Cultivated', String(col.livingTiles)],
      ['Market Trades Settled', String(col.tradesExecuted)],
      ['War Raids Launched', String(col.raidsLaunched)],
      ['Peace Truces Signed', String(col.trucesSigned)],
      ['Metals (Day 1 → Day 7)', `${col.initialStock['metals.t1'] ?? 0} → ${col.finalStock['metals.t1'] ?? 0}`],
      ['Biomass (Day 1 → Day 7)', `${col.initialStock['bio.biomass'] ?? 0} → ${col.finalStock['bio.biomass'] ?? 0}`],
    ];
    for (const [k, v] of rows) {
      const r = el('div', 'es-stat-row');
      r.append(el('span', undefined, k), el('strong', undefined, v));
      card.appendChild(r);
    }
    grid.appendChild(card);
  }
  return grid;
}

export function renderDailySeriesTable(report: EconomySimUiReport): HTMLElement {
  const wrap = el('section', 'es-table-wrap plate-sm');
  wrap.appendChild(el('p', 'label c-blue', '7-DAY PRICE CURVES & PLANETARY LIVING TERRAFORMING'));
  const table = el('table', 'es-table');
  table.dataset.testid = 'econ-sim-price-table';
  const thead = el('thead');
  const hr = el('tr');
  for (const h of ['DAY', 'METALS (USDC)', 'MINERALS (USDC)', 'WATER (USDC)', 'BIOMASS (USDC)', 'LIVING HEXES', 'VOLUME (USDC)', 'ACTIVE TRUCES']) {
    hr.appendChild(el('th', undefined, h));
  }
  thead.appendChild(hr);

  const tbody = el('tbody');
  for (const pt of report.dailySeries) {
    const tr = el('tr');
    const cells = [
      `Day ${pt.day}`,
      (pt.prices['metals.t1'] ?? 0).toFixed(2),
      (pt.prices['minerals.t1'] ?? 0).toFixed(2),
      (pt.prices['bio.water'] ?? 0).toFixed(2),
      (pt.prices['bio.biomass'] ?? 0).toFixed(2),
      String(pt.totalLivingTiles),
      pt.tradeVolumeUsdc.toFixed(2),
      String(pt.activeTruces),
    ];
    for (const c of cells) tr.appendChild(el('td', undefined, c));
    tbody.appendChild(tr);
  }
  table.append(thead, tbody);
  wrap.appendChild(table);
  return wrap;
}

export function renderTimeline(report: EconomySimUiReport): HTMLElement {
  const box = el('section', 'es-timeline plate-sm');
  box.dataset.testid = 'econ-sim-timeline';
  box.appendChild(el('p', 'label c-orange', 'CHRONOLOGICAL SWARM, MARKET, WAR & DIPLOMACY LEDGER'));
  for (const ev of report.timeline) {
    const row = el('div', 'es-event');
    row.dataset.kind = ev.kind;
    const dayEl = el('span', 'es-event__meta', `DAY ${ev.day}`);
    const kindEl = el('span', 'es-event__meta', ev.kind.toUpperCase());
    const body = el('div');
    body.appendChild(el('strong', undefined, `${ev.actor}: `));
    body.appendChild(document.createTextNode(ev.summary));
    if (ev.guildReason) {
      const reason = el('span', 'es-event__reason', `Guild Quote Reason: ${ev.guildReason}`);
      reason.title = ev.guildReason;
      body.appendChild(reason);
    }
    row.append(dayEl, kindEl, body);
    box.appendChild(row);
  }
  return box;
}
