export interface EconomySimSwarmUi {
  parentAccount: string;
  buyerSubAccounts: number;
  sellerSubAccounts: number;
  zeroLlmCalls: boolean;
  rounds: Array<{
    round: number;
    day: number;
    resource: string;
    buyerCount: number;
    sellerCount: number;
    bidsSubmitted: number;
    asksSubmitted: number;
    totalBidUnits: number;
    totalAskUnits: number;
    clearingPriceUsdc: number;
    clearedUnits: number;
    totalNotionalUsdc: number;
    zeroSumVerified: boolean;
    intentBatchHash: string;
    topBids: Array<{ agentAccountId: string; cohort: string; maxPriceUsdc: number; desiredUnits: number }>;
    allocations: Array<{ buyerAccountId: string; cohort: string; unitsReceived: number; sharePaidUsdc: number }>;
  }>;
}

export interface EconomySimContractorUi {
  contractorAccountId: string;
  goal: string;
  keyPolicySummary: string;
  budgetUsdc: number;
  spentUsdc: number;
  budgetNear: number;
  spentNear: number;
  withinBudget: boolean;
  selfExecutedSteps: string[];
  receipts: Array<{
    taskId: string;
    day: number;
    buyerAccountId: string;
    sellerAccountId: string;
    category: string;
    whatWasBought: string;
    quantity: number;
    currency: string;
    settlementRail: string;
    negotiation: {
      decision: string;
      sellerInitialAsk: number;
      plannedUnitPrice: number;
      walkAwayUnitPrice: number;
      counterUnitPrice: number | null;
      counterReasoning: string | null;
      finalUnitPrice: number | null;
      totalCost: number;
    };
    unitPricePaid: number;
    totalPaid: number;
    workPassedCheck: boolean;
    checkSummary: string;
    settlementRef: string;
  }>;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function formatWhoGotWhat(
  allocs: Array<{ buyerAccountId: string; unitsReceived: number; sharePaidUsdc: number }>,
): string {
  const top = allocs.slice(0, 3).map((a) => {
    const short = a.buyerAccountId.split('.')[0] ?? a.buyerAccountId;
    return `${short}: +${a.unitsReceived}u ($${a.sharePaidUsdc.toFixed(2)})`;
  });
  const rest = allocs.length > 3 ? ` +${allocs.length - 3} buyers` : '';
  return `${top.join(', ')}${rest}`;
}

export function renderSwarmRoundsSection(swarm: EconomySimSwarmUi | undefined): HTMLElement {
  const wrap = el('section', 'es-table-wrap plate-sm');
  wrap.dataset.testid = 'econ-sim-swarm-rounds';
  wrap.setAttribute('role', 'region');
  wrap.setAttribute('aria-label', '25-Agent Scripted Swarm Clearing Rounds');
  if (!swarm) return wrap;

  wrap.appendChild(
    el(
      'p',
      'label c-blue',
      `TRACK 05 AI SWARMS · ${swarm.buyerSubAccounts} BUYER + ${swarm.sellerSubAccounts} SELLER SUB-ACCOUNTS (${swarm.parentAccount}) · ZERO-LLM SEALED-BID CLEARING`,
    ),
  );
  const table = el('table', 'es-table');
  const thead = el('thead');
  const hr = el('tr');
  for (const h of ['ROUND', 'RESOURCE', 'BIDS / ASKS', 'CLEARING PRICE', 'CLEARED', 'WHO GOT WHAT (PRO-RATA SHARE)', 'NEP-413 PROOF']) {
    const th = el('th', undefined, h);
    th.scope = 'col';
    hr.appendChild(th);
  }
  thead.appendChild(hr);

  const tbody = el('tbody');
  for (const r of swarm.rounds) {
    const tr = el('tr');
    const cells = [
      `R${r.round} (D${r.day})`,
      r.resource,
      `${r.bidsSubmitted}b (${r.totalBidUnits}u) / ${r.asksSubmitted}a (${r.totalAskUnits}u)`,
      `${r.clearingPriceUsdc.toFixed(2)} USDC`,
      `${r.clearedUnits}u ($${r.totalNotionalUsdc.toFixed(2)})`,
      formatWhoGotWhat(r.allocations),
      r.zeroSumVerified ? `✔ ${r.intentBatchHash}` : 'FAIL',
    ];
    for (const c of cells) tr.appendChild(el('td', undefined, c));
    tbody.appendChild(tr);
  }
  table.append(thead, tbody);
  wrap.appendChild(table);
  return wrap;
}

function formatNegotiationCell(neg: EconomySimContractorUi['receipts'][number]['negotiation'], currency: string): string {
  if (neg.decision === 'accepted_initial') {
    return `Ask ${neg.sellerInitialAsk.toFixed(2)} <= planned ${neg.plannedUnitPrice.toFixed(2)} ${currency} -> ACCEPTED`;
  }
  const counter = neg.counterUnitPrice !== null ? neg.counterUnitPrice.toFixed(2) : '-';
  if (neg.decision === 'accepted_counter') {
    return `Ask ${neg.sellerInitialAsk.toFixed(2)} -> Counter ${counter} -> Settled ${(neg.finalUnitPrice ?? 0).toFixed(2)} ${currency}`;
  }
  return `Ask ${neg.sellerInitialAsk.toFixed(2)} -> Counter ${counter} (> ${neg.walkAwayUnitPrice.toFixed(2)} cap) -> WALKED AWAY`;
}

export function renderContractorReceiptsSection(commerce: EconomySimContractorUi | undefined): HTMLElement {
  const wrap = el('section', 'es-table-wrap plate-sm');
  wrap.dataset.testid = 'econ-sim-agent-receipts';
  wrap.setAttribute('role', 'region');
  wrap.setAttribute('aria-label', 'Agent Economy Contractor Task Receipts');
  if (!commerce) return wrap;

  wrap.appendChild(
    el(
      'p',
      'label c-orange',
      `TRACK 07 AGENT ECONOMY · ${commerce.contractorAccountId} · SPENT ${commerce.spentUsdc.toFixed(2)}/${commerce.budgetUsdc.toFixed(2)} USDC & ${commerce.spentNear.toFixed(2)}/${commerce.budgetNear.toFixed(2)} NEAR`,
    ),
  );
  const meta = el('p', 'es-event__reason', `${commerce.keyPolicySummary} | ${commerce.selfExecutedSteps.join(' · ')}`);
  wrap.appendChild(meta);

  const table = el('table', 'es-table');
  const thead = el('thead');
  const hr = el('tr');
  for (const h of ['DAY', 'WHAT WAS BOUGHT / HIRED', 'FROM AGENT', '1-ROUND NEGOTIATION', 'PAID', 'CHECK & RECEIPT']) {
    const th = el('th', undefined, h);
    th.scope = 'col';
    hr.appendChild(th);
  }
  thead.appendChild(hr);

  const tbody = el('tbody');
  for (const rec of commerce.receipts) {
    const tr = el('tr');
    if (rec.negotiation.counterReasoning) tr.title = rec.negotiation.counterReasoning;
    const paidText = rec.totalPaid > 0 ? `${rec.totalPaid.toFixed(2)} ${rec.currency} (${rec.settlementRail})` : `0.00 ${rec.currency} (walked_away)`;
    const checkText = `${rec.workPassedCheck ? 'PASS' : 'SKIPPED'} · ${rec.checkSummary} [${rec.settlementRef}]`;
    for (const c of [
      `Day ${rec.day}`,
      `${rec.quantity}x ${rec.whatWasBought}`,
      rec.sellerAccountId,
      formatNegotiationCell(rec.negotiation, rec.currency),
      paidText,
      checkText,
    ]) {
      tr.appendChild(el('td', undefined, c));
    }
    tbody.appendChild(tr);
  }
  table.append(thead, tbody);
  wrap.appendChild(table);
  return wrap;
}
