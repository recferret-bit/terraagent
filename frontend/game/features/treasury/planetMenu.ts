export interface PlanetMenuItem {
  id: string;
  label: string;
  open(): void;
}

declare module '../../core/registry/types' {
  interface FeatureServices {
    /** Adds a row to the Planet menu. The menu is mounted only while wave W22 is on. */
    registerPlanetMenuItem?: (item: PlanetMenuItem) => () => void;
    /** Opens or closes the Council sheet. */
    openCouncil?: (open?: boolean) => void;
  }
}

/** Planet menu. Items are registered by features. An empty menu stays hidden. */
export class PlanetMenu {
  readonly root: HTMLElement;
  private readonly list: HTMLElement;
  private readonly toggle: HTMLButtonElement;
  private listOpen = false;
  private readonly items = new Map<string, PlanetMenuItem>();

  constructor(parent: HTMLElement) {
    const doc = parent.ownerDocument;
    this.root = doc.createElement('div');
    this.root.className = 'ta-planet-menu';
    this.root.dataset.testid = 'planet-menu';
    this.root.hidden = true;
    this.toggle = doc.createElement('button');
    this.toggle.type = 'button';
    this.toggle.className = 'ta-planet-menu__toggle plate-sm';
    this.toggle.dataset.testid = 'planet-menu-toggle';
    this.toggle.textContent = 'Planet';
    this.toggle.setAttribute('aria-haspopup', 'menu');
    this.toggle.setAttribute('aria-expanded', 'false');
    this.list = doc.createElement('div');
    this.list.className = 'ta-planet-menu__list plate-sm';
    this.list.dataset.testid = 'planet-menu-list';
    this.list.hidden = true;
    this.list.setAttribute('role', 'menu');
    this.list.setAttribute('aria-label', 'Planet');
    this.toggle.addEventListener('click', () => this.setListOpen(!this.listOpen));
    this.root.append(this.toggle, this.list);
    parent.appendChild(this.root);
  }

  register(item: PlanetMenuItem): () => void {
    this.items.set(item.id, item);
    this.renderItems();
    return () => {
      this.items.delete(item.id);
      this.renderItems();
    };
  }

  closeList(): void {
    this.setListOpen(false);
  }

  dispose(): void {
    this.root.remove();
  }

  private setListOpen(open: boolean): void {
    this.listOpen = open;
    this.list.hidden = !open;
    this.toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
  }

  private renderItems(): void {
    const doc = this.root.ownerDocument;
    this.list.replaceChildren();
    for (const item of this.items.values()) this.list.appendChild(itemButton(doc, item, () => this.closeList()));
    this.root.hidden = this.items.size === 0;
  }
}

function itemButton(doc: Document, item: PlanetMenuItem, close: () => void): HTMLButtonElement {
  const btn = doc.createElement('button');
  btn.type = 'button';
  btn.className = 'ta-planet-menu__item';
  btn.dataset.testid = `planet-menu-${item.id}`;
  btn.textContent = item.label;
  btn.setAttribute('role', 'menuitem');
  btn.addEventListener('click', () => {
    close();
    item.open();
  });
  return btn;
}
