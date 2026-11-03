export type FamilyKey = 'metals' | 'minerals' | 'bio';

export interface SubResourceDef {
  key: string;
  name: string;
  isT1: boolean;
}

export const FAMILY_DEFS: Record<FamilyKey, { label: string; subs: SubResourceDef[] }> = {
  metals: {
    label: 'METALS',
    subs: [
      { key: 'metals.t1', name: 'Iron', isT1: true },
      { key: 'metals.t2', name: 'T2 Metal', isT1: false },
      { key: 'metals.t3', name: 'T3 Metal', isT1: false },
    ],
  },
  minerals: {
    label: 'MINERALS',
    subs: [
      { key: 'minerals.t1', name: 'Silica', isT1: true },
      { key: 'minerals.t2', name: 'T2 Mineral', isT1: false },
      { key: 'minerals.t3', name: 'T3 Mineral', isT1: false },
    ],
  },
  bio: {
    label: 'BIO',
    subs: [
      { key: 'bio.water', name: 'Water', isT1: true },
      { key: 'bio.biomass', name: 'Biomass', isT1: true },
      { key: 'bio.t2', name: 'T2 Bio', isT1: false },
      { key: 'bio.t3', name: 'T3 Bio', isT1: false },
    ],
  },
};

export interface ResourceFlowSummary {
  familyIncome: Record<FamilyKey, number>;
  familySpending: Record<FamilyKey, number>;
  tierIncome: Record<string, number>;
  tierSpending: Record<string, number>;
}

function collectInProgressOrders(
  col: Record<string, unknown> | undefined,
  view: Record<string, unknown> | undefined,
  colonyIndex: number,
): Array<Record<string, unknown>> {
  const seenIds = new Set<string>();
  const seenRefs = new Set<object>();
  const out: Array<Record<string, unknown>> = [];

  const addList = (list: unknown): void => {
    if (!Array.isArray(list)) return;
    for (const item of list) {
      if (!item || typeof item !== 'object') continue;
      const rec = item as Record<string, unknown>;
      if (typeof rec.colonyIndex === 'number' && rec.colonyIndex !== colonyIndex) continue;
      if (rec.state !== 'in_progress') continue;
      if (typeof rec.taskId === 'string') {
        if (seenIds.has(rec.taskId)) continue;
        seenIds.add(rec.taskId);
      } else {
        if (seenRefs.has(rec)) continue;
        seenRefs.add(rec);
      }
      out.push(rec);
    }
  };

  addList(col?.queue);
  addList(col?.constructionQueue);
  addList(col?.unitQueue);
  addList(view?.queue);

  const blobs = (view?.blobs ?? {}) as Record<string, unknown>;
  const qBlob = blobs.queue as Record<string, unknown> | undefined;
  if (Array.isArray(qBlob)) addList(qBlob);
  else if (qBlob && typeof qBlob === 'object') {
    addList(qBlob.entries);
    const val = qBlob.value as Record<string, unknown> | undefined;
    if (val && typeof val === 'object') addList(val.entries);
  }

  return out;
}

export function computeResourceFlow(
  col: Record<string, unknown> | undefined,
  view?: Record<string, unknown>,
  colonyIndex = 0,
): ResourceFlowSummary {
  const prod = ((col?.production ?? view?.production ?? {}) as Record<string, unknown>);
  const rawFamInc = ((prod.familyIncomePerS ?? {}) as Record<string, number>);
  const rawSubInc = ((prod.incomePerS ?? {}) as Record<string, number>);
  const rawFamSpend = ((prod.familySpendingPerS ?? col?.familySpendingPerS ?? {}) as Record<string, number>);
  const rawSubSpend = ((prod.spendingPerS ?? col?.spendingPerS ?? {}) as Record<string, number>);

  const queueTierSpend: Record<string, number> = {};
  for (const order of collectInProgressOrders(col, view, colonyIndex)) {
    const buildTicks = typeof order.buildTicks === 'number' && order.buildTicks > 0 ? order.buildTicks : 50;
    const workRate = typeof order.workRate === 'number' && order.workRate > 0 ? order.workRate : 1;
    const durationS = Math.max(0.2, (buildTicks / workRate) * 0.2);
    const cost = (order.cost ?? {}) as Record<string, number>;
    for (const [k, amt] of Object.entries(cost)) {
      if (typeof amt === 'number' && Number.isFinite(amt) && amt > 0) {
        queueTierSpend[k] = (queueTierSpend[k] ?? 0) + amt / durationS;
      }
    }
  }

  const familyIncome: Record<FamilyKey, number> = { metals: 0, minerals: 0, bio: 0 };
  const familySpending: Record<FamilyKey, number> = { metals: 0, minerals: 0, bio: 0 };
  const tierIncome: Record<string, number> = {};
  const tierSpending: Record<string, number> = {};

  for (const family of ['metals', 'minerals', 'bio'] as const) {
    const def = FAMILY_DEFS[family];
    let subIncSum = 0;
    let subSpendSum = 0;
    for (const s of def.subs) {
      const inc = typeof rawSubInc[s.key] === 'number' && Number.isFinite(rawSubInc[s.key]) ? rawSubInc[s.key] : 0;
      const spend = typeof rawSubSpend[s.key] === 'number' && Number.isFinite(rawSubSpend[s.key])
        ? Math.abs(rawSubSpend[s.key])
        : (queueTierSpend[s.key] ?? 0);
      tierIncome[s.key] = inc;
      tierSpending[s.key] = spend;
      subIncSum += inc;
      subSpendSum += spend;
    }
    const famInc = rawFamInc[family];
    familyIncome[family] = typeof famInc === 'number' && Number.isFinite(famInc) && (famInc !== 0 || subIncSum === 0)
      ? famInc
      : subIncSum;
    const famSpend = rawFamSpend[family];
    familySpending[family] = typeof famSpend === 'number' && Number.isFinite(famSpend) && (famSpend !== 0 || subSpendSum === 0)
      ? Math.abs(famSpend)
      : subSpendSum;
  }

  return { familyIncome, familySpending, tierIncome, tierSpending };
}

function ensureFamilyBreakdownDom(container: HTMLElement, family: FamilyKey): void {
  if (container.querySelector('.ta-res-breakdown__header')) return;
  const def = FAMILY_DEFS[family];
  container.replaceChildren();

  const hdr = document.createElement('div');
  hdr.className = 'ta-res-breakdown__header';
  hdr.textContent = `${def.label} TIERS`;
  container.appendChild(hdr);

  const flowEl = document.createElement('div');
  flowEl.className = 'ta-res-breakdown__flow';

  const incEl = document.createElement('div');
  incEl.className = 'ta-res-breakdown__flow-line ta-res-breakdown__income';
  incEl.setAttribute('data-testid', `res-income-${family}`);

  const spendEl = document.createElement('div');
  spendEl.className = 'ta-res-breakdown__flow-line ta-res-breakdown__spending';
  spendEl.setAttribute('data-testid', `res-spending-${family}`);

  const netEl = document.createElement('div');
  netEl.className = 'ta-res-breakdown__flow-line ta-res-breakdown__net';
  netEl.setAttribute('data-testid', `res-net-${family}`);

  flowEl.append(incEl, spendEl, netEl);
  container.appendChild(flowEl);

  for (const s of def.subs) {
    const row = document.createElement('div');
    row.className = 'ta-res-breakdown__row';
    row.setAttribute('data-res', s.key);
    row.setAttribute('data-locked', String(!s.isT1));

    const name = document.createElement('span');
    name.className = 'ta-res-breakdown__name';
    name.textContent = s.name;

    const amt = document.createElement('span');
    amt.className = 'ta-res-breakdown__amount';
    amt.textContent = '0';

    const rateSpan = document.createElement('span');
    rateSpan.className = 'ta-res-breakdown__rate';
    rateSpan.textContent = '+0.0/s';

    row.append(name, amt, rateSpan);
    container.appendChild(row);
  }
}

export function renderFamilyBreakdown(
  container: HTMLElement,
  family: FamilyKey,
  stock: Record<string, number>,
  flow: ResourceFlowSummary,
): void {
  ensureFamilyBreakdownDom(container, family);
  const def = FAMILY_DEFS[family];
  const income = flow.familyIncome[family] ?? 0;
  const spending = flow.familySpending[family] ?? 0;
  const rawNet = income - spending;
  const net = Math.abs(rawNet) < 1e-6 ? 0 : rawNet;

  const incEl = container.querySelector(`[data-testid="res-income-${family}"]`);
  if (incEl) incEl.textContent = `Income: ${income >= 0 ? '+' : '−'}${Math.abs(income).toFixed(1)}/s`;

  const spendEl = container.querySelector(`[data-testid="res-spending-${family}"]`);
  if (spendEl) spendEl.textContent = `Spending: −${spending.toFixed(1)}/s`;

  const netEl = container.querySelector(`[data-testid="res-net-${family}"]`);
  if (netEl) netEl.textContent = `Net: ${net >= 0 ? '+' : '−'}${Math.abs(net).toFixed(1)}/s`;

  for (const s of def.subs) {
    const val = Math.floor(stock[s.key] ?? 0);
    const rate = flow.tierIncome[s.key] ?? 0;
    const spend = flow.tierSpending[s.key] ?? 0;
    const isLocked = !s.isT1 && val <= 0 && rate <= 0 && spend <= 0;

    const row = container.querySelector(`[data-res="${s.key}"]`);
    if (!row) continue;
    row.className = 'ta-res-breakdown__row' + (isLocked ? ' ta-res-tier--locked' : '');
    row.setAttribute('data-locked', String(isLocked));

    const amt = row.querySelector('.ta-res-breakdown__amount');
    if (amt) amt.textContent = String(val);

    const rateSpan = row.querySelector('.ta-res-breakdown__rate');
    if (rateSpan) {
      rateSpan.textContent = spend > 0
        ? `${rate >= 0 ? '+' : ''}${rate.toFixed(1)} / −${spend.toFixed(1)}/s`
        : `${rate >= 0 ? '+' : ''}${rate.toFixed(1)}/s`;
    }
  }
}

export function renderPowerBreakdown(
  container: HTMLElement,
  power: Record<string, unknown> | undefined,
  hqCell?: { cell: number; cellMax: number } | null,
  includeCellLine = true,
): void {
  const sup = power && typeof power.supply === 'number' ? Math.round(Number(power.supply)) : 0;
  const dem = power && typeof power.demand === 'number' ? Math.round(Number(power.demand)) : 0;
  const net = power && typeof power.net === 'number' ? Math.round(Number(power.net)) : sup - dem;

  if (!container.querySelector('.ta-res-breakdown__header')) {
    container.replaceChildren();
    const hdr = document.createElement('div');
    hdr.className = 'ta-res-breakdown__header';
    hdr.textContent = 'POWER & CELL';
    container.appendChild(hdr);

    const flowEl = document.createElement('div');
    flowEl.className = 'ta-res-breakdown__flow';

    if (includeCellLine) {
      const cellLine = document.createElement('div');
      cellLine.className = 'ta-res-breakdown__flow-line';
      cellLine.setAttribute('data-testid', 'res-cell-energy');
      flowEl.appendChild(cellLine);
    }

    const incEl = document.createElement('div');
    incEl.className = 'ta-res-breakdown__flow-line ta-res-breakdown__income';
    incEl.setAttribute('data-testid', 'res-income-energy');

    const spendEl = document.createElement('div');
    spendEl.className = 'ta-res-breakdown__flow-line ta-res-breakdown__spending';
    spendEl.setAttribute('data-testid', 'res-spending-energy');

    const netEl = document.createElement('div');
    netEl.className = 'ta-res-breakdown__flow-line ta-res-breakdown__net';
    netEl.setAttribute('data-testid', 'res-net-energy');

    flowEl.append(incEl, spendEl, netEl);
    container.appendChild(flowEl);
  }

  const cellLine = container.querySelector('[data-testid="res-cell-energy"]');
  if (cellLine) {
    cellLine.textContent = hqCell
      ? `HQ Cell: ${Math.round(hqCell.cell)} / ${Math.round(hqCell.cellMax)} E`
      : 'HQ Cell: — E';
  }

  const incEl = container.querySelector('[data-testid="res-income-energy"]');
  if (incEl) incEl.textContent = `Income (Supply): +${sup} E/s`;

  const spendEl = container.querySelector('[data-testid="res-spending-energy"]');
  if (spendEl) spendEl.textContent = `Spending (Demand): −${dem} E/s`;

  const netEl = container.querySelector('[data-testid="res-net-energy"]');
  if (netEl) netEl.textContent = `Net: ${net >= 0 ? '+' : '−'}${Math.abs(net)} E/s`;
}

export function bindHoverPopover(chipEl: HTMLElement): void {
  chipEl.addEventListener('mouseenter', () => chipEl.setAttribute('data-open', 'true'));
  chipEl.addEventListener('mouseleave', () => chipEl.removeAttribute('data-open'));
}
