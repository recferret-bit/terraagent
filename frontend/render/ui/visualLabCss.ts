/** Inline CSS of the F8 Visual Shader Lab dialog (`pixelDialog.ts`): Faction-Plate look, chamfered plates. */
export const VISUAL_LAB_CSS = `
#pixel-dlg{position:fixed;left:12px;bottom:52px;z-index:70;width:336px;display:none;flex-direction:column;
  font:500 11px/1.35 ui-monospace,SFMono-Regular,Menlo,monospace;color:#f2f4f7;
  background:rgba(11,13,17,.94);border:1px solid #2a3140;border-top:3px solid #ff6a13;
  backdrop-filter:blur(10px);box-shadow:0 16px 40px rgba(0,0,0,.65);user-select:none;
  clip-path:polygon(10px 0,100% 0,100% calc(100% - 10px),calc(100% - 10px) 100%,0 100%,0 10px)}
#pixel-dlg.open{display:flex}
#pixel-dlg .pd-head{display:flex;align-items:center;justify-content:space-between;padding:10px 12px;
  background:rgba(7,8,10,.75);border-bottom:1px solid #232936;cursor:move;letter-spacing:.14em}
#pixel-dlg .pd-title{font-weight:700;color:#f2f4f7;display:flex;align-items:center;gap:7px}
#pixel-dlg .pd-title i{width:7px;height:7px;background:#ff6a13;display:inline-block}
#pixel-dlg .pd-sub{font-size:10px;color:#8a93a6;letter-spacing:.1em}
#pixel-dlg .pd-close{background:none;border:1px solid transparent;color:#8a93a6;cursor:pointer;font:inherit;padding:2px 6px}
#pixel-dlg .pd-close:hover{color:#f2f4f7;border-color:#ff6a13}
#pixel-dlg .pd-body{padding:12px;display:flex;flex-direction:column;gap:9px}
#pixel-dlg .pd-tabs{display:grid;grid-template-columns:repeat(4,1fr);gap:4px}
#pixel-dlg .pd-tab{background:#141820;border:1px solid #262c3a;color:#8a93a6;padding:6px 3px;font:600 9px/1 inherit;
  letter-spacing:.08em;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:4px;text-transform:uppercase}
#pixel-dlg .pd-tab:hover{border-color:#ff6a13;color:#f2f4f7}
#pixel-dlg .pd-tab.on{background:rgba(255,106,19,.16);border-color:#ff6a13;color:#ff8a3d}
#pixel-dlg .pd-dot{width:5px;height:5px;border-radius:50%;background:#3a4152;display:inline-block}
#pixel-dlg .pd-dot.live{background:#3ddc84;box-shadow:0 0 6px #3ddc84}
#pixel-dlg .pd-top{display:flex;align-items:center;justify-content:space-between;padding-bottom:8px;border-bottom:1px solid #1e232e}
#pixel-dlg .pd-toggle{background:#181c24;border:1px solid #2a3140;color:#cfd6e4;padding:5px 10px;font:600 10px/1 inherit;
  letter-spacing:.14em;cursor:pointer;clip-path:polygon(5px 0,100% 0,100% calc(100% - 5px),calc(100% - 5px) 100%,0 100%,0 5px)}
#pixel-dlg .pd-toggle[aria-pressed="true"]{background:#ff6a13;border-color:#ff6a13;color:#07080a}
#pixel-dlg .pd-sliders{display:flex;flex-direction:column;gap:8px;max-height:min(440px,calc(100vh - 190px));overflow-y:auto;padding-right:3px}
#pixel-dlg .pd-row{display:flex;flex-direction:column;gap:3px}
#pixel-dlg .pd-group{font-size:9px;font-weight:700;letter-spacing:.18em;color:#38bfd4;padding-top:4px;border-bottom:1px solid #1e232e;padding-bottom:3px}
#pixel-dlg .pd-lbl{display:flex;justify-content:space-between;font-size:10px;letter-spacing:.1em;color:#cfd6e4}
#pixel-dlg .pd-lbl b{color:#ff8a3d;font-weight:600;font-variant-numeric:tabular-nums}
#pixel-dlg input[type=range]{-webkit-appearance:none;appearance:none;width:100%;height:5px;background:#1d222d;outline:none;margin:2px 0}
#pixel-dlg input[type=range]::-webkit-slider-thumb{-webkit-appearance:none;width:12px;height:12px;background:#ff6a13;border:1px solid #07080a;cursor:pointer}
#pixel-dlg .pd-sun-box{background:#12161e;border:1px solid #232a38;padding:8px;display:flex;flex-direction:column;gap:6px}
#pixel-dlg .pd-sun-row{display:flex;align-items:center;gap:10px}
#pixel-dlg .pd-sun-pad{position:relative;width:76px;height:76px;border-radius:50%;background:radial-gradient(circle,#1c2331 0%,#0d1118 75%);
  border:1px solid #2f384a;cursor:crosshair;flex-shrink:0;touch-action:none}
#pixel-dlg .pd-sun-pad::before,#pixel-dlg .pd-sun-pad::after{content:'';position:absolute;background:rgba(138,147,166,.18);pointer-events:none}
#pixel-dlg .pd-sun-pad::before{left:50%;top:4px;bottom:4px;width:1px}
#pixel-dlg .pd-sun-pad::after{top:50%;left:4px;right:4px;height:1px}
#pixel-dlg .pd-sun-ring{position:absolute;inset:17px;border-radius:50%;border:1px dashed rgba(138,147,166,.22);pointer-events:none}
#pixel-dlg .pd-sun-ray{position:absolute;left:50%;top:50%;height:2px;background:linear-gradient(90deg,rgba(255,138,61,.85),rgba(56,191,212,.35));
  transform-origin:0 50%;pointer-events:none}
#pixel-dlg .pd-sun-dot{position:absolute;width:11px;height:11px;border-radius:50%;background:#ff9d3b;border:1.5px solid #fff;
  box-shadow:0 0 8px #ff6a13;transform:translate(-50%,-50%);pointer-events:none}
#pixel-dlg .pd-wind-arrow{position:absolute;left:50%;top:50%;height:2px;margin-top:-1px;transform-origin:0 50%;pointer-events:none;
  background:linear-gradient(90deg,rgba(56,191,212,.35),rgba(255,138,61,.95))}
#pixel-dlg .pd-wind-arrow::after{content:'';position:absolute;right:-7px;top:-4px;border-left:8px solid #ff9d3b;
  border-top:5px solid transparent;border-bottom:5px solid transparent;filter:drop-shadow(0 0 4px #ff6a13)}
#pixel-dlg .pd-wind-hub{position:absolute;left:50%;top:50%;width:7px;height:7px;border-radius:50%;background:#38bfd4;
  transform:translate(-50%,-50%);pointer-events:none}
#pixel-dlg .pd-sun-presets{display:grid;grid-template-columns:repeat(2,1fr);gap:4px;flex:1}
#pixel-dlg .pd-sun-btn{background:#181d27;border:1px solid #293142;color:#cfd6e4;padding:4px 5px;font:600 9px/1 inherit;
  letter-spacing:.1em;cursor:pointer;text-align:center}
#pixel-dlg .pd-sun-btn:hover,#pixel-dlg .pd-sun-btn.on{border-color:#ff6a13;color:#ff8a3d;background:rgba(255,106,19,.14)}
#pixel-dlg .pd-foot{display:flex;justify-content:space-between;align-items:center;padding-top:6px;border-top:1px solid #1e232e}
#pixel-dlg .pd-reset{background:none;border:1px solid #2a3140;color:#8a93a6;padding:4px 9px;font:600 10px/1 inherit;letter-spacing:.12em;cursor:pointer}
#pixel-dlg .pd-reset:hover{border-color:#ff6a13;color:#f2f4f7}`;
