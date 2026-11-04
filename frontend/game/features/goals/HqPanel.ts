import type { FeatureContext } from '../../core/registry/types';
import { PrioritiesPanel } from '../priorities/PrioritiesPanel';
import '../priorities/priorities.css';
import { GoalsPanel } from './GoalsPanel';

/** One HQ surface; switching tabs preserves forms, slider state and subscriptions. */
export class HqPanel {
  readonly root = document.createElement('section');
  readonly goals: GoalsPanel;
  readonly priorities: PrioritiesPanel;

  constructor(host: HTMLElement, ctx: FeatureContext) {
    this.root.className = 'ta-hq-command-panel plate-sm';
    this.root.dataset.testid = 'hq-panel';
    const tabs = document.createElement('div');
    tabs.className = 'ta-hq-tabs';
    tabs.setAttribute('role', 'tablist');
    tabs.setAttribute('aria-label', 'HQ');
    const body = document.createElement('div');
    this.goals = new GoalsPanel(body, ctx);
    this.priorities = new PrioritiesPanel(body, ctx);
    const panels = [this.goals.root, this.priorities.root];
    const buttons = ['Goals', 'Priorities'].map((label, index) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'btn btn-ghost btn-sm';
      button.dataset.testid = `hq-tab-${label.toLowerCase()}`;
      button.id = `hq-tab-${label.toLowerCase()}`;
      button.textContent = label;
      button.setAttribute('role', 'tab');
      button.setAttribute('aria-controls', `hq-pane-${index}`);
      panels[index].id = `hq-pane-${index}`;
      panels[index].setAttribute('role', 'tabpanel');
      panels[index].setAttribute('aria-labelledby', button.id);
      button.onclick = () => select(index);
      button.onkeydown = (event) => {
        if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
        event.preventDefault();
        const next = event.key === 'Home' ? 0 : event.key === 'End' ? 1 : 1 - index;
        select(next);
        buttons[next].focus();
      };
      tabs.append(button);
      return button;
    });
    const select = (index: number) => {
      panels.forEach((panel, i) => { panel.hidden = i !== index; });
      buttons.forEach((button, i) => {
        button.setAttribute('aria-selected', String(i === index));
        button.tabIndex = i === index ? 0 : -1;
      });
    };
    select(0);
    this.root.append(tabs, body);
    host.append(this.root);
  }

  update(view?: unknown): void {
    this.goals.update(view);
    this.priorities.update(view);
  }

  dispose(): void {
    this.goals.dispose();
    this.priorities.dispose();
    this.root.remove();
  }
}
