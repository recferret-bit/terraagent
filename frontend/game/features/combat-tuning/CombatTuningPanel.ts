import type { CompiledDataLike } from '@terra/sim';
import { isGameInputBlocked, setGameInputBlocked } from '../../core/input/gameInputBlock';
import type { FeatureContext, HudPanelInstance } from '../../core/registry/types';
import { makeBtn, makeDiv } from '../shared/dom';
import { isTypingTarget } from '../shared/hotkeys';
import { combatTuneTypes, readTuneValue, tuneDesignValue, validateTuneRange, type CombatTuneField, type CombatTuneType } from './catalog';
import '../../net/services';
import '../landfall';

const BLOCK = 'combat-tuning';

/** Live per-type balance controls, using the same authoritative tune service as the dev console. */
export class CombatTuningPanel implements HudPanelInstance {
  private readonly button: HTMLButtonElement;
  private readonly dialog = makeDiv('ta-combat-tuning', 'combat-tuning-panel');
  private readonly picker = document.createElement('select');
  private readonly fields = makeDiv('ta-combat-tuning__fields');
  private readonly status = makeDiv('ta-combat-tuning__status', 'combat-tuning-status');
  private readonly exported = document.createElement('textarea');
  private types: CombatTuneType[] = [];
  private busy = false;
  private disposed = false;
  private open = false;

  constructor(private readonly el: HTMLElement, private readonly ctx: FeatureContext) {
    this.button = makeBtn('btn', 'combat-tuning-toggle', 'COMBAT F6', () => this.toggle());
    this.button.title = 'Combat balance tuning (F6)';
    this.button.setAttribute('aria-expanded', 'false');
    this.dialog.hidden = true;
    this.dialog.setAttribute('role', 'dialog');
    this.dialog.setAttribute('aria-label', 'Combat tuning');
    const header = makeDiv('ta-combat-tuning__header');
    header.append(makeDiv('', undefined, 'COMBAT LAB'), makeBtn('btn', 'combat-tuning-close', 'CLOSE', () => this.toggle(false)));
    const note = makeDiv('ta-combat-tuning__note', undefined, 'Live balance for every entity of this type on this planet. Health changes preserve the current health percentage.');
    this.picker.setAttribute('aria-label', 'Entity type');
    this.picker.dataset.testid = 'combat-tuning-type';
    this.picker.onchange = () => this.renderFields();
    this.status.setAttribute('role', 'status');
    const actions = makeDiv('ta-combat-tuning__actions');
    actions.append(makeBtn('btn', 'combat-tuning-refresh', 'RELOAD VALUES', () => this.refresh()),
      makeBtn('btn', 'combat-tuning-export', 'EXPORT JSON', () => { void this.export(); }));
    this.exported.hidden = true;
    this.exported.readOnly = true;
    this.exported.setAttribute('aria-label', 'Planet balance overrides JSON');
    this.dialog.append(header, note, this.picker, this.fields, actions, this.status, this.exported);
    this.el.append(this.button, this.dialog);
    window.addEventListener('keydown', this.onKey, true);
  }

  private readonly onKey = (e: KeyboardEvent): void => {
    if (e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.code === 'F6' && !isTypingTarget(e) && !isGameInputBlocked(BLOCK)) {
      e.preventDefault(); e.stopImmediatePropagation(); this.toggle();
    } else if (this.open && e.key === 'Escape') {
      e.preventDefault(); e.stopImmediatePropagation(); this.toggle(false);
    }
  };

  private toggle(open = !this.open): void {
    this.open = open;
    this.dialog.hidden = !open;
    this.button.setAttribute('aria-expanded', String(open));
    setGameInputBlocked(BLOCK, open);
    if (open) {
      const selected = this.ctx.services.landfall?.getSelectedEntity();
      this.refresh(selected?.kind);
      this.picker.focus();
    } else this.button.focus();
  }

  private refresh(selectedKind?: number): void {
    if (this.busy) return;
    const data = this.ctx.services.store?.simData?.();
    if (!data) { this.status.textContent = 'Connect to a planet to tune combat.'; return; }
    const previous = this.picker.value;
    this.types = combatTuneTypes(data);
    this.picker.replaceChildren(...this.types.map(type => new Option(type.label, type.id)));
    const choice = this.types.find(t => t.kind === selectedKind && selectedKind !== undefined)
      ?? this.types.find(t => t.id === previous) ?? this.types.find(t => t.id === 'combatUnits.recon') ?? this.types[0];
    if (choice) this.picker.value = choice.id;
    this.renderFields(data);
  }

  private renderFields(data = this.ctx.services.store?.simData?.()): void {
    if (!data) return;
    const type = this.types.find(t => t.id === this.picker.value);
    this.fields.replaceChildren();
    for (const field of type?.fields ?? []) this.fields.append(this.fieldRow(data, field));
    this.status.textContent = 'Set a value, then APPLY. Range and movement use hex tiles (2 m).';
    this.exported.hidden = true;
  }

  private fieldRow(data: CompiledDataLike, field: CombatTuneField): HTMLElement {
    const form = document.createElement('form');
    form.className = 'ta-combat-tuning__row';
    const label = document.createElement('label');
    label.textContent = field.label;
    const input = document.createElement('input');
    input.type = 'number'; input.min = String(field.min); input.max = String(field.max); input.step = field.step;
    input.required = true;
    input.value = String(Number(readTuneValue(data, field).toFixed(6)));
    input.dataset.path = field.path;
    input.setAttribute('aria-label', field.label);
    label.append(input);
    const apply = makeBtn('btn', `combat-apply-${field.path}`, 'APPLY', () => {});
    apply.type = 'submit';
    form.onsubmit = e => { e.preventDefault(); void this.apply(field, input); };
    form.append(label, apply);
    return form;
  }

  private setBusy(busy: boolean): void {
    this.busy = busy;
    this.dialog.querySelectorAll<HTMLInputElement | HTMLButtonElement | HTMLSelectElement>('input, select, form button, .ta-combat-tuning__actions button')
      .forEach(control => { control.disabled = busy; });
  }

  private async call(body: Record<string, unknown>): Promise<{ text?: string }> {
    const planetId = this.ctx.services.session?.planetId();
    if (!planetId) throw new Error('Not connected to a planet.');
    if (!this.ctx.services.devServer) throw new Error('Combat tuning is unavailable on this host.');
    return await this.ctx.services.devServer('tune', { planetId, ...body }) as { text?: string };
  }

  private async apply(field: CombatTuneField, input: HTMLInputElement): Promise<void> {
    if (this.busy) return;
    try {
      const value = tuneDesignValue(field, input.value);
      validateTuneRange(this.ctx.services.store?.simData?.(), field, value);
      this.setBusy(true);
      this.status.textContent = `Applying ${field.label.toLowerCase()}…`;
      await this.call({ op: 'set', path: field.path, value });
      if (!this.disposed) this.status.textContent = `Applied ${field.label.toLowerCase()} = ${input.value} to this type on the planet.`;
    } catch (error) {
      if (!this.disposed) this.status.textContent = `Not applied: ${error instanceof Error ? error.message : String(error)}`;
    } finally { if (!this.disposed) this.setBusy(false); }
  }

  private async export(): Promise<void> {
    if (this.busy) return;
    this.setBusy(true);
    try {
      const result = await this.call({ op: 'export' });
      if (this.disposed) return;
      this.exported.value = result.text ?? '{}'; this.exported.hidden = false;
      this.exported.focus(); this.exported.select();
      this.status.textContent = 'Planet overrides ready to copy.';
    } catch (error) {
      if (!this.disposed) this.status.textContent = `Export failed: ${error instanceof Error ? error.message : String(error)}`;
    } finally { if (!this.disposed) this.setBusy(false); }
  }

  dispose(): void {
    this.disposed = true;
    window.removeEventListener('keydown', this.onKey, true);
    setGameInputBlocked(BLOCK, false);
    this.button.remove(); this.dialog.remove();
  }
}
