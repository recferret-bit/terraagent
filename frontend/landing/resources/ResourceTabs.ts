// The five resource cards are tabs: selecting one swaps the technical sheet (works without WebGL) and notifies the 3D viewer.
import { RES } from './data';

export class ResourceTabs {
  private current = '';

  constructor(
    private readonly tabs: HTMLButtonElement[],
    private readonly infoEl: HTMLElement,
    private readonly onSelect: (key: string) => void,
  ) {
    tabs.forEach((t, i) => {
      t.onclick = () => this.select(t.dataset.res!);
      t.onkeydown = (e) => {
        const d = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
        if (d) { e.preventDefault(); this.select(tabs[(i + d + tabs.length) % tabs.length].dataset.res!, true); }
      };
    });
  }

  select(key: string, focus = false) {
    this.tabs.forEach((t) => { const on = t.dataset.res === key; t.setAttribute('aria-selected', String(on)); t.tabIndex = on ? 0 : -1; if (on && focus) t.focus(); });
    if (key === this.current) return;
    this.current = key; this.renderInfo(key); this.onSelect(key);
  }

  private renderInfo(key: string) {
    const r = RES[key], el = this.infoEl;
    el.innerHTML = `<p class="label rv-sym">${r.symbol}</p><h3 class="h3 rv-name">${r.name}</h3><p class="rv-sci">${r.science}</p>
      <dl class="rv-specs">${r.specs.map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join('')}</dl>
      <p class="rv-game"><span class="label">IN THE GAME</span>${r.game}</p>`;
    el.classList.remove('rv-swap'); void el.offsetWidth; el.classList.add('rv-swap');
  }
}
