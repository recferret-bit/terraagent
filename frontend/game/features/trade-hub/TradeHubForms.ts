import {
  RESOURCE_FAMILIES,
  RESOURCE_FAMILY_OF,
  RESOURCE_KEYS,
  type ResourceFamily,
  type ResourceKey,
} from '@terra/contracts';
import type { FeatureContext } from '../../core/registry/types';
import '../../net/services';
import { clampPct } from '../shared/dom';
import {
  computeTransferBounds,
  formatCargoCount,
  formatTransferPreview,
  ORBIT_FAMILY_GROUPS,
  type ResolvedTradeHubCargoView,
  type TradeHubTab,
  type TransferBounds,
} from './cargoView';

export { formatTransferPreview };

export function syncMockTreeText(root: HTMLElement): void {
  if ('nodeType' in root) return;
  const walk = (el: HTMLElement): string => {
    const children = (el as unknown as { children?: HTMLElement[] }).children;
    if (!children || children.length === 0) {
      return el.textContent ?? '';
    }
    const joined = children.map(walk).filter(Boolean).join(' ');
    (el as { textContent: string }).textContent = joined;
    return joined;
  };
  walk(root);
}

export interface TradeHubFormsCallbacks {
  getTab(): TradeHubTab;
  getResolvedCargoView(): ResolvedTradeHubCargoView;
  getContext(): FeatureContext | undefined;
  onResourceSelected?(resource: ResourceKey): void;
  onRenderRoot?(): void;
}

export class TradeHubForms {
  readonly promptEl: HTMLElement;
  readonly familyPickerEl: HTMLElement;
  readonly resourcePickerEl: HTMLElement;
  readonly amountControlsEl: HTMLElement;
  readonly sliderEl: HTMLInputElement;
  readonly amountInputEl: HTMLInputElement;
  readonly maxBtnEl: HTMLButtonElement;
  readonly limitReasonEl: HTMLElement;
  readonly previewEl: HTMLElement;
  readonly confirmBtnEl: HTMLButtonElement;

  private readonly familyBtns = new Map<ResourceFamily, HTMLButtonElement>();
  private readonly resourceBtns = new Map<ResourceKey, HTMLButtonElement>();

  private selectedFamily: ResourceFamily = 'metals';
  private selectedResource: ResourceKey = 'metals.t1';
  private amount = 0;
  private userSetAmount = false;
  private lastSliderStr = '0';
  private lastInputStr = '0';

  constructor(
    private readonly container: HTMLElement,
    private readonly callbacks: TradeHubFormsCallbacks,
  ) {
    this.promptEl = document.createElement('div');
    this.promptEl.className = 'ta-trade-hub__tab-placeholder';
    this.promptEl.setAttribute('data-testid', 'trade-hub-form-prompt');
    this.promptEl.textContent = 'Select cargo to export to orbit';

    this.familyPickerEl = this.buildFamilyPicker();
    this.resourcePickerEl = document.createElement('div');
    this.resourcePickerEl.className = 'ta-trade-hub__resource-picker';
    this.resourcePickerEl.setAttribute('data-testid', 'trade-hub-resource-picker');
    this.resourcePickerEl.setAttribute('role', 'group');

    const amountBuild = this.buildAmountControls();
    this.amountControlsEl = amountBuild.controlsEl;
    this.sliderEl = amountBuild.sliderEl;
    this.amountInputEl = amountBuild.inputEl;
    this.maxBtnEl = amountBuild.maxBtnEl;

    this.limitReasonEl = document.createElement('div');
    this.limitReasonEl.className = 'ta-trade-hub__limit-reason';
    this.limitReasonEl.setAttribute('data-testid', 'trade-hub-limit-reason');
    this.limitReasonEl.hidden = true;

    this.previewEl = document.createElement('div');
    this.previewEl.className = 'ta-trade-hub__preview plate-sm';
    this.previewEl.setAttribute('data-testid', 'trade-hub-preview');

    this.confirmBtnEl = document.createElement('button');
    this.confirmBtnEl.type = 'button';
    this.confirmBtnEl.className = 'ta-trade-hub__confirm btn btn-primary btn-sm plate-sm';
    this.confirmBtnEl.setAttribute('data-testid', 'trade-hub-confirm');
    this.confirmBtnEl.textContent = 'CONFIRM EXPORT';
    this.confirmBtnEl.onclick = () => {
      this.confirm();
    };

    this.container.replaceChildren(
      this.promptEl,
      this.familyPickerEl,
      this.resourcePickerEl,
      this.amountControlsEl,
      this.limitReasonEl,
      this.previewEl,
      this.confirmBtnEl,
    );

    this.rebuildResourceButtons();
  }

  private buildFamilyPicker(): HTMLElement {
    const picker = document.createElement('div');
    picker.className = 'ta-trade-hub__family-picker';
    picker.setAttribute('data-testid', 'trade-hub-family-picker');
    picker.setAttribute('role', 'group');

    for (const group of ORBIT_FAMILY_GROUPS) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'ta-trade-hub__family-btn btn-sm plate-sm';
      btn.setAttribute('data-testid', `trade-hub-family-${group.family}`);
      btn.setAttribute('data-family', group.family);
      btn.setAttribute('data-active', String(group.family === this.selectedFamily));
      btn.setAttribute('aria-pressed', String(group.family === this.selectedFamily));
      btn.textContent = group.label;
      btn.onclick = () => this.selectFamily(group.family);
      this.familyBtns.set(group.family, btn);
      picker.appendChild(btn);
    }

    return picker;
  }

  private buildAmountControls(): {
    controlsEl: HTMLElement;
    sliderEl: HTMLInputElement;
    inputEl: HTMLInputElement;
    maxBtnEl: HTMLButtonElement;
  } {
    const controlsEl = document.createElement('div');
    controlsEl.className = 'ta-trade-hub__amount-controls';
    controlsEl.setAttribute('data-testid', 'trade-hub-amount-controls');

    const sliderEl = document.createElement('input');
    sliderEl.type = 'range';
    sliderEl.className = 'ta-trade-hub__slider range';
    sliderEl.setAttribute('data-testid', 'trade-hub-amount-slider');
    sliderEl.setAttribute('min', '0');
    sliderEl.setAttribute('max', '0');
    sliderEl.setAttribute('step', '1');
    sliderEl.setAttribute('value', '0');
    sliderEl.value = '0';

    const onSliderInput = () => {
      const raw = this.readElementValue(sliderEl, this.lastSliderStr);
      const parsed = Number(raw);
      const bounds = this.getTransferBounds();
      const clamped = Number.isFinite(parsed)
        ? Math.max(0, Math.min(Math.floor(parsed), bounds.maxAmount))
        : 0;
      this.userSetAmount = true;
      this.amount = clamped;
      this.render();
      this.callbacks.onRenderRoot?.();
    };
    sliderEl.oninput = onSliderInput;
    sliderEl.onchange = onSliderInput;
    sliderEl.addEventListener('input', onSliderInput);
    sliderEl.addEventListener('change', onSliderInput);

    const rowEl = document.createElement('div');
    rowEl.className = 'ta-trade-hub__amount-row';

    const inputEl = document.createElement('input');
    inputEl.type = 'number';
    inputEl.className = 'ta-trade-hub__amount-input input plate-sm';
    inputEl.setAttribute('data-testid', 'trade-hub-amount-input');
    inputEl.setAttribute('min', '1');
    inputEl.setAttribute('step', '1');
    inputEl.setAttribute('value', '0');
    inputEl.value = '0';

    const onNumberInput = () => {
      const raw = this.readElementValue(inputEl, this.lastInputStr);
      const parsed = Number(raw);
      const clean = Number.isFinite(parsed) ? Math.max(0, Math.floor(parsed)) : 0;
      this.userSetAmount = true;
      this.amount = clean;
      this.render();
      this.callbacks.onRenderRoot?.();
    };
    inputEl.oninput = onNumberInput;
    inputEl.onchange = onNumberInput;
    inputEl.addEventListener('input', onNumberInput);
    inputEl.addEventListener('change', onNumberInput);

    const quickGroup = document.createElement('div');
    quickGroup.className = 'ta-trade-hub__quick-btns';

    const btn25 = this.buildQuickBtn('25%', 'trade-hub-amount-25', 0.25);
    const btn50 = this.buildQuickBtn('50%', 'trade-hub-amount-50', 0.5);
    const maxBtnEl = this.buildQuickBtn('MAX', 'trade-hub-amount-max', 1);

    quickGroup.append(btn25, btn50, maxBtnEl);
    rowEl.append(inputEl, quickGroup);
    controlsEl.append(sliderEl, rowEl);

    return { controlsEl, sliderEl, inputEl, maxBtnEl };
  }

  private buildQuickBtn(label: string, testId: string, ratio: number): HTMLButtonElement {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'ta-trade-hub__quick-btn btn-sm plate-sm';
    btn.setAttribute('data-testid', testId);
    btn.textContent = label;
    btn.onclick = () => {
      const bounds = this.getTransferBounds();
      const target =
        ratio >= 1
          ? bounds.maxAmount
          : bounds.maxAmount > 0
            ? Math.max(1, Math.floor(bounds.maxAmount * ratio))
            : 0;
      this.setAmount(target);
    };
    return btn;
  }

  private rebuildResourceButtons(): void {
    this.resourceBtns.clear();
    const group =
      ORBIT_FAMILY_GROUPS.find((g) => g.family === this.selectedFamily) ?? ORBIT_FAMILY_GROUPS[0];
    const buttons: HTMLElement[] = [];

    for (const sub of group.resources) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'ta-trade-hub__resource-btn btn-sm plate-sm';
      btn.setAttribute('data-testid', `trade-hub-resource-${sub.key}`);
      btn.setAttribute('data-resource', sub.key);
      btn.setAttribute('data-family', sub.family);
      btn.setAttribute('data-active', String(sub.key === this.selectedResource));
      btn.setAttribute('aria-pressed', String(sub.key === this.selectedResource));
      btn.textContent = `${sub.label} (0)`;
      btn.onclick = () => this.selectResource(sub.key);
      this.resourceBtns.set(sub.key, btn);
      buttons.push(btn);
    }

    this.resourcePickerEl.replaceChildren(...buttons);
  }

  private readElementValue(el: HTMLInputElement, lastSynced: string): string {
    const propVal = (el as { value?: string }).value;
    const attrVal = el.getAttribute('value');
    if (typeof propVal === 'string' && propVal !== lastSynced) return propVal;
    if (typeof attrVal === 'string' && attrVal !== lastSynced) return attrVal;
    return propVal ?? attrVal ?? '';
  }

  private writeElementValue(el: HTMLInputElement, val: string): void {
    el.value = val;
    el.setAttribute('value', val);
  }

  private syncDirectInputMutations(): void {
    const rawInput = this.readElementValue(this.amountInputEl, this.lastInputStr);
    if (rawInput !== this.lastInputStr) {
      const parsed = Number(rawInput);
      if (Number.isFinite(parsed) && parsed >= 0) {
        this.userSetAmount = true;
        this.amount = Math.floor(parsed);
        return;
      }
    }
    const rawSlider = this.readElementValue(this.sliderEl, this.lastSliderStr);
    if (rawSlider !== this.lastSliderStr) {
      const parsed = Number(rawSlider);
      if (Number.isFinite(parsed) && parsed >= 0) {
        const bounds = this.getTransferBounds();
        this.userSetAmount = true;
        this.amount = Math.max(0, Math.min(Math.floor(parsed), bounds.maxAmount));
      }
    }
  }

  getTransferBounds(
    resolved = this.callbacks.getResolvedCargoView(),
    tab = this.callbacks.getTab(),
  ): TransferBounds {
    return computeTransferBounds(resolved, tab, this.selectedResource);
  }

  selectFamily(family: ResourceFamily): void {
    if (!RESOURCE_FAMILIES.includes(family)) return;
    const changedFamily = this.selectedFamily !== family;
    this.selectedFamily = family;
    const group = ORBIT_FAMILY_GROUPS.find((g) => g.family === family) ?? ORBIT_FAMILY_GROUPS[0];
    if (RESOURCE_FAMILY_OF[this.selectedResource] !== family) {
      this.selectedResource = group.resources[0].key;
    }
    if (changedFamily) {
      this.userSetAmount = false;
    }
    this.rebuildResourceButtons();
    this.render();
    this.callbacks.onResourceSelected?.(this.selectedResource);
    this.callbacks.onRenderRoot?.();
  }

  getSelectedFamily(): ResourceFamily {
    return this.selectedFamily;
  }

  selectResource(resource: ResourceKey): void {
    if (!RESOURCE_KEYS.includes(resource)) return;
    const family = RESOURCE_FAMILY_OF[resource];
    const familyChanged = family !== this.selectedFamily;
    const resourceChanged = resource !== this.selectedResource;
    this.selectedFamily = family;
    this.selectedResource = resource;
    if (familyChanged) {
      this.rebuildResourceButtons();
    }
    if (resourceChanged) {
      this.userSetAmount = false;
    }
    this.render();
    this.callbacks.onResourceSelected?.(this.selectedResource);
    this.callbacks.onRenderRoot?.();
  }

  getSelectedResource(): ResourceKey {
    return this.selectedResource;
  }

  setAmount(amount: number): void {
    const clean = Number.isFinite(amount) ? Math.max(0, Math.floor(amount)) : 0;
    this.userSetAmount = true;
    this.amount = clean;
    this.render();
    this.callbacks.onRenderRoot?.();
  }

  getAmount(): number {
    this.syncDirectInputMutations();
    return this.amount;
  }

  onTabChanged(): void {
    const bounds = this.getTransferBounds();
    if (!this.userSetAmount || bounds.maxAmount > 0) {
      this.userSetAmount = false;
      this.amount = bounds.maxAmount;
    }
    this.render();
  }

  confirm(amountOverride?: number): boolean {
    if (amountOverride !== undefined) {
      this.setAmount(amountOverride);
    } else {
      this.syncDirectInputMutations();
    }

    const resolved = this.callbacks.getResolvedCargoView();
    if (!resolved.hubOnline) return false;

    const sendAmount = Math.max(0, Math.floor(this.amount));
    if (sendAmount <= 0) return false;

    const tab = this.callbacks.getTab();
    const commandKind = tab === 'export' ? 'cargo.export' : 'cargo.import';
    const payload = { resource: this.selectedResource, amount: sendAmount };
    const ctx = this.callbacks.getContext();

    if (ctx?.services.sendCommand) {
      void ctx.services.sendCommand(commandKind, payload);
      return true;
    }
    if (ctx?.services.store?.sendCommand) {
      ctx.services.store.sendCommand(commandKind, payload);
      return true;
    }
    return false;
  }

  render(resolved = this.callbacks.getResolvedCargoView()): void {
    const tab = this.callbacks.getTab();
    const isExport = tab === 'export';
    const bounds = computeTransferBounds(resolved, tab, this.selectedResource);

    if (!this.userSetAmount) {
      this.amount = bounds.maxAmount;
    }

    this.promptEl.textContent = isExport
      ? 'Select cargo to export to orbit'
      : 'Select orbital cargo to import to colony';

    for (const [fam, btn] of this.familyBtns.entries()) {
      const active = fam === this.selectedFamily;
      btn.setAttribute('data-active', String(active));
      btn.setAttribute('aria-pressed', String(active));
    }

    const group =
      ORBIT_FAMILY_GROUPS.find((g) => g.family === this.selectedFamily) ?? ORBIT_FAMILY_GROUPS[0];
    for (const sub of group.resources) {
      const btn = this.resourceBtns.get(sub.key);
      if (!btn) continue;
      const avail = isExport ? (resolved.stock[sub.key] ?? 0) : (resolved.inOrbit[sub.key] ?? 0);
      const active = sub.key === this.selectedResource;
      btn.setAttribute('data-active', String(active));
      btn.setAttribute('aria-pressed', String(active));
      btn.setAttribute('data-available', String(avail));
      btn.textContent = `${sub.label} (${formatCargoCount(avail)})`;
    }

    const sliderVal = Math.max(0, Math.min(this.amount, bounds.maxAmount));
    const sliderPct = clampPct(sliderVal, bounds.maxAmount);
    this.sliderEl.setAttribute('max', String(bounds.maxAmount));
    this.sliderEl.setAttribute('data-slider-max', String(bounds.maxAmount));
    this.sliderEl.setAttribute('data-stock-max', String(bounds.availableAmount));
    this.sliderEl.setAttribute('data-cap-max', String(bounds.capBound));
    (this.sliderEl.style as unknown as Record<string, string>)['--val'] = `${sliderPct.toFixed(1)}%`;
    this.sliderEl.disabled = !resolved.hubOnline || bounds.maxAmount <= 0;
    this.lastSliderStr = String(sliderVal);
    this.writeElementValue(this.sliderEl, this.lastSliderStr);

    const maxInputBound = Math.max(1, bounds.availableAmount);
    this.amountInputEl.setAttribute('max', String(maxInputBound));
    this.amountInputEl.disabled = !resolved.hubOnline;
    this.lastInputStr = String(this.amount);
    this.writeElementValue(this.amountInputEl, this.lastInputStr);

    const { previewText, limitReason } = formatTransferPreview(
      resolved,
      tab,
      this.selectedResource,
      this.amount,
      bounds,
    );
    this.limitReasonEl.hidden = !limitReason;
    this.limitReasonEl.textContent = limitReason ?? '';
    this.previewEl.textContent = previewText;

    this.confirmBtnEl.textContent = isExport ? 'CONFIRM EXPORT' : 'CONFIRM IMPORT';
    const disabled = !resolved.hubOnline || this.amount <= 0;
    this.confirmBtnEl.disabled = disabled;
    this.confirmBtnEl.setAttribute('data-disabled', String(disabled));
  }
}
