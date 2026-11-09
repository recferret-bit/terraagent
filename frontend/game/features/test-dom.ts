export class MockElement {
  tagName: string;
  className = '';
  textContent = '';
  type = '';
  disabled = false;
  style = Object.assign({} as Record<string, string>, { setProperty: (name: string, value: string) => { this.style[name] = value; } });
  dataset: Record<string, string>;
  private attrs = new Map<string, string>();
  children: MockElement[] = [];
  parentElement: MockElement | null = null;
  draggable = false;
  onclick?: (e?: unknown) => void;
  ondragstart?: (e?: unknown) => void;
  ondragover?: (e?: unknown) => void;
  ondrop?: (e?: unknown) => void;
  private listeners = new Map<string, Array<(e?: unknown) => void>>();

  addEventListener(type: string, cb: (e?: unknown) => void): void {
    const arr = this.listeners.get(type) ?? [];
    arr.push(cb);
    this.listeners.set(type, arr);
  }

  click(): void {
    this.onclick?.();
    for (const cb of this.listeners.get('click') ?? []) cb();
  }
  classList = {
    add: (...names: string[]) => {
      const set = new Set(this.className.split(/\s+/).filter(Boolean));
      for (const n of names) set.add(n);
      this.className = Array.from(set).join(' ');
    },
    remove: (...names: string[]) => {
      const set = new Set(this.className.split(/\s+/).filter(Boolean));
      for (const n of names) set.delete(n);
      this.className = Array.from(set).join(' ');
    },
    toggle: (name: string, force?: boolean) => {
      const set = new Set(this.className.split(/\s+/).filter(Boolean));
      const shouldAdd = force !== undefined ? force : !set.has(name);
      if (shouldAdd) set.add(name); else set.delete(name);
      this.className = Array.from(set).join(' ');
      return shouldAdd;
    },
    contains: (name: string) => this.className.split(/\s+/).includes(name),
  };

  constructor(tagName: string) {
    this.tagName = tagName.toUpperCase();
    const rawData: Record<string, string> = {};
    this.dataset = new Proxy(rawData, {
      set: (_target, prop: string, val: unknown) => {
        const strVal = String(val);
        rawData[prop] = strVal;
        const attrKey = 'data-' + prop.replace(/([A-Z])/g, '-$1').toLowerCase();
        this.attrs.set(attrKey, strVal);
        return true;
      },
      get: (_target, prop: string) => rawData[prop],
    });
  }

  get innerHTML(): string {
    return this.children.map((c) => `<${c.tagName.toLowerCase()}>${c.innerHTML || c.textContent}</${c.tagName.toLowerCase()}>`).join('');
  }

  set innerHTML(html: string) {
    this.children = [];
    if (!html) {
      this.textContent = '';
      return;
    }
    const nodes = parseHtmlToMock(html);
    for (const n of nodes) this.appendChild(n);
  }

  setAttribute(k: string, v: string) {
    this.attrs.set(k, String(v));
    if (k.startsWith('data-')) {
      const prop = k.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase());
      this.dataset[prop] = String(v);
    }
  }

  getAttribute(k: string): string | null {
    return this.attrs.get(k) ?? null;
  }

  removeAttribute(k: string) {
    this.attrs.delete(k);
    if (k.startsWith('data-')) {
      const prop = k.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase());
      delete this.dataset[prop];
    }
  }

  appendChild(child: MockElement): MockElement {
    child.parentElement = this;
    this.children.push(child);
    return child;
  }

  append(...items: (MockElement | string)[]) {
    for (const item of items) {
      if (typeof item === 'string') {
        const textNode = new MockElement('span');
        textNode.textContent = item;
        this.appendChild(textNode);
      } else {
        this.appendChild(item);
      }
    }
  }

  replaceChildren(...items: (MockElement | string)[]) {
    this.children = [];
    this.append(...items);
  }

  remove() {
    if (this.parentElement) {
      const idx = this.parentElement.children.indexOf(this);
      if (idx >= 0) this.parentElement.children.splice(idx, 1);
      this.parentElement = null;
    }
  }

  querySelector(selector: string): MockElement | null {
    return this.querySelectorAll(selector)[0] ?? null;
  }

  querySelectorAll(selector: string): MockElement[] {
    const res: MockElement[] = [];
    const match = (el: MockElement): boolean => {
      if (selector.startsWith('#')) return el.getAttribute('id') === selector.slice(1);
      if (selector.startsWith('.')) {
        const classes = selector.slice(1).split('.');
        const elClasses = el.className.split(/\s+/).filter(Boolean);
        return classes.every((c) => elClasses.includes(c));
      }
      if (selector.startsWith('[')) {
        const attrs = [...selector.matchAll(/\[([^\]=\s]+)(?:=(["']?)([^"'\]]*)\2)?\]/g)];
        const rest = selector.replace(/\[[^\]]*\]/g, '');
        if (attrs.length > 0 && rest === '') {
          return attrs.every((part) => {
            const name = part[1] ?? '';
            if (part[3] === undefined) return el.getAttribute(name) !== null;
            return el.getAttribute(name) === part[3];
          });
        }
      }
      return el.tagName.toLowerCase() === selector.toLowerCase();
    };

    const walk = (el: MockElement) => {
      for (const child of el.children) {
        if (match(child)) res.push(child);
        walk(child);
      }
    };
    walk(this);
    return res;
  }
}

export function parseHtmlToMock(html: string): MockElement[] {
  const root = new MockElement('div');
  const stack: MockElement[] = [root];
  const tagRegex = /<(\/)?([a-zA-Z0-9]+)([^>]*)>|([^<]+)/g;
  let match: RegExpExecArray | null;

  while ((match = tagRegex.exec(html)) !== null) {
    const [full, isClosing, tagName, attrString, text] = match;
    const current = stack[stack.length - 1];

    if (text) {
      const trimmed = text.trim();
      if (trimmed) {
        if (current.children.length === 0 && !current.textContent) {
          current.textContent = trimmed;
        } else {
          const tNode = new MockElement('span');
          tNode.textContent = trimmed;
          current.appendChild(tNode);
        }
      }
    } else if (isClosing) {
      if (stack.length > 1 && stack[stack.length - 1].tagName.toLowerCase() === tagName.toLowerCase()) {
        stack.pop();
      }
    } else {
      const el = new MockElement(tagName);
      if (attrString) {
        const attrRegex = /([a-zA-Z0-9_-]+)(?:=(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g;
        let attrMatch: RegExpExecArray | null;
        while ((attrMatch = attrRegex.exec(attrString)) !== null) {
          const name = attrMatch[1];
          const val = attrMatch[2] ?? attrMatch[3] ?? attrMatch[4] ?? '';
          if (name === 'class') {
            el.className = val;
          } else if (name === 'id') {
            el.setAttribute('id', val);
          } else {
            el.setAttribute(name, val);
          }
        }
      }
      current.appendChild(el);
      const isVoid = ['img', 'br', 'hr', 'input'].includes(tagName.toLowerCase()) || full.endsWith('/>');
      if (!isVoid) {
        stack.push(el);
      }
    }
  }

  return root.children;
}

export function installMockDocument(): () => void {
  const origDoc = (globalThis as unknown as { document: unknown }).document;
  (globalThis as unknown as { document: unknown }).document = {
    createElement: (tag: string) => new MockElement(tag),
  };
  return () => {
    (globalThis as unknown as { document: unknown }).document = origDoc;
  };
}
