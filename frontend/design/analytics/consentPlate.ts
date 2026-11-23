const PLATE_CSS = `
.ta-analytics-consent{position:fixed;right:var(--ta-s4);bottom:var(--ta-s4);z-index:80;max-width:360px;display:flex;flex-direction:column;gap:var(--ta-s3);padding:var(--ta-s4);background:var(--ta-plate);color:var(--ta-text);border:1px solid var(--ta-seam-2);font-family:var(--ta-font-body);font-size:var(--ta-fs-small);line-height:1.45;clip-path:polygon(var(--ta-chamfer-m) 0,100% 0,100% calc(100% - var(--ta-chamfer-m)),calc(100% - var(--ta-chamfer-m)) 100%,0 100%,0 var(--ta-chamfer-m))}
.ta-analytics-consent p{margin:0;color:var(--ta-text-2)}
.ta-analytics-consent .ta-analytics-actions{display:flex;gap:var(--ta-s2)}
.ta-analytics-consent button{font-family:var(--ta-font-display);font-weight:700;letter-spacing:var(--ta-track-button);text-transform:uppercase;cursor:pointer;min-height:40px;padding:10px 16px;clip-path:polygon(var(--ta-chamfer-s) 0,100% 0,100% calc(100% - var(--ta-chamfer-s)),calc(100% - var(--ta-chamfer-s)) 100%,0 100%,0 var(--ta-chamfer-s))}
.ta-analytics-allow{background:var(--ta-orange);color:var(--ta-void);border:0}
.ta-analytics-later{background:transparent;color:var(--ta-text);border:1.5px solid var(--ta-seam-3)}
`;

function ensurePlateCss(): void {
  if (typeof document === 'undefined' || document.getElementById('ta-analytics-consent-css')) return;
  const style = document.createElement('style');
  style.id = 'ta-analytics-consent-css';
  style.textContent = PLATE_CSS;
  document.head.appendChild(style);
}

export function mountConsentPlate(opts: { onAllow(): void; onDecline(): void }): void {
  if (typeof document === 'undefined' || !document.body) return;
  if (document.querySelector('[data-testid="analytics-consent"]')) return;
  ensurePlateCss();
  const plate = document.createElement('aside');
  plate.className = 'ta-analytics-consent plate';
  plate.dataset.testid = 'analytics-consent';
  plate.setAttribute('role', 'dialog');
  plate.setAttribute('aria-label', 'Product analytics');
  const copy = document.createElement('p');
  copy.textContent = 'Anonymous product analytics. No account id and no IP. Used to see which step fails.';
  const actions = document.createElement('div');
  actions.className = 'ta-analytics-actions';
  const allow = document.createElement('button');
  allow.type = 'button';
  allow.className = 'ta-analytics-allow';
  allow.dataset.testid = 'analytics-consent-allow';
  allow.textContent = 'Allow';
  const later = document.createElement('button');
  later.type = 'button';
  later.className = 'ta-analytics-later';
  later.dataset.testid = 'analytics-consent-decline';
  later.textContent = 'Not now';
  const close = (): void => plate.remove();
  allow.onclick = () => { close(); opts.onAllow(); };
  later.onclick = () => { close(); opts.onDecline(); };
  actions.append(allow, later);
  plate.append(copy, actions);
  document.body.append(plate);
}
