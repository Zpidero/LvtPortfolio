/* ===========================
   Lluc Vivet Torras — Portfolio
   js/main.js  ·  湖 — the lake

   One page, four places:
     about    → the night sky above the lake
     home     → the lake at dusk (cursor ripples the water)
     projects → underwater (cursor ripples + koi + bubbles)
     contact  → inside the house (shoji doors slide open)
   =========================== */
(() => {
  'use strict';

  const $  = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const rand  = (a, b) => a + Math.random() * (b - a);
  const sleep = ms => new Promise(r => setTimeout(r, ms));

  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const finePointer  = matchMedia('(hover: hover) and (pointer: fine)').matches;
  const DPR  = Math.min(window.devicePixelRatio || 1, 1.75);
  const root = document.documentElement;
  const body = document.body;

  let W = innerWidth, H = innerHeight;

  function mulberry(seed) {
    return () => {
      seed = (seed + 0x6D2B79F5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /* =========================================================
     Ripple — height-field water simulation that refracts a
     texture. Runs at low resolution and is upscaled by CSS.
     ========================================================= */
  class Ripple {
    constructor(canvas, o = {}) {
      this.canvas  = canvas;
      this.ctx     = canvas.getContext('2d');
      this.damp    = o.damp ?? 0.984;
      this.refract = o.refract ?? 0.1;
      this.light   = o.light ?? 0.35;
      this.ambient = o.ambient || null;
      this.ready   = false;
      this.w = this.h = 0;
    }
    resize(w, h) {
      w = Math.max(8, Math.round(w)); h = Math.max(8, Math.round(h));
      this.w = w; this.h = h;
      this.canvas.width = w; this.canvas.height = h;
      this.a = new Float32Array(w * h);
      this.b = new Float32Array(w * h);
      this.tex = new Uint8ClampedArray(w * h * 4);
      this.img = this.ctx.createImageData(w, h);
      this.rowOff = new Float32Array(h);
      this.ready = false;
    }
    setTexture(data) {
      if (data.length !== this.tex.length) return;
      this.tex.set(data);
      this.ready = true;
    }
    drop(x, y, r, s) {
      if (!this.w) return;
      const { w, h, a } = this;
      r = Math.max(1, r);
      const r2 = r * r;
      const x0 = Math.max(1, Math.floor(x - r)), x1 = Math.min(w - 2, Math.ceil(x + r));
      const y0 = Math.max(1, Math.floor(y - r)), y1 = Math.min(h - 2, Math.ceil(y + r));
      for (let yy = y0; yy <= y1; yy++) {
        for (let xx = x0; xx <= x1; xx++) {
          const d2 = (xx - x) * (xx - x) + (yy - y) * (yy - y);
          if (d2 < r2) a[yy * w + xx] += s * (1 - Math.sqrt(d2) / r);
        }
      }
    }
    trail(x0, y0, x1, y1, r, s) {
      const d = Math.hypot(x1 - x0, y1 - y0);
      const n = Math.min(40, Math.max(1, Math.ceil(d / (r * 0.9))));
      for (let i = 1; i <= n; i++) {
        const k = i / n;
        this.drop(x0 + (x1 - x0) * k, y0 + (y1 - y0) * k, r, s);
      }
    }
    step(t) {
      if (!this.ready) return;
      const { w, h, damp } = this;
      const cur = this.a, nxt = this.b;
      for (let y = 1; y < h - 1; y++) {
        let i = y * w + 1;
        for (let x = 1; x < w - 1; x++, i++) {
          nxt[i] = ((cur[i - 1] + cur[i + 1] + cur[i - w] + cur[i + w]) * 0.5 - nxt[i]) * damp;
        }
      }
      this.a = nxt; this.b = cur;

      if (this.ambient) this.ambient(this.rowOff, t, h);
      const buf = this.a, tex = this.tex, out = this.img.data, ro = this.rowOff;
      const rf = this.refract, lt = this.light, wm = w - 1, hm = h - 1;
      for (let y = 0, i = 0; y < h; y++) {
        const off = ro[y];
        const inY = y > 0 && y < hm;
        for (let x = 0; x < w; x++, i++) {
          let dx = 0, dy = 0;
          if (inY && x > 0 && x < wm) {
            dx = buf[i - 1] - buf[i + 1];
            dy = buf[i - w] - buf[i + w];
          }
          let sx = (x + dx * rf + off) | 0;
          let sy = (y + dy * rf) | 0;
          if (sx < 0) sx = 0; else if (sx > wm) sx = wm;
          if (sy < 0) sy = 0; else if (sy > hm) sy = hm;
          const j = (sy * w + sx) << 2, o = i << 2, sh = (dx - dy) * lt;
          out[o]     = tex[j]     + sh;
          out[o + 1] = tex[j + 1] + sh;
          out[o + 2] = tex[j + 2] + sh;
          out[o + 3] = 255;
        }
      }
      this.ctx.putImageData(this.img, 0, 0);
    }
  }

  /* =========================================================
     LAKE (home) — reflection of the SVG scene + cursor ripples
     ========================================================= */
  const sceneSvg   = $('#sceneSvg');
  const lakeCanvas = $('#lakeCanvas');
  const lake = new Ripple(lakeCanvas, {
    damp: 0.986, refract: 0.11, light: 0.3,
    ambient(ro, t, h) {
      for (let y = 0; y < h; y++) {
        const k = y / h;
        ro[y] = Math.sin(y * 0.5 + t * 2.0) * (0.25 + 1.8 * k) + Math.sin(y * 0.13 - t * 0.9) * 0.7 * k;
      }
    }
  });

  // Scene SVG is 1600×900, horizon at y=560, drawn with "xMidYMid slice"
  const L = { scale: 1, offX: 0, offY: 0, horizon: 0, lakeH: 0, cell: 3 };
  const vb = (x, y) => [L.offX + x * L.scale, L.offY + y * L.scale];

  function layoutLake() {
    L.scale = Math.max(W / 1600, H / 900);
    L.offX = (W - 1600 * L.scale) / 2;
    L.offY = (H - 900 * L.scale) / 2;
    L.horizon = L.offY + 560 * L.scale;
    L.lakeH = Math.max(10, H - L.horizon);
    L.cell = clamp(W / 560, 1.6, 3.4);
    lakeCanvas.style.top = L.horizon + 'px';
    lakeCanvas.style.height = L.lakeH + 'px';
    // vertical over-sampling squashes ripples into perspective ellipses
    lake.resize(W / L.cell, (L.lakeH / L.cell) * 1.6);
    return buildLakeTexture();
  }

  let texToken = 0;
  async function buildLakeTexture() {
    const token = ++texToken;
    const sw = lake.w, sh = lake.h;
    const rw = sw, rh = Math.max(2, Math.round(H / L.cell));

    let data = null;
    try {
      const clone = sceneSvg.cloneNode(true);
      clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
      clone.setAttribute('width', rw);
      clone.setAttribute('height', rh);
      clone.removeAttribute('class');
      const img = new Image();
      img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(new XMLSerializer().serializeToString(clone));
      await img.decode();
      if (token !== texToken) return;
      const c = document.createElement('canvas');
      c.width = rw; c.height = rh;
      const cx = c.getContext('2d');
      cx.drawImage(img, 0, 0, rw, rh);
      data = cx.getImageData(0, 0, rw, rh).data;
    } catch (e) { data = null; }
    if (token !== texToken) return;

    const tex = new Uint8ClampedArray(sw * sh * 4);
    const hr = L.horizon / L.cell;               // horizon row in raster space
    const WR = 18, WG = 28, WB = 50;              // deep water colour
    for (let j = 0; j < sh; j++) {
      const k = (j + 0.5) / sh;
      const ry = clamp(Math.round(hr - k * (L.lakeH / L.cell) - 1), 0, rh - 1);
      const refl = 0.86 - 0.44 * k;               // fresnel-ish: more reflective near horizon
      const dark = 0.95 - 0.2 * k;
      for (let i = 0; i < sw; i++) {
        const o = (j * sw + i) * 4;
        let r = 110, g = 80, b = 120;
        if (data) { const s = (ry * rw + i) * 4; r = data[s]; g = data[s + 1]; b = data[s + 2]; }
        tex[o]     = (r * refl + WR * (1 - refl)) * dark;
        tex[o + 1] = (g * refl + WG * (1 - refl)) * dark;
        tex[o + 2] = (b * refl + WB * (1 - refl)) * dark;
        tex[o + 3] = 255;
      }
    }
    lake.setTexture(tex);
    lakeCanvas.classList.add('ready');
  }

  function lakeDrop(x, y, r, s) {
    if (y <= L.horizon) return;
    lake.drop((x / W) * lake.w, ((y - L.horizon) / L.lakeH) * lake.h, r, s);
  }
  function lakeSplash() {
    const cx = lake.w / 2, cy = lake.h * 0.55;
    lake.drop(cx, cy, 7, 900);
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2;
      lake.drop(cx + Math.cos(a) * 16, cy + Math.sin(a) * 10, 3, 320);
    }
  }

  /* ---------- Sakura petals ---------- */
  const petalCanvas = $('#petalCanvas');
  const pctx = petalCanvas.getContext('2d');
  const P = { list: [], updraft: 0 };
  const PETAL_COLORS = ['#f6c1cc', '#f9d4dc', '#f2a9b9', '#fbe3e8'];

  function layoutPetals() {
    petalCanvas.width = W * DPR; petalCanvas.height = H * DPR;
    pctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  }
  function newPetal(fromBelow) {
    return {
      x: fromBelow ? rand(0, W) : rand(-W * 0.15, W * 0.95),
      y: fromBelow ? H + rand(0, 120) : -20,
      vx: rand(5, 25), vy: fromBelow ? -rand(260, 460) : rand(30, 60),
      fall: rand(32, 68), rot: rand(0, 6.28), spin: rand(-2, 2),
      flip: rand(0, 6.28), flipS: rand(1, 3), size: rand(4, 7.5),
      land: rand(L.horizon + 8, H - 6), seed: rand(0, 100),
      float: false, life: rand(5, 9), alpha: rand(0.7, 1),
      color: PETAL_COLORS[(Math.random() * PETAL_COLORS.length) | 0]
    };
  }
  function updatePetals(dt, t) {
    pctx.clearRect(0, 0, W, H);
    const max = reduceMotion ? 8 : W < 700 ? 18 : 34;
    if (P.list.length < max && Math.random() < dt * 2.4) P.list.push(newPetal(false));
    if (P.updraft > 0) P.updraft -= dt;

    for (let i = P.list.length - 1; i >= 0; i--) {
      const p = P.list[i];
      if (p.float) {
        p.x += p.vx * dt; p.life -= dt;
        if (p.life <= 0 || p.x > W + 20) { P.list.splice(i, 1); continue; }
      } else {
        p.vx += (Math.sin(t * 0.7 + p.seed) * 18 + 14 - p.vx) * dt * 0.8;
        if (P.updraft > 0) p.vy += (-460 - p.vy) * dt * 2.5;
        else p.vy += (p.fall - p.vy) * dt * 1.2;
        // the cursor is a little gust of wind
        const dx = p.x - ptr.x, dy = p.y - ptr.y, d2 = dx * dx + dy * dy;
        if (d2 < 12100 && d2 > 1) {
          const d = Math.sqrt(d2), f = ((110 - d) / 110) * 700 * dt;
          p.vx += (dx / d) * f; p.vy += (dy / d) * f;
        }
        p.x += p.vx * dt; p.y += p.vy * dt;
        p.rot += p.spin * dt; p.flip += p.flipS * dt;
        if (P.updraft <= 0 && p.vy > 0 && p.y >= p.land) {
          p.float = true; p.y = p.land; p.vx = rand(4, 12);
          lakeDrop(p.x, p.y, 1.6, 90);
        }
        if (p.y < -60 || p.y > H + 160 || p.x > W + 40 || p.x < -W * 0.2) { P.list.splice(i, 1); continue; }
      }

      const s = p.size;
      pctx.save();
      pctx.translate(p.x, p.y);
      pctx.rotate(p.rot);
      pctx.scale(1, p.float ? 0.4 : Math.abs(Math.cos(p.flip)) * 0.8 + 0.2);
      pctx.globalAlpha = p.float ? Math.min(1, p.life / 2) * p.alpha * 0.85 : p.alpha;
      pctx.fillStyle = p.color;
      pctx.beginPath();
      pctx.moveTo(0, -s);
      pctx.bezierCurveTo(s, -s * 0.9, s * 0.9, s * 0.6, 0, s);
      pctx.bezierCurveTo(-s * 0.9, s * 0.6, -s, -s * 0.9, 0, -s);
      pctx.fill();
      pctx.restore();
    }
  }
  function petalUpdraft(seconds) {
    P.updraft = seconds;
    for (let i = 0; i < 26; i++) P.list.push(newPetal(true));
  }

  /* =========================================================
     DEEP (projects) — refracted light, koi, bubbles, seaweed
     ========================================================= */
  const layerDeep  = $('#page-projects');
  const deepCanvas = $('#deepCanvas');
  const deepScroll = $('#deepScroll');
  const deep = new Ripple(deepCanvas, {
    damp: 0.982, refract: 0.09, light: 0.22,
    ambient(ro, t, h) {
      for (let y = 0; y < h; y++) ro[y] = Math.sin(y * 0.09 + t * 1.2) * 1.1 + Math.sin(y * 0.031 - t * 0.6) * 0.9;
    }
  });

  function layoutDeep() {
    const cell = clamp(W / 480, 2, 4);
    deep.resize(W / cell, H / cell);
    const w = deep.w, h = deep.h;
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const x = c.getContext('2d');
    const g = x.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, '#3a8d9b'); g.addColorStop(0.06, '#2a7486'); g.addColorStop(0.32, '#145066');
    g.addColorStop(0.68, '#0b2e41'); g.addColorStop(1, '#04131d');
    x.fillStyle = g; x.fillRect(0, 0, w, h);

    const r = mulberry(11);
    x.globalCompositeOperation = 'lighter';
    for (let k = 0; k < 7; k++) {
      const x0 = w * (0.02 + k * 0.15 + r() * 0.06), tw = w * (0.015 + r() * 0.03);
      const drift = w * (0.06 + r() * 0.08), bw = tw * 3 + w * 0.05 * r();
      const a = 0.05 + r() * 0.07;
      const rg = x.createLinearGradient(0, 0, 0, h * 0.85);
      rg.addColorStop(0, `rgba(200,240,235,${a})`); rg.addColorStop(1, 'rgba(200,240,235,0)');
      x.fillStyle = rg;
      x.beginPath();
      x.moveTo(x0, 0); x.lineTo(x0 + tw, 0);
      x.lineTo(x0 + tw + drift + bw, h * 0.85); x.lineTo(x0 + drift, h * 0.85);
      x.closePath(); x.fill();
    }
    const sg = x.createLinearGradient(0, 0, 0, h * 0.08);
    sg.addColorStop(0, 'rgba(220,250,245,.35)'); sg.addColorStop(1, 'rgba(220,250,245,0)');
    x.fillStyle = sg; x.fillRect(0, 0, w, h * 0.08);
    x.globalCompositeOperation = 'source-over';

    const bed = (color, base, amp, n) => {
      x.fillStyle = color;
      x.beginPath(); x.moveTo(0, h);
      let px = 0, py = h * (base + r() * amp);
      x.lineTo(px, py);
      for (let i = 1; i <= n; i++) {
        const nx = (i / n) * w, ny = h * (base + r() * amp);
        x.quadraticCurveTo(px, py, (px + nx) / 2, (py + ny) / 2);
        px = nx; py = ny;
      }
      x.lineTo(w, py); x.lineTo(w, h); x.closePath(); x.fill();
    };
    bed('#082231', 0.84, 0.07, 9);
    bed('#04121b', 0.92, 0.05, 14);
    deep.setTexture(x.getImageData(0, 0, w, h).data);
  }

  const fxCanvas = $('#deepFx');
  const fctx = fxCanvas.getContext('2d');
  const FX = { bubbles: [], koi: [], weeds: [] };
  const KOI_PALETTES = [
    ['#f4efe6', '#e5532b', '#f4efe6', '#e5532b', '#f7f1e8'],
    ['#f3b33d', '#f6c65e', '#e89a25', '#f3b33d', '#f8d98c'],
    ['#f4efe6', '#1e1d22', '#f4efe6', '#d6402a', '#f4efe6']
  ];

  function layoutFx() {
    fxCanvas.width = W * DPR; fxCanvas.height = H * DPR;
    fctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    const r = mulberry(5);
    FX.weeds = [];
    const n = Math.round(W / 55);
    for (let i = 0; i < n; i++) {
      FX.weeds.push({
        x: (i / n) * W + r() * 40, h: H * (0.1 + r() * 0.24), seg: 9,
        ph: r() * 6.28, amp: 0.5 + r() * 0.8, w: 3 + r() * 4,
        c: r() < 0.5 ? 'rgba(14,64,56,.8)' : 'rgba(20,78,62,.7)'
      });
    }
    if (!FX.koi.length) {
      const count = W < 700 ? 2 : 3;
      for (let i = 0; i < count; i++) FX.koi.push(makeKoi(i));
    }
  }
  function makeKoi(i) {
    return {
      x: rand(W * 0.2, W * 0.8), y: rand(H * 0.3, H * 0.8), a: rand(0, 6.28),
      sp: rand(38, 58), v: 40, size: rand(14, 20) * (W < 700 ? 0.8 : 1), ph: rand(0, 6),
      tx: rand(W * 0.1, W * 0.9), ty: rand(H * 0.2, H * 0.85), retarget: rand(2, 6),
      pal: KOI_PALETTES[i % KOI_PALETTES.length]
    };
  }
  function spawnBubble(x, y, big, fast) {
    if (FX.bubbles.length > 140) return;
    FX.bubbles.push({ x, y, r: rand(1.5, big ? 8 : 4.5), vy: fast ? rand(160, 320) : rand(30, 70), ph: rand(0, 6.28) });
  }
  function bubbleBurst() {
    for (let i = 0; i < 70; i++) spawnBubble(rand(W * 0.2, W * 0.8), H + rand(0, 260), true, true);
  }

  function drawKoi(k) {
    const s = k.size, Lb = s * 3.2, n = 10, head = Lb * 0.35;
    const left = [], right = [];
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      const px = head - t * Lb;
      const py = Math.sin(k.ph - t * 3) * t * s * 0.45;
      const wd = s * 0.5 * Math.sin(Math.PI * (0.14 + 0.84 * t));
      left.push([px, py - wd]); right.push([px, py + wd]);
    }
    const tail = [head - Lb, Math.sin(k.ph - 3) * s * 0.45];
    const flap = Math.sin(k.ph - 3.6) * s * 0.35;

    fctx.save();
    fctx.translate(k.x, k.y);
    fctx.rotate(k.a);
    fctx.globalAlpha = 0.92;

    // pectoral fins
    fctx.fillStyle = 'rgba(255,240,230,.45)';
    const fy = Math.sin(k.ph - 0.6) * 0.2 * s * 0.45;
    for (const sgn of [-1, 1]) {
      fctx.beginPath();
      fctx.ellipse(head - Lb * 0.24, fy + sgn * s * 0.55, s * 0.42, s * 0.18, sgn * (0.5 + Math.sin(k.ph) * 0.2), 0, 6.283);
      fctx.fill();
    }

    const g = fctx.createLinearGradient(head + s * 0.3, 0, head - Lb, 0);
    k.pal.forEach((c, i) => g.addColorStop(i / (k.pal.length - 1), c));
    fctx.fillStyle = g;
    fctx.beginPath();
    fctx.moveTo(left[0][0], left[0][1]);
    for (let i = 1; i <= n; i++) fctx.lineTo(left[i][0], left[i][1]);
    // tail fin
    fctx.quadraticCurveTo(tail[0] - s * 0.6, tail[1] - s * 0.9 + flap, tail[0] - s * 1.3, tail[1] - s * 0.7 + flap);
    fctx.quadraticCurveTo(tail[0] - s * 0.7, tail[1] + flap * 0.5, tail[0] - s * 1.3, tail[1] + s * 0.7 + flap);
    fctx.quadraticCurveTo(tail[0] - s * 0.6, tail[1] + s * 0.9 + flap, right[n][0], right[n][1]);
    for (let i = n - 1; i >= 0; i--) fctx.lineTo(right[i][0], right[i][1]);
    fctx.quadraticCurveTo(head + s * 0.45, 0, left[0][0], left[0][1]);
    fctx.fill();
    fctx.restore();
  }

  function updateFx(dt, t) {
    fctx.clearRect(0, 0, W, H);

    // seaweed
    fctx.lineCap = 'round';
    for (const wd of FX.weeds) {
      fctx.strokeStyle = wd.c; fctx.lineWidth = wd.w;
      fctx.beginPath(); fctx.moveTo(wd.x, H + 4);
      for (let s = 1; s <= wd.seg; s++) {
        const k = s / wd.seg;
        const sway = Math.sin(t * 0.9 + wd.ph + s * 0.35) * k * k * 26 * wd.amp;
        fctx.lineTo(wd.x + sway, H - wd.h * k);
      }
      fctx.stroke();
    }

    // koi — wander, and dart away from the cursor
    for (const k of FX.koi) {
      k.retarget -= dt;
      if (k.retarget <= 0) { k.tx = rand(W * 0.08, W * 0.92); k.ty = rand(H * 0.2, H * 0.85); k.retarget = rand(3, 7); }
      let desired = Math.atan2(k.ty - k.y, k.tx - k.x);
      let boost = 1;
      const dx = k.x - ptr.x, dy = k.y - ptr.y, d = Math.hypot(dx, dy);
      if (d < 180) { desired = Math.atan2(dy, dx); boost = 1 + (180 - d) / 50; }
      let diff = desired - k.a;
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;
      const turn = (boost > 1 ? 4 : 1.4) * dt;
      k.a += clamp(diff, -turn, turn);
      k.v += (k.sp * boost - k.v) * dt * 2;
      k.x += Math.cos(k.a) * k.v * dt;
      k.y += Math.sin(k.a) * k.v * dt;
      k.ph += dt * (3 + k.v * 0.09);
      const m = 60;
      if (k.x < -m || k.x > W + m || k.y < -m || k.y > H + m) { k.tx = W / 2; k.ty = H / 2; k.retarget = 3; }
      drawKoi(k);
    }

    // bubbles
    if (!reduceMotion && Math.random() < dt * 1.6) spawnBubble(rand(0, W), H + 10, false, false);
    fctx.lineWidth = 1;
    for (let i = FX.bubbles.length - 1; i >= 0; i--) {
      const b = FX.bubbles[i];
      b.y -= b.vy * dt;
      b.vy += (55 - b.vy) * dt * 0.6;
      b.x += Math.sin(t * 2.2 + b.ph) * 0.45;
      if (b.y < -20) { FX.bubbles.splice(i, 1); continue; }
      fctx.strokeStyle = 'rgba(220,245,255,.5)';
      fctx.beginPath(); fctx.arc(b.x, b.y, b.r, 0, 6.283); fctx.stroke();
      fctx.fillStyle = 'rgba(255,255,255,.55)';
      fctx.beginPath(); fctx.arc(b.x - b.r * 0.35, b.y - b.r * 0.35, b.r * 0.28, 0, 6.283); fctx.fill();
    }
  }

  // depth gauge + darkening as you scroll deeper
  const depthVal = $('#depthVal');
  const depthEl  = $('.depth');
  function updateDepth() {
    const max = deepScroll.scrollHeight - deepScroll.clientHeight;
    const k = max > 0 ? deepScroll.scrollTop / max : 0;
    depthEl.style.setProperty('--p', (k * 100).toFixed(1) + '%');
    depthVal.textContent = Math.round(4 + k * 36) + 'm';
    if (lake3d) lake3d.setScroll('projects', k);
    layerDeep.style.setProperty('--deep-dark', (k * 0.45).toFixed(3));
  }

  // project filter tabs
  const tabs  = $$('.tab');
  const cards = $$('.card');
  function revealCards() {
    cards.filter(c => !c.hidden).forEach((c, i) => {
      c.style.setProperty('--i', i);
      c.classList.add('in');
    });
  }
  tabs.forEach(tab => tab.addEventListener('click', () => {
    if (tab.getAttribute('aria-selected') === 'true') return;
    tabs.forEach(t => t.setAttribute('aria-selected', String(t === tab)));
    const f = tab.dataset.filter;
    cards.forEach(c => { c.classList.remove('in'); c.hidden = c.dataset.category !== f; });
    deep.drop(deep.w / 2, deep.h * 0.35, 8, 500);
    requestAnimationFrame(() => requestAnimationFrame(revealCards));
  }));

  /* =========================================================
     WINDOW (contact) — the little moonlit lake in the marumado
     ========================================================= */
  const winCanvas = $('#winCanvas');
  const win = new Ripple(winCanvas, {
    damp: 0.978, refract: 0.12, light: 0.55,
    ambient(ro, t, h) { for (let y = 0; y < h; y++) ro[y] = Math.sin(y * 0.6 + t * 1.8) * (0.3 + 1.3 * y / h); }
  });
  let winRect = null;
  function layoutWin() {
    winRect = winCanvas.getBoundingClientRect();
    if (winRect.width < 4) return;
    win.resize(winRect.width / 2.2, (winRect.height / 2.2) * 1.4);
    const w = win.w, h = win.h;
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const x = c.getContext('2d');
    const g = x.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, '#1a1c3c'); g.addColorStop(1, '#05091a');
    x.fillStyle = g; x.fillRect(0, 0, w, h);
    x.fillStyle = '#0b0d22'; x.fillRect(0, 0, w, h * 0.08);
    const r = mulberry(3), cx = w * 0.71;
    for (let j = Math.round(h * 0.06); j < h; j += 2) {
      const k = j / h, bw = w * (0.1 + k * 0.12) * (0.6 + r() * 0.6);
      x.fillStyle = `rgba(255,240,210,${(0.75 * (1 - k) * (0.5 + r() * 0.5)).toFixed(3)})`;
      x.fillRect(cx - bw / 2 + (r() - 0.5) * w * 0.05, j, bw, 1.2);
    }
    win.setTexture(x.getImageData(0, 0, w, h).data);
  }

  /* =========================================================
     Pointer → water
     ========================================================= */
  const ptr = { x: -9999, y: -9999, has: false };

  function interact(x0, y0, x1, y1) {
    const speed = Math.hypot(x1 - x0, y1 - y0);
    if (lake3d) { lake3d.pointer(x1, y1, speed); return; }
    if (state.busy) return;
    if (state.page === 'home') {
      if (y1 > L.horizon + 2) {
        const sy = v => ((v - L.horizon) / L.lakeH) * lake.h;
        lake.trail((x0 / W) * lake.w, sy(y0), (x1 / W) * lake.w, sy(y1), 2.2, clamp(26 + speed * 5, 26, 220));
      }
    } else if (state.page === 'projects') {
      deep.trail((x0 / W) * deep.w, (y0 / H) * deep.h, (x1 / W) * deep.w, (y1 / H) * deep.h, 3, clamp(18 + speed * 4, 18, 180));
      if (speed > 10 && Math.random() < 0.3) spawnBubble(x1, y1, false, false);
    } else if (state.page === 'contact' && winRect && win.ready) {
      const r = winRect;
      const inside = v => v.x >= r.left && v.x <= r.right && v.y >= r.top && v.y <= r.bottom;
      if (inside({ x: x1, y: y1 })) {
        const mx = v => ((v - r.left) / r.width) * win.w, my = v => ((v - r.top) / r.height) * win.h;
        win.trail(mx(x0), my(y0), mx(x1), my(y1), 2.2, clamp(40 + speed * 6, 40, 260));
      }
    }
  }

  addEventListener('pointermove', e => {
    const x = e.clientX, y = e.clientY;
    if (ptr.has) interact(ptr.x, ptr.y, x, y);
    ptr.x = x; ptr.y = y; ptr.has = true;
  }, { passive: true });

  addEventListener('pointerdown', e => {
    const x = e.clientX, y = e.clientY;
    ptr.x = x; ptr.y = y; ptr.has = true;
    spawnInkSplat(x, y);
    if (lake3d) { if (!e.target.closest('a, button, input, textarea')) lake3d.click(x, y); return; }
    if (state.busy) return;
    if (state.page === 'home') lakeDrop(x, y, 5, 520);
    else if (state.page === 'projects') {
      deep.drop((x / W) * deep.w, (y / H) * deep.h, 6, 420);
      for (let i = 0; i < 8; i++) spawnBubble(x + rand(-10, 10), y + rand(-10, 10), true, false);
    }
  }, { passive: true });

  document.documentElement.addEventListener('pointerleave', () => {
    ptr.has = false; ptr.x = ptr.y = -9999;
    if (lake3d) lake3d.leave();
  });

  /* ---------- Ink-brush cursor ----------
     A sumi-ink brush tip that leaves a fading stroke, draws an ensō
     circle over links and splatters ink on click. */
  const inkCanvas = $('#inkCanvas');
  const ictx = inkCanvas.getContext('2d');
  const enso = $('#enso');
  const inkTrail = [], inkDrops = [];
  const tip = { x: -99, y: -99, a: 0 };
  const INK_LIFE = 460;
  let hoverDOM = false, hover3D = false;
  function syncEnso() {
    const on = hoverDOM || hover3D;
    // only the cursor changes — toggling classes on <body> restyled the whole page and made the title flash
    enso.classList.toggle('on', on);
    enso.classList.toggle('pick-3d', hover3D && !hoverDOM);
  }

  function layoutInk() {
    if (!finePointer) return;
    inkCanvas.width = W * DPR; inkCanvas.height = H * DPR;
    ictx.setTransform(DPR, 0, 0, DPR, 0, 0);
  }
  if (finePointer) {
    addEventListener('pointermove', e => {
      inkTrail.push({ x: e.clientX, y: e.clientY, t: performance.now() });
      if (inkTrail.length > 60) inkTrail.shift();
    }, { passive: true });
    document.addEventListener('pointerover', e => {
      hoverDOM = !!e.target.closest('a, button');
      syncEnso();
    });
  }
  function spawnInkSplat(x, y) {
    if (!finePointer) return;
    for (let i = 0; i < 12; i++) {
      const a = rand(0, Math.PI * 2), sp = rand(60, 320);
      inkDrops.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, r: rand(1, 3.6), life: rand(0.35, 0.7), age: 0 });
    }
  }
  function updateCursor(dt) {
    if (!finePointer) return;
    const now = performance.now();
    const dark = state.page === 'contact';
    const ink = dark ? '33,27,22' : '255,246,234';
    ictx.clearRect(0, 0, W, H);

    while (inkTrail.length && now - inkTrail[0].t > INK_LIFE) inkTrail.shift();

    // the brush stroke: thick and dark near the tip, thin and faded at the tail
    ictx.lineCap = 'round'; ictx.lineJoin = 'round';
    for (let i = 1; i < inkTrail.length; i++) {
      const a = inkTrail[i - 1], b = inkTrail[i];
      const k = 1 - (now - b.t) / INK_LIFE;
      if (k <= 0) continue;
      ictx.strokeStyle = `rgba(${ink},${(k * 0.8).toFixed(3)})`;
      ictx.lineWidth = 0.6 + k * k * 7;
      ictx.beginPath(); ictx.moveTo(a.x, a.y); ictx.lineTo(b.x, b.y); ictx.stroke();
    }

    // ink splatter
    for (let i = inkDrops.length - 1; i >= 0; i--) {
      const d = inkDrops[i];
      d.age += dt;
      if (d.age >= d.life) { inkDrops.splice(i, 1); continue; }
      d.vx *= 1 - dt * 6; d.vy *= 1 - dt * 6;
      d.x += d.vx * dt; d.y += d.vy * dt;
      ictx.fillStyle = `rgba(${ink},${(1 - d.age / d.life).toFixed(3)})`;
      ictx.beginPath(); ictx.arc(d.x, d.y, d.r, 0, 6.283); ictx.fill();
    }

    // brush tip: an ink drop stretched along the direction of travel
    const dx = ptr.x - tip.x, dy = ptr.y - tip.y;
    tip.x += dx * 0.5; tip.y += dy * 0.5;
    const sp = Math.hypot(dx, dy);
    if (sp > 0.5) tip.a = Math.atan2(dy, dx);
    if (ptr.has) {
      const stretch = 1 + Math.min(sp / 18, 1.4);
      ictx.save();
      ictx.translate(ptr.x, ptr.y); ictx.rotate(tip.a);
      ictx.fillStyle = `rgba(${ink},.95)`;
      ictx.beginPath(); ictx.ellipse(0, 0, 4.5 * stretch, 4.5 / Math.sqrt(stretch), 0, 0, 6.283); ictx.fill();
      ictx.restore();
      ictx.fillStyle = '#e0573f';
      ictx.beginPath(); ictx.arc(ptr.x, ptr.y, 1.8, 0, 6.283); ictx.fill();
    }
    enso.style.transform = `translate3d(${ptr.x}px, ${ptr.y}px, 0)`;
    enso.classList.toggle('dark', dark);
  }

  /* =========================================================
     Router + scene transitions
     ========================================================= */
  const PAGES  = ['home', 'projects', 'about', 'contact', 'gallery', 'ski'];
  const TITLES = {
    home: 'Lluc Vivet Torras — Developer',
    projects: 'Projects — Lluc Vivet Torras',
    about: 'About — Lluc Vivet Torras',
    contact: 'Contact — Lluc Vivet Torras',
    gallery: '侍の目 — Hidden gallery',
    ski: '雪の道 — Snow Run'
  };
  const MOVE = reduceMotion ? 450 : 1500;

  const world      = $('#world');
  const zoom       = $('#surfaceZoom');
  const interior   = $('#page-contact');
  const aboutScroll = $('#aboutScroll');
  const layers = {
    home: $('#page-home'), projects: layerDeep, about: $('#page-about'), contact: interior, gallery: $('#page-gallery'), ski: $('#page-ski')
  };
  const state  = { page: null, busy: false, queued: null };
  const active = new Set();

  function markPage(p) {
    body.dataset.page = p;
    $$('#nav [data-route]').forEach(a => {
      if (a.dataset.route === p && !a.classList.contains('nav-logo')) a.setAttribute('aria-current', 'page');
      else a.removeAttribute('aria-current');
    });
    for (const [k, el] of Object.entries(layers)) {
      const on = k === p;
      el.inert = !on;
      el.setAttribute('aria-hidden', String(!on));
    }
    document.title = TITLES[p];
    if (p === 'projects') revealCards();
    if (p === 'gallery') loadGallery().then(() => { if (lake3d) ensureGallery3D(); });
    if (p === 'ski' && !state.busy && state.page === null) ensureSki().then(g => g && g.show());
  }

  function setZoomOrigin() {
    const [x, y] = vb(900, 482);   // the house's lit doorway
    zoom.style.transformOrigin = `${x}px ${y}px`;
  }

  function applyInstant(p) {
    body.classList.add('no-anim');
    world.dataset.at = p === 'contact' ? 'home' : p;
    zoom.classList.toggle('zoomed', p === 'contact');
    interior.classList.toggle('show', p === 'contact');
    interior.classList.toggle('open', p === 'contact');
    active.clear();
    active.add(p);
    markPage(p);
    state.page = p;
    if (p === 'contact') layoutWin();
    void body.offsetWidth;
    requestAnimationFrame(() => requestAnimationFrame(() => body.classList.remove('no-anim')));
  }

  async function leg(from, to, fast) {
    const d = Math.round(fast ? MOVE * 0.6 : MOVE);
    root.style.setProperty('--move', d + 'ms');
    markPage(to);

    if (from === 'home' && to === 'projects') {            // dive under the surface
      active.add('projects');
      if (lake3d) lake3d.dive(d); else lakeSplash();
      bubbleBurst();
      deepScroll.scrollTop = 0; updateDepth();
      world.dataset.at = 'projects';
      await sleep(d);
      active.delete('home');
    } else if (from === 'projects' && to === 'home') {     // surface again
      active.add('home');
      if (lake3d) lake3d.surface(d);
      world.dataset.at = 'home';
      await sleep(d * 0.6);
      if (!lake3d) lake.drop(lake.w / 2, lake.h * 0.8, 6, 700);
      await sleep(d * 0.4);
      active.delete('projects');
    } else if (from === 'home' && to === 'about') {        // rise into the sky
      if (lake3d) lake3d.rise(d); else petalUpdraft(d / 1000);
      aboutScroll.scrollTop = 0;
      world.dataset.at = 'about';
      await sleep(d);
      active.delete('home');
    } else if (from === 'about' && to === 'home') {        // descend back to the lake
      active.add('home');
      if (lake3d) lake3d.descend(d);
      world.dataset.at = 'home';
      await sleep(d);
    } else if (from === 'home' && to === 'contact') {      // walk into the house
      if (lake3d) lake3d.enterHouse(d);
      else { setZoomOrigin(); zoom.classList.add('zoomed'); }
      await sleep(d * 0.78);
      interior.classList.add('show');
      layoutWin();
      active.add('contact');
      await sleep(d * 0.3);
      interior.classList.add('open');
      await sleep(fast ? 500 : 950);
      active.delete('home');
    } else if (to === 'gallery' || from === 'gallery' || to === 'ski' || from === 'ski') {   // (2D fallback) fade
      active.add(to === 'gallery' || to === 'ski' ? from : to);
      if (from === 'gallery' || from === 'ski') world.dataset.at = to === 'contact' ? 'home' : to;
      if (to === 'ski') ensureSki().then(() => skiGame && skiGame.show());
      if (from === 'ski' && skiGame) skiGame.hide();
      await sleep(d * 0.8);
    } else if (from === 'contact' && to === 'home') {      // step back outside
      interior.classList.remove('open');
      await sleep(fast ? 450 : 850);
      active.add('home');
      if (lake3d) lake3d.exitHouse(d);
      zoom.classList.remove('zoomed');
      interior.classList.remove('show');
      await sleep(d * 0.9);
      active.delete('contact');
    }
    state.page = to;
  }

  async function travel3D(from, to) {
    const ms = lake3d.travelTime(from, to);
    root.style.setProperty('--move', ms + 'ms');
    body.classList.add('in-transit');
    if (from === 'gallery') {                                         // the iris closes first, then we pull out of the eye
      closeLightbox(true);
      body.classList.add('iris-closing');
      await sleep(reduceMotion ? 200 : 1150);
      if (gallery3d) gallery3d.stop();
      body.classList.remove('iris-closing');
    }
    if (from === 'contact') interior.classList.remove('show', 'open');
    if (from === 'ski' && skiGame) skiGame.hide();
    if (to === 'ski') ensureSki();
    if (to === 'projects') { deepScroll.scrollTop = 0; updateDepth(); }
    if (to === 'about') { aboutScroll.scrollTop = 0; lake3d.setScroll('about', 0); }
    if (to === 'gallery') { loadGallery().then(ensureGallery3D); $('#galleryScroll').scrollTop = 0; }
    markPage(to);
    const done = lake3d.travel(from, to, ms);
    await sleep(ms * (to === 'gallery' ? 0.97 : to === 'ski' ? 0.9 : 0.7));   // the iris only opens once we're inside the pupil
    if (to === 'gallery' && gallery3d) gallery3d.start();
    if (to === 'ski') { await ensureSki(); if (skiGame) skiGame.show(); }
    body.classList.remove('in-transit');
    if (to === 'contact') interior.classList.add('show', 'open');
    await done;
    state.page = to;
  }

  /* ---------- Snow Run (ski mini-game) ---------- */
  let skiGame = null, skiLoading = null;
  function ensureSki() {
    if (skiGame) return Promise.resolve(skiGame);
    if (!skiLoading) skiLoading = import('./skigame.js')
      .then(mod => { skiGame = mod.createSkiGame({ container: $('#page-ski'), reduceMotion }); return skiGame; })
      .catch(e => { console.warn('Ski game unavailable:', e); skiLoading = null; });
    return skiLoading;
  }

  /* ---------- Hidden gallery ---------- */
  let gallery3d = null, gallery3dLoading = null;
  function ensureGallery3D() {
    if (gallery3d || gallery3dLoading || !lake3d || !photos.length) return gallery3dLoading;
    gallery3dLoading = import('./gallery3d.js').then(mod => {
      gallery3d = mod.createGallery3D({
        container: $('#page-gallery'), photos, reduceMotion,
        onOpen: (i, rect) => openLightbox(i, rect),
        onHover: on => { hover3D = on; syncEnso(); }
      });
      $('#page-gallery').classList.add('g3d');
      if (body.dataset.page === 'gallery' && !body.classList.contains('in-transit')) gallery3d.start();
    }).catch(e => { console.warn('3D gallery unavailable, keeping the grid:', e); });
    return gallery3dLoading;
  }
  const photoGrid = $('#photoGrid');
  const lightbox = $('#lightbox'), lbImg = $('#lbImg'), lbCap = $('#lbCap'), lbCount = $('#lbCount');
  let photos = [], lbIndex = 0, galleryLoaded = null, lbBusy = false;
  const EASE = 'cubic-bezier(.2, .8, .2, 1)';

  function loadGallery() {
    if (galleryLoaded) return galleryLoaded;
    galleryLoaded = fetch('assets/gallery/photos.json', { cache: 'no-cache' })
      .then(r => r.json())
      .then(data => {
        photos = (data.photos || []).map(p => ({ src: /^(https?:)?\/\//.test(p.src) ? p.src : 'assets/gallery/' + p.src, caption: p.caption || '' }));
        photoGrid.innerHTML = '';
        if (!photos.length) { photoGrid.innerHTML = '<p class="gallery-empty">No photos yet — add some to assets/gallery/photos.json</p>'; return; }
        photos.forEach((p, i) => {
          const fig = document.createElement('figure');
          fig.className = 'photo'; fig.tabIndex = 0; fig.style.setProperty('--i', i);
          fig.setAttribute('role', 'button'); fig.setAttribute('aria-label', p.caption || `Photo ${i + 1}`);
          const img = document.createElement('img');
          img.src = p.src; img.alt = p.caption; img.loading = 'lazy'; img.decoding = 'async';
          fig.appendChild(img);
          if (p.caption) { const cap = document.createElement('figcaption'); cap.textContent = p.caption; fig.appendChild(cap); }
          fig.addEventListener('click', () => openLightbox(i));
          fig.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openLightbox(i); } });
          // 3D tilt + moving shine that follows the cursor
          if (finePointer && !reduceMotion) {
            fig.addEventListener('pointermove', e => {
              const r = fig.getBoundingClientRect();
              const px = (e.clientX - r.left) / r.width, py = (e.clientY - r.top) / r.height;
              fig.classList.add('tilting');
              fig.style.setProperty('--ry', ((px - 0.5) * 10).toFixed(2) + 'deg');
              fig.style.setProperty('--rx', ((0.5 - py) * 8).toFixed(2) + 'deg');
              fig.style.setProperty('--mx', (px * 100).toFixed(1) + '%');
              fig.style.setProperty('--my', (py * 100).toFixed(1) + '%');
            });
            fig.addEventListener('pointerleave', () => {
              fig.classList.remove('tilting');
              fig.style.setProperty('--rx', '0deg'); fig.style.setProperty('--ry', '0deg');
            });
          }
          photoGrid.appendChild(fig);
        });
      })
      .catch(() => { photoGrid.innerHTML = '<p class="gallery-empty">Couldn\'t load the gallery.</p>'; galleryLoaded = null; });
    return galleryLoaded;
  }

  const thumbOf = i => photoGrid.children[i] && photoGrid.children[i].querySelector('img');
  function setPhoto(i) {
    lbIndex = (i + photos.length) % photos.length;
    lbImg.src = photos[lbIndex].src; lbImg.alt = photos[lbIndex].caption;
    lbCap.textContent = photos[lbIndex].caption;
    lbCount.textContent = `${String(lbIndex + 1).padStart(2, '0')} / ${String(photos.length).padStart(2, '0')}`;
  }
  // FLIP: the photo grows out of its thumbnail, and shrinks back into it
  function flipFrom(thumb, reverse) {
    const a = thumb.getBoundingClientRect ? thumb.getBoundingClientRect() : thumb, b = lbImg.getBoundingClientRect();
    if (!a.width || !b.width) return Promise.resolve();
    const from = `translate(${a.left + a.width / 2 - (b.left + b.width / 2)}px, ${a.top + a.height / 2 - (b.top + b.height / 2)}px) scale(${a.width / b.width}, ${a.height / b.height})`;
    const frames = [{ transform: from, borderRadius: '14px', opacity: 0.6 }, { transform: 'none', borderRadius: '10px', opacity: 1 }];
    return lbImg.animate(reverse ? frames.reverse() : frames, { duration: reduceMotion ? 1 : 560, easing: EASE, fill: 'both' }).finished;
  }
  async function openLightbox(i, rect) {
    if (lbBusy || !photos.length) return;
    lbBusy = true;
    setPhoto(i);
    lightbox.hidden = false;
    try { await lbImg.decode(); } catch {}
    requestAnimationFrame(() => lightbox.classList.add('open'));
    const t = rect || thumbOf(lbIndex);
    if (rect) await flipFrom(rect, false);
    else if (t) { t.style.visibility = 'hidden'; await flipFrom(t, false); t.style.visibility = ''; }
    lbBusy = false;
    $('#lbClose').focus({ preventScroll: true });
  }
  async function closeLightbox(instant) {
    if (lightbox.hidden) return;
    const t = gallery3d ? gallery3d.cardRectFor(lbIndex) : thumbOf(lbIndex);
    if (!instant && t && !lbBusy) {
      lbBusy = true;
      lightbox.classList.remove('open');
      if (t.style) t.style.visibility = 'hidden';
      await flipFrom(t, true);
      if (t.style) t.style.visibility = '';
      lbBusy = false;
    }
    lightbox.classList.remove('open');
    lightbox.hidden = true;
    lbImg.getAnimations().forEach(a => a.cancel());
  }
  // crossfade + slide between photos
  async function stepPhoto(dir) {
    if (lbBusy || photos.length < 2) return;
    lbBusy = true;
    const d = reduceMotion ? 1 : 260;
    await lbImg.animate([{ opacity: 1, transform: 'none' }, { opacity: 0, transform: `translateX(${-dir * 40}px) scale(.98)` }], { duration: d, easing: 'ease-in', fill: 'forwards' }).finished;
    setPhoto(lbIndex + dir);
    try { await lbImg.decode(); } catch {}
    lbImg.getAnimations().forEach(a => a.cancel());
    await lbImg.animate([{ opacity: 0, transform: `translateX(${dir * 40}px) scale(.98)` }, { opacity: 1, transform: 'none' }], { duration: d + 120, easing: EASE }).finished;
    lbBusy = false;
  }
  $('#lbClose').addEventListener('click', () => closeLightbox());
  $('#lbPrev').addEventListener('click', () => stepPhoto(-1));
  $('#lbNext').addEventListener('click', () => stepPhoto(1));
  lightbox.addEventListener('click', e => { if (e.target === lightbox || e.target.classList.contains('lb-figure')) closeLightbox(); });
  let lbTouch = null;
  lightbox.addEventListener('touchstart', e => { lbTouch = e.touches[0].clientX; }, { passive: true });
  lightbox.addEventListener('touchend', e => {
    if (lbTouch == null) return;
    const dx = e.changedTouches[0].clientX - lbTouch; lbTouch = null;
    if (Math.abs(dx) > 50) stepPhoto(dx < 0 ? 1 : -1);
  }, { passive: true });
  addEventListener('keydown', e => {
    if (lightbox.hidden) return;
    if (e.key === 'Escape') { closeLightbox(); e.stopImmediatePropagation(); }
    else if (e.key === 'ArrowLeft') { stepPhoto(-1); e.stopImmediatePropagation(); }
    else if (e.key === 'ArrowRight') { stepPhoto(1); e.stopImmediatePropagation(); }
  }, true);

  async function go(target) {
    if (!PAGES.includes(target)) target = 'home';
    if (state.busy) { state.queued = target; return; }
    if (target === state.page) return;
    state.busy = true;
    try {
      if (lake3d) await travel3D(state.page, target);
      else {
        if (state.page !== 'home' && target !== 'home') await leg(state.page, 'home', true);
        await leg(state.page, target, false);
      }
    } finally {
      state.busy = false;
    }
    const q = state.queued;
    state.queued = null;
    if (q && q !== state.page) go(q);
  }

  const pageFromHash = () => {
    const h = location.hash.replace(/^#\/?/, '');
    return PAGES.includes(h) ? h : 'home';
  };
  function navigate(p) {
    if (location.hash === '#' + p) go(p);
    else location.hash = p;
  }
  addEventListener('hashchange', () => go(pageFromHash()));

  /* ---------- Scroll / swipe / keys move the camera ---------- */
  const atBottom = el => el.scrollTop + el.clientHeight >= el.scrollHeight - 2;
  const innerScrolledAt = { projects: 0, about: 0 };
  deepScroll.addEventListener('scroll', () => { innerScrolledAt.projects = performance.now(); updateDepth(); }, { passive: true });
  aboutScroll.addEventListener('scroll', () => {
    innerScrolledAt.about = performance.now();
    if (lake3d) {
      const max = aboutScroll.scrollHeight - aboutScroll.clientHeight;
      lake3d.setScroll('about', max > 0 ? aboutScroll.scrollTop / max : 0);
    }
  }, { passive: true });

  let wheelAcc = 0, wheelTimer = 0, lastNavAt = 0;
  addEventListener('wheel', e => {
    const now = performance.now();
    if (state.busy || now - lastNavAt < 1100) return;
    const p = state.page;
    let ok = false;
    if (p === 'home') ok = true;
    else if (p === 'projects') ok = e.deltaY < 0 && deepScroll.scrollTop <= 0 && now - innerScrolledAt.projects > 400;
    else if (p === 'about') ok = e.deltaY > 0 && atBottom(aboutScroll) && now - innerScrolledAt.about > 400;
    if (!ok) { wheelAcc = 0; return; }
    wheelAcc += e.deltaY;
    clearTimeout(wheelTimer);
    wheelTimer = setTimeout(() => { wheelAcc = 0; }, 250);
    if (Math.abs(wheelAcc) > 90) {
      const dir = Math.sign(wheelAcc);
      wheelAcc = 0; lastNavAt = now;
      if (p === 'home') navigate(dir > 0 ? 'projects' : 'about');
      else navigate('home');
    }
  }, { passive: true });

  let touch = null;
  addEventListener('touchstart', e => {
    touch = { y: e.touches[0].clientY, deepTop: deepScroll.scrollTop, aboutBottom: atBottom(aboutScroll) };
  }, { passive: true });
  addEventListener('touchend', e => {
    if (!touch || state.busy) { touch = null; return; }
    const dy = e.changedTouches[0].clientY - touch.y;
    const p = state.page, t = touch;
    touch = null;
    if (Math.abs(dy) < 70) return;
    if (p === 'home') navigate(dy < 0 ? 'projects' : 'about');
    else if (p === 'projects' && dy > 0 && t.deepTop <= 0) navigate('home');
    else if (p === 'about' && dy < 0 && t.aboutBottom) navigate('home');
  }, { passive: true });

  addEventListener('keydown', e => {
    if (e.target.closest && e.target.closest('input, textarea')) return;
    const p = state.page;
    if (e.key === 'Escape' && p !== 'home') { closeLightbox(); navigate('home'); }
    else if (p === 'home' && (e.key === 'ArrowDown' || e.key === 'PageDown')) navigate('projects');
    else if (p === 'home' && (e.key === 'ArrowUp' || e.key === 'PageUp')) navigate('about');
  });

  /* ---------- Stars for the sky ---------- */
  function makeStars() {
    const r = mulberry(42);
    for (const [sel, n] of [['.stars.a', 140], ['.stars.b', 110]]) {
      const parts = [];
      for (let i = 0; i < n; i++) {
        const x = Math.round(r() * 2600), y = Math.round(Math.pow(r(), 1.4) * 1400);
        const s = r() < 0.1 ? 1 : 0;
        parts.push(`${x}px ${y}px 0 ${s}px rgba(255,248,232,${(0.4 + r() * 0.6).toFixed(2)})`);
      }
      $(sel).style.boxShadow = parts.join(',');
    }
  }

  /* =========================================================
     Main loop + layout
     ========================================================= */
  let last = performance.now();
  function frame(now) {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    const t = now / 1000;

    // pause the lake only once we're settled in the gallery — the camera flight must finish first,
    // otherwise its promise never resolves and the router stays busy (you couldn't leave the eye)
    const inGallery = (gallery3d && state.page === 'gallery' && !state.busy) || (skiGame && state.page === 'ski' && !state.busy);
    if (lake3d) {
      if (!inGallery) lake3d.render(dt, t);
    } else if (active.has('home')) {
      if (!reduceMotion && Math.random() < dt * 0.6) {
        lake.drop(rand(2, lake.w - 2), rand(lake.h * 0.1, lake.h - 2), 1.5, 70);
      }
      lake.step(t);
      updatePetals(dt, t);
    }
    if (!lake3d && active.has('projects')) {
      if (!reduceMotion && Math.random() < dt * 5) deep.drop(rand(2, deep.w - 2), rand(2, deep.h * 0.12), 2, 40);
      deep.step(t);
      updateFx(dt, t);
    }
    if (!lake3d && active.has('contact')) {
      if (!reduceMotion && Math.random() < dt * 0.5) win.drop(rand(2, win.w - 2), rand(2, win.h - 2), 1.5, 60);
      win.step(t);
    }
    updateCursor(dt);
    requestAnimationFrame(frame);
  }

  function setViewport() {
    W = innerWidth; H = innerHeight;
    root.style.setProperty('--h', H + 'px');
  }

  function layoutAll() {
    setViewport();
    const p = layoutLake();
    layoutPetals();
    layoutDeep();
    layoutFx();
    setZoomOrigin();
    layoutInk();
    if (lake3d) lake3d.resize(W, H);
    if (gallery3d) gallery3d.resize();
    if (skiGame) skiGame.resize();
    if (state.page === 'contact') layoutWin();
    return p;
  }

  let resizeTimer = 0;
  addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(layoutAll, 160);
  });

  let lake3d = null;
  async function load3D() {
    try {
      let mod;
      try { mod = await import('./scene3d.js'); }
      catch (e) { await sleep(800); mod = await import('./scene3d.js?retry=1'); }   // flaky CDN: one retry
      lake3d = mod.createLake3D({
        container: $('#stage'), reduceMotion, initialPage: state.page || pageFromHash(),
        onNavigate: p => navigate(p),
        onHover: on => { hover3D = on; syncEnso(); }
      });
      body.classList.add('three-on');
      if (state.page === 'gallery') loadGallery().then(ensureGallery3D);
      if (/[?&]debug\b/.test(location.search)) window.__lake3d = lake3d;   // test hook (only with ?debug)
      if (state.page === 'projects') updateDepth();
    } catch (e) {
      console.warn('3D lake unavailable, using the 2D one:', e);
      lake3d = null;
    }
  }

  function init() {
    makeStars();
    const texReady = layoutAll();
    applyInstant(pageFromHash());
    updateDepth();
    requestAnimationFrame(frame);
    const reveal = () => {
      body.classList.add('loaded');
      setTimeout(() => body.classList.add('name-ready'), 2300);   // drop the reveal mask once the name has slid in
    };
    const ready3D = load3D();
    Promise.race([Promise.all([texReady, ready3D]), sleep(4000)]).then(() => setTimeout(reveal, 250), reveal);
  }

  init();
})();
