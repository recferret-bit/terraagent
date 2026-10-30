/**
 * Minimal DOM shim for Node unit tests where `document` is not provided by the test runner.
 * In a real browser, native `document` and `window` are used directly.
 */

type Listener = (ev: Record<string, unknown>) => void;

function camelToKebab(key: string): string {
  return key.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`);
}

function kebabToCamel(key: string): string {
  return key.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());
}

function matchesSingleSelector(el: MiniElement, sel: string): boolean {
  let rem = sel.trim();
  if (!rem) return false;
  const attrRe = /\[([a-zA-Z0-9_-]+)(?:=['"]?([^'"\]]*)['"]?)?\]/g;
  let m: RegExpExecArray | null;
  while ((m = attrRe.exec(sel)) !== null) {
    const val = el.getAttribute(m[1]);
    if (val === null) return false;
    if (m[2] !== undefined && val !== m[2]) return false;
  }
  rem = rem.replace(attrRe, '');
  const idMatch = /#([a-zA-Z0-9_-]+)/.exec(rem);
  if (idMatch && el.id !== idMatch[1]) return false;
  rem = rem.replace(/#[a-zA-Z0-9_-]+/g, '');
  const classes = [...rem.matchAll(/\.([a-zA-Z0-9_-]+)/g)].map((c) => c[1]);
  for (const cls of classes) {
    if (!el.classList.contains(cls)) return false;
  }
  rem = rem.replace(/\.[a-zA-Z0-9_-]+/g, '').trim();
  if (rem && rem !== '*' && el.tagName.toLowerCase() !== rem.toLowerCase()) return false;
  return true;
}

function matchesChain(el: MiniElement, parts: string[]): boolean {
  if (!matchesSingleSelector(el, parts[parts.length - 1])) return false;
  let cur: MiniElement | null = el.parentElement;
  for (let i = parts.length - 2; i >= 0; i--) {
    while (cur && !matchesSingleSelector(cur, parts[i])) cur = cur.parentElement;
    if (!cur) return false;
    cur = cur.parentElement;
  }
  return true;
}

class MiniElement {
  readonly tagName: string;
  id = '';
  title = '';
  type = '';
  hidden = false;
  disabled = false;
  parentElement: MiniElement | null = null;
  readonly children: MiniElement[] = [];
  readonly style: { [k: string]: string | ((k: string, v: string) => void); setProperty(k: string, v: string): void } = {
    setProperty(k: string, v: string) {
      this[k] = v;
    },
  };
  readonly dataset: Record<string, string>;
  onclick: ((ev: unknown) => void) | null = null;
  private attrs = new Map<string, string>();
  private listeners = new Map<string, Set<Listener>>();
  private rawText = '';

  constructor(tag: string) {
    this.tagName = tag.toUpperCase();
    const attrs = this.attrs;
    this.dataset = new Proxy({} as Record<string, string>, {
      get(_t, prop: string) {
        return attrs.get(`data-${camelToKebab(prop)}`);
      },
      set(_t, prop: string, val: string) {
        attrs.set(`data-${camelToKebab(prop)}`, String(val));
        return true;
      },
      deleteProperty(_t, prop: string) {
        attrs.delete(`data-${camelToKebab(prop)}`);
        return true;
      },
    });
  }

  get className(): string { return this.attrs.get('class') ?? ''; }
  set className(v: string) { this.attrs.set('class', String(v)); }

  readonly classList = {
    add: (...tokens: string[]) => {
      const set = new Set(this.className.split(/\s+/).filter(Boolean));
      for (const t of tokens) set.add(t);
      this.className = [...set].join(' ');
    },
    remove: (...tokens: string[]) => {
      const set = new Set(this.className.split(/\s+/).filter(Boolean));
      for (const t of tokens) set.delete(t);
      this.className = [...set].join(' ');
    },
    toggle: (token: string, force?: boolean) => {
      const has = this.classList.contains(token);
      const next = force ?? !has;
      if (next) this.classList.add(token); else this.classList.remove(token);
      return next;
    },
    contains: (token: string) => this.className.split(/\s+/).filter(Boolean).includes(token),
  };

  get textContent(): string {
    if (this.children.length === 0) return this.rawText;
    return this.rawText + this.children.map((c) => c.textContent).join('');
  }
  set textContent(v: string) {
    for (const c of this.children) c.parentElement = null;
    this.children.length = 0;
    this.rawText = String(v ?? '');
  }

  setAttribute(name: string, value: string): void {
    this.attrs.set(name, String(value));
    if (name === 'id') this.id = String(value);
  }
  getAttribute(name: string): string | null {
    if (name === 'id' && this.id) return this.id;
    if (name === 'class') return this.className || null;
    return this.attrs.get(name) ?? null;
  }
  hasAttribute(name: string): boolean { return this.getAttribute(name) !== null; }
  removeAttribute(name: string): void {
    this.attrs.delete(name);
    if (name.startsWith('data-')) delete this.dataset[kebabToCamel(name.slice(5))];
  }

  appendChild<T extends MiniElement>(child: T): T {
    if (child.parentElement) child.remove();
    child.parentElement = this;
    this.children.push(child);
    return child;
  }
  append(...nodes: Array<MiniElement | string>): void {
    for (const n of nodes) {
      if (typeof n === 'string') {
        const span = new MiniElement('#text');
        span.textContent = n;
        this.appendChild(span);
      } else {
        this.appendChild(n);
      }
    }
  }
  replaceChildren(...nodes: Array<MiniElement | string>): void {
    for (const c of this.children) c.parentElement = null;
    this.children.length = 0;
    this.rawText = '';
    this.append(...nodes);
  }
  remove(): void {
    if (!this.parentElement) return;
    const idx = this.parentElement.children.indexOf(this);
    if (idx >= 0) this.parentElement.children.splice(idx, 1);
    this.parentElement = null;
  }

  addEventListener(type: string, fn: Listener): void {
    let set = this.listeners.get(type);
    if (!set) { set = new Set(); this.listeners.set(type, set); }
    set.add(fn);
  }
  removeEventListener(type: string, fn: Listener): void {
    this.listeners.get(type)?.delete(fn);
  }
  dispatchEvent(ev: { type: string; [k: string]: unknown }): boolean {
    const payload = { target: this, currentTarget: this, preventDefault() {}, stopPropagation() {}, ...ev };
    for (const fn of this.listeners.get(ev.type) ?? []) fn(payload);
    if (ev.type === 'click' && this.onclick) this.onclick(payload);
    return true;
  }
  click(): void {
    if (this.disabled) return;
    this.dispatchEvent({ type: 'click', button: 0 });
  }
  getBoundingClientRect() {
    return { left: 0, top: 0, width: 800, height: 600, right: 800, bottom: 600, x: 0, y: 0, toJSON: () => ({}) };
  }

  querySelector(selector: string): MiniElement | null {
    return this.querySelectorAll(selector)[0] ?? null;
  }
  querySelectorAll(selector: string): MiniElement[] {
    const groups = selector.split(',').map((s) => s.trim().split(/\s+/).filter(Boolean));
    const out: MiniElement[] = [];
    const visit = (node: MiniElement) => {
      for (const c of node.children) {
        if (c.tagName !== '#TEXT' && groups.some((parts) => matchesChain(c, parts))) out.push(c);
        visit(c);
      }
    };
    visit(this);
    return out;
  }
}

export function ensureDom(): void {
  if (typeof globalThis.document !== 'undefined') return;
  const body = new MiniElement('body');
  const winListeners = new Map<string, Set<Listener>>();
  const doc = {
    body,
    documentElement: body,
    hidden: false,
    createElement: (tag: string) => new MiniElement(tag),
    createTextNode: (text: string) => { const n = new MiniElement('#text'); n.textContent = text; return n; },
    querySelector: (sel: string) => body.querySelector(sel),
    querySelectorAll: (sel: string) => body.querySelectorAll(sel),
    addEventListener: (t: string, fn: Listener) => {
      let s = winListeners.get(t);
      if (!s) { s = new Set(); winListeners.set(t, s); }
      s.add(fn);
    },
    removeEventListener: (t: string, fn: Listener) => winListeners.get(t)?.delete(fn),
  };
  const win = {
    document: doc,
    addEventListener: doc.addEventListener,
    removeEventListener: doc.removeEventListener,
    dispatchEvent: (ev: { type: string; [k: string]: unknown }) => {
      const payload = { target: body, preventDefault() {}, stopPropagation() {}, ...ev };
      for (const fn of winListeners.get(ev.type) ?? []) fn(payload);
      return true;
    },
  };
  (globalThis as unknown as { document: unknown }).document = doc;
  if (typeof globalThis.window === 'undefined') {
    (globalThis as unknown as { window: unknown }).window = win;
  }
}
