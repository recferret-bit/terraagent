import { PRIORITY_KEYS, type PriorityKey } from '@terra/contracts';

export interface SliderDef<K extends string = string> {
  key: K;
  label?: string;
  min?: number;
  max?: number;
  step?: number;
  defaultValue?: number;
}

export interface PrioritySlidersOptions<K extends string = PriorityKey> {
  sliders?: readonly SliderDef<K>[];
  initialValues?: Partial<Record<K, number>>;
  onChange?: (values: Record<K, number>, changedKey: K, newValue: number) => void;
}

export const CANONICAL_PRIORITY_SLIDERS: readonly SliderDef<PriorityKey>[] = PRIORITY_KEYS.map((key) => ({
  key,
  label: key.toUpperCase(),
  min: 0,
  max: 100,
  step: 10,
  defaultValue: 50,
}));

interface SliderRowElements {
  row: HTMLElement;
  input: HTMLInputElement;
  valueSpan: HTMLElement;
  def: SliderDef<string>;
}

export class PrioritySliders<K extends string = PriorityKey> {
  readonly el: HTMLElement;
  private readonly sliderDefs: readonly SliderDef<K>[];
  private readonly values: Record<K, number>;
  private readonly rows = new Map<K, SliderRowElements>();
  private readonly sumSpan: HTMLElement;
  private onChange?: (values: Record<K, number>, changedKey: K, newValue: number) => void;

  constructor(opts?: PrioritySlidersOptions<K>) {
    this.sliderDefs = opts?.sliders ?? (CANONICAL_PRIORITY_SLIDERS as readonly SliderDef<K>[]);
    this.onChange = opts?.onChange;
    this.values = {} as Record<K, number>;

    this.el = document.createElement('div');
    this.el.className = 'ta-priority-sliders';

    const list = document.createElement('div');
    list.className = 'ta-priority-sliders__list';

    for (const def of this.sliderDefs) {
      const initial = opts?.initialValues?.[def.key] ?? def.defaultValue ?? 50;
      this.values[def.key] = initial;
      const row = this.createSliderRow(def, initial);
      this.rows.set(def.key, row);
      list.appendChild(row.row);
    }
    this.el.appendChild(list);

    const sumRow = this.createSumRow();
    this.sumSpan = sumRow.sumSpan;
    this.el.appendChild(sumRow.row);

    this.updateSumDisplay();
  }

  private createSliderRow(def: SliderDef<K>, initialValue: number): SliderRowElements {
    const row = document.createElement('div');
    row.className = 'ta-priority-slider';

    const header = document.createElement('div');
    header.className = 'ta-priority-slider__header';

    const label = document.createElement('label');
    label.className = 'ta-priority-slider__label';
    label.textContent = def.label ?? def.key.toUpperCase();

    const valueSpan = document.createElement('span');
    valueSpan.className = 'ta-priority-slider__value';
    valueSpan.setAttribute('data-testid', `priority-value-${def.key}`);
    valueSpan.textContent = String(initialValue);

    header.append(label, valueSpan);

    const input = document.createElement('input');
    input.type = 'range';
    input.className = 'ta-priority-slider__input range';
    input.min = String(def.min ?? 0);
    input.max = String(def.max ?? 100);
    input.step = String(def.step ?? 10);
    input.value = String(initialValue);
    input.setAttribute('data-testid', `priority-slider-${def.key}`);

    const onInput = () => {
      const val = Number(input.value);
      this.setValue(def.key, val, true);
    };
    input.addEventListener('input', onInput);
    input.addEventListener('change', onInput);

    row.append(header, input);
    this.syncRangeFill(input, initialValue, def.min ?? 0, def.max ?? 100);

    return { row, input, valueSpan, def: def as SliderDef<string> };
  }

  private createSumRow(): { row: HTMLElement; sumSpan: HTMLElement } {
    const row = document.createElement('div');
    row.className = 'ta-priority-sliders__sum-row';

    const label = document.createElement('span');
    label.className = 'ta-priority-sliders__sum-label';
    label.textContent = 'TOTAL';

    const sumSpan = document.createElement('span');
    sumSpan.className = 'ta-priority-sliders__sum-value';
    sumSpan.setAttribute('data-testid', 'priority-sum');
    sumSpan.textContent = '0';

    row.append(label, sumSpan);
    return { row, sumSpan };
  }

  private syncRangeFill(input: HTMLInputElement, val: number, min: number, max: number): void {
    const range = max - min;
    const pct = range > 0 ? Math.max(0, Math.min(100, ((val - min) / range) * 100)) : 0;
    input.style.setProperty('--val', `${pct}%`);
  }

  getSum(): number {
    let sum = 0;
    for (const def of this.sliderDefs) {
      sum += this.values[def.key] ?? 0;
    }
    return sum;
  }

  private updateSumDisplay(): void {
    this.sumSpan.textContent = String(this.getSum());
  }

  getValues(): Record<K, number> {
    return { ...this.values };
  }

  getValue(key: K): number {
    return this.values[key] ?? 0;
  }

  setValue(key: K, value: number, emitChange = false): void {
    const row = this.rows.get(key);
    if (!row) return;

    const min = row.def.min ?? 0;
    const max = row.def.max ?? 100;
    const step = row.def.step ?? 10;

    let clamped = Math.max(min, Math.min(max, value));
    if (step > 0) {
      clamped = Math.round((clamped - min) / step) * step + min;
    }

    this.values[key] = clamped;
    row.input.value = String(clamped);
    row.valueSpan.textContent = String(clamped);
    this.syncRangeFill(row.input, clamped, min, max);
    this.updateSumDisplay();

    if (emitChange) {
      this.onChange?.(this.getValues(), key, clamped);
    }
  }

  setValues(values: Partial<Record<K, number>>, emitChange = false): void {
    for (const [k, v] of Object.entries(values) as [K, number | undefined][]) {
      if (typeof v === 'number' && !Number.isNaN(v)) {
        this.setValue(k, v, false);
      }
    }
    if (emitChange) {
      const keys = Object.keys(values) as K[];
      const lastKey = keys[keys.length - 1];
      if (lastKey !== undefined) {
        this.onChange?.(this.getValues(), lastKey, this.values[lastKey]);
      }
    }
  }

  setOnChange(cb: (values: Record<K, number>, changedKey: K, newValue: number) => void): void {
    this.onChange = cb;
  }

  dispose(): void {
    this.el.remove();
  }
}
