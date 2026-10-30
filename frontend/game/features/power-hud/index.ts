import { defineFeature } from '../../core/registry/types';
import { PowerHud } from './PowerHud';
import './power-hud.css';

declare module '../../core/registry/types' {
  interface GameView {
    selectedEntityId?: number;
    blobs?: {
      power?: {
        byColony?: Record<number, unknown>;
      };
      environment?: {
        daylight?: number;
        phase?: 'day' | 'night';
        clockText?: string;
      };
      [key: string]: unknown;
    };
  }
}

export default defineFeature({
  id: 'power-hud',
  wave: 'W02',
  hud: [
    {
      id: 'power-hud',
      slot: 'top-right',
      order: 10,
      mount(el, ctx) {
        const hud = new PowerHud(el, ctx);
        return {
          update(view) {
            hud.update(view);
          },
          dispose() {
            hud.dispose();
          },
        };
      },
    },
  ],
});
