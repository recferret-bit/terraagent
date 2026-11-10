import '../design/css/tokens.css';
import '../design/css/base.css';
import './playground.css';
import './panels/dock.css';
import './panels/sidebar.css';
import './panels/toolbar.css';
import './panels/info.css';
import './panels/extra-docks.css';
import '@terra/render/kitbash';
import { initCrt } from '@terra/render/ui/crt';
import { mountDeedCardShowcase } from '../design/deed/deedCardArt';
import { PlaygroundApp } from './PlaygroundApp';

const params = new URLSearchParams(location.search);
if (params.get('deedcard') === '1') {
  (window as any).__pgDeedShowcase = mountDeedCardShowcase(document.body);
} else {
  const app = new PlaygroundApp(params);
  app.start();
  const viewport = document.getElementById('viewport');
  if (viewport) initCrt([viewport]);
  const fxBar = document.getElementById('fx-bar');
  const stage = document.getElementById('stage');
  if (fxBar && stage) stage.appendChild(fxBar);
  (window as any).__pg = app.debug; // QA hooks
}
