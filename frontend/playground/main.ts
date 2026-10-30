import '../design/css/tokens.css';
import '../design/css/base.css';
import './playground.css';
import '@terra/render/kitbash';
import { PlaygroundApp } from './PlaygroundApp';

const app = new PlaygroundApp(new URLSearchParams(location.search));
app.start();
(window as any).__pg = app.debug; // QA hooks
