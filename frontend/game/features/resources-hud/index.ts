import { defineFeature } from '../../core/registry/types';
import { ResourcesHud } from './ResourcesHud';
import './resources-hud.css';

export { ResourcesHud };

export default defineFeature({
  id: 'resources-hud',
  wave: 'W02',
  hud: [],
});
