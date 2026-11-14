import type { AwayDigestV1 } from '@terra/contracts';
import { defineFeature, type FeatureContext } from '../../core/registry/types';
import { pushNotification } from '../notifications/notificationStore';
import { AwayDigestModal } from './AwayDigestModal';
import { awayIdentity, formatAwayDuration } from './format';
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

function recordAndShow(modal: AwayDigestModal, digest: AwayDigestV1): void {
  modal.show(digest);
  pushNotification({
    category: 'colony',
    title: 'While You Were Away',
    message: `Away for ${formatAwayDuration(digest.durationS)} — click to inspect session report`,
    dedupeKey: `away-digest:${awayIdentity(digest)}`,
    onSelect: () => modal.reopen(digest),
  });
}

function watchStore(modal: AwayDigestModal, ctx: FeatureContext): () => void {
  const store = ctx.services.store;
  const pending = store?.latestAway?.();
  if (pending) recordAndShow(modal, pending);
  return store?.onAwayDigest?.((digest) => recordAndShow(modal, digest)) ?? (() => {});
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
