/* ===========================
   Lluc Vivet Torras — Portfolio
   js/skigame.js  ·  雪の道 Snow Run — a little downhill mini-game on the volcano

   Steer: mouse / ← → (A D) / drag on touch.  Tuck: hold click or Space.
   Dodge pines and rocks, ride through torii gates (+100), grab gold koban (+25).
   =========================== */
import * as THREE from 'three';

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
const damp = (a, b, k, dt) => lerp(a, b, 1 - Math.exp(-k * dt));
const rand = (a, b) => a + Math.random() * (b - a);

const HALF = 9;            // half width of the run
const SPAWN_Z = -150;      // where new things appear
const BEST_KEY = 'lvt-snowrun-best';

export function createSkiGame({ container, reduceMotion = false }) {
  const $ = id => container.querySelector('#' + id);
  const ui = {
    score: $('skiScore'), speed: $('skiSpeed'), best: $('skiBest'),
    start: $('skiStart'), over: $('skiOver'), final: $('skiFinal'), finalBest: $('skiFinalBest'),
    go: $('skiGo'), retry: $('skiRetry'), toast: $('skiToast')
  };
  let best = 0;
  try { best = +localStorage.getItem(BEST_KEY) || 0; } catch {}
  ui.best.textContent = best;

  /* ---------- renderer / scene ---------- */
  const canvas = document.createElement('canvas');
  canvas.className = 'ski-canvas';
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.6));
  container.prepend(canvas);
  let W = container.clientWidth || innerWidth, H = container.clientHeight || innerHeight;
  renderer.setSize(W, H, false);

  const scene = new THREE.Scene();
  const FOG = new THREE.Color('#e8c9cf');
  scene.fog = new THREE.Fog(FOG, 40, 150);
  {
    const c = document.createElement('canvas'); c.width = 4; c.height = 256;
    const x = c.getContext('2d'), g = x.createLinearGradient(0, 0, 0, 256);
    g.addColorStop(0, '#3d3468'); g.addColorStop(0.45, '#9a6b8f'); g.addColorStop(0.75, '#e8a28c'); g.addColorStop(1, '#f6d2b0');
    x.fillStyle = g; x.fillRect(0, 0, 4, 256);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
    scene.background = t;
  }
  const camera = new THREE.PerspectiveCamera(62, W / H, 0.1, 400);
  camera.position.set(0, 4.4, 7.5);

  scene.add(new THREE.HemisphereLight('#ffe6ee', '#6a5a8a', 1.35));
  const sun = new THREE.DirectionalLight('#ffd2b0', 1.7);
  sun.position.set(12, 18, -30);
  scene.add(sun);

  // distant ridges + setting sun
  {
    const ridge = (z, base, amp, color, seed) => {
      const s = new THREE.Shape(); s.moveTo(-300, -5);
      for (let x = -300; x <= 300; x += 10) s.lineTo(x, base + amp * (0.5 + 0.5 * Math.sin(x * 0.02 + seed) * Math.cos(x * 0.047 + seed * 2)));
      s.lineTo(300, -5); s.closePath();
      const m = new THREE.Mesh(new THREE.ShapeGeometry(s), new THREE.MeshBasicMaterial({ color, fog: false }));
      m.position.set(0, -2, z); scene.add(m);
    };
    const sunDisc = new THREE.Mesh(new THREE.CircleGeometry(14, 40), new THREE.MeshBasicMaterial({ color: '#f9b994', fog: false }));
    sunDisc.position.set(40, 18, -260); scene.add(sunDisc);
    ridge(-240, 4, 26, '#8f7aa6', 1.3);
    ridge(-200, 0, 18, '#6f5e8e', 4.1);
  }

  // the slope: a snow plane whose texture scrolls with your speed
  const snowTex = (() => {
    const c = document.createElement('canvas'); c.width = c.height = 256;
    const x = c.getContext('2d');
    x.fillStyle = '#f4eef2'; x.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 1400; i++) {
      x.fillStyle = Math.random() < 0.5 ? 'rgba(170,160,200,.14)' : 'rgba(255,255,255,.7)';
      x.fillRect(Math.random() * 256, Math.random() * 256, 1 + Math.random() * 2, 1 + Math.random() * 6);
    }
    for (let i = 0; i < 6; i++) {            // old ski tracks
      x.strokeStyle = 'rgba(150,140,190,.18)'; x.lineWidth = 2;
      x.beginPath(); const sx = Math.random() * 256; x.moveTo(sx, 0);
      x.bezierCurveTo(sx + rand(-40, 40), 90, sx + rand(-40, 40), 170, sx + rand(-30, 30), 256); x.stroke();
    }
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
    t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(6, 22); t.anisotropy = 8;
    return t;
  })();
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(90, 320), new THREE.MeshLambertMaterial({ map: snowTex, color: '#ffffff' }));
  ground.rotation.x = -Math.PI / 2; ground.position.z = -130;
  scene.add(ground);
  // snow banks on both sides
  const bankMat = new THREE.MeshLambertMaterial({ color: '#efe4ec' });
  [-1, 1].forEach(sd => {
    const b = new THREE.Mesh(new THREE.CylinderGeometry(4, 6, 320, 10, 1, true), bankMat);
    b.rotation.x = Math.PI / 2; b.position.set(sd * (HALF + 6), -1.5, -130); b.scale.set(1, 1, 0.6);
    scene.add(b);
  });

  /* ---------- the skier: little samurai in a straw hat and red scarf ---------- */
  const player = new THREE.Group();
  const body = new THREE.Group();
  player.add(body);
  {
    const indigo = new THREE.MeshLambertMaterial({ color: '#25305a' });
    const dark = new THREE.MeshLambertMaterial({ color: '#1a1418' });
    const skin = new THREE.MeshLambertMaterial({ color: '#e2b690' });
    const straw = new THREE.MeshLambertMaterial({ color: '#d8b56a' });
    const red = new THREE.MeshLambertMaterial({ color: '#c8372a' });
    const add = (g, m, x, y, z, rx = 0, ry = 0, rz = 0, p = body) => { const o = new THREE.Mesh(g, m); o.position.set(x, y, z); o.rotation.set(rx, ry, rz); p.add(o); return o; };
    [-0.22, 0.22].forEach(x => {
      add(new THREE.BoxGeometry(0.12, 0.04, 1.9), red, x, 0.03, -0.1, 0, 0, 0, player);              // skis
      add(new THREE.BoxGeometry(0.12, 0.04, 0.25), red, x, 0.08, -1.02, -0.5, 0, 0, player);        // ski tips
      add(new THREE.CylinderGeometry(0.08, 0.09, 0.6, 8), indigo, x * 0.8, 0.38, 0.05, 0.25);        // legs
    });
    add(new THREE.CylinderGeometry(0.22, 0.26, 0.6, 10), indigo, 0, 0.92, 0.1, 0.35);                // torso
    add(new THREE.CylinderGeometry(0.235, 0.235, 0.08, 12), red, 0, 0.78, 0.06, 0.35);               // obi
    add(new THREE.SphereGeometry(0.17, 14, 12), skin, 0, 1.33, -0.02);                               // head
    add(new THREE.ConeGeometry(0.42, 0.2, 18), straw, 0, 1.5, -0.02);                                // kasa hat
    [-1, 1].forEach(sd => {
      add(new THREE.CylinderGeometry(0.05, 0.05, 0.55, 6), indigo, sd * 0.3, 0.95, -0.12, -0.9, 0, sd * 0.3);   // arms
      add(new THREE.CylinderGeometry(0.015, 0.015, 1.1, 5), dark, sd * 0.42, 0.6, -0.45, -0.6, 0, sd * 0.1);   // poles
    });
  }
  // scarf that streams behind
  const scarfGeo = new THREE.PlaneGeometry(0.16, 1.1, 1, 10); scarfGeo.translate(0, -0.55, 0);
  const scarfBase = scarfGeo.attributes.position.array.slice();
  const scarf = new THREE.Mesh(scarfGeo, new THREE.MeshLambertMaterial({ color: '#d8402f', side: THREE.DoubleSide }));
  scarf.position.set(0.05, 1.18, 0.1); scarf.rotation.x = -1.35;
  body.add(scarf);
  const shadow = new THREE.Mesh(new THREE.CircleGeometry(0.75, 24), new THREE.MeshBasicMaterial({ color: '#6a5a8a', transparent: true, opacity: 0.28, depthWrite: false }));
  shadow.rotation.x = -Math.PI / 2; shadow.position.y = 0.01; shadow.scale.set(1, 1.6, 1);
  player.add(shadow);
  scene.add(player);

  /* ---------- obstacles, gates, coins ---------- */
  const pineDark = new THREE.MeshLambertMaterial({ color: '#2c4a3e' });
  const snowCap = new THREE.MeshLambertMaterial({ color: '#f7f2f6' });
  const trunk = new THREE.MeshLambertMaterial({ color: '#4a3226' });
  const rockMat = new THREE.MeshLambertMaterial({ color: '#7d7488', flatShading: true });
  const toriiMat = new THREE.MeshLambertMaterial({ color: '#c23b2c', emissive: '#3a0d08' });
  const blackMat = new THREE.MeshLambertMaterial({ color: '#1f1418' });
  const goldMat = new THREE.MeshLambertMaterial({ color: '#e7b54a', emissive: '#6a4410' });

  function makePine() {
    const g = new THREE.Group();
    const t = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.16, 0.8, 6), trunk); t.position.y = 0.4; g.add(t);
    [[1.3, 1.6, 0.9], [1.0, 1.4, 1.8], [0.7, 1.2, 2.6]].forEach(([r, h, y]) => {
      const c = new THREE.Mesh(new THREE.ConeGeometry(r, h, 8), pineDark); c.position.y = y; g.add(c);
      const s = new THREE.Mesh(new THREE.ConeGeometry(r * 0.72, h * 0.45, 8), snowCap); s.position.y = y + h * 0.3; g.add(s);
    });
    g.userData = { kind: 'pine', r: 0.9 };
    return g;
  }
  function makeRock() {
    const g = new THREE.Group();
    const r = new THREE.Mesh(new THREE.DodecahedronGeometry(0.9, 0), rockMat); r.scale.set(1.2, 0.7, 1); r.position.y = 0.35; g.add(r);
    const s = new THREE.Mesh(new THREE.SphereGeometry(0.75, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2.4), snowCap); s.scale.set(1.25, 0.5, 1); s.position.y = 0.62; g.add(s);
    g.userData = { kind: 'rock', r: 0.95 };
    return g;
  }
  function makeGate() {
    const g = new THREE.Group();
    [-1.9, 1.9].forEach(x => { const p = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.15, 3.2, 10), toriiMat); p.position.set(x, 1.6, 0); g.add(p); });
    const nuki = new THREE.Mesh(new THREE.BoxGeometry(4.3, 0.16, 0.16), toriiMat); nuki.position.y = 2.6; g.add(nuki);
    const kasagi = new THREE.Mesh(new THREE.BoxGeometry(5, 0.22, 0.3), blackMat); kasagi.position.y = 3.25; g.add(kasagi);
    const shimaki = new THREE.Mesh(new THREE.BoxGeometry(4.6, 0.16, 0.24), toriiMat); shimaki.position.y = 3.05; g.add(shimaki);
    g.userData = { kind: 'gate', r: 1.9 };
    return g;
  }
  function makeCoin() {
    const g = new THREE.Group();
    const c = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, 0.08, 24), goldMat);
    c.rotation.x = Math.PI / 2; c.scale.set(0.72, 1, 1); c.position.y = 0.9; g.add(c);
    g.userData = { kind: 'coin', r: 0.8, spin: c };
    return g;
  }
  const pools = { pine: [], rock: [], gate: [], coin: [] };
  const live = [];
  function take(kind) {
    const p = pools[kind];
    const o = p.length ? p.pop() : ({ pine: makePine, rock: makeRock, gate: makeGate, coin: makeCoin })[kind]();
    o.visible = true; o.userData.done = false; o.scale.setScalar(1);
    if (!o.parent) scene.add(o);
    live.push(o);
    return o;
  }
  function recycle(o) { o.visible = false; pools[o.userData.kind].push(o); }

  // scenery pines along the edges (no collision)
  const edgePines = [];
  for (let i = 0; i < 26; i++) {
    const p = makePine(); const sd = i % 2 ? 1 : -1;
    p.position.set(sd * rand(HALF + 2, HALF + 14), 0, -i * 6); p.scale.setScalar(rand(1, 1.8));
    scene.add(p); edgePines.push(p);
  }

  /* ---------- particles: falling snow + spray from the skis ---------- */
  const FN = reduceMotion ? 300 : 900;
  const fPos = new Float32Array(FN * 3);
  for (let i = 0; i < FN; i++) { fPos[i * 3] = rand(-25, 25); fPos[i * 3 + 1] = rand(0, 18); fPos[i * 3 + 2] = rand(-90, 10); }
  const fGeo = new THREE.BufferGeometry(); fGeo.setAttribute('position', new THREE.BufferAttribute(fPos, 3));
  scene.add(new THREE.Points(fGeo, new THREE.PointsMaterial({ color: '#ffffff', size: 0.09, transparent: true, opacity: 0.85, depthWrite: false })));
  const SN = 260, sPos = new Float32Array(SN * 3), sVel = new Float32Array(SN * 3), sLife = new Float32Array(SN);
  const sGeo = new THREE.BufferGeometry(); sGeo.setAttribute('position', new THREE.BufferAttribute(sPos, 3));
  scene.add(new THREE.Points(sGeo, new THREE.PointsMaterial({ color: '#ffffff', size: 0.16, transparent: true, opacity: 0.9, depthWrite: false })));
  let sCursor = 0;
  function spray(x, z, n, power) {
    for (let i = 0; i < n; i++) {
      const k = sCursor; sCursor = (sCursor + 1) % SN;
      sPos[k * 3] = x + rand(-0.3, 0.3); sPos[k * 3 + 1] = 0.1; sPos[k * 3 + 2] = z + rand(-0.2, 0.4);
      sVel[k * 3] = rand(-1, 1) * power; sVel[k * 3 + 1] = rand(1, 3) * power; sVel[k * 3 + 2] = rand(1, 4);
      sLife[k] = rand(0.4, 0.9);
    }
  }

  /* ---------- game state ---------- */
  const S = { mode: 'idle', speed: 0, score: 0, x: 0, targetX: 0, vx: 0, tuck: false, nextSpawn: 0, crashT: 0, t: 0, keys: 0 };
  function reset() {
    while (live.length) recycle(live.pop());
    Object.assign(S, { speed: 15, score: 0, x: 0, targetX: 0, vx: 0, tuck: false, nextSpawn: 20, crashT: 0, t: 0, keys: 0 });
    player.position.set(0, 0, 0); player.rotation.set(0, 0, 0); body.rotation.set(0, 0, 0);
    // a few things already on the slope so it starts alive
    for (let z = -40; z > SPAWN_Z; z -= 14) spawnRow(z, 0.5);
  }
  function spawnRow(z, density) {
    const r = Math.random();
    if (r < 0.14) {                                      // torii gate (with a clear line to it)
      const g = take('gate'); g.position.set(rand(-HALF + 2.5, HALF - 2.5), 0, z);
      return;
    }
    if (r < 0.3) {                                       // a curving line of koban
      const x0 = rand(-HALF + 1, HALF - 1), dir = Math.random() < 0.5 ? -1 : 1;
      for (let i = 0; i < 5; i++) { const c = take('coin'); c.position.set(clamp(x0 + dir * Math.sin(i * 0.5) * 2.5, -HALF + 0.5, HALF - 0.5), 0, z - i * 3); }
      return;
    }
    const n = 1 + Math.floor(Math.random() * (1.5 + density * 2.5));
    const gap = rand(-HALF + 2, HALF - 2);               // always leave a way through
    for (let i = 0; i < n; i++) {
      let x = rand(-HALF, HALF);
      if (Math.abs(x - gap) < 2.4) x = gap + (x < gap ? -2.6 : 2.6);
      const o = take(Math.random() < 0.72 ? 'pine' : 'rock');
      o.position.set(clamp(x, -HALF, HALF), 0, z + rand(-3, 3));
      o.rotation.y = rand(0, 6); o.scale.setScalar(rand(0.85, 1.25));
    }
  }

  function toast(text) {
    ui.toast.textContent = text;
    ui.toast.classList.remove('pop'); void ui.toast.offsetWidth; ui.toast.classList.add('pop');
  }
  function startRun() {
    reset();
    S.mode = 'play';
    ui.start.hidden = true; ui.over.hidden = true;
    container.classList.add('ski-playing');
  }
  function crash() {
    S.mode = 'crash'; S.crashT = 0;
    spray(S.x, 0, 60, 2.2);
    container.classList.remove('ski-playing');
    const score = Math.floor(S.score);
    if (score > best) { best = score; try { localStorage.setItem(BEST_KEY, String(best)); } catch {} }
    setTimeout(() => {
      ui.final.textContent = score; ui.finalBest.textContent = best; ui.best.textContent = best;
      ui.over.hidden = false; ui.retry.focus({ preventScroll: true });
    }, 1100);
  }

  /* ---------- input ---------- */
  const keyDown = new Set();
  function onKey(e) {
    if (!running) return;
    const down = e.type === 'keydown';
    const k = e.key;
    if (['ArrowLeft', 'a', 'A'].includes(k)) down ? keyDown.add('L') : keyDown.delete('L');
    else if (['ArrowRight', 'd', 'D'].includes(k)) down ? keyDown.add('R') : keyDown.delete('R');
    else if (k === ' ') { S.tuck = down; e.preventDefault(); }
    else if (k === 'Enter' && down && S.mode !== 'play') { startRun(); e.preventDefault(); }
    else return;
    S.keys = performance.now();
  }
  function onPointerMove(e) {
    if (!running || S.mode !== 'play') return;
    if (performance.now() - S.keys < 600) return;                 // keyboard has priority for a moment
    S.targetX = clamp(((e.clientX / innerWidth) * 2 - 1) * HALF * 1.15, -HALF, HALF);
  }
  function onPointerDown(e) {
    if (!running || S.mode !== 'play' || e.target.closest('a, button')) return;
    if (e.pointerType === 'mouse') S.tuck = true;                 // on touch the finger steers, so no tuck
    else onPointerMove(e);
  }
  function onPointerUp() { S.tuck = false; }
  ui.go.addEventListener('click', startRun);
  ui.retry.addEventListener('click', startRun);

  /* ---------- loop ---------- */
  let running = false, raf = 0, prev = 0;
  const pa = sGeo.attributes.position.array;
  function frame(now) {
    if (!running) return;
    raf = requestAnimationFrame(frame);
    const dt = Math.min(0.05, (now - prev) / 1000); prev = now;
    S.t += dt;

    let speed = S.speed;
    if (S.mode === 'play') {
      S.speed = Math.min(42, S.speed + dt * 0.5);
      speed = S.speed * (S.tuck ? 1.25 : 1);
      if (keyDown.has('L')) S.targetX -= dt * 16;
      if (keyDown.has('R')) S.targetX += dt * 16;
      S.targetX = clamp(S.targetX, -HALF, HALF);
      const px = S.x;
      S.x = damp(S.x, S.targetX, 5.5, dt);
      S.vx = (S.x - px) / Math.max(dt, 1e-3);
      S.score += speed * dt * (S.tuck ? 1.5 : 1);
      if (Math.abs(S.vx) > 4 && Math.random() < dt * 30) spray(S.x - Math.sign(S.vx) * 0.3, 0.3, 3, 1);
    } else if (S.mode === 'crash') {
      S.crashT += dt; speed = Math.max(0, S.speed * (1 - S.crashT * 1.4)); S.speed = speed;
    } else {                                                          // idle: gentle cruise behind the menu
      speed = 8; S.x = Math.sin(S.t * 0.6) * 3; S.vx = Math.cos(S.t * 0.6) * 1.8;
    }

    // move the world towards you
    const dz = speed * dt;
    snowTex.offset.y += dz / (320 / 22);
    S.nextSpawn -= dz;
    if (S.nextSpawn <= 0 && S.mode !== 'crash') {
      spawnRow(SPAWN_Z, S.mode === 'play' ? clamp((S.speed - 15) / 25, 0, 1) : 0.3);
      S.nextSpawn = S.mode === 'play' ? rand(9, 14) - clamp((S.speed - 15) / 4, 0, 4) : 14;
    }
    for (let i = live.length - 1; i >= 0; i--) {
      const o = live[i], u = o.userData;
      const z0 = o.position.z;
      o.position.z += dz;
      if (u.kind === 'coin') u.spin.rotation.z += dt * 4;
      if (o.position.z > 14) { live.splice(i, 1); recycle(o); continue; }
      if (S.mode !== 'play' || u.done) continue;
      const dx = Math.abs(o.position.x - S.x);
      if (u.kind === 'gate') {
        if (z0 < 0 && o.position.z >= 0) {
          if (dx < 1.6) { u.done = true; S.score += 100; toast('鳥居 +100'); spray(S.x, 0, 14, 1.2); }
          else if (dx < 2.15) { u.done = true; crash(); }
        }
      } else if (Math.abs(o.position.z) < 0.9) {
        if (u.kind === 'coin') {
          if (dx < u.r) { u.done = true; S.score += 25; toast('小判 +25'); o.visible = false; }
        } else if (dx < u.r * o.scale.x * 0.75 + 0.35) { u.done = true; crash(); }
      }
    }
    for (const p of edgePines) { p.position.z += dz; if (p.position.z > 14) p.position.z -= 26 * 6; }

    // skier pose: lean into turns, crouch when tucking, tumble on crash
    player.position.x = S.x;
    if (S.mode === 'crash') {
      body.rotation.z += dt * 9; body.rotation.x = damp(body.rotation.x, 1.4, 4, dt);
      player.position.y = Math.max(0, Math.sin(Math.min(1, S.crashT * 1.6) * Math.PI) * 1.2);
    } else {
      player.rotation.y = damp(player.rotation.y, clamp(-S.vx * 0.05, -0.5, 0.5), 8, dt);
      body.rotation.z = damp(body.rotation.z, clamp(-S.vx * 0.045, -0.5, 0.5), 8, dt);
      body.rotation.x = damp(body.rotation.x, S.tuck ? 0.45 : 0.1, 8, dt);
      body.position.y = damp(body.position.y, S.tuck ? -0.25 : 0, 8, dt);
      player.position.y = Math.abs(Math.sin(S.t * 9)) * 0.02;
    }
    // scarf ripples with speed
    const sa = scarfGeo.attributes.position.array;
    for (let i = 0; i < sa.length; i += 3) {
      const k = -scarfBase[i + 1] / 1.1;
      sa[i] = scarfBase[i] + Math.sin(S.t * 14 - k * 6) * 0.08 * k;
      sa[i + 2] = scarfBase[i + 2] + Math.cos(S.t * 11 - k * 5) * 0.06 * k;
    }
    scarfGeo.attributes.position.needsUpdate = true;

    // particles
    const fa = fGeo.attributes.position.array;
    for (let i = 0; i < FN; i++) {
      fa[i * 3 + 1] -= dt * 1.4; fa[i * 3 + 2] += dz; fa[i * 3] += Math.sin(S.t + i) * dt * 0.3;
      if (fa[i * 3 + 1] < 0 || fa[i * 3 + 2] > 12) { fa[i * 3] = rand(-25, 25) + S.x; fa[i * 3 + 1] = rand(6, 18); fa[i * 3 + 2] = rand(-90, -10); }
    }
    fGeo.attributes.position.needsUpdate = true;
    for (let k = 0; k < SN; k++) {
      if (sLife[k] <= 0) { pa[k * 3 + 1] = -10; continue; }
      sLife[k] -= dt;
      sVel[k * 3 + 1] -= 9 * dt;
      pa[k * 3] += sVel[k * 3] * dt; pa[k * 3 + 1] = Math.max(0.02, pa[k * 3 + 1] + sVel[k * 3 + 1] * dt); pa[k * 3 + 2] += (sVel[k * 3 + 2] + speed * 0.6) * dt;
    }
    sGeo.attributes.position.needsUpdate = true;

    // camera: follows behind, wider and lower as you go faster
    const fast = clamp((speed - 15) / 30, 0, 1);
    const shake = S.mode === 'play' && !reduceMotion ? fast * 0.04 : 0;
    camera.position.set(damp(camera.position.x, S.x * 0.75, 4, dt) + (Math.random() - 0.5) * shake, lerp(4.6, 3.6, fast) + (Math.random() - 0.5) * shake, lerp(7.8, 6.6, fast));
    camera.fov = damp(camera.fov, lerp(60, 74, fast), 3, dt); camera.updateProjectionMatrix();
    camera.lookAt(S.x * 0.6, 0.6, -12);

    // HUD
    ui.score.textContent = Math.floor(S.score);
    ui.speed.textContent = Math.round(speed * 3.6);

    renderer.render(scene, camera);
  }

  return {
    show() {
      if (running) return;
      running = true; prev = performance.now();
      reset(); S.mode = 'idle';
      ui.start.hidden = false; ui.over.hidden = true;
      container.classList.remove('ski-playing');
      addEventListener('keydown', onKey); addEventListener('keyup', onKey);
      addEventListener('pointermove', onPointerMove); addEventListener('pointerdown', onPointerDown); addEventListener('pointerup', onPointerUp);
      raf = requestAnimationFrame(frame);
    },
    hide() {
      running = false; cancelAnimationFrame(raf);
      removeEventListener('keydown', onKey); removeEventListener('keyup', onKey);
      removeEventListener('pointermove', onPointerMove); removeEventListener('pointerdown', onPointerDown); removeEventListener('pointerup', onPointerUp);
      keyDown.clear(); S.tuck = false;
      container.classList.remove('ski-playing');
    },
    resize() {
      W = container.clientWidth || innerWidth; H = container.clientHeight || innerHeight;
      renderer.setSize(W, H, false); camera.aspect = W / H; camera.updateProjectionMatrix();
    },
    get playing() { return running && S.mode === 'play'; }
  };
}
