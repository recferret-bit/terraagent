/* TerraAgent landing — hero copy variants, live stats, and the two live scenes:
   a WebGL planet (hero) and a Canvas 2D isometric hex colony (section 02).
   No dependencies. Respects prefers-reduced-motion (renders one still frame). */
(function () {
  'use strict';

  // ── hero headline variants: set data-hero on .page to "robot" | "world" | "director"
  var HERO = {
    robot: { h1: 'Drop one robot.\nLeave.\nIt keeps building.', lede: 'An autonomous colony builder. Your robots mine, build, defend and trade on a live planet, around the clock. You set the priorities; the colony does the rest, even while you are away.' },
    world: { h1: 'Colonize a planet\nthat never\nlogs off.', lede: 'Up to five colonies share one live world. Borders freeze where they meet, storms cut your power lines, and the server keeps the clock whether you are watching or not.' },
    director: { h1: 'Set the intent.\nThe colony\nexecutes.', lede: 'Indirect control: a task queue, four priority sliders and an AI Director for emergencies. Every resource and every watt counts, because the economy is the game.' }
  };
  var page = document.querySelector('.page');
  var variant = new URLSearchParams(location.search).get('hero') || (page && page.dataset.hero) || 'robot';
  var copy = HERO[variant] || HERO.robot;
  var t = document.querySelector('[data-hero-title]'), l = document.querySelector('[data-hero-lede]');
  if (t) t.textContent = copy.h1;
  if (l) l.textContent = copy.lede;

  // ── live stats (GET /v1/planets/stats → { planetsActive, coloniesAlive, playersOnline, updatedAt })
  var API = (page && page.dataset.api) || 'https://api.terraagent.com';
  function loadStats() {
    if (!window.fetch || location.protocol === 'file:') return;
    var ctl = new AbortController(); var to = setTimeout(function () { ctl.abort(); }, 1500);
    fetch(API + '/v1/planets/stats', { signal: ctl.signal }).then(function (r) { return r.ok ? r.json() : null; }).then(function (d) {
      if (!d) return;
      document.querySelectorAll('[data-stat]').forEach(function (el) {
        var v = d[el.dataset.stat]; if (typeof v === 'number') el.textContent = v.toLocaleString('en-US');
      });
    }).catch(function () {}).finally(function () { clearTimeout(to); });
  }
  loadStats(); setInterval(loadStats, 60000);

  // ── scenes
  class TerraScenes {
  _fit(cv) {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.max(1, Math.round(cv.clientWidth * dpr)), h = Math.max(1, Math.round(cv.clientHeight * dpr));
    if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; }
    return { w, h, dpr };
  }

  /* ───── WebGL planet: terrain fbm, terraform front, night-side lights, rim atmosphere, orbit ring ───── */
  _initPlanet(cv) {
    const gl = cv.getContext('webgl', { antialias: true, premultipliedAlpha: false });
    if (!gl) return this._initPlanetFallback(cv);
    const vs = 'attribute vec2 p;void main(){gl_Position=vec4(p,0.,1.);}';
    const fs = `precision highp float;
uniform vec2 R;uniform float T;
float h(vec3 p){p=fract(p*.3183099+.1);p*=17.;return fract(p.x*p.y*p.z*(p.x+p.y+p.z));}
float n(vec3 x){vec3 i=floor(x),f=fract(x);f=f*f*(3.-2.*f);
return mix(mix(mix(h(i),h(i+vec3(1,0,0)),f.x),mix(h(i+vec3(0,1,0)),h(i+vec3(1,1,0)),f.x),f.y),
mix(mix(h(i+vec3(0,0,1)),h(i+vec3(1,0,1)),f.x),mix(h(i+vec3(0,1,1)),h(i+vec3(1,1,1)),f.x),f.y),f.z);}
float fbm(vec3 p){float a=.5,s=0.;for(int i=0;i<5;i++){s+=a*n(p);p*=2.03;a*=.5;}return s;}
mat3 ry(float a){float c=cos(a),s=sin(a);return mat3(c,0,-s,0,1,0,s,0,c);}
mat3 rx(float a){float c=cos(a),s=sin(a);return mat3(1,0,0,0,c,s,0,-s,c);}
void main(){
 vec2 uv=(gl_FragCoord.xy-.5*R)/min(R.x,R.y);
 vec3 col=vec3(.012,.014,.02);
 float st=h(vec3(floor(gl_FragCoord.xy*.5),1.));col+=step(.9965,st)*vec3(.7,.75,.9)*(.5+.5*sin(T*2.+st*40.));
 float r=.36;float d=length(uv);
 vec3 L=normalize(vec3(-.65,.35,.7));
 if(d<r){
  vec3 nrm=vec3(uv/r,sqrt(1.-dot(uv/r,uv/r)));
  vec3 q=rx(.35)*ry(T*.06)*nrm;
  float e=fbm(q*3.2);float e2=fbm(q*9.+7.);
  vec3 sand=mix(vec3(.55,.26,.09),vec3(.93,.55,.24),smoothstep(.35,.75,e));
  sand=mix(sand,vec3(.33,.14,.06),smoothstep(.6,.8,e2)*.6);
  float lon=atan(q.z,q.x);float front=sin(T*.25)*.9-.2;
  float terra=smoothstep(front+.02,front-.18,q.y+.25*sin(lon*3.+e*4.));
  vec3 green=mix(vec3(.08,.32,.22),vec3(.2,.55,.3),e2);
  vec3 water=vec3(.05,.18,.42);
  vec3 tf=mix(green,water,smoothstep(.42,.36,e));
  vec3 base=mix(sand,tf,terra);
  float edge=exp(-pow((q.y+.25*sin(lon*3.+e*4.)-front+.08)*22.,2.));
  base+=vec3(.24,.86,.52)*edge*.9;
  float lit=max(dot(nrm,L),0.);
  float night=smoothstep(.15,-.1,dot(nrm,L));
  float city=step(.82,n(q*38.))*step(.45,e)*night;
  vec3 c=base*(.05+1.05*lit)+vec3(1.,.42,.08)*city*1.6;
  float fres=pow(1.-nrm.z,3.);
  c+=vec3(.12,.36,1.)*fres*(.35+.9*lit);
  col=c;
 }
 float glow=smoothstep(r+.09,r,d)*step(r,d);col+=vec3(.12,.36,1.)*glow*.55;
 vec2 o=uv;o.y/=.28;float ring=abs(length(o)-.62);
 float front2=step(0.,uv.y)+step(r,d);
 col+=vec3(1.,.42,.08)*smoothstep(.006,0.,ring*.28)*.55*min(front2,1.);
 float a=T*.5;vec2 sat=vec2(cos(a)*.62,sin(a)*.62*.28);
 float behind=step(sat.y,0.)*step(length(sat),r);
 col+=vec3(.95,.97,1.)*smoothstep(.012,.0,length(uv-sat))*(1.-behind)*1.4;
 col=pow(col,vec3(.4545));
 gl_FragColor=vec4(col,1.);
}`;
    const sh = (t, s) => { const o = gl.createShader(t); gl.shaderSource(o, s); gl.compileShader(o); return o; };
    const pr = gl.createProgram();
    gl.attachShader(pr, sh(gl.VERTEX_SHADER, vs)); gl.attachShader(pr, sh(gl.FRAGMENT_SHADER, fs)); gl.linkProgram(pr);
    if (!gl.getProgramParameter(pr, gl.LINK_STATUS)) return this._initPlanetFallback(cv);
    gl.useProgram(pr);
    const b = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, b);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(pr, 'p'); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    const uR = gl.getUniformLocation(pr, 'R'), uT = gl.getUniformLocation(pr, 'T');
    return (t) => {
      const { w, h } = this._fit(cv);
      gl.viewport(0, 0, w, h); gl.uniform2f(uR, w, h); gl.uniform1f(uT, t);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    };
  }

  _initPlanetFallback(cv) {
    const c = cv.getContext('2d');
    return () => {
      const { w, h } = this._fit(cv);
      c.fillStyle = '#050608'; c.fillRect(0, 0, w, h);
      const r = Math.min(w, h) * 0.36, g = c.createRadialGradient(w * 0.42, h * 0.42, r * 0.1, w / 2, h / 2, r);
      g.addColorStop(0, '#E08A3C'); g.addColorStop(0.7, '#8A3F14'); g.addColorStop(1, '#1E5BFF');
      c.fillStyle = g; c.beginPath(); c.arc(w / 2, h / 2, r, 0, Math.PI * 2); c.fill();
    };
  }

  /* ───── Canvas2D isometric hex colony ───── */
  _initColony(cv) {
    const c = cv.getContext('2d');
    const R = 7, S3 = Math.sqrt(3);
    const key = (q, r) => q + ',' + r;
    const dist = (a, b) => (Math.abs(a.q - b.q) + Math.abs(a.q + a.r - b.q - b.r) + Math.abs(a.r - b.r)) / 2;
    const hash = (q, r) => { const s = Math.sin(q * 127.1 + r * 311.7) * 43758.5453; return s - Math.floor(s); };
    const tiles = [];
    const hub = { q: -3, r: 1 }, foe = { q: 4, r: -2 };
    for (let q = -R; q <= R; q++) for (let r = Math.max(-R, -q - R); r <= Math.min(R, -q + R); r++) {
      const dA = dist({ q, r }, hub), dB = dist({ q, r }, foe);
      const owner = dA <= 4 ? 'A' : (dB <= 3 ? 'B' : null);
      tiles.push({ q, r, h: Math.floor(hash(q, r) * 3), owner, dep: hash(q + 9, r - 4) > 0.9 && !owner ? 1 : 0 });
    }
    const map = {}; tiles.forEach(t => map[key(t.q, t.r)] = t);
    const deposit = { q: 0, r: 2 }; map[key(0, 2)].dep = 1; map[key(0, 2)].owner = null;
    const deposit2 = { q: -5, r: 4 }; if (map[key(-5, 4)]) map[key(-5, 4)].dep = 1;
    const pylons = [{ q: -3, r: 1 }, { q: -1, r: 1 }, { q: 1, r: 0 }, { q: -2, r: -1 }];
    const solars = [{ q: -4, r: 0 }, { q: -5, r: 1 }, { q: -4, r: 2 }];
    const foeB = [{ q: 4, r: -2 }, { q: 5, r: -3 }, { q: 3, r: -1 }];
    const DIRS = [[1, 0], [1, -1], [0, -1], [-1, 0], [-1, 1], [0, 1]];
    const strike = { at: -1, target: 2, repaired: true };
    let geom = null;

    const proj = (q, r, h, g) => ({ x: g.cx + g.s * S3 * (q + r / 2), y: g.cy + g.s * 1.5 * r * 0.58 - h * g.s * 0.32 });
    const hexPath = (x, y, s) => { c.beginPath(); for (let i = 0; i < 6; i++) { const a = Math.PI / 180 * (60 * i - 30); const px = x + s * Math.cos(a), py = y + s * Math.sin(a) * 0.58; i ? c.lineTo(px, py) : c.moveTo(px, py); } c.closePath(); };

    const drawPrism = (x, y, s, hgt, top, side) => {
      c.fillStyle = side; c.beginPath();
      c.moveTo(x - s * 0.5, y); c.lineTo(x - s * 0.5, y - hgt); c.lineTo(x + s * 0.5, y - hgt); c.lineTo(x + s * 0.5, y); c.closePath(); c.fill();
      c.fillStyle = top; c.beginPath(); c.ellipse(x, y - hgt, s * 0.5, s * 0.29, 0, 0, Math.PI * 2); c.fill();
    };

    const bot = (x, y, s, body, visor, t, ph) => {
      const bob = Math.sin(t * 6 + ph) * s * 0.06;
      c.fillStyle = 'rgba(0,0,0,0.45)'; c.beginPath(); c.ellipse(x, y + s * 0.05, s * 0.34, s * 0.12, 0, 0, Math.PI * 2); c.fill();
      const bx = x - s * 0.26, by = y - s * 0.62 + bob, bw = s * 0.52, bh = s * 0.44, k = s * 0.08;
      c.fillStyle = '#1A1D24'; c.fillRect(bx - s * 0.04, by + bh - s * 0.04, bw + s * 0.08, s * 0.12);
      c.fillStyle = body; c.beginPath();
      c.moveTo(bx + k, by); c.lineTo(bx + bw, by); c.lineTo(bx + bw, by + bh - k); c.lineTo(bx + bw - k, by + bh); c.lineTo(bx, by + bh); c.lineTo(bx, by + k); c.closePath(); c.fill();
      c.fillStyle = visor; c.fillRect(bx + bw * 0.18, by + bh * 0.3, bw * 0.64, bh * 0.22);
      c.strokeStyle = '#8A93A6'; c.lineWidth = Math.max(1, s * 0.03); c.beginPath(); c.moveTo(bx + bw * 0.8, by); c.lineTo(bx + bw * 0.95, by - s * 0.22); c.stroke();
      c.fillStyle = visor; c.beginPath(); c.arc(bx + bw * 0.95, by - s * 0.22, s * 0.035, 0, Math.PI * 2); c.fill();
    };

    const lerp = (a, b, k) => a + (b - a) * k;

    return (t) => {
      const { w, h, dpr } = this._fit(cv);
      const s = Math.min(w / (S3 * (2 * R + 2)), h / (1.5 * 0.58 * (2 * R + 3))) * 0.98;
      const g = { cx: w / 2, cy: h * 0.5, s };
      geom = g;
      c.setTransform(1, 0, 0, 1, 0, 0);
      const day = 0.5 + 0.5 * Math.sin(t * 0.12);
      const bg = c.createLinearGradient(0, 0, 0, h);
      bg.addColorStop(0, '#05070C'); bg.addColorStop(1, '#0B0E15');
      c.fillStyle = bg; c.fillRect(0, 0, w, h);

      // strike scheduling
      const cycle = 9;
      const ct = t % cycle;
      const strikeOn = ct > 3 && ct < 7.4;
      const severed = strikeOn;
      const repairK = Math.min(1, Math.max(0, (ct - 4.2) / 3.2));

      // tiles back to front
      const sorted = tiles.slice().sort((a, b) => (a.r - b.r) || (a.q - b.q));
      for (const tl of sorted) {
        const p = proj(tl.q, tl.r, 0, g);
        const ht = tl.h * s * 0.16;
        let top = tl.h === 0 ? '#3A2414' : tl.h === 1 ? '#4A2D18' : '#5A371D';
        if (tl.dep) top = '#6B4A22';
        c.fillStyle = '#140D08';
        hexPath(p.x, p.y + s * 0.18, s * 0.98); c.fill();
        c.fillStyle = top; hexPath(p.x, p.y - ht * 0.2, s * 0.98); c.fill();
        if (tl.owner) {
          c.fillStyle = tl.owner === 'A' ? 'rgba(255,106,19,0.16)' : 'rgba(30,91,255,0.2)';
          hexPath(p.x, p.y - ht * 0.2, s * 0.98); c.fill();
        }
        if (tl.dep) { c.fillStyle = '#FFB35C'; for (let i = 0; i < 4; i++) { c.beginPath(); c.arc(p.x + (hash(tl.q + i, tl.r) - 0.5) * s, p.y + (hash(tl.q, tl.r + i) - 0.5) * s * 0.5, s * 0.07, 0, Math.PI * 2); c.fill(); } }
        c.strokeStyle = 'rgba(0,0,0,0.35)'; c.lineWidth = 1 * dpr; hexPath(p.x, p.y - ht * 0.2, s * 0.98); c.stroke();
        // frozen border edges
        if (tl.owner) for (let i = 0; i < 6; i++) {
          const nb = map[key(tl.q + DIRS[i][0], tl.r + DIRS[i][1])];
          if (nb && nb.owner && nb.owner !== tl.owner) {
            c.strokeStyle = '#F2F4F7'; c.lineWidth = 2 * dpr; c.setLineDash([4 * dpr, 4 * dpr]);
            const a0 = Math.PI / 180 * (60 * (i === 0 ? 0 : i === 1 ? 5 : i === 2 ? 4 : i === 3 ? 3 : i === 4 ? 2 : 1) - 30);
            const a1 = a0 + Math.PI / 3;
            c.beginPath(); c.moveTo(p.x + s * Math.cos(a0), p.y - ht * 0.2 + s * Math.sin(a0) * 0.58); c.lineTo(p.x + s * Math.cos(a1), p.y - ht * 0.2 + s * Math.sin(a1) * 0.58); c.stroke();
            c.setLineDash([]);
          }
        }
      }

      // power lines with flowing energy
      const pp = pylons.map(p => { const o = proj(p.q, p.r, 0, g); return { x: o.x, y: o.y - s * 1.1 }; });
      const links = [[0, 1], [1, 2], [0, 3]];
      links.forEach(([a, b], i) => {
        const dead = severed && (b === strike.target || a === strike.target) && repairK < 1;
        c.strokeStyle = dead ? 'rgba(255,59,59,0.5)' : 'rgba(57,208,255,0.85)';
        c.lineWidth = 2 * dpr; c.setLineDash(dead ? [3 * dpr, 6 * dpr] : [10 * dpr, 8 * dpr]);
        c.lineDashOffset = dead ? 0 : -t * 40 * dpr;
        c.beginPath(); c.moveTo(pp[a].x, pp[a].y);
        c.quadraticCurveTo((pp[a].x + pp[b].x) / 2, (pp[a].y + pp[b].y) / 2 + s * 0.35, pp[b].x, pp[b].y); c.stroke();
      });
      c.setLineDash([]);

      // structures (painter's order by r)
      const items = [];
      solars.forEach(o => items.push({ q: o.q, r: o.r, kind: 'solar' }));
      pylons.forEach((o, i) => items.push({ q: o.q, r: o.r, kind: i === 0 ? 'hub' : 'pylon', i }));
      foeB.forEach((o, i) => items.push({ q: o.q, r: o.r, kind: i === 0 ? 'foehub' : 'foe' }));
      items.push({ q: deposit.q, r: deposit.r, kind: 'mine' });
      items.sort((a, b) => a.r - b.r);
      for (const it of items) {
        const p = proj(it.q, it.r, 0, g);
        if (it.kind === 'hub') {
          drawPrism(p.x, p.y, s * 1.3, s * 0.55, '#E9ECF2', '#9AA3B5');
          drawPrism(p.x, p.y - s * 0.55, s * 0.9, s * 0.45, '#FF6A13', '#B4470A');
          drawPrism(p.x, p.y - s * 1.0, s * 0.36, s * 0.5, '#F2F4F7', '#6B7385');
          c.fillStyle = '#39D0FF'; c.beginPath(); c.arc(p.x, p.y - s * 1.55, s * 0.08 * (1 + 0.3 * Math.sin(t * 4)), 0, Math.PI * 2); c.fill();
        } else if (it.kind === 'pylon') {
          const dead = severed && it.i === strike.target && repairK < 1;
          c.strokeStyle = '#C9CFDA'; c.lineWidth = 3 * dpr; c.beginPath(); c.moveTo(p.x, p.y); c.lineTo(p.x, p.y - s * 1.1); c.stroke();
          c.lineWidth = 2 * dpr; c.beginPath(); c.moveTo(p.x - s * 0.25, p.y - s * 0.9); c.lineTo(p.x + s * 0.25, p.y - s * 0.9); c.stroke();
          c.fillStyle = dead ? '#FF3B3B' : '#39D0FF';
          c.beginPath(); c.arc(p.x, p.y - s * 1.1, s * 0.09, 0, Math.PI * 2); c.fill();
          if (dead) { c.font = `600 ${Math.round(s * 0.28)}px "IBM Plex Mono", monospace`; c.fillStyle = '#FF3B3B'; c.fillText('OFFLINE', p.x + s * 0.2, p.y - s * 1.3); }
        } else if (it.kind === 'solar') {
          const glint = 0.5 + 0.5 * Math.sin(t * 1.5 + it.q);
          c.fillStyle = '#0E2A80'; hexPath(p.x, p.y - s * 0.25, s * 0.62); c.fill();
          c.strokeStyle = `rgba(91,140,255,${0.5 + 0.5 * glint})`; c.lineWidth = 1.5 * dpr; hexPath(p.x, p.y - s * 0.25, s * 0.62); c.stroke();
          c.strokeStyle = 'rgba(91,140,255,0.45)'; c.beginPath(); c.moveTo(p.x - s * 0.5, p.y - s * 0.25); c.lineTo(p.x + s * 0.5, p.y - s * 0.25); c.stroke();
        } else if (it.kind === 'mine') {
          drawPrism(p.x, p.y, s * 0.8, s * 0.35, '#FF8A3D', '#8A3F14');
          c.strokeStyle = '#F2F4F7'; c.lineWidth = 2 * dpr; c.beginPath(); c.moveTo(p.x, p.y - s * 0.35); c.lineTo(p.x + Math.cos(t * 3) * s * 0.3, p.y - s * 0.7); c.stroke();
        } else if (it.kind === 'foehub') {
          drawPrism(p.x, p.y, s * 1.2, s * 0.5, '#E9ECF2', '#9AA3B5');
          drawPrism(p.x, p.y - s * 0.5, s * 0.8, s * 0.5, '#1E5BFF', '#0E2A80');
        } else {
          drawPrism(p.x, p.y, s * 0.6, s * 0.4, '#5B8CFF', '#1E3F99');
        }
      }

      // robots: miners shuttle hub <-> deposit
      const hp = proj(hub.q, hub.r, 0, g), dp = proj(deposit.q, deposit.r, 0, g), d2 = proj(deposit2.q, deposit2.r, 0, g);
      for (let i = 0; i < 4; i++) {
        const k = (t * 0.12 + i * 0.25) % 1; const tri = k < 0.5 ? k * 2 : 2 - k * 2;
        const ease = tri * tri * (3 - 2 * tri);
        const target = i % 2 ? dp : d2;
        bot(lerp(hp.x + s * 0.6, target.x, ease), lerp(hp.y + s * 0.3, target.y, ease), s * 0.95, '#F2F4F7', k < 0.5 ? '#FF6A13' : '#FFB35C', t, i);
      }
      // builder to struck pylon
      const tp = proj(pylons[strike.target].q, pylons[strike.target].r, 0, g);
      if (severed) {
        const k = Math.min(1, Math.max(0, (ct - 3.6) / 1.6));
        const bx = lerp(hp.x - s * 0.5, tp.x - s * 0.5, k), by = lerp(hp.y + s * 0.5, tp.y + s * 0.3, k);
        bot(bx, by, s * 1.05, '#FF6A13', '#07080A', t, 9);
        if (k >= 1 && repairK < 1) {
          c.strokeStyle = `rgba(57,208,255,${0.5 + 0.5 * Math.sin(t * 30)})`; c.lineWidth = 2 * dpr;
          c.beginPath(); c.moveTo(bx + s * 0.2, by - s * 0.5); c.lineTo(tp.x, tp.y - s * 0.6); c.stroke();
        }
      }
      // foe robot patrols
      const fp = proj(foe.q, foe.r, 0, g), fq = proj(2, 0, 0, g);
      const fk = 0.5 + 0.5 * Math.sin(t * 0.5);
      bot(lerp(fp.x, fq.x, fk), lerp(fp.y + s * 0.4, fq.y, fk), s * 0.9, '#C9CFDA', '#1E5BFF', t, 3);

      // lightning
      if (ct > 3 && ct < 3.45) {
        const top = { x: tp.x + s * 2, y: 0 }, bot2 = { x: tp.x, y: tp.y - s * 1.1 };
        const seed = Math.floor(t * 20);
        const pts = [top]; const n = 10;
        for (let i = 1; i < n; i++) { const k = i / n; pts.push({ x: lerp(top.x, bot2.x, k) + (hash(seed, i) - 0.5) * s * 1.6, y: lerp(top.y, bot2.y, k) }); }
        pts.push(bot2);
        c.save(); c.shadowColor = '#9FE7FF'; c.shadowBlur = 24 * dpr;
        c.strokeStyle = '#E9FBFF'; c.lineWidth = 3 * dpr; c.beginPath(); pts.forEach((pt, i) => i ? c.lineTo(pt.x, pt.y) : c.moveTo(pt.x, pt.y)); c.stroke();
        c.restore();
        c.fillStyle = `rgba(200,240,255,${0.22 * (1 - (ct - 3) / 0.45)})`; c.fillRect(0, 0, w, h);
      }

      // night tint
      c.fillStyle = `rgba(5,8,20,${0.35 * (1 - day)})`; c.fillRect(0, 0, w, h);

      // event log
      const log = [];
      const tick = Math.floor(t * 10);
      log.push(['TICK ' + String(tick).padStart(6, '0'), '#8A93A6']);
      if (ct > 3) log.push(['LIGHTNING STRIKE · PYLON P' + (strike.target + 1) + ' SEVERED', '#FF3B3B']);
      if (ct > 3.6) log.push(['BUILDER B1 DISPATCHED', '#FF8A3D']);
      if (ct > 7.4) log.push(['P' + (strike.target + 1) + ' RESTORED · GRID ONLINE', '#3DDC84']);
      if (ct <= 3) log.push(['GRID ONLINE · 4 MINERS WORKING', '#3DDC84']);
      const fs = Math.round(12 * dpr);
      c.font = `500 ${fs}px "IBM Plex Mono", monospace`;
      const lh = fs * 1.6, bx0 = 16 * dpr, by0 = h - 16 * dpr - lh * log.length;
      c.fillStyle = 'rgba(7,8,10,0.75)'; c.fillRect(bx0 - 8 * dpr, by0 - fs, 330 * dpr, lh * log.length + 10 * dpr);
      log.forEach(([txt, col], i) => { c.fillStyle = col; c.fillText(txt, bx0, by0 + i * lh + fs * 0.4); });
    };
  }
  }

  var reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var scenes = new TerraScenes();
  var hero = document.getElementById('hero-canvas'), colony = document.getElementById('colony-canvas');
  var drawHero = hero ? scenes._initPlanet(hero) : null;
  var drawColony = colony ? scenes._initColony(colony) : null;

  // only animate scenes that are on screen
  var visible = new Map();
  if ('IntersectionObserver' in window) {
    var io = new IntersectionObserver(function (es) { es.forEach(function (e) { visible.set(e.target, e.isIntersecting); }); });
    [hero, colony].forEach(function (c) { if (c) { visible.set(c, true); io.observe(c); } });
  }
  var isOn = function (c) { return !visible.size || visible.get(c) !== false; };

  var t0 = performance.now();
  function frame(now) {
    var tt = (now - t0) / 1000;
    if (drawHero && isOn(hero)) drawHero(tt);
    if (drawColony && isOn(colony)) drawColony(tt);
    if (!reduced) requestAnimationFrame(frame);
  }
  if (reduced) frame(t0 + 9000); else requestAnimationFrame(frame);
  if (reduced) window.addEventListener('resize', function () { frame(t0 + 9000); });
})();
