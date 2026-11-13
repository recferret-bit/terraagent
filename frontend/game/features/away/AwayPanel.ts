import { patchSharedAutopilotState, subscribeSharedAutopilotState } from '../shared/aiAutopilotState';
import { dispatchCommand, type CommandOutcome } from '../shared/commandDispatch';
import { AutoTradeSection } from './AutoTradeSection';
import { buildAwayDom, type AwayDom } from './dom';
import { AWAY_FAMILIES, diffAutopilot, isSessionPct, parseMercenarySpend, type AwayFamily, type AwaySettings } from './model';
import type { AwayPanelOptions } from './options';
import { loadAwaySettings, saveAwaySettings } from './storage';

export type { AwayPanelOptions } from './options';

/**
 * Away settings (W09-14). Session percents are the sliders. The directive percent is the stored
 * default, shown as text. A save is committed only when `setAutopilot` acks.
 */
export class AwayPanel {
  private readonly dom: AwayDom;
  private readonly trade: AutoTradeSection | null;
  private readonly offShared: () => void;
  private saved: AwaySettings;
  private open = true;
  private inflight = false;

  constructor(host: HTMLElement, private readonly opts: AwayPanelOptions = {}) {
    this.saved = loadAwaySettings();
    patchSharedAutopilotState({
      awayRaids: this.saved.awayRaids,
      mode: this.saved.mode,
    });
    this.dom = buildAwayDom(host, { mercenary: opts.mercenary === true });
    this.trade = opts.flags?.has('W15') ? new AutoTradeSection(this.dom.body, opts) : null;
    this.bind();
    this.paint();
    this.setOpen(true);
    this.offShared = subscribeSharedAutopilotState((st) => {
      if (st.awayRaids !== this.saved.awayRaids) {
        this.saved = { ...this.saved, awayRaids: st.awayRaids };
        this.dom.raids.checked = st.awayRaids;
      }
      if (st.mode !== this.saved.mode) {
        this.saved = { ...this.saved, mode: st.mode };
        this.dom.mode.value = st.mode;
      }
    });
  }

  dispose(): void {
    this.offShared();
    this.trade?.dispose();
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

  private read(): AwaySettings | 'budget' | 'spend' {
    const session = {
      metals: Number(this.dom.sessions.metals.value),
      minerals: Number(this.dom.sessions.minerals.value),
      bio: Number(this.dom.sessions.bio.value),
    };
    if (AWAY_FAMILIES.some((family) => !isSessionPct(session[family]))) return 'budget';
    const hire = this.readHire();
    if (hire === 'spend') return 'spend';
    const mode = this.dom.mode.value === 'rules_only' ? 'rules_only' : 'director';
    return { mode, awayRaids: this.dom.raids.checked, session, ...hire };
  }

  /** Hidden controls keep the last ack, so a W22-off save does not send a hire. */
  private readHire(): Pick<AwaySettings, 'hireMercenaries' | 'mercenaryMaxSpend'> | 'spend' {
    if (!this.dom.mercenaries || !this.dom.maxSpend) {
      return { hireMercenaries: this.saved.hireMercenaries, mercenaryMaxSpend: this.saved.mercenaryMaxSpend };
    }
    const spend = parseMercenarySpend(this.dom.maxSpend.value);
    if (spend === null) return 'spend';
    return { hireMercenaries: this.dom.mercenaries.checked, mercenaryMaxSpend: spend };
  }

  private async save(): Promise<void> {
    if (this.inflight) return;
    const next = this.read();
    if (next === 'budget' || next === 'spend') {
      this.paint();
      this.setStatus(rejectDraft(next), 'rejected');
      return;
    }
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
    patchSharedAutopilotState({
      awayRaids: this.saved.awayRaids,
      mode: this.saved.mode,
    });
    this.paint();
    this.setStatus('saved', 'saved');
  }

  private paint(): void {
    this.dom.mode.value = this.saved.mode;
    this.dom.raids.checked = this.saved.awayRaids;
    if (this.dom.mercenaries) this.dom.mercenaries.checked = this.saved.hireMercenaries;
    if (this.dom.maxSpend) this.dom.maxSpend.value = String(this.saved.mercenaryMaxSpend);
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

function rejectDraft(field: 'budget' | 'spend'): string {
  return field === 'spend' ? 'rejected: max spend must be a whole number' : 'rejected: budget must be 0–100';
}

function rejectText(outcome: CommandOutcome | undefined): string {
  if (!outcome) return 'no ack';
  return outcome.detail ? `${outcome.code ?? 'rejected'} ${outcome.detail}` : (outcome.code ?? 'rejected');
}
