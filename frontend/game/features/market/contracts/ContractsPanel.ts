import { CONTRACTS_LIMIT, rowBadge, type ContractsLog } from './contractsLog';

export interface ContractsPanelOptions {
  /** Called with the panel root whenever it opens (the HUD's `revealHudPanel`: switches the book to its tab). */
  readonly reveal?: (el: HTMLElement) => void;
  /** Start open (inside a HUD tab book, where the tab itself shows and hides it). Default: closed. */
  readonly open?: boolean;
}

/**
 * The Contracts list (last 5; the full history is on the trade page), Faction Plate chrome, DOM built with textContent
 * only. Hidden until opened from the menu, the Supply panel or the Trade Hub (open by default inside the Colony book).
 */
export class ContractsPanel {
  private readonly list: HTMLElement;
  private readonly off: () => void;
  private readonly reveal?: (el: HTMLElement) => void;

  constructor(private readonly root: HTMLElement, private readonly log: ContractsLog, opts: ContractsPanelOptions = {}) {
    this.reveal = opts.reveal;
    root.className = 'plate-sm ta-contracts';
    root.dataset.testid = 'contracts-panel';
    root.hidden = !opts.open;
    const head = document.createElement('div');
    head.className = 'ta-contracts-head';
    const title = document.createElement('span');
    title.className = 'label c-blue';
    title.textContent = `CONTRACTS (LAST ${CONTRACTS_LIMIT})`;
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'ta-toast-close';
    close.setAttribute('aria-label', 'Close contracts');
    close.textContent = '×';
    close.onclick = () => this.setOpen(false);
    head.append(title, close);
    this.list = document.createElement('ul');
    this.list.className = 'ta-contracts-list';
    this.list.dataset.testid = 'contracts-list';
    root.append(head, this.list);
    this.off = log.onChange(() => this.render());
    this.render();
  }

  get isOpen(): boolean {
    return !this.root.hidden;
  }

  setOpen(open: boolean): void {
    this.root.hidden = !open;
    if (open) this.reveal?.(this.root);
  }

  toggle(): void {
    this.setOpen(!this.isOpen);
  }

  render(): void {
    const rows = this.log.list;
    if (rows.length === 0) {
      const empty = document.createElement('li');
      empty.className = 'ta-contracts-empty';
      empty.textContent = 'No contracts yet. A signed trade appears here.';
      this.list.replaceChildren(empty);
      return;
    }
    this.list.replaceChildren(...rows.map((row) => {
      const li = document.createElement('li');
      li.className = `ta-contracts-row ta-contracts-row--${row.kind === 'history.trade' ? 'signed' : 'failed'}`;
      li.dataset.testid = 'contract-row';
      li.dataset.kind = row.kind;
      const text = document.createElement('span');
      text.textContent = row.text;
      li.append(text);
      const badge = rowBadge(row);
      if (badge) {
        const b = document.createElement('span');
        b.className = 'label ta-contracts-badge';
        b.textContent = badge;
        li.append(b);
      }
      return li;
    }));
  }

  dispose(): void {
    this.off();
    this.root.replaceChildren();
  }
}
