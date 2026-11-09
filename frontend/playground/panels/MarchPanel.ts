import { esc } from '../dom';
import type { MarchPace, MarchStats } from '../content/marchScene';
import type { PgState } from '../state';

export interface MarchPanelHandlers {
  onPace(pace: MarchPace | null): void;
  onRock(rock: boolean): void;
  onOrder(): void;
  onPause(): void;
  onStep(): void;
  onReset(): void;
}

/** Group-march controls. The scene runs the sim `moveGroup` order. */
export class MarchPanel {
  private root!: HTMLElement;

  constructor(
    private state: PgState,
    private getStats: () => MarchStats,
    private on: MarchPanelHandlers,
  ) {}

  build(): void {
    const mount = document.querySelector<HTMLElement>('[data-side-pane="march"]');
    if (!mount) throw new Error('Missing sidebar pane [data-side-pane="march"]. Call Sidebar.build() before MarchPanel.build().');
    const el = document.createElement('section');
    el.id = 'march-panel';
    el.className = 'panel plate-sm mp-panel';
    el.setAttribute('data-testid', 'pg-march-panel');
    el.innerHTML = `
      <div class="fp-scenes">
        <button type="button" class="pg-btn" data-march="off">OFF</button>
        <button type="button" class="pg-btn" data-march="own">OWN PACE</button>
        <button type="button" class="pg-btn" data-march="together">TOGETHER</button>
        <button type="button" class="pg-btn" data-march-rock>ROCK</button>
      </div>
      <div class="fp-transport">
        <button type="button" class="pg-btn" data-march-order>ORDER</button>
        <button type="button" class="pg-btn" data-march-pause>PAUSE</button>
        <button type="button" class="pg-btn" data-march-step>+1 STEP</button>
        <button type="button" class="pg-btn" data-march-reset>RESET</button>
      </div>
      <div class="fp-stats" data-march-stats></div>`;
    mount.appendChild(el);
    this.root = el;
    el.querySelectorAll<HTMLButtonElement>('[data-march]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const pace = btn.dataset.march;
        this.on.onPace(pace === 'own' || pace === 'together' ? pace : null);
      });
    });
    el.querySelector('[data-march-rock]')?.addEventListener('click', () => this.on.onRock(!this.state.marchRock));
    el.querySelector('[data-march-order]')?.addEventListener('click', () => this.on.onOrder());
    el.querySelector('[data-march-pause]')?.addEventListener('click', () => this.on.onPause());
    el.querySelector('[data-march-step]')?.addEventListener('click', () => this.on.onStep());
    el.querySelector('[data-march-reset]')?.addEventListener('click', () => this.on.onReset());
    this.render();
  }

  render(): void {
    const pace = this.state.march;
    this.root.querySelectorAll<HTMLButtonElement>('[data-march]').forEach((btn) => {
      btn.classList.toggle('on', (pace === null && btn.dataset.march === 'off') || btn.dataset.march === pace);
    });
    this.root.querySelector('[data-march-rock]')?.classList.toggle('on', this.state.marchRock);
    this.renderStats();
  }

  renderStats(): void {
    const stats = this.getStats();
    const node = this.root.querySelector('[data-march-stats]');
    if (!node) return;
    const body = stats.active
      ? `${esc(stats.pace)} · tick ${stats.tick} · ${stats.moving} moving · ${stats.arrived} idle · ${stats.distinct} tiles`
      : 'Off. OWN PACE or TOGETHER starts 30 units walking to one hex.';
    if (node.textContent !== body) node.textContent = body;
  }
}
