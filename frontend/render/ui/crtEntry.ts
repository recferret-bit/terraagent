import { initCrt } from './crt';

// Landing page: only the live WebGL pictures get the old-TV look, never the page interface.
const hosts = [...document.querySelectorAll('canvas')].map((c) => c.parentElement).filter((e): e is HTMLElement => !!e);
initCrt([...new Set(hosts)]);
