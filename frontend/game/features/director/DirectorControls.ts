import { DIRECTOR_PRESETS, DIRECTOR_RISKS, type DirectorPreset, type DirectorRisk, type SetDirectorPolicyArgs } from '@terra/contracts';

/** Player director controls. There is no away-raid field. Risk cannot add one. */
export class DirectorControls {
  constructor(private readonly host: HTMLElement) {
    this.host.classList.add('ta-director-controls');
    const risk = select('risk', DIRECTOR_RISKS);
    const preset = select('preset', DIRECTOR_PRESETS);
    const note = document.createElement('textarea');
    note.name = 'note';
    note.maxLength = 500;
    const pause = document.createElement('input');
    pause.type = 'checkbox';
    pause.name = 'pause';
    this.host.append(risk, preset, note, pause);
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

function select(name: string, options: readonly string[]): HTMLSelectElement {
  const el = document.createElement('select');
  el.name = name;
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
