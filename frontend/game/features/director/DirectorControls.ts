import {
  DIRECTOR_PRESETS,
  DIRECTOR_RISKS,
  type DirectorPolicyV1,
  type DirectorPreset,
  type DirectorRisk,
  type SetDirectorPolicyArgs,
} from '@terra/contracts';

/** Player director controls. There is no away-raid field. Risk cannot add one. */
export class DirectorControls {
  private readonly riskEl: HTMLSelectElement;
  private readonly presetEl: HTMLSelectElement;
  private readonly noteEl: HTMLTextAreaElement;
  private readonly pauseEl: HTMLInputElement;

  constructor(
    private readonly host: HTMLElement,
    private readonly onChange?: (patch: SetDirectorPolicyArgs) => void,
  ) {
    this.host.classList.add('ta-director-controls');
    this.riskEl = select('risk', DIRECTOR_RISKS);
    this.presetEl = select('preset', DIRECTOR_PRESETS);
    this.noteEl = document.createElement('textarea');
    this.noteEl.name = 'note';
    this.noteEl.maxLength = 500;
    this.noteEl.rows = 2;
    this.noteEl.placeholder = 'Note for the director (optional)';
    this.noteEl.setAttribute('aria-label', 'Director note');
    this.pauseEl = document.createElement('input');
    this.pauseEl.type = 'checkbox';
    this.pauseEl.name = 'pause';

    const emit = () => this.onChange?.(this.read());
    this.riskEl.addEventListener('change', emit);
    this.presetEl.addEventListener('change', emit);
    this.pauseEl.addEventListener('change', emit);
    this.noteEl.addEventListener('change', emit);

    const grid = document.createElement('div');
    grid.className = 'ta-director-controls__grid';
    grid.append(labeledField('RISK PROFILE', this.riskEl), labeledField('STRATEGY FOCUS', this.presetEl));
    const noteField = labeledField('COMMANDER DIRECTIVE', this.noteEl);
    noteField.classList.add('ta-director-controls__field--full');
    const pauseLabel = document.createElement('label');
    pauseLabel.className = 'ta-director-controls__pause';
    pauseLabel.append(this.pauseEl, ' Pause director');
    this.host.append(grid, noteField, pauseLabel);
  }

  /** Syncs controls from authoritative colony policy without emitting a synthetic change event. */
  sync(policy: DirectorPolicyV1): void {
    this.riskEl.value = policy.risk;
    this.presetEl.value = policy.preset;
    this.pauseEl.checked = policy.pause;
    if (typeof document === 'undefined' || document.activeElement !== this.noteEl) {
      this.noteEl.value = policy.note ?? '';
    }
  }

  /** Args for `setDirectorPolicy`. Unknown controls are ignored. */
  read(): SetDirectorPolicyArgs {
    const risk = valueOf(this.host, 'risk');
    const preset = valueOf(this.host, 'preset');
    const note = this.host.querySelector('textarea');
    const pause = this.host.querySelector<HTMLInputElement>('input[name="pause"]');
    return {
      ...(isRisk(risk) ? { risk } : {}),
      ...(isPreset(preset) ? { preset } : {}),
      ...(note ? { note: note.value } : {}),
      ...(pause ? { pause: pause.checked } : {}),
    };
  }

  dispose(): void {
    this.host.replaceChildren();
  }
}

function labeledField(labelText: string, control: HTMLElement): HTMLElement {
  const wrap = document.createElement('label');
  wrap.className = 'ta-director-controls__field';
  const text = document.createElement('span');
  text.className = 'ta-director-controls__label';
  text.textContent = labelText;
  wrap.append(text, control);
  return wrap;
}

function select(name: string, options: readonly string[]): HTMLSelectElement {
  const el = document.createElement('select');
  el.name = name;
  el.setAttribute('aria-label', `Director ${name}`);
  el.title = `Director ${name}`;
  for (const option of options) {
    const item = document.createElement('option');
    item.value = option;
    item.textContent = option;
    el.append(item);
  }
  return el;
}

function valueOf(host: HTMLElement, name: string): string {
  return host.querySelector<HTMLSelectElement>(`select[name="${name}"]`)?.value ?? '';
}

function isRisk(value: string): value is DirectorRisk {
  return (DIRECTOR_RISKS as readonly string[]).includes(value);
}

function isPreset(value: string): value is DirectorPreset {
  return (DIRECTOR_PRESETS as readonly string[]).includes(value);
}
