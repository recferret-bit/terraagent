import { dispatchCommand, type CommandOutcome, type CommandSink } from '../shared/commandDispatch';
import { buildAwayDom, type AwayDom } from './dom';
import { AWAY_FAMILIES, diffAutopilot, type AwayFamily, type AwaySettings } from './model';
import { loadAwaySettings, saveAwaySettings } from './storage';

export interface AwayPanelOptions {
  sendCommand?: CommandSink['sendCommand'];
  store?: CommandSink['store'];
}

/**
 * Away settings (W09-14). Session percents are the sliders. The directive percent is the stored
 * default, shown as text. A save is committed only when `setAutopilot` acks.
 */
export class AwayPanel {
  private readonly dom: AwayDom;
  private saved: AwaySettings;
  private open = true;
  private inflight = false;

  constructor(host: HTMLElement, private readonly opts: AwayPanelOptions = {}) {
    this.saved = loadAwaySettings();
    this.dom = buildAwayDom(host);
    this.bind();
    this.paint();
    this.setOpen(true);
  }

  dispose(): void {
    const host = this.dom.toggle.parentElement;
    if (!host) return;
    host.replaceChildren();
    host.classList.remove('ta-away', 'plate-sm');
  }

  private bind(): void {
    this.dom.toggle.addEventListener('click', () => this.setOpen(!this.open));
    this.dom.save.addEventListener('click', () => { void this.save(); });
    for (const family of AWAY_FAMILIES) {
      this.dom.sessions[family].addEventListener('input', () => this.onSlide(family));
    }
  }

  private setOpen(open: boolean): void {
    this.open = open;
    this.dom.body.hidden = !open;
    this.dom.toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
    this.dom.caret.textContent = open ? '▾' : '▸';
  }

  private onSlide(family: AwayFamily): void {
    const n = Number(this.dom.sessions[family].value);
    this.dom.readouts[family].textContent = Number.isFinite(n) ? `${Math.round(n)}%` : '—';
  }

  private read(): AwaySettings {
    const mode = this.dom.mode.value === 'rules_only' ? 'rules_only' : 'director';
    return {
      mode,
      awayRaids: this.dom.raids.checked,
      session: {
        metals: Number(this.dom.sessions.metals.value),
        minerals: Number(this.dom.sessions.minerals.value),
        bio: Number(this.dom.sessions.bio.value),
      },
    };
  }

  private async save(): Promise<void> {
    if (this.inflight) return;
    const next = this.read();
    const diff = diffAutopilot(this.saved, next);
    if (diff.kind === 'invalid') {
      this.paint();
      this.setStatus('rejected: budget must be 0–100', 'rejected');
      return;
    }
    if (diff.kind === 'empty') {
      this.setStatus('no changes', 'idle');
      return;
    }
    if (!this.opts.sendCommand && !this.opts.store?.sendCommand) {
      this.setStatus('rejected: not connected', 'rejected');
      return;
    }
    this.inflight = true;
    this.dom.save.disabled = true;
    try {
      const outcome = await this.send(diff.args);
      this.finish(next, outcome);
    } finally {
      this.inflight = false;
      this.dom.save.disabled = false;
    }
  }

  private send(args: unknown): Promise<CommandOutcome | undefined> {
    return dispatchCommand(
      { sendCommand: this.opts.sendCommand, store: this.opts.store },
      'setAutopilot',
      args,
      0,
    ).result;
  }

  /** Ack commits the draft and localStorage. A reject restores the last ack and does not persist. */
  private finish(next: AwaySettings, outcome: CommandOutcome | undefined): void {
    if (!outcome?.ok) {
      this.paint();
      this.setStatus(`rejected: ${rejectText(outcome)}`, 'rejected');
      return;
    }
    this.saved = next;
    saveAwaySettings(this.saved);
    this.paint();
    this.setStatus('saved', 'saved');
  }

  private paint(): void {
    this.dom.mode.value = this.saved.mode;
    this.dom.raids.checked = this.saved.awayRaids;
    for (const family of AWAY_FAMILIES) {
      const pct = this.saved.session[family];
      this.dom.sessions[family].value = String(pct);
      this.dom.readouts[family].textContent = `${pct}%`;
    }
  }

  private setStatus(text: string, state: 'saved' | 'rejected' | 'idle'): void {
    this.dom.status.textContent = text;
    if (state === 'idle') delete this.dom.status.dataset.state;
    else this.dom.status.dataset.state = state;
  }
}

function rejectText(outcome: CommandOutcome | undefined): string {
  if (!outcome) return 'no ack';
  return outcome.detail ? `${outcome.code ?? 'rejected'} ${outcome.detail}` : (outcome.code ?? 'rejected');
}
