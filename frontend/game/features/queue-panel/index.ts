import { defineFeature } from '../../core/registry/types';
import { QueuePanel } from './QueuePanel';
import './queue-panel.css';

export { QueuePanel } from './QueuePanel';

declare module '../../core/registry/types' {
  interface FeatureServices {
    cancelQueueTask?: (taskId: string) => void;
    getQueuePanel?: () => QueuePanel | null;
  }
}

let activePanel: QueuePanel | null = null;

export default defineFeature({
  id: 'queue-panel',
  wave: 'W02',
  hud: [
    {
      id: 'queue-panel',
      slot: 'right',
      order: 10,
      mount(el, ctx) {
        const panel = new QueuePanel(el, ctx);
        activePanel = panel;
        ctx.services.getQueuePanel = () => activePanel;
        return {
          update(view) {
            panel.update(view);
          },
          dispose() {
            if (activePanel === panel) activePanel = null;
            panel.dispose();
          },
        };
      },
    },
  ],
});
