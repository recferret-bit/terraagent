import '../design/css/tokens.css';
import '../design/css/base.css';
import './playground.css';
import '@terra/render/kitbash';
import { initFpsCounter } from '@terra/render/ui/fps';
import { PlaygroundApp } from './PlaygroundApp';

const app = new PlaygroundApp(new URLSearchParams(location.search));
app.start();
initFpsCounter();
(window as any).__pg = app.debug; // QA hooks
