/* ===========================
   Lluc Vivet Torras — Portfolio
   js/gallery3d.js  ·  the world inside the samurai's eye

   Photos float as cards in a deep 3D space. Drag to drift through it, scroll to
   fly forwards / backwards, hover to lift a card, click to open it.
   A giant eye watches from the dark behind them — it follows the cursor,
   dilates when you hover a photo, and blinks.
   =========================== */
import * as THREE from 'three';
import { makeEyeMaterial } from './eyeShader.js';

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
const damp = (a, b, k, dt) => lerp(a, b, 1 - Math.exp(-k * dt));

function mulberry(seed) {
  return () => {
    seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function createGallery3D({ container, photos, reduceMotion = false, onOpen = () => {}, onHover = () => {} }) {
  const canvas = document.createElement('canvas');
  canvas.className = 'gallery-canvas';
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  const DPR = Math.min(window.devicePixelRatio || 1, 1.6);
  renderer.setPixelRatio(DPR);
  renderer.setClearColor('#070304', 1);
  container.prepend(canvas);
  let W = container.clientWidth || innerWidth, H = container.clientHeight || innerHeight;
  renderer.setSize(W, H, false);

  const scene = new THREE.Scene();
  const FOG = new THREE.Color('#070304');
  scene.fog = new THREE.Fog(FOG, 14, 46);
  const camera = new THREE.PerspectiveCamera(52, W / H, 0.1, 200);
  camera.position.set(0, 0, 14);

  /* ---------- the giant eye ---------- */
  const eyeMat = makeEyeMaterial({ almond: true, lid: '#070304' });
  eyeMat.uniforms.uGlow.value = 0.35;
  const eye = new THREE.Mesh(new THREE.SphereGeometry(1, 128, 96), eyeMat);
  eye.scale.set(19, 15, 6);
  eye.position.set(0, 0.5, -40);
  scene.add(eye);
  const glowTex = (() => {
    const c = document.createElement('canvas'); c.width = c.height = 256;
    const x = c.getContext('2d'), g = x.createRadialGradient(128, 128, 0, 128, 128, 128);
    g.addColorStop(0, 'rgba(255,170,70,.35)'); g.addColorStop(0.5, 'rgba(200,80,20,.08)'); g.addColorStop(1, 'rgba(0,0,0,0)');
    x.fillStyle = g; x.fillRect(0, 0, 256, 256);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
  })();
  const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }));
  halo.scale.set(90, 70, 1); halo.position.set(0, 0.5, -46);
  scene.add(halo);

  /* ---------- drifting embers ---------- */
  const EN = reduceMotion ? 120 : 420;
  const ePos = new Float32Array(EN * 3), eSeed = new Float32Array(EN);
  const er = mulberry(7);
  for (let i = 0; i < EN; i++) {
    ePos[i * 3] = (er() - 0.5) * 60; ePos[i * 3 + 1] = (er() - 0.5) * 36; ePos[i * 3 + 2] = -36 + er() * 46;
    eSeed[i] = er() * 100;
  }
  const eGeo = new THREE.BufferGeometry();
  eGeo.setAttribute('position', new THREE.BufferAttribute(ePos, 3));
  const embers = new THREE.Points(eGeo, new THREE.PointsMaterial({ color: '#ffb35c', size: 0.07, transparent: true, opacity: 0.55, depthWrite: false, blending: THREE.AdditiveBlending }));
  scene.add(embers);

  /* ---------- photo cards ---------- */
  const cardVert = `
    uniform float uHover, uTime, uPhase; uniform vec2 uBend;
    varying vec2 vUv; varying float vDepth;
    void main(){
      vUv = uv;
      vec3 p = position;
      vec2 c = uv - 0.5;
      p.z += (c.x * c.x * uBend.x + c.y * c.y * uBend.y) * -1.6;          // cards bend with the drift
      p.z += sin(uTime * 0.8 + uPhase + c.x * 3.0) * 0.04;                  // gentle ripple
      vec4 mv = modelViewMatrix * vec4(p, 1.0);
      vDepth = -mv.z;
      gl_Position = projectionMatrix * mv;
    }`;
  const cardFrag = `
    uniform sampler2D map; uniform float uHover, uAlpha, uAspect; uniform vec3 fogColor; uniform float fogNear, fogFar;
    varying vec2 vUv; varying float vDepth;
    float rbox(vec2 p, vec2 b, float r){ vec2 q = abs(p) - b + r; return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r; }
    void main(){
      vec2 p = (vUv - 0.5) * vec2(uAspect, 1.0);
      float d = rbox(p, vec2(uAspect, 1.0) * 0.5, 0.045);
      if (d > 0.0) discard;
      vec2 uv = (vUv - 0.5) / (1.0 + uHover * 0.06) + 0.5;                  // subtle zoom inside the frame
      vec3 col = texture2D(map, uv).rgb;
      float g = dot(col, vec3(0.299, 0.587, 0.114));
      col = mix(mix(vec3(g), col, 0.55) * vec3(1.02, 0.95, 0.88), col, uHover);   // muted until hovered
      float edge = smoothstep(-0.02, 0.0, d);
      col = mix(col, vec3(1.0, 0.78, 0.4), edge * (0.25 + uHover * 0.75));          // golden rim
      col *= 0.82 + 0.18 * uHover;
      float f = smoothstep(fogNear, fogFar, vDepth);
      col = mix(col, fogColor, f);
      gl_FragColor = vec4(col, uAlpha * (1.0 - f * 0.4));
      #include <colorspace_fragment>
    }`;

  const loader = new THREE.TextureLoader();
  const texCache = new Map();
  const getTex = (src, cb) => {
    if (texCache.has(src)) { const t = texCache.get(src); t.image ? cb(t) : t.userData.cbs.push(cb); return; }
    const t = loader.load(src, tex => { tex.userData.cbs.forEach(f => f(tex)); tex.userData.cbs = []; });
    t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; t.userData.cbs = [cb];
    texCache.set(src, t);
  };

  const cards = [];
  const n = photos.length;
  const COUNT = n ? Math.min(36, Math.max(n, 18)) : 0;
  const r = mulberry(21);
  // layered, jittered rings so nothing overlaps head-on
  for (let i = 0; i < COUNT; i++) {
    const layer = i % 4, ring = Math.floor(i / 4);
    const ang = ring * 2.399 + layer * 1.1 + r() * 0.4;
    const rad = 3.2 + (ring % 3) * 3.1 + r() * 1.6;
    const pos = new THREE.Vector3(Math.cos(ang) * rad * 1.45, Math.sin(ang) * rad * 0.8, -layer * 7.5 - r() * 3 + 2);
    const photoIndex = i % n;
    const mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: true,
      uniforms: {
        map: { value: null }, uHover: { value: 0 }, uAlpha: { value: 0 }, uAspect: { value: 1.5 },
        uTime: { value: 0 }, uPhase: { value: r() * 6 }, uBend: { value: new THREE.Vector2() },
        fogColor: { value: FOG }, fogNear: { value: 14 }, fogFar: { value: 46 }
      },
      vertexShader: cardVert, fragmentShader: cardFrag
    });
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1, 24, 16), mat);
    const h = 2.4 + r() * 1.1;
    mesh.scale.set(h * 1.5, h, 1);
    mesh.position.copy(pos);
    mesh.userData = { home: pos.clone(), h, photoIndex, hover: 0, delay: 0.25 + i * 0.045, phase: r() * 6, tilt: (r() - 0.5) * 0.25 };
    getTex(photos[photoIndex].src, tex => {
      const a = tex.image.width / tex.image.height || 1.5;
      mat.uniforms.map.value = tex; mat.uniforms.uAspect.value = a;
      mesh.scale.set(h * a, h, 1);
    });
    scene.add(mesh);
    cards.push(mesh);
  }

  /* ---------- interaction ---------- */
  const look = { x: 0, y: 0 };                  // mouse, -1..1
  const view = { x: 0, y: 0, z: 14, vx: 0, vy: 0, vz: 0 };
  let dragging = false, dragMoved = 0, last = { x: 0, y: 0 }, hovered = null, intro = 0;
  const raycaster = new THREE.Raycaster(), ndc = new THREE.Vector2();

  function pick(x, y) {
    const rect = canvas.getBoundingClientRect();
    ndc.set(((x - rect.left) / rect.width) * 2 - 1, -((y - rect.top) / rect.height) * 2 + 1);
    raycaster.setFromCamera(ndc, camera);
    const hit = raycaster.intersectObjects(cards, false)[0];
    return hit ? hit.object : null;
  }
  function onMove(e) {
    look.x = (e.clientX / innerWidth) * 2 - 1; look.y = -((e.clientY / innerHeight) * 2 - 1);
    if (dragging) {
      const dx = e.clientX - last.x, dy = e.clientY - last.y;
      last.x = e.clientX; last.y = e.clientY;
      dragMoved += Math.abs(dx) + Math.abs(dy);
      view.vx = -dx * 0.012; view.vy = dy * 0.012;
      view.x += view.vx; view.y += view.vy;
    }
    const h = dragging ? null : pick(e.clientX, e.clientY);
    if (h !== hovered) { hovered = h; onHover(!!h); }
  }
  function onDown(e) {
    if (e.button !== undefined && e.button !== 0) return;
    dragging = true; dragMoved = 0; last.x = e.clientX; last.y = e.clientY;
    canvas.setPointerCapture && canvas.setPointerCapture(e.pointerId);
  }
  function onUp(e) {
    if (!dragging) return;
    dragging = false;
    if (dragMoved < 6) {
      const h = pick(e.clientX, e.clientY);
      if (h) onOpen(h.userData.photoIndex, cardRect(h));
    }
  }
  function onWheel(e) { view.vz += clamp(e.deltaY, -120, 120) * 0.0035; }
  canvas.addEventListener('pointermove', onMove);
  canvas.addEventListener('pointerdown', onDown);
  canvas.addEventListener('pointerup', onUp);
  canvas.addEventListener('pointercancel', () => { dragging = false; });
  canvas.addEventListener('wheel', onWheel, { passive: true });
  canvas.addEventListener('pointerleave', () => { if (hovered) { hovered = null; onHover(false); } });

  function cardRect(mesh) {
    const b = new THREE.Box3().setFromObject(mesh), rect = canvas.getBoundingClientRect();
    const pts = [];
    for (const x of [b.min.x, b.max.x]) for (const y of [b.min.y, b.max.y]) for (const z of [b.min.z, b.max.z]) pts.push(new THREE.Vector3(x, y, z).project(camera));
    const xs = pts.map(p => (p.x * 0.5 + 0.5) * rect.width + rect.left), ys = pts.map(p => (-p.y * 0.5 + 0.5) * rect.height + rect.top);
    const left = Math.min(...xs), top = Math.min(...ys);
    return { left, top, width: Math.max(...xs) - left, height: Math.max(...ys) - top };
  }

  /* ---------- loop ---------- */
  let running = false, raf = 0, prev = performance.now(), blinkT = 2.5, blinkK = 0;
  function frame(now) {
    if (!running) return;
    raf = requestAnimationFrame(frame);
    const dt = Math.min(0.05, (now - prev) / 1000); prev = now;
    const t = now / 1000;
    intro = Math.min(1, intro + dt / 2.4);

    // drift with inertia; bounded so you never get lost
    if (!dragging) { view.x += view.vx; view.y += view.vy; view.vx *= Math.pow(0.04, dt); view.vy *= Math.pow(0.04, dt); }
    view.z += view.vz; view.vz *= Math.pow(0.02, dt);
    if (!reduceMotion && !dragging && Math.abs(view.vx) < 0.002) view.x += Math.sin(t * 0.13) * 0.002;
    view.x = clamp(view.x, -9, 9); view.y = clamp(view.y, -6, 6); view.z = clamp(view.z, -12, 16);

    camera.position.set(view.x + look.x * 0.6, view.y + look.y * 0.4, view.z + (1 - easeOutCubic(intro)) * 6);   // settle in as you arrive
    camera.lookAt(view.x * 0.85 + look.x * 0.3, view.y * 0.85 + look.y * 0.2, view.z - 20);

    const bendX = clamp(view.vx * 9, -0.9, 0.9), bendY = clamp(view.vy * 9, -0.9, 0.9);
    for (const c of cards) {
      const u = c.userData, m = c.material.uniforms;
      const k = clamp((intro * 2.4 - u.delay) / 1.0, 0, 1), e = easeOutCubic(k);
      u.hover = damp(u.hover, c === hovered ? 1 : 0, 9, dt);
      c.position.set(
        u.home.x + Math.sin(t * 0.35 + u.phase) * 0.18,
        u.home.y + Math.cos(t * 0.3 + u.phase) * 0.14,
        u.home.z + (1 - e) * -26 + u.hover * 1.2
      );
      c.lookAt(camera.position.x * 0.35 + c.position.x * 0.65, camera.position.y * 0.35 + c.position.y * 0.65, camera.position.z);
      c.rotation.z += u.tilt * (1 - u.hover);
      const s = 1 + u.hover * 0.12;
      const a = m.uAspect.value;
      c.scale.set(u.h * a * s, u.h * s, 1);
      m.uHover.value = u.hover; m.uAlpha.value = e; m.uTime.value = t;
      m.uBend.value.set(lerp(m.uBend.value.x, bendX, 0.15), lerp(m.uBend.value.y, bendY, 0.15));
    }

    // embers rise slowly
    const ep = eGeo.attributes.position.array;
    for (let i = 0; i < EN; i++) {
      ep[i * 3 + 1] += dt * (0.15 + (eSeed[i] % 1) * 0.3);
      ep[i * 3] += Math.sin(t * 0.5 + eSeed[i]) * dt * 0.08;
      if (ep[i * 3 + 1] > 18) ep[i * 3 + 1] = -18;
    }
    eGeo.attributes.position.needsUpdate = true;

    // the eye: follows the cursor, dilates when you hover a photo, blinks
    const eu = eyeMat.uniforms;
    eu.uLook.value.set(damp(eu.uLook.value.x, look.x * 0.9, 4, dt), damp(eu.uLook.value.y, look.y * 0.9, 4, dt));
    eu.uPupil.value = damp(eu.uPupil.value, hovered ? 0.36 : 0.22 + Math.sin(t * 0.6) * 0.02, 3, dt);
    eu.uGlow.value = damp(eu.uGlow.value, hovered ? 0.8 : 0.35, 3, dt);
    eu.uTime.value = t;
    blinkT -= dt;
    if (blinkT <= 0) { blinkK = 1; blinkT = 3 + Math.random() * 5; }
    if (blinkK > 0) blinkK = Math.max(0, blinkK - dt * 3.6);
    eu.uOpen.value = (1 - (blinkK > 0 ? Math.sin(blinkK * Math.PI) : 0) * 0.97) * easeOutCubic(Math.min(1, intro * 1.6));
    eye.position.x = view.x * 0.35; eye.position.y = 0.5 + view.y * 0.35;
    halo.position.x = eye.position.x; halo.position.y = eye.position.y;

    renderer.render(scene, camera);
  }
  function easeOutCubic(x) { return 1 - Math.pow(1 - x, 3); }

  return {
    start() { if (running) return; running = true; intro = 0; prev = performance.now(); view.x = view.y = 0; view.z = 14; view.vx = view.vy = view.vz = 0; raf = requestAnimationFrame(frame); },
    stop() { running = false; cancelAnimationFrame(raf); if (hovered) { hovered = null; onHover(false); } },
    resize() {
      W = container.clientWidth || innerWidth; H = container.clientHeight || innerHeight;
      renderer.setSize(W, H, false); camera.aspect = W / H; camera.updateProjectionMatrix();
    },
    cardRectFor(photoIndex) {
      const c = cards.find(m => m.userData.photoIndex === photoIndex);
      return c ? cardRect(c) : null;
    }
  };
}
