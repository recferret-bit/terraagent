import './style.css';

interface TxDetail {
  txHash: string;
  statusLabel: string;
  signerId: string | null;
  receiverId: string | null;
  opId: string | null;
  port: string;
  method: string;
  blockHeight: number | null;
  payload: unknown;
}

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', text = ''): HTMLElementTagNameMap[K] => {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text) node.textContent = text;
  return node;
};

/** Hash from `?hash=` or `/dev/chain/tx/<hash>` (the colon in `mock:` is percent-encoded in the path). */
export function receiptHashFromLocation(loc: { pathname: string; search: string }): string {
  const fromQuery = new URLSearchParams(loc.search).get('hash')?.trim() ?? '';
  if (fromQuery) return fromQuery;
  const marker = '/dev/chain/tx/';
  const at = loc.pathname.indexOf(marker);
  if (at === -1) return '';
  const raw = loc.pathname.slice(at + marker.length).replace(/\/$/, '');
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

function addField(dl: HTMLDListElement, label: string, value: string, opts?: { status?: boolean; cls?: string }): void {
  const dd = el('dd', opts?.cls ?? '', value);
  if (opts?.status) dd.dataset.status = value.toLowerCase();
  dl.append(el('dt', '', label), dd);
}

function payloadText(payload: unknown): string {
  if (payload === null || payload === undefined) return '';
  if (typeof payload === 'string') return payload;
  try {
    return JSON.stringify(payload, null, 2);
  } catch {
    return '';
  }
}

/** One mock-chain receipt (`/dev/chain/tx/<hash>`). */
class ReceiptPage {
  private readonly panel = el('section', 'xdetail plate');

  constructor(root: HTMLElement) {
    root.append(this.header(), this.panel);
    void this.load();
  }

  private header(): HTMLElement {
    const head = el('header', 'xhead plate');
    const left = el('div');
    left.append(el('p', 'eyebrow', 'DEV TOOLS · NEAR §1A'), el('h1', 'h2', 'RECEIPT'));
    const back = el('a', 'btn btn-ghost btn-sm', 'EXPLORER');
    back.href = '/dev/chain/';
    head.append(left, back);
    return head;
  }

  private async load(): Promise<void> {
    const hash = receiptHashFromLocation(location);
    if (!hash) {
      this.fail('No receipt hash in this URL.');
      return;
    }
    try {
      const res = await fetch(`/v1/dev/chain/tx?hash=${encodeURIComponent(hash)}`);
      if (!res.ok) throw new Error(res.status === 404 ? 'Receipt not found.' : `HTTP ${res.status}`);
      this.show((await res.json()) as TxDetail);
    } catch (e) {
      this.fail(e instanceof Error ? e.message : String(e));
    }
  }

  private show(tx: TxDetail): void {
    const dl = el('dl');
    const call = tx.port || tx.method ? `${tx.port}.${tx.method}` : '—';
    addField(dl, 'HASH', tx.txHash, { cls: 'hash' });
    addField(dl, 'STATUS', tx.statusLabel, { status: true });
    addField(dl, 'SIGNER', tx.signerId ?? '—');
    addField(dl, 'RECEIVER', tx.receiverId ?? '—');
    addField(dl, 'CALL', call);
    addField(dl, 'BLOCK', tx.blockHeight === null ? '—' : String(tx.blockHeight));
    addField(dl, 'OP ID', tx.opId ?? '—');
    const payload = payloadText(tx.payload);
    const nodes: HTMLElement[] = [dl];
    if (payload) nodes.push(el('pre', 'xpayload', payload));
    this.panel.replaceChildren(...nodes);
  }

  private fail(message: string): void {
    this.panel.replaceChildren(el('p', 'empty xerr', message));
  }
}

new ReceiptPage(document.getElementById('app')!);
