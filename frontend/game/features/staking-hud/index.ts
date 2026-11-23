import { defineFeature, type FeatureContext, type HudPanelInstance } from '../../core/registry/types';
import { StakingPill } from '../shared/stakingPill/pill';

const REFRESH_MS = 60_000;

/** `⚡ TIER N · APY` pill in the `/play.html` HUD (W28-11). Hidden with W28 off and on `?host=local`. */
function mountStakingPill(el: HTMLElement, ctx: FeatureContext): HudPanelInstance {
  if (!ctx.flags.has('W28') || ctx.host === 'local') {
    el.hidden = true;
    return { dispose() {} };
  }
  const pill = new StakingPill({
    query: () => {
      const v = ctx.services.pilot?.view();
      return { accountId: v?.isGuest === false ? v.accountId : null, colonyId: 'col_0', token: v?.accessToken };
    },
  });
  el.append(pill.el);
  void pill.refresh();
  const timer = setInterval(() => { void pill.refresh(); }, REFRESH_MS);
  const off = ctx.services.pilot?.subscribe(() => { void pill.refresh(); });
  return {
    dispose() {
      clearInterval(timer);
      off?.();
      pill.dispose();
    },
  };
}

export default defineFeature({
  id: 'staking-hud',
  wave: 'W28',
  hostOnly: 'server',
  hud: [{ id: 'staking-pill', slot: 'top-right', order: 4, mount: mountStakingPill }],
});
