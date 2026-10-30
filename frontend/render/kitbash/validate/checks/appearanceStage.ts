// Stage 6: appearance (colour fit, group separation, surface detail). Only for models built by the Builder.
import { checkAppearance } from '../appearance';
import type { CheckStage } from '../context';

export const appearanceStage: CheckStage = (ctx) => {
  const { o, R } = ctx;
  if (!o.appearance || ctx.model.source !== 'builder') return;
  const a = checkAppearance(ctx.parts, (i, j) => R(i, j).dist <= o.contactTol, o);
  ctx.issues.push(...a.issues); ctx.roles = a.roles; ctx.meanL = a.meanL;
};
