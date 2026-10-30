import { Game } from './app/Game';
import { initCrt } from '@terra/render/ui/crt';

const app = document.getElementById('app')!;
const game = new Game(app);
initCrt([app]); // old-TV look over the 3D picture only; menus/HUD layers sit above #app
(window as any).__game = game;
if (import.meta.hot) import.meta.hot.dispose(() => game.dispose());
