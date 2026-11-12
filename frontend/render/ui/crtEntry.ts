import { initCrt } from './crt';

// Landing page: only the live WebGL pictures get the old-TV look, never the page interface.
// Effects (CRT, Pixel-Art, Shadows) are enabled by default on landing with no toggle bar or FPS counter.
const canvasParents = [...document.querySelectorAll('canvas')].map((c) => c.parentElement);
const stageHosts = [...document.querySelectorAll<HTMLElement>('#hero-stage, #colony-stage, #rv-stage')];
const hosts = [...canvasParents, ...stageHosts].filter((e): e is HTMLElement => !!e);
initCrt([...new Set(hosts)], { showControls: false, showFps: false, forceEnableAll: true });
