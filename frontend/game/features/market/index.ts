import { defineFeature } from '../../core/registry/types';
import { registerMarketTab } from './tab/register';
import './tab/market-tab.css';

export default defineFeature({
  id: 'market',
  wave: 'W13',
  hud: [{ id: 'market-tab', slot: 'bottom-right', order: 30, mount: (_el, ctx) => registerMarketTab(ctx) }],
});
