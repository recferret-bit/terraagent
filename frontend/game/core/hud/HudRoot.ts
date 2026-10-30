import { HUD_SLOTS, type Feature, type FeatureContext, type GameView, type HudPanelInstance, type HudSlot } from '../registry/types';
import './hud.css';

/** pointer-events:none overlay with five slot containers; mounts every enabled feature's HUD panels. */
export class HudRoot {
  readonly el: HTMLElement;
  private slots = new Map<HudSlot, HTMLElement>();
  private panels: HudPanelInstance[] = [];

  constructor(parent: HTMLElement, features: readonly Feature[], ctx: FeatureContext) {
    this.el = document.createElement('div');
    this.el.className = 'ta-hud';
    for (const s of HUD_SLOTS) {
      const slot = document.createElement('div');
      slot.className = 'ta-hud__slot';
      slot.dataset.slot = s;
      this.el.appendChild(slot);
      this.slots.set(s, slot);
    }
    const defs = features.flatMap((f) => (f.hud ?? []).map((p) => ({ f, p })));
    defs.sort((a, b) => (a.p.order ?? 0) - (b.p.order ?? 0));
    for (const { f, p } of defs) {
      const el = document.createElement('div');
      el.className = 'ta-hud__panel';
      el.dataset.feature = f.id;
      el.dataset.panel = p.id;
      this.slots.get(p.slot)!.appendChild(el);
      try { this.panels.push(p.mount(el, ctx)); } catch (e) { console.warn(`HUD panel ${f.id}/${p.id} failed`, e); el.remove(); }
    }
    parent.appendChild(this.el);
  }

  update(view: GameView) {
    for (const p of this.panels) p.update?.(view);
  }

  dispose() {
    for (const p of this.panels) { try { p.dispose(); } catch (e) { console.warn(e); } }
    this.panels = [];
    this.el.remove();
  }
}
