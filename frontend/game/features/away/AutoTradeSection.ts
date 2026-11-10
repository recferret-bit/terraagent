import type { AutoTradeLimits, DirectorKeyStatusPayload } from '@terra/contracts';
import { dispatchCommand, type CommandOutcome } from '../shared/commandDispatch';
import {
  autoTradePartners,
  directorAllowanceText,
  emptyAutoTrade,
  isT1Resource,
  limitsForSave,
  shownLimit,
  tradeError,
  type AutoTradeRecord,
  type TradeDraft,
} from './autotrade';
import { buildAutoTradeDom, type AutoTradeDom } from './autotradeDom';
import { requestDirectorKey } from './directorKey';
import type { AwayPanelOptions } from './options';
import { loadAutoTrade, saveAutoTrade } from './storage';

/**
 * Settings → Away autoTrade (W15-23). Limits go out as `setAutoTrade` and stay in localStorage after the ack.
 * The director key is `POST` / `DELETE /v1/near/director-key`; a `director.status` push paints the same line.
 */
export class AutoTradeSection {
  private readonly dom: AutoTradeDom;
  private readonly w18: boolean;
  private saved: AutoTradeRecord;
  private lastKey: DirectorKeyStatusPayload | null = null;
  private offDirector: (() => void) | null = null;
  private busy = false;

  constructor(
    parent: HTMLElement,
    private readonly opts: AwayPanelOptions,
  ) {
    this.w18 = opts.flags?.has('W18') ?? false;
    this.saved = loadAutoTrade();
    this.dom = buildAutoTradeDom(parent, autoTradePartners(this.w18));
    this.bind();
    this.paint();
    const off = opts.subscribeDirector?.((payload) => this.onPush(payload));
    this.offDirector = typeof off === 'function' ? off : null;
  }

  dispose(): void {
    this.offDirector?.();
    this.offDirector = null;
  }

  private bind(): void {
    this.dom.resource.addEventListener('change', () => this.onResource());
    this.dom.save.addEventListener('click', () => {
      void this.save();
    });
    this.dom.toggle.addEventListener('click', () => {
      void this.enable();
    });
    this.dom.revoke.addEventListener('click', () => {
      void this.revoke();
    });
  }

  private onResource(): void {
    this.paintFields(this.resource());
    if (this.lastKey) this.paintKey(this.lastKey);
  }

  private resource(): string {
    return isT1Resource(this.dom.resource.value) ? this.dom.resource.value : 'metals.t1';
  }

  private read(): TradeDraft {
    return {
      resource: this.dom.resource.value,
      sellAboveStoragePct: Number(this.dom.sell.value),
      maxPerTrade: Number(this.dom.maxTrade.value),
      maxPerSession: Number(this.dom.maxSession.value),
      minStock: Number(this.dom.minStock.value),
      partners: this.dom.partners.value,
    };
  }

  /** Invalid input is not sent. The field stays so the reject still shows the bad number. */
  private validated(): { resource: AutoTradeRecord['resource']; limits: AutoTradeLimits } | null {
    const draft = this.read();
    const problem = tradeError(draft, this.w18);
    if (problem || !isT1Resource(draft.resource)) {
      this.setTradeStatus(`rejected: ${problem ?? 'resource is not tradable'}`, 'rejected');
      return null;
    }
    return { resource: draft.resource, limits: limitsForSave(this.saved.limits, draft) };
  }

  private async save(): Promise<void> {
    if (this.busy) return;
    const built = this.validated();
    if (!built) return;
    if (!this.opts.sendCommand && !this.opts.store?.sendCommand) {
      this.setTradeStatus('rejected: not connected', 'rejected');
      return;
    }
    this.busy = true;
    this.dom.save.disabled = true;
    try {
      const outcome = await this.send(built.limits);
      this.finishSave(built, outcome);
    } finally {
      this.busy = false;
      this.dom.save.disabled = false;
    }
  }

  private finishSave(
    built: { resource: AutoTradeRecord['resource']; limits: AutoTradeLimits },
    outcome: CommandOutcome | undefined,
  ): void {
    if (!outcome?.ok) {
      this.paint();
      this.setTradeStatus(`rejected: ${rejectText(outcome)}`, 'rejected');
      return;
    }
    this.saved = { resource: built.resource, limits: built.limits };
    saveAutoTrade(this.saved);
    this.paint();
    this.setTradeStatus('saved', 'saved');
  }

  private send(limits: AutoTradeLimits): Promise<CommandOutcome | undefined> {
    return dispatchCommand(
      { sendCommand: this.opts.sendCommand, store: this.opts.store },
      'setAutoTrade',
      { limits },
      0,
    ).result;
  }

  private async enable(): Promise<void> {
    if (this.busy || this.dom.toggle.getAttribute('aria-checked') === 'true') return;
    const built = this.validated();
    if (!built) return;
    const colonyId = this.opts.colonyId?.() ?? null;
    if (!colonyId) {
      this.setKeyStatus('rejected: no colony', 'rejected');
      return;
    }
    this.busy = true;
    this.dom.toggle.disabled = true;
    try {
      this.paintKey(await requestDirectorKey('POST', { colonyId, limits: built.limits }, this.opts));
    } catch (err) {
      this.setKeyStatus(`rejected: ${messageOf(err)}`, 'rejected');
    } finally {
      this.busy = false;
      this.dom.toggle.disabled = false;
    }
  }

  private async revoke(): Promise<void> {
    if (this.busy || this.dom.revoke.hidden) return;
    const colonyId = this.opts.colonyId?.() ?? null;
    if (!colonyId) {
      this.setKeyStatus('rejected: no colony', 'rejected');
      return;
    }
    this.busy = true;
    this.dom.revoke.disabled = true;
    try {
      const payload = await requestDirectorKey('DELETE', { colonyId }, this.opts);
      this.paintKey(payload);
      if (payload.state !== 'revoked') this.setKeyStatus('rejected: key still active', 'rejected');
    } catch (err) {
      this.dom.revoke.disabled = false;
      this.setKeyStatus(`rejected: ${messageOf(err)}`, 'rejected');
    } finally {
      this.busy = false;
    }
  }

  private onPush(payload: DirectorKeyStatusPayload): void {
    const colonyId = this.opts.colonyId?.();
    if (colonyId && payload.colonyId !== colonyId) return;
    this.paintKey(payload);
  }

  private paint(): void {
    const resource = isT1Resource(this.saved.resource) ? this.saved.resource : emptyAutoTrade().resource;
    this.dom.resource.value = resource;
    this.paintFields(resource);
    if (this.lastKey) this.paintKey(this.lastKey);
  }

  private paintFields(resource: string): void {
    const key = isT1Resource(resource) ? resource : 'metals.t1';
    const row = shownLimit(this.saved.limits, key);
    this.dom.sell.value = String(row.sellAboveStoragePct ?? 80);
    this.dom.maxTrade.value = String(row.maxPerTrade);
    this.dom.maxSession.value = String(row.maxPerSession);
    this.dom.minStock.value = String(row.minStock);
    const allowed = autoTradePartners(this.w18);
    this.dom.partners.value = allowed.includes(row.partners) ? row.partners : 'guild';
  }

  private paintKey(payload: DirectorKeyStatusPayload): void {
    this.lastKey = payload;
    const text = directorAllowanceText(payload, this.resource());
    const active = payload.state === 'active';
    this.dom.keyStatus.textContent = text;
    if (payload.state === 'revoked') this.dom.keyStatus.dataset.state = 'revoked';
    else if (active && text) this.dom.keyStatus.dataset.state = 'active';
    else delete this.dom.keyStatus.dataset.state;
    this.dom.revoke.hidden = !active;
    this.dom.revoke.disabled = !active;
    this.dom.toggle.setAttribute('aria-checked', active ? 'true' : 'false');
  }

  private setTradeStatus(text: string, state: 'saved' | 'rejected' | 'idle'): void {
    this.dom.tradeStatus.textContent = text;
    if (state === 'idle') delete this.dom.tradeStatus.dataset.state;
    else this.dom.tradeStatus.dataset.state = state;
  }

  private setKeyStatus(text: string, state: 'rejected' | 'idle'): void {
    this.dom.keyStatus.textContent = text;
    if (state === 'idle') delete this.dom.keyStatus.dataset.state;
    else this.dom.keyStatus.dataset.state = state;
  }
}

function rejectText(outcome: CommandOutcome | undefined): string {
  if (!outcome) return 'no ack';
  return outcome.detail ? `${outcome.code ?? 'rejected'} ${outcome.detail}` : (outcome.code ?? 'rejected');
}

function messageOf(err: unknown): string {
  return err instanceof Error && err.message ? err.message : 'request failed';
}
