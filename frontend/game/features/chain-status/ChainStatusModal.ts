import type { FeatureContext } from '../../core/registry/types';
import { makeBtn, makeDiv, makeSpan } from '../shared/dom';

export interface NearPortEntry {
  readonly port: string;
  readonly mode: string;
  readonly target: string;
}

export interface NearStatusResponse {
  readonly nearMode: string;
  readonly rootAccount: string;
  readonly explorerBaseUrl: string;
  readonly health?: { readonly ok: boolean; readonly latencyMs?: number; readonly detail?: string };
  readonly ports: readonly NearPortEntry[];
}

function isNearAccountTarget(target: string): boolean {
  return target.endsWith('.testnet') || target.endsWith('.near');
}

function renderPortTable(data: NearStatusResponse): HTMLTableElement {
  const table = document.createElement('table');
  table.className = 'ta-chain-table';
  table.setAttribute('data-testid', 'chain-ports-table');
  const thead = document.createElement('thead');
  const hr = document.createElement('tr');
  for (const label of ['Port', 'Adapter', 'Target / Contract']) {
    const th = document.createElement('th');
    th.textContent = label;
    hr.appendChild(th);
  }
  thead.appendChild(hr);
  const tbody = document.createElement('tbody');
  for (const row of data.ports) {
    const tr = document.createElement('tr');
    tr.setAttribute('data-port', row.port);
    const tdPort = document.createElement('td');
    tdPort.textContent = row.port;
    const tdMode = document.createElement('td');
    const badge = makeSpan(`ta-chain-badge ta-chain-badge--${row.mode}`, undefined, row.mode);
    tdMode.appendChild(badge);
    const tdTarget = document.createElement('td');
    if (isNearAccountTarget(row.target)) {
      const a = document.createElement('a');
      a.className = 'ta-chain-link';
      a.href = `${data.explorerBaseUrl}/address/${row.target}`;
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      a.textContent = row.target;
      tdTarget.appendChild(a);
    } else {
      tdTarget.textContent = row.target;
    }
    tr.append(tdPort, tdMode, tdTarget);
    tbody.appendChild(tr);
  }
  table.append(thead, tbody);
  return table;
}

function renderQuoteRow(): HTMLElement {
  const wrap = makeDiv('ta-chain-quote');
  const out = makeSpan('ta-chain-quote__out', 'chain-quote-output', '1Click NEAR Intents dry quote ready.');
  const btn = makeBtn('btn btn-primary btn-sm', 'chain-quote-btn', 'Live 1Click Dry Quote', () => {
    out.textContent = 'Requesting dry quote…';
    void fetch('/v1/near/intents/quote', {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ amount: '1000000000000000000000000' }),
    })
      .then(async (res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const q = (await res.json()) as { source: string; amountOut: string; minAmountOut: string };
        out.textContent = `[${q.source}] 1 wNEAR → ${q.amountOut} out (min ${q.minAmountOut})`;
      })
      .catch(() => {
        out.textContent = '1Click quote unavailable.';
      });
  });
  wrap.append(out, btn);
  return wrap;
}

export class ChainStatusModal {
  private backdrop: HTMLElement | null = null;
  private unregisterCloser: (() => void) | null = null;

  constructor(private readonly ctx: FeatureContext) {}

  open(): void {
    if (this.backdrop) return;
    const host = this.ctx.services.hudOverlay ?? document.body;
    const backdrop = makeDiv('ta-chain-backdrop', 'chain-status-backdrop');
    const modal = makeDiv('ta-chain-modal plate', 'chain-status-modal');
    const header = makeDiv('ta-chain-header');
    const title = document.createElement('h2');
    title.className = 'ta-chain-title';
    title.textContent = 'NEAR Chain & Port Status';
    const closeBtn = makeBtn('btn btn-ghost btn-sm', 'chain-status-close', 'Close', () => this.close());
    header.append(title, closeBtn);

    const body = makeDiv('ta-chain-body', 'chain-status-body');
    body.textContent = 'Loading chain telemetry…';
    modal.append(header, body, renderQuoteRow());
    backdrop.appendChild(modal);
    backdrop.addEventListener('click', (e) => {
      if (e.target === backdrop) this.close();
    });
    host.appendChild(backdrop);
    this.backdrop = backdrop;
    this.unregisterCloser = this.ctx.services.registerHudCloser?.(() => this.close()) ?? null;
    void this.loadStatus(body);
  }

  close(): void {
    this.unregisterCloser?.();
    this.unregisterCloser = null;
    this.backdrop?.remove();
    this.backdrop = null;
  }

  private async loadStatus(container: HTMLElement): Promise<void> {
    try {
      const res = await fetch('/v1/near/status', { headers: { accept: 'application/json' } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as NearStatusResponse;
      if (!this.backdrop) return;
      container.replaceChildren();
      const meta = makeDiv('ta-chain-meta');
      const rpcState = data.health?.ok ? `OK (${data.health.latencyMs ?? 0}ms)` : 'DEGRADED';
      meta.append(
        makeSpan(`ta-chain-badge ta-chain-badge--${data.nearMode}`, 'chain-near-mode', `NEAR_MODE: ${data.nearMode}`),
        makeSpan('', 'chain-root-account', `Root: ${data.rootAccount}`),
        makeSpan('', 'chain-rpc-health', `RPC: ${rpcState}`),
      );
      container.append(meta, renderPortTable(data));
    } catch {
      if (!this.backdrop) return;
      container.replaceChildren();
      const err = document.createElement('p');
      err.className = 'ta-chain-fault';
      err.textContent = 'Unable to reach /v1/near/status.';
      container.appendChild(err);
    }
  }
}
