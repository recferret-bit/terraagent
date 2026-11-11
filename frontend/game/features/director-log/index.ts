import { defineFeature } from '../../core/registry/types';
import { DirectorEventLog } from './log';
import './director-log.css';

/** Director sentences in the HUD event log. Absent unless `W15` is on; lines appear only while `W09` is off. */
export default defineFeature({
  id: 'director-log',
  wave: 'W15',
  hud: [{
    id: 'director-log',
    slot: 'bottom-left',
    order: 30,
    mount(el, ctx) {
      el.hidden = true;
      const log = new DirectorEventLog(ctx.services.hudOverlay ?? el, {
        showLine: () => !ctx.flags.has('W09'),
      });
      const off = ctx.services.store?.onServerEvents?.((events) => log.pushEvents(events)) ?? (() => {});
      return {
        dispose() {
          off();
          log.dispose();
        },
      };
    },
  }],
});
