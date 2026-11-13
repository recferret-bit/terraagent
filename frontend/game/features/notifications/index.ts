import { defineFeature } from '../../core/registry/types';
import { NotificationsPanel } from './NotificationsPanel';
import './notifications.css';

export * from './notificationStore';
export { NotificationsPanel } from './NotificationsPanel';

export default defineFeature({
  id: 'notifications',
  wave: 'W01',
  hud: [
    {
      id: 'notifications-panel',
      slot: 'top-right',
      order: 95,
      mount(el, ctx) {
        return new NotificationsPanel(el, ctx);
      },
    },
  ],
});
