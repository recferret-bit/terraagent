import type { Feature, FeatureContext } from '../../core/registry/types';
import { CommandRunner } from './runner';
import './console.css';

const HISTORY_MAX = 100;

/** Backtick-toggled terminal plate at the bottom of the screen: output log, input line, history (up/down), Esc closes. */
export class DevConsole {
  readonly el: HTMLElement;
  private readonly log: HTMLElement;
  private readonly input: HTMLInputElement;
  private readonly runner: CommandRunner;
  private readonly history: string[] = [];
  private cursor = 0;
  private draft = '';
  /** Commands run one after another; Enter while one is running queues the next instead of dropping it. */
  private queue: Promise<void> = Promise.resolve();

  constructor(parent: HTMLElement, features: readonly Feature[], ctx: FeatureContext) {
    this.runner = new CommandRunner(features, ctx);
    this.el = document.createElement('div');
    this.el.className = 'ta-devcon plate-sm';
    this.el.hidden = true;
    this.el.dataset.testid = 'dev-console';
    this.el.setAttribute('role', 'dialog');
    this.el.setAttribute('aria-label', 'Dev console');
    this.log = document.createElement('div');
    this.log.className = 'ta-devcon__log';
    this.log.setAttribute('role', 'log');
    this.log.dataset.testid = 'dev-console-output';
    const row = document.createElement('label');
    row.className = 'ta-devcon__row';
    const prompt = document.createElement('span');
    prompt.className = 'ta-devcon__prompt';
    prompt.textContent = '>';
    this.input = document.createElement('input');
    this.input.className = 'ta-devcon__input';
    this.input.type = 'text';
    this.input.spellcheck = false;
    this.input.autocomplete = 'off';
    this.input.setAttribute('aria-label', 'Command');
    row.append(prompt, this.input);
    this.el.append(this.log, row);
    parent.appendChild(this.el);
    this.input.addEventListener('keydown', this.onInputKey);
    // Capture phase: the game's own key handlers must not see keys meant for the console.
    window.addEventListener('keydown', this.onWindowKey, true);
    this.print(`TerraAgent dev console. Type help. (${this.runner.names().length} commands)`, 'info');
  }

  get open(): boolean { return !this.el.hidden; }

  setOpen(open: boolean): void {
    this.el.hidden = !open;
    if (open) this.input.focus(); else this.input.blur();
  }

  /** Runs a line as if typed; resolves when its output is printed. */
  async exec(line: string): Promise<void> {
    this.print(`> ${line}`, 'echo');
    const r = await this.runner.run(line);
    if (!r) return;
    if (r.kind === 'clear') { this.log.replaceChildren(); return; }
    if (r.text) this.print(r.text, r.error ? 'error' : 'out');
  }

  private print(text: string, kind: 'echo' | 'out' | 'error' | 'info'): void {
    const p = document.createElement('pre');
    p.dataset.testid = 'dev-console-line';
    p.className = `ta-devcon__line ta-devcon__line--${kind}`;
    p.textContent = text;
    this.log.appendChild(p);
    this.log.scrollTop = this.log.scrollHeight;
  }

  private readonly onWindowKey = (e: KeyboardEvent) => {
    if ((e.key !== '`' && e.code !== 'Backquote') || e.ctrlKey || e.metaKey || e.altKey) return;
    const t = e.target as HTMLElement | null;
    const typing = t && t !== this.input && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
    if (typing) return;
    e.preventDefault();
    e.stopPropagation();
    this.setOpen(!this.open);
  };

  private readonly onInputKey = (e: KeyboardEvent) => {
    e.stopPropagation();
    if (e.key === 'Escape') { e.preventDefault(); this.setOpen(false); return; }
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') { e.preventDefault(); this.walkHistory(e.key === 'ArrowUp' ? -1 : 1); return; }
    if (e.key !== 'Enter') return;
    const line = this.input.value.trim();
    this.input.value = '';
    if (!line) return;
    if (this.history[this.history.length - 1] !== line) this.history.push(line);
    if (this.history.length > HISTORY_MAX) this.history.shift();
    this.cursor = this.history.length;
    this.queue = this.queue.then(() => this.exec(line));
  };

  private walkHistory(dir: -1 | 1): void {
    if (this.cursor === this.history.length) this.draft = this.input.value;
    this.cursor = Math.min(this.history.length, Math.max(0, this.cursor + dir));
    this.input.value = this.cursor === this.history.length ? this.draft : this.history[this.cursor];
  }

  dispose(): void {
    window.removeEventListener('keydown', this.onWindowKey, true);
    this.el.remove();
  }
}
