import { defineFeature, type FeatureContext } from '../../core/registry/types';
import { AwayDigestModal } from './AwayDigestModal';
import './away-digest.css';

declare module '../../core/registry/types' {
  interface FeatureServices {
    /** Mounted with the W09 away plate. Join welcomes call `showWelcome`. */
    awayDigest?: AwayDigestModal;
  }
}

function parentOf(el: HTMLElement): HTMLElement {
  return el.ownerDocument?.body ?? el;
}

function watchStore(modal: AwayDigestModal, ctx: FeatureContext): () => void {
  const store = ctx.services.store;
  const pending = store?.latestAway?.();
  if (pending) modal.show(pending);
  return store?.onAwayDigest?.((digest) => modal.show(digest)) ?? (() => {});
}

/** While-you-were-away plate. Absent unless wave `W09` is on. */
export default defineFeature({
  id: 'away-digest',
  wave: 'W09',
  hud: [{
    id: 'away-digest',
    slot: 'top-center',
    mount(el, ctx) {
      el.hidden = true;
      const modal = new AwayDigestModal(ctx.services.hudOverlay ?? parentOf(el));
      ctx.services.awayDigest = modal;
      const off = watchStore(modal, ctx);
      const offCloser = ctx.services.registerHudCloser?.(() => modal.dismiss());
      return {
        dispose() {
          off();
          offCloser?.();
          if (ctx.services.awayDigest === modal) ctx.services.awayDigest = undefined;
          modal.dispose();
        },
      };
    },
  }],
});
