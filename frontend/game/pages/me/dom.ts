export type DomChild = Node | string | number | null | undefined | boolean;

export interface ElementAttrs {
  readonly className?: string;
  readonly id?: string;
  readonly href?: string;
  readonly src?: string;
  readonly alt?: string;
  readonly type?: string;
  readonly role?: string;
  readonly tabIndex?: number;
  readonly title?: string;
  readonly target?: string;
  readonly rel?: string;
  readonly width?: number | string;
  readonly height?: number | string;
  readonly dataset?: Readonly<Record<string, string | number | undefined>>;
  readonly aria?: Readonly<Record<string, string | undefined>>;
  readonly style?: Readonly<Record<string, string | undefined>>;
  readonly onClick?: (ev: MouseEvent) => void;
  readonly onKeyDown?: (ev: KeyboardEvent) => void;
}

/**
 * Safe DOM element builder (PA-03: never uses `innerHTML`).
 * All string or number children are appended via `document.createTextNode`.
 */
export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs?: ElementAttrs | null,
  ...children: readonly DomChild[]
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (attrs) applyAttrs(node, attrs);
  for (const child of children) {
    if (child === null || child === undefined || typeof child === 'boolean') continue;
    if (typeof child === 'string' || typeof child === 'number') {
      node.appendChild(document.createTextNode(String(child)));
    } else {
      node.appendChild(child);
    }
  }
  return node;
}

function applyAttrs(node: HTMLElement, attrs: ElementAttrs): void {
  if (attrs.className) node.className = attrs.className;
  if (attrs.id) node.id = attrs.id;
  if (attrs.title) node.title = attrs.title;
  if (attrs.role) node.setAttribute('role', attrs.role);
  if (attrs.tabIndex !== undefined) node.tabIndex = attrs.tabIndex;
  if (attrs.href !== undefined && 'href' in node) (node as HTMLAnchorElement).href = attrs.href;
  if (attrs.target !== undefined && 'target' in node) (node as HTMLAnchorElement).target = attrs.target;
  if (attrs.rel !== undefined && 'rel' in node) (node as HTMLAnchorElement).rel = attrs.rel;
  if (attrs.src !== undefined && 'src' in node) (node as HTMLImageElement).src = attrs.src;
  if (attrs.alt !== undefined && 'alt' in node) (node as HTMLImageElement).alt = attrs.alt;
  if (attrs.type !== undefined && 'type' in node) (node as HTMLButtonElement).type = attrs.type as 'button';
  if (attrs.width !== undefined) node.setAttribute('width', String(attrs.width));
  if (attrs.height !== undefined) node.setAttribute('height', String(attrs.height));

  if (attrs.dataset) {
    for (const [k, v] of Object.entries(attrs.dataset)) {
      if (v !== undefined) node.dataset[k] = String(v);
    }
  }
  if (attrs.aria) {
    for (const [k, v] of Object.entries(attrs.aria)) {
      if (v !== undefined) node.setAttribute(`aria-${k}`, v);
    }
  }
  if (attrs.style) {
    for (const [k, v] of Object.entries(attrs.style)) {
      if (v !== undefined) node.style.setProperty(k, v);
    }
  }
  if (attrs.onClick) node.addEventListener('click', attrs.onClick);
  if (attrs.onKeyDown) node.addEventListener('keydown', attrs.onKeyDown);
}

/** Removes all child nodes without touching `innerHTML` (PA-03). */
export function clearChildren(node: Element): void {
  while (node.firstChild) {
    node.removeChild(node.firstChild);
  }
}

/** Formats an integer with spaces between thousands (`1 120`, `10 000`, `12 450`). */
export function formatThinInt(value: number): string {
  const safe = Number.isFinite(value) ? Math.trunc(value) : 0;
  const sign = safe < 0 ? '-' : '';
  const digits = String(Math.abs(safe));
  return sign + digits.replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
}
