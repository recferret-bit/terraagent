import type { FeatureContext } from '../../core/registry/types';
import { ownColonyIndex, viewColony } from '../shared/colony';

/**
 * Colony AI on/off switch (default OFF). The host owns the flag (`setAiEnabled`, `ViewColony.aiEnabled`); this button
 * only sends the command and shows what the replica reports. Mounted by `HqPanel` above the Goals / Priorities tabs.
 */
export class AiToggle {
  readonly root = document.createElement('div');
  private readonly button = document.createElement('button');
  private readonly hint = document.createElement('span');
  private enabled = false;

  constructor(host: HTMLElement, private readonly ctx: FeatureContext) {
    this.root.className = 'ta-ai-toggle';
    this.root.dataset.testid = 'hq-ai-toggle-row';
    const label = document.createElement('span');
    label.className = 'ta-ai-toggle__label';
    label.textContent = 'HQ AI';
    this.button.type = 'button';
    this.button.dataset.testid = 'hq-ai-toggle';
    this.button.onclick = () => this.send(!this.enabled);
    this.hint.className = 'ta-ai-toggle__hint';
    this.root.append(label, this.button, this.hint);
    host.append(this.root);
    this.render();
    if (ctx.services.store?.latest) this.update(ctx.services.store.latest);
  }

  private send(next: boolean): void {
    const send = this.ctx.services.sendCommand ?? this.ctx.services.store?.sendCommand;
    if (!send) return;
    void send('setAiEnabled', { enabled: next });
  }

  update(view?: unknown): void {
    if (!view) return;
    const col = viewColony(view, ownColonyIndex(this.ctx.services));
    const next = col?.aiEnabled === true;
    if (next === this.enabled && this.button.textContent) return;
    this.enabled = next;
    this.render();
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  private render(): void {
    this.button.textContent = this.enabled ? 'AI ON' : 'AI OFF';
    this.button.className = this.enabled ? 'btn btn-primary btn-sm' : 'btn btn-ghost btn-sm';
    this.button.setAttribute('aria-pressed', String(this.enabled));
    this.button.title = this.enabled ? 'Bots pick up goals and priorities on their own. Click to take control.' : 'Bots only run your commands. Click to let the HQ AI work on goals and priorities.';
    this.hint.textContent = this.enabled ? 'Bots follow goals and priorities' : 'Bots wait for your orders';
    this.root.dataset.enabled = String(this.enabled);
  }

  dispose(): void {
    this.root.remove();
  }
}
