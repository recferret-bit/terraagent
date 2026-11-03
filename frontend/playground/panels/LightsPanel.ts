import {
  addArchetypeLight,
  exportArchetypeLightsCode,
  getArchetypeLights,
  removeArchetypeLight,
  resetArchetypeLights,
  updateArchetypeLight,
  type ArchetypeLightSource,
} from '@terra/render/lighting/archetypeLights';
import { $, esc } from '../dom';
import type { PgState } from '../state';
import { toast } from './Toast';

export interface LightsPanelHandlers {
  onNightToggle(night: boolean): void;
  onClose(): void;
}

function toHexColor(c: number): string {
  return '#' + Math.max(0, Math.min(0xffffff, Math.round(c))).toString(16).padStart(6, '0');
}

function fmtNum(v: number): string {
  return Number(v.toFixed(2)).toString();
}

function sliderRowHtml(
  idx: number,
  field: string,
  label: string,
  val: number,
  min: number,
  max: number,
  step: number,
): string {
  return `<div class="lp-row">
    <span class="lp-lbl">${label}</span>
    <input type="range" class="lp-range" data-idx="${idx}" data-field="${field}" min="${min}" max="${max}" step="${step}" value="${val}" />
    <input type="number" class="lp-num" data-idx="${idx}" data-field="${field}" min="${min}" max="${max}" step="${step}" value="${fmtNum(val)}" />
  </div>`;
}

function cardHtml(light: ArchetypeLightSource, idx: number): string {
  return `<div class="lp-card" data-card-idx="${idx}">
    <div class="lp-card-head">
      <span class="lp-badge">#${idx + 1}</span>
      <input type="text" class="lp-id-input" data-idx="${idx}" value="${esc(light.id)}" title="Light source ID" />
      <input type="color" class="lp-color" data-idx="${idx}" value="${toHexColor(light.color)}" title="Light color" />
      <button type="button" class="pg-btn lp-remove-btn" data-idx="${idx}" title="Remove light source">× Remove</button>
    </div>
    <div class="lp-sec-lbl">POSITION (X / Y / Z)</div>
    ${sliderRowHtml(idx, 'posX', 'X', light.pos[0], -6, 6, 0.05)}
    ${sliderRowHtml(idx, 'posY', 'Y', light.pos[1], -6, 6, 0.05)}
    ${sliderRowHtml(idx, 'posZ', 'Z', light.pos[2], -6, 6, 0.05)}
    <div class="lp-sec-lbl">TARGET (TX / TY / TZ)</div>
    ${sliderRowHtml(idx, 'tgtX', 'TX', light.target[0], -8, 8, 0.05)}
    ${sliderRowHtml(idx, 'tgtY', 'TY', light.target[1], -8, 8, 0.05)}
    ${sliderRowHtml(idx, 'tgtZ', 'TZ', light.target[2], -8, 8, 0.05)}
    <div class="lp-sec-lbl">OPTICS &amp; CONE</div>
    ${sliderRowHtml(idx, 'intensity', 'Int', light.intensity, 0, 3, 0.05)}
    ${sliderRowHtml(idx, 'range', 'Rng', light.range, 1, 20, 0.5)}
    ${sliderRowHtml(idx, 'coneBottomRadius', 'Cone', light.coneBottomRadius, 0.2, 4.0, 0.05)}
    ${sliderRowHtml(idx, 'poolRadius', 'Pool', light.poolRadius, 0.2, 5.0, 0.05)}
  </div>`;
}

/** Interactive Faction-Plate Lights Editor panel for tuning per-archetype 3D projector light sources. */
export class LightsPanel {
  private root!: HTMLElement;
  private nightMode = true;
  private codeOpen = false;
  private isInlineUpdating = false;

  constructor(private state: PgState, private on: LightsPanelHandlers) {}

  get isNightPreview(): boolean {
    return this.state.lights && this.nightMode;
  }

  build() {
    const el = document.createElement('section');
    el.id = 'lights-panel';
    el.className = 'panel lp-panel';
    el.hidden = !this.state.lights;
    el.innerHTML = `
      <div class="lp-head">
        <div>
          <div class="lp-title">LIGHTS EDITOR</div>
          <small id="lp-sub" class="lp-sub"></small>
        </div>
        <div class="lp-head-actions">
          <button type="button" class="pg-btn tog on" id="lp-night-btn" title="Dim sun &amp; ambient to preview lights at night">Night</button>
          <button type="button" class="pg-btn" id="lp-close-btn" title="Close Lights Editor (L)">×</button>
        </div>
      </div>
      <div class="lp-actions">
        <button type="button" class="pg-btn lp-btn-primary" id="lp-add-btn">+ Add Light</button>
        <button type="button" class="pg-btn" id="lp-reset-btn">Reset</button>
        <button type="button" class="pg-btn" id="lp-copy-btn">Copy Code</button>
      </div>
      <div id="lp-list" class="lp-list"></div>
      <div class="lp-code-wrap">
        <button type="button" class="lp-code-toggle" id="lp-code-toggle">▾ Code Config Preview</button>
        <pre class="lp-code" id="lp-code-pre" hidden><code id="lp-code"></code></pre>
      </div>`;
    $('#overlay').appendChild(el);
    this.root = el;
    this.bindHeaderEvents();
    this.bindListEvents();
  }

  private bindHeaderEvents() {
    this.root.querySelector<HTMLButtonElement>('#lp-night-btn')!.onclick = () => {
      this.nightMode = !this.nightMode;
      this.syncNightButton();
      this.on.onNightToggle(this.isNightPreview);
    };
    this.root.querySelector<HTMLButtonElement>('#lp-close-btn')!.onclick = () => this.on.onClose();
    this.root.querySelector<HTMLButtonElement>('#lp-add-btn')!.onclick = () => {
      if (!this.state.id) return;
      addArchetypeLight(this.state.id);
      this.render();
    };
    this.root.querySelector<HTMLButtonElement>('#lp-reset-btn')!.onclick = () => {
      if (!this.state.id) return;
      resetArchetypeLights(this.state.id);
      this.render();
      toast('Lights reset to defaults');
    };
    this.root.querySelector<HTMLButtonElement>('#lp-copy-btn')!.onclick = () => this.copyCode();
    this.root.querySelector<HTMLButtonElement>('#lp-code-toggle')!.onclick = () => {
      this.codeOpen = !this.codeOpen;
      this.refreshCodePreview();
    };
  }

  private bindListEvents() {
    const list = this.root.querySelector<HTMLElement>('#lp-list')!;
    list.addEventListener('click', (e) => {
      const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('.lp-remove-btn');
      if (!btn || !this.state.id) return;
      const idx = Number(btn.dataset.idx);
      if (Number.isFinite(idx)) {
        removeArchetypeLight(this.state.id, idx);
        this.render();
      }
    });
    list.addEventListener('input', (e) => this.handleInput(e.target as HTMLInputElement));
  }

  private handleInput(target: HTMLInputElement) {
    if (!target || !this.state.id) return;
    const idx = Number(target.dataset.idx);
    if (!Number.isFinite(idx)) return;
    if (target.classList.contains('lp-id-input')) {
      this.withInlineUpdate(() => updateArchetypeLight(this.state.id, idx, { id: target.value.trim() || `light_${idx + 1}` }));
      this.refreshCodePreview();
      return;
    }
    if (target.classList.contains('lp-color')) {
      const parsed = parseInt(target.value.replace('#', ''), 16);
      if (Number.isFinite(parsed)) {
        this.withInlineUpdate(() => updateArchetypeLight(this.state.id, idx, { color: parsed }));
        this.refreshCodePreview();
      }
      return;
    }
    const field = target.dataset.field;
    const val = parseFloat(target.value);
    if (!field || !Number.isFinite(val)) return;
    const peerClass = target.classList.contains('lp-range') ? '.lp-num' : '.lp-range';
    const peer = this.root.querySelector<HTMLInputElement>(`${peerClass}[data-idx="${idx}"][data-field="${field}"]`);
    if (peer) peer.value = target.classList.contains('lp-range') ? fmtNum(val) : String(val);
    this.applyFieldPatch(idx, field, val);
  }

  private applyFieldPatch(idx: number, field: string, val: number) {
    const cur = getArchetypeLights(this.state.id)[idx];
    if (!cur) return;
    let patch: Partial<ArchetypeLightSource> = {};
    if (field === 'posX') patch = { pos: [val, cur.pos[1], cur.pos[2]] };
    else if (field === 'posY') patch = { pos: [cur.pos[0], val, cur.pos[2]] };
    else if (field === 'posZ') patch = { pos: [cur.pos[0], cur.pos[1], val] };
    else if (field === 'tgtX') patch = { target: [val, cur.target[1], cur.target[2]] };
    else if (field === 'tgtY') patch = { target: [cur.target[0], val, cur.target[2]] };
    else if (field === 'tgtZ') patch = { target: [cur.target[0], cur.target[1], val] };
    else if (field === 'intensity') patch = { intensity: val };
    else if (field === 'range') patch = { range: val };
    else if (field === 'coneBottomRadius') patch = { coneBottomRadius: val };
    else if (field === 'poolRadius') patch = { poolRadius: val };
    this.withInlineUpdate(() => updateArchetypeLight(this.state.id, idx, patch));
    this.refreshCodePreview();
  }

  private withInlineUpdate(fn: () => void) {
    this.isInlineUpdating = true;
    try { fn(); } finally { this.isInlineUpdating = false; }
  }

  private copyCode() {
    if (!this.state.id) return;
    const code = exportArchetypeLightsCode(this.state.id);
    this.codeOpen = true;
    this.refreshCodePreview();
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(code).catch(() => {});
    }
    toast('Light config copied as code');
  }

  private syncNightButton() {
    const btn = this.root?.querySelector<HTMLButtonElement>('#lp-night-btn');
    if (!btn) return;
    btn.classList.toggle('on', this.nightMode);
    btn.textContent = this.nightMode ? 'Night: ON' : 'Night: OFF';
  }

  onExternalChange(changedId: string) {
    if (this.isInlineUpdating) return;
    if (!changedId || changedId === '*' || changedId === this.state.id) {
      this.render();
    }
  }

  render() {
    if (!this.root) return;
    this.root.hidden = !this.state.lights;
    this.syncNightButton();
    if (!this.state.lights) return;
    const id = this.state.id;
    const lights = id ? getArchetypeLights(id) : [];
    const sub = this.root.querySelector<HTMLElement>('#lp-sub')!;
    sub.textContent = `${id || 'none'} · ${lights.length} source${lights.length === 1 ? '' : 's'}`;
    const list = this.root.querySelector<HTMLElement>('#lp-list')!;
    list.innerHTML = lights.length
      ? lights.map((l, i) => cardHtml(l, i)).join('')
      : `<div class="lp-empty">No light sources on <b>${esc(id)}</b>.<br>Click <b>+ Add Light</b> to attach a projector.</div>`;
    this.refreshCodePreview();
  }

  private refreshCodePreview() {
    if (!this.root || !this.state.id) return;
    const pre = this.root.querySelector<HTMLElement>('#lp-code-pre')!;
    const codeEl = this.root.querySelector<HTMLElement>('#lp-code')!;
    const toggleBtn = this.root.querySelector<HTMLButtonElement>('#lp-code-toggle')!;
    pre.hidden = !this.codeOpen;
    toggleBtn.textContent = `${this.codeOpen ? '▴' : '▾'} Code Config (${this.state.id})`;
    codeEl.textContent = exportArchetypeLightsCode(this.state.id);
  }
}
