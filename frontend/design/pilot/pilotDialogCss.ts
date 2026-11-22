export const PILOT_DIALOG_CSS = `
.pilot-access-bar{display:inline-flex;align-items:center;gap:var(--ta-s2);flex-wrap:wrap}
.pilot-dialog{margin:auto;padding:var(--ta-s5);min-width:320px;max-width:390px;background:var(--ta-plate);color:var(--ta-text);border:1px solid var(--ta-seam-2);overscroll-behavior:contain}
.pilot-dialog::backdrop{background:color-mix(in srgb,var(--ta-black-hole) 74%,transparent);backdrop-filter:blur(4px)}
.pilot-dialog-head{display:flex;align-items:center;justify-content:space-between;gap:var(--ta-s3);margin-bottom:var(--ta-s3)}
.pilot-dialog-tabs{display:grid;grid-template-columns:1fr 1fr;gap:var(--ta-s2);margin-bottom:var(--ta-s3)}
.pilot-dialog-sub{font-size:var(--ta-fs-eyebrow);color:var(--ta-text-3);margin:0 0 var(--ta-s3);line-height:1.4}
.pilot-dialog-list{display:flex;flex-direction:column;gap:var(--ta-s2)}
.pilot-dialog-list .btn{width:100%;justify-content:center}
.pilot-email-box{display:flex;flex-direction:column;gap:var(--ta-s2);padding:var(--ta-s2);background:var(--ta-plate-2);border:1px solid var(--ta-seam)}
.pilot-email-box input{width:100%;box-sizing:border-box}
.pilot-status{font-family:var(--ta-font-mono);font-size:var(--ta-fs-label);color:var(--ta-fault-text)}
`;

export function ensurePilotDialogStyles(): void {
  if (typeof document === 'undefined' || document.getElementById('pilot-dialog-css')) return;
  const style = document.createElement('style');
  style.id = 'pilot-dialog-css';
  style.textContent = PILOT_DIALOG_CSS;
  document.head.appendChild(style);
}

