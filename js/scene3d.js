/* ===========================
   Lluc Vivet Torras — Portfolio
   js/scene3d.js  ·  one continuous 3D world (Three.js)

     sky       (about)    — night sky, moon, clouds, cranes      y ≈ 40
     lake      (home)     — dusk lake, house, torii, sakura      y ≈ 0
     underwater(projects) — seabed, koi, seaweed, light shafts   y < 0
     house     (contact)  — a real room inside the stilt house

   A single camera flies between them along smooth spline paths.
   =========================== */
import * as THREE from 'three';
import { Reflector } from 'three/addons/objects/Reflector.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { makeEyeMaterial } from './eyeShader.js';

const V3 = THREE.Vector3;
const C  = hex => new THREE.Color(hex);
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const rand  = (a, b) => a + Math.random() * (b - a);
const lerp  = (a, b, t) => a + (b - a) * t;
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const easeInOut = t => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

function mulberry(seed) {
  return () => {
    seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function canvasTex(w, h, draw) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
function radialTex(stops, size = 128) {
  return canvasTex(size, size, (x, w) => {
    const g = x.createRadialGradient(w / 2, w / 2, 0, w / 2, w / 2, w / 2);
    stops.forEach(([o, c]) => g.addColorStop(o, c));
    x.fillStyle = g; x.fillRect(0, 0, w, w);
  });
}

export function createLake3D({ container, reduceMotion = false, initialPage = 'home', onNavigate = () => {}, onHover = () => {} }) {
  /* =========================================================
     Renderer / scene / camera
     ========================================================= */
  const canvas = document.createElement('canvas');
  canvas.id = 'threeCanvas';
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  if (!renderer.capabilities.isWebGL2) throw new Error('WebGL2 required');
  const DPR = Math.min(window.devicePixelRatio || 1, 1.5);
  renderer.setPixelRatio(DPR);
  container.appendChild(canvas);

  let W = innerWidth, H = innerHeight;
  const mobile = W < 700;
  renderer.setSize(W, H, false);

  const scene = new THREE.Scene();
  const FOG_DUSK  = C('#d48f8c'), FOG_NIGHT = C('#1b1c3f');
  const FOG_SHALLOW = C('#5a4a7a'), FOG_DEEP = C('#1a1433');      // underwater: the same dusk violet as above
  scene.fog = new THREE.Fog(FOG_DUSK.clone(), 28, 240);
  const fogU = { uFogColor: { value: scene.fog.color }, uFogNear: { value: 28 }, uFogFar: { value: 240 } };
  const FOG_GLSL = `
    uniform vec3 uFogColor; uniform float uFogNear, uFogFar;
    vec3 applyFog(vec3 c, float d){ return mix(c, uFogColor, smoothstep(uFogNear, uFogFar, d)); }`;

  const camera = new THREE.PerspectiveCamera(45, W / H, 0.05, 900);
  const SUN_DIR  = new V3(0.36, 0.085, -1).normalize();
  let volcano = null, skiNight = 1, furin = null, updateRoom = null, duel = null;
  const duelGroup = new THREE.Group();
  const MOON_DIR = new V3(0.04, 0.55, -1).normalize();

  /* =========================================================
     SKY — dome (follows camera), stars, sun, moon, clouds, cranes
     ========================================================= */
  const skyGroup = new THREE.Group();
  scene.add(skyGroup);
  const skyMat = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: {
      cH: { value: C('#f7c99b') }, c1: { value: C('#e3937f') }, c2: { value: C('#97698c') },
      c3: { value: C('#4d4174') }, cTop: { value: C('#1d1f3d') },
      nH: { value: C('#3b3566') }, n1: { value: C('#2a2756') }, n2: { value: C('#171940') },
      n3: { value: C('#0d0f2c') }, nTop: { value: C('#04061a') },
      sunDir: { value: SUN_DIR }, moonDir: { value: MOON_DIR }, night: { value: 0 }
    },
    vertexShader: `varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
    fragmentShader: `
      uniform vec3 cH, c1, c2, c3, cTop, nH, n1, n2, n3, nTop, sunDir, moonDir; uniform float night;
      varying vec3 vDir;
      vec3 grad(vec3 h, vec3 a, vec3 b, vec3 c, vec3 t, float y){
        vec3 col = mix(h, a, smoothstep(0.0, 0.06, y));
        col = mix(col, b, smoothstep(0.06, 0.16, y));
        col = mix(col, c, smoothstep(0.16, 0.34, y));
        return mix(col, t, smoothstep(0.34, 0.7, y));
      }
      void main(){
        vec3 d = normalize(vDir); float y = d.y;
        vec3 c = mix(grad(cH, c1, c2, c3, cTop, y), grad(nH, n1, n2, n3, nTop, y), night);
        float s = max(dot(d, sunDir), 0.0);
        c += vec3(1.0, 0.72, 0.5) * (pow(s, 40.0) * 0.45 + pow(s, 7.0) * 0.12) * (1.0 - night);
        float m = max(dot(d, moonDir), 0.0);
        c += vec3(0.75, 0.78, 1.0) * (pow(m, 60.0) * 0.35 + pow(m, 8.0) * 0.08) * night;
        gl_FragColor = vec4(c, 1.0);
        #include <colorspace_fragment>
      }`
  });
  const sky = new THREE.Mesh(new THREE.SphereGeometry(320, 48, 24), skyMat);
  sky.renderOrder = -10;
  skyGroup.add(sky);

  const starMat = new THREE.PointsMaterial({ color: '#fff4e6', size: 1.7, sizeAttenuation: false, fog: false, transparent: true, opacity: 0.6, depthWrite: false });
  {
    const r = mulberry(9), pts = [];
    for (let i = 0; i < 900; i++) {
      const th = r() * Math.PI * 2, y = 0.06 + r() * 0.94, rr = Math.sqrt(1 - y * y);
      pts.push(Math.cos(th) * rr * 300, y * 300, Math.sin(th) * rr * 300);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    const stars = new THREE.Points(g, starMat);
    stars.renderOrder = -9;
    skyGroup.add(stars);
  }

  const sunPos = SUN_DIR.clone().multiplyScalar(270);
  const sunMat = new THREE.MeshBasicMaterial({ color: '#f9b994', fog: false, depthWrite: false, transparent: true });
  const sun = new THREE.Mesh(new THREE.CircleGeometry(15, 48), sunMat);
  sun.position.copy(sunPos); sun.lookAt(0, 0, 0); sun.renderOrder = -8;
  skyGroup.add(sun);
  const streakMat = new THREE.MeshBasicMaterial({ color: '#5b4a7c', transparent: true, opacity: 0.55, fog: false, depthWrite: false });
  [[0, 2.2, 64, 1.3], [6, -1.8, 52, 1.0], [10, -5.2, 38, 0.8]].forEach(([dx, dy, w, h]) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), streakMat);
    m.position.copy(sunPos).add(new V3(dx, dy, 0).applyQuaternion(sun.quaternion)).multiplyScalar(0.99);
    m.quaternion.copy(sun.quaternion); m.renderOrder = -7;
    skyGroup.add(m);
  });

  const moonMat = new THREE.MeshBasicMaterial({ color: '#fbf1dc', fog: false, transparent: true, opacity: 0, depthWrite: false });
  const moon = new THREE.Mesh(new THREE.CircleGeometry(11, 48), moonMat);
  moon.position.copy(MOON_DIR).multiplyScalar(260); moon.lookAt(0, 0, 0); moon.renderOrder = -8;
  skyGroup.add(moon);
  const moonGlowMat = new THREE.SpriteMaterial({ map: radialTex([[0, 'rgba(255,240,210,.55)'], [0.4, 'rgba(255,240,210,.12)'], [1, 'rgba(255,240,210,0)']]), transparent: true, depthWrite: false, fog: false, blending: THREE.AdditiveBlending, opacity: 0 });
  const moonGlow = new THREE.Sprite(moonGlowMat);
  moonGlow.position.copy(MOON_DIR).multiplyScalar(255); moonGlow.scale.setScalar(90); moonGlow.renderOrder = -8;
  skyGroup.add(moonGlow);

  // low pink dusk clouds on the dome
  const domeCloudTex = radialTex([[0, 'rgba(242,185,168,.55)'], [1, 'rgba(242,185,168,0)']]);
  const domeCloudMat = new THREE.MeshBasicMaterial({ map: domeCloudTex, transparent: true, fog: false, depthWrite: false });
  [[-0.5, 0.2, 150, 9], [0.05, 0.14, 100, 6], [0.8, 0.24, 140, 8], [-1.0, 0.33, 110, 7]].forEach(([ang, el, w, h]) => {
    const dir = new V3(Math.sin(ang), el, -Math.cos(ang)).normalize();
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), domeCloudMat);
    m.position.copy(dir.multiplyScalar(260)); m.lookAt(0, 0, 0); m.renderOrder = -7;
    skyGroup.add(m);
  });

  // volumetric-looking cloud layer you fly through on the way up
  const puffTex = canvasTex(256, 256, (x, w) => {
    const r = mulberry(77);
    for (let i = 0; i < 9; i++) {
      const cx = w * (0.25 + r() * 0.5), cy = w * (0.4 + r() * 0.25), rr = w * (0.14 + r() * 0.16);
      const g = x.createRadialGradient(cx, cy, 0, cx, cy, rr);
      g.addColorStop(0, 'rgba(255,255,255,.5)'); g.addColorStop(1, 'rgba(255,255,255,0)');
      x.fillStyle = g; x.fillRect(0, 0, w, w);
    }
  });
  const cloudMat = new THREE.SpriteMaterial({ map: puffTex, transparent: true, depthWrite: false, opacity: 0.75, color: '#f2c7c4' });
  const clouds = [];
  {
    const r = mulberry(31), n = mobile ? 34 : 54;
    for (let i = 0; i < n; i++) {
      const s = new THREE.Sprite(cloudMat);
      const sc = 14 + r() * 30;
      s.scale.set(sc * 1.8, sc, 1);
      s.position.set(-130 + r() * 260, 16 + r() * 34, -150 + r() * 165);
      s.userData = { speed: 0.6 + r() * 1.2, push: new V3(), home: s.position.clone() };
      scene.add(s); clouds.push(s);
    }
  }

  // cranes circling in the night sky
  const cranes = [];
  {
    const mat = new THREE.MeshBasicMaterial({ color: '#efe8de', side: THREE.DoubleSide });
    const wingShape = new THREE.Shape(); wingShape.moveTo(0, 0); wingShape.lineTo(1.4, 0.25); wingShape.lineTo(0.9, -0.15); wingShape.lineTo(0, -0.3); wingShape.closePath();
    const wingGeo = new THREE.ShapeGeometry(wingShape); wingGeo.rotateX(-Math.PI / 2);
    const bodyGeo = new THREE.ConeGeometry(0.12, 1.6, 6); bodyGeo.rotateX(-Math.PI / 2);
    for (let i = 0; i < 7; i++) {
      const g = new THREE.Group();
      g.add(new THREE.Mesh(bodyGeo, mat));
      const wl = new THREE.Mesh(wingGeo, mat), wr = new THREE.Mesh(wingGeo, mat);
      wr.scale.x = -1; g.add(wl, wr);
      const tail = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.5, 4), new THREE.MeshBasicMaterial({ color: '#1d1a17' }));
      tail.rotation.x = Math.PI / 2; tail.position.z = 0.9; g.add(tail);
      g.userData = { wl, wr, ph: i * 0.7, off: new V3((i % 2 ? 1 : -1) * Math.ceil(i / 2) * 2.2, Math.sin(i) * 0.6, Math.ceil(i / 2) * 2.4) };
      g.scale.setScalar(0.9);
      scene.add(g); cranes.push(g);
    }
  }

  /* =========================================================
     Lights
     ========================================================= */
  const hemi = new THREE.HemisphereLight('#d9a7c7', '#1d1f3d', 1.25);
  scene.add(hemi);
  const HEMI_SKY = C('#d9a7c7'), HEMI_GROUND = C('#1d1f3d'), HEMI_WATER = C('#f0b6c8'), HEMI_WATER_G = C('#221a3a');
  const sunLight = new THREE.DirectionalLight('#ffc39a', 1.3);
  sunLight.position.copy(SUN_DIR).multiplyScalar(60);
  scene.add(sunLight);

  /* =========================================================
     LAKE SURROUNDINGS — mountains, mist, shores, pines
     ========================================================= */
  function ridge(z, base, amp, color, seed, freq = 1) {
    const r = mulberry(seed), s = new THREE.Shape();
    const p = [r() * 6, r() * 6, r() * 6];
    s.moveTo(-420, -3);
    for (let x = -420; x <= 420; x += 6) {
      const n = Math.sin(x * 0.021 * freq + p[0]) * 0.5 + Math.sin(x * 0.053 * freq + p[1]) * 0.3 + Math.sin(x * 0.11 * freq + p[2]) * 0.2;
      s.lineTo(x, base + amp * (n * 0.5 + 0.5));
    }
    s.lineTo(420, -3); s.closePath();
    const m = new THREE.Mesh(new THREE.ShapeGeometry(s), new THREE.MeshBasicMaterial({ color }));
    m.position.z = z;
    scene.add(m);
  }
  ridge(-210, 10, 12, '#6f5e8e', 3, 0.8);
  ridge(-150, 4, 9, '#5d4f80', 7);
  {
    const g = new THREE.CylinderGeometry(4, 46, 34, 18, 6, true);
    const pos = g.attributes.position, r = mulberry(21), cols = [];
    const snow = C('#f2dfe4'), rock = C('#54467a'), rock2 = C('#4a3d6e');
    for (let i = 0; i < pos.count; i++) {
      const y = pos.getY(i);
      if (y > -16 && y < 16.9) {
        pos.setX(i, pos.getX(i) * (1 + (r() - 0.5) * 0.08));
        pos.setZ(i, pos.getZ(i) * (1 + (r() - 0.5) * 0.08));
        pos.setY(i, y + (r() - 0.5) * 1.2);
      }
      const c = pos.getY(i) > 9 + r() * 4 ? snow : (r() < 0.5 ? rock : rock2);
      cols.push(c.r, c.g, c.b);
    }
    g.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
    g.computeVertexNormals();
    const m = new THREE.Mesh(g, new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true, emissive: '#000000' }));
    m.position.set(-38, 15, -118);
    volcano = m;                               // clickable: the ski mini-game lives up there
    scene.add(m);
  }
  ridge(-62, 0.6, 2.4, '#382f57', 11, 1.6);
  const mist = [];
  {
    const t = canvasTex(4, 128, (x) => {
      const g = x.createLinearGradient(0, 0, 0, 128);
      g.addColorStop(0, 'rgba(246,210,192,0)'); g.addColorStop(0.65, 'rgba(246,210,192,.45)'); g.addColorStop(1, 'rgba(246,210,192,0)');
      x.fillStyle = g; x.fillRect(0, 0, 4, 128);
    });
    [[-55, 4, 9], [-100, 8, 16]].forEach(([z, y, h]) => {
      const m = mist[mist.length] = new THREE.Mesh(new THREE.PlaneGeometry(900, h), new THREE.MeshBasicMaterial({ map: t, transparent: true, depthWrite: false, fog: false }));
      m.position.set(0, y - h * 0.35, z);
      scene.add(m);
    });
  }

  /* =========================================================
     FAR SHORE — forest, a little lantern-lit town with a castle, a pagoda temple on a hill
     ========================================================= */
  const farHeight = (x, z) => {
    const t = clamp((-z - 41) / 17, 0, 1);
    let h = -0.5 + t * 2.3 + (Math.sin(x * 0.13) * 0.5 + Math.sin(x * 0.31 + 1) * 0.3 + Math.sin(x * 0.71 + 2) * 0.12) * (0.4 + t);
    h += 3.4 * Math.exp(-((x - 18) ** 2 + (z + 56) ** 2) / 40);       // temple hill
    h += 1.4 * Math.exp(-((x - 37) ** 2 + (z + 52) ** 2) / 22);       // castle hill
    return h;
  };
  const scenery = { boats: [], birds: [], update: null };
  {
    // the land
    const g = new THREE.PlaneGeometry(180, 18, 180, 14);
    g.rotateX(-Math.PI / 2); g.translate(0, 0, -50);
    const pos = g.attributes.position, cols = [];
    const shoreC = C('#3a3048'), grassC = C('#4a4660'), highC = C('#544a68'), tmpL = new THREE.Color();
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), z = pos.getZ(i), y = farHeight(x, z);
      pos.setY(i, y);
      tmpL.copy(shoreC).lerp(grassC, clamp(y / 1.2, 0, 1)).lerp(highC, clamp((y - 1.5) / 3, 0, 1));
      cols.push(tmpL.r, tmpL.g, tmpL.b);
    }
    g.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
    g.computeVertexNormals();
    scene.add(new THREE.Mesh(g, new THREE.MeshLambertMaterial({ vertexColors: true })));

    const r = mulberry(77), d = new THREE.Object3D();
    const inTown = (x, z) => x > 21 && x < 47 && z > -55;
    const onTemple = (x, z) => Math.hypot(x - 18, z + 57) < 3.2;

    // forest: tall cedars + rounded broadleaf trees
    const cedars = new THREE.InstancedMesh(new THREE.ConeGeometry(0.75, 3.2, 7).translate(0, 1.5, 0), new THREE.MeshLambertMaterial({ color: '#3d3b55' }), 480);
    const broad = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 1).translate(0, 1.1, 0), new THREE.MeshLambertMaterial({ color: '#4a3f5c', flatShading: true }), 220);
    let nc = 0, nb = 0;
    for (let i = 0; i < 1400 && (nc < 480 || nb < 220); i++) {
      const x = -85 + r() * 140, z = -43 - r() * 15;
      if (inTown(x, z) || onTemple(x, z)) continue;
      if (x > 14 && r() < 0.6) continue;                               // thinner near the town
      const y = farHeight(x, z), sc = 0.6 + r() * 1.0;
      if (y < -0.1) continue;
      d.position.set(x, y - 0.15, z); d.rotation.set(0, r() * 6, 0);
      if (r() < 0.68 && nc < 480) { d.scale.set(sc, sc * (0.8 + r() * 0.6), sc); d.updateMatrix(); cedars.setMatrixAt(nc++, d.matrix); }
      else if (nb < 220) { d.scale.set(sc * 1.1, sc * 0.8, sc * 1.1); d.updateMatrix(); broad.setMatrixAt(nb++, d.matrix); }
    }
    cedars.count = nc; broad.count = nb;
    scene.add(cedars, broad);

    // the town: little houses with glowing windows
    const winTex = canvasTex(64, 64, (x, w, h) => {
      x.fillStyle = '#000'; x.fillRect(0, 0, w, h);
      const rr = mulberry(3);
      for (let i = 0; i < 4; i++) for (let j = 0; j < 2; j++) if (rr() < 0.7) { x.fillStyle = rr() < 0.5 ? '#ffc477' : '#ffe2a8'; x.fillRect(6 + i * 15, 14 + j * 24, 8, 10); }
    });
    const wallMat = new THREE.MeshLambertMaterial({ color: '#4a3f52', emissive: '#ffffff', emissiveMap: winTex, emissiveIntensity: 1.1 });
    const houses = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0), wallMat, 90);
    const roofs = new THREE.InstancedMesh(new THREE.ConeGeometry(0.78, 0.55, 4).rotateY(Math.PI / 4).translate(0, 0.27, 0), new THREE.MeshLambertMaterial({ color: '#1f1a26' }), 90);
    let nh = 0;
    for (let i = 0; i < 400 && nh < 90; i++) {
      const x = 21.5 + r() * 25, z = -43.2 - r() * 11;
      if (!inTown(x, z) || Math.hypot(x - 37, z + 52.5) < 2.4) continue;
      const y = farHeight(x, z);
      if (y < 0.05) continue;
      const w = 0.9 + r() * 0.9, hgt = 0.6 + r() * 0.7 + (r() < 0.12 ? 0.9 : 0), dz = 0.8 + r() * 0.7, ry = (r() - 0.5) * 0.5;
      d.position.set(x, y - 0.05, z); d.rotation.set(0, ry, 0); d.scale.set(w, hgt, dz); d.updateMatrix(); houses.setMatrixAt(nh, d.matrix);
      d.position.set(x, y - 0.05 + hgt, z); d.scale.set(w * 1.05, 0.9 + r() * 0.4, dz * 1.1); d.updateMatrix(); roofs.setMatrixAt(nh, d.matrix);
      nh++;
    }
    houses.count = roofs.count = nh;
    scene.add(houses, roofs);

    // a small castle keep on its hill
    {
      const cx = 37, cz = -52.5, cy0 = farHeight(cx, cz) - 0.1;
      const stone = new THREE.MeshLambertMaterial({ color: '#4b4456', flatShading: true });
      const white = new THREE.MeshLambertMaterial({ color: '#d9d0cc', emissive: '#ffffff', emissiveMap: winTex, emissiveIntensity: 0.9 });
      const dark = new THREE.MeshLambertMaterial({ color: '#1c1822' });
      const base = new THREE.Mesh(new THREE.CylinderGeometry(2.2, 2.9, 1.3, 4).rotateY(Math.PI / 4), stone); base.position.set(cx, cy0 + 0.65, cz); scene.add(base);
      [[2.3, 1.1], [1.75, 0.95], [1.25, 0.85]].forEach(([w, hgt], i, arr) => {
        const y = cy0 + 1.3 + arr.slice(0, i).reduce((a, [, hh]) => a + hh + 0.35, 0);
        const body = new THREE.Mesh(new THREE.BoxGeometry(w, hgt, w * 0.8), white); body.position.set(cx, y + hgt / 2, cz); scene.add(body);
        const roof = new THREE.Mesh(new THREE.ConeGeometry(w * 0.95, 0.6, 4).rotateY(Math.PI / 4), dark); roof.scale.z = 0.8; roof.position.set(cx, y + hgt + 0.2, cz); scene.add(roof);
      });
    }

    // pagoda temple on the hill, against the sunset
    {
      const px = 18, pz = -57, py = farHeight(px, pz) - 0.1;
      const red = new THREE.MeshLambertMaterial({ color: '#7a2a24', emissive: '#2a0806' });
      const dark = new THREE.MeshLambertMaterial({ color: '#1d1822' });
      const gold = new THREE.MeshLambertMaterial({ color: '#c9a046', emissive: '#4a3210' });
      const temple = new THREE.Group();
      let y = 0;
      for (let i = 0; i < 5; i++) {
        const w = 2.3 - i * 0.32, hgt = i === 0 ? 1.3 : 0.85;
        const body = new THREE.Mesh(new THREE.BoxGeometry(w, hgt, w), red); body.position.y = y + hgt / 2; temple.add(body);
        y += hgt;
        const roof = new THREE.Mesh(new THREE.ConeGeometry(w * 1.05, 0.55, 4, 1).rotateY(Math.PI / 4), dark); roof.scale.y = 0.8; roof.position.y = y + 0.12; temple.add(roof);
        y += 0.3;
      }
      const spire = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.08, 2.4, 6), gold); spire.position.y = y + 1.1; temple.add(spire);
      for (let k = 0; k < 6; k++) { const ring = new THREE.Mesh(new THREE.TorusGeometry(0.2 - k * 0.018, 0.04, 6, 14).rotateX(Math.PI / 2), gold); ring.position.y = y + 0.4 + k * 0.28; temple.add(ring); }
      // main hall beside it
      const hall = new THREE.Mesh(new THREE.BoxGeometry(3.6, 1.5, 2.2), new THREE.MeshLambertMaterial({ color: '#5a2420', emissive: '#ffffff', emissiveMap: winTex, emissiveIntensity: 0.7 }));
      hall.position.set(4, 0.75, 1); temple.add(hall);
      const hallRoof = new THREE.Mesh(new THREE.ConeGeometry(2.8, 1.3, 4).rotateY(Math.PI / 4), dark); hallRoof.scale.set(1.15, 1, 0.75); hallRoof.position.set(4, 2.05, 1); temple.add(hallRoof);
      temple.position.set(px, py, pz); temple.scale.setScalar(1.15);
      scene.add(temple);
    }

    // street lanterns along the town's waterfront + temple path
    {
      const lp = [];
      for (let x = 21; x < 47; x += 1.6) lp.push(x + r() * 0.4, farHeight(x, -43.4) + 0.35, -43.4);
      for (let k = 0; k < 9; k++) { const t = k / 8, x = lerp(19, 14, t), z = lerp(-44, -54, t); lp.push(x, farHeight(x, z) + 0.3, z); }
      const lg = new THREE.BufferGeometry(); lg.setAttribute('position', new THREE.Float32BufferAttribute(lp, 3));
      scene.add(new THREE.Points(lg, new THREE.PointsMaterial({
        map: radialTex([[0, 'rgba(255,220,160,1)'], [0.3, 'rgba(255,180,100,.6)'], [1, 'rgba(255,160,80,0)']]),
        size: 0.9, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending
      })));
    }

    // fishing boats drifting with a lantern at the bow
    const hullShape = new THREE.Shape();
    hullShape.moveTo(-1.1, 0.25); hullShape.lineTo(1.2, 0.3); hullShape.quadraticCurveTo(0.9, -0.15, 0.6, -0.2); hullShape.lineTo(-0.8, -0.2); hullShape.quadraticCurveTo(-1.05, -0.05, -1.1, 0.25);
    const hullGeo = new THREE.ExtrudeGeometry(hullShape, { depth: 0.55, bevelEnabled: false }); hullGeo.translate(0, 0, -0.275);
    const hullMat = new THREE.MeshLambertMaterial({ color: '#3a2822' });
    const boatGlow = new THREE.SpriteMaterial({ map: radialTex([[0, 'rgba(255,190,110,.9)'], [1, 'rgba(255,170,90,0)']]), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
    [[-6, -16.5, 0.35, 0.22], [9, -26, -0.28, 0.16]].forEach(([x, z, speed, sc]) => {
      const b = new THREE.Group();
      b.add(new THREE.Mesh(hullGeo, hullMat));
      const roof = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.05, 0.6), new THREE.MeshLambertMaterial({ color: '#c2a272' })); roof.position.set(-0.2, 0.75, 0); b.add(roof);
      [[-0.55, -0.25], [-0.55, 0.25], [0.15, -0.25], [0.15, 0.25]].forEach(([px2, pz2]) => { const post = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.5, 4), hullMat); post.position.set(px2, 0.5, pz2); b.add(post); });
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 0.7, 4), hullMat); pole.position.set(1.15, 0.6, 0); pole.rotation.z = -0.4; b.add(pole);
      const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.08, 10, 8), new THREE.MeshBasicMaterial({ color: '#ffb35c' })); lamp.position.set(1.3, 0.8, 0); b.add(lamp);
      const glow = new THREE.Sprite(boatGlow); glow.scale.setScalar(1.4); glow.position.copy(lamp.position); b.add(glow);
      b.scale.setScalar(sc * 4); b.position.set(x, 0, z); b.rotation.y = speed > 0 ? 0 : Math.PI;
      b.userData = { speed, ph: r() * 6, z };
      scene.add(b); scenery.boats.push(b);
    });

    // birds crossing the sky
    const birdGeo = new THREE.BufferGeometry();
    birdGeo.setAttribute('position', new THREE.Float32BufferAttribute([-0.6, 0.1, 0, 0, 0, 0.1, 0, 0, -0.1, 0.6, 0.1, 0, 0, 0, 0.1, 0, 0, -0.1], 3));
    const birdMat = new THREE.MeshBasicMaterial({ color: '#2a2238', side: THREE.DoubleSide });
    for (let i = 0; i < 9; i++) {
      const bird = new THREE.Mesh(birdGeo.clone(), birdMat);
      bird.userData = { off: new V3((i % 2 ? 1 : -1) * Math.ceil(i / 2) * 1.1, Math.sin(i * 1.7) * 0.4, Math.ceil(i / 2) * 1.4), ph: i * 0.6, base: birdGeo.attributes.position.array.slice() };
      bird.scale.setScalar(0.7);
      scene.add(bird); scenery.birds.push(bird);
    }

    // fireflies drifting around the islands
    const FF = 70, ffPos = new Float32Array(FF * 3), ffSeed = new Float32Array(FF);
    const ffHomes = [];
    for (let i = 0; i < FF; i++) {
      const left = i < 44, cx = left ? -12.6 : 15.2, cz = left ? -7.4 : -13.6;
      ffHomes.push([cx + (r() - 0.5) * (left ? 10 : 7), 0.4 + r() * 1.8, cz + (r() - 0.5) * (left ? 5 : 4)]);
      ffSeed[i] = r() * 100;
    }
    const ffGeo = new THREE.BufferGeometry(); ffGeo.setAttribute('position', new THREE.BufferAttribute(ffPos, 3));
    ffGeo.setAttribute('aSeed', new THREE.BufferAttribute(ffSeed, 1));
    const ffMat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      uniforms: { time: { value: 0 } },
      vertexShader: `attribute float aSeed; uniform float time; varying float vA;
        void main(){ vA = pow(0.5 + 0.5 * sin(time * 2.0 + aSeed * 3.0), 3.0);
          vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_PointSize = (60.0 / -mv.z) * (0.4 + vA); gl_Position = projectionMatrix * mv; }`,
      fragmentShader: `varying float vA; void main(){ float d = length(gl_PointCoord - 0.5); if (d > 0.5) discard;
          gl_FragColor = vec4(vec3(1.0, 0.92, 0.55) * smoothstep(0.5, 0.0, d) * vA, 1.0); }`
    });
    scene.add(new THREE.Points(ffGeo, ffMat));

    scenery.update = (dt, t) => {
      for (const b of scenery.boats) {
        const u = b.userData;
        b.position.x += u.speed * dt;
        if (b.position.x > 34) b.position.x = -34; if (b.position.x < -34) b.position.x = 34;
        b.position.y = Math.sin(t * 1.3 + u.ph) * 0.03 - 0.05;
        b.rotation.z = Math.sin(t * 1.1 + u.ph) * 0.04; b.rotation.x = Math.sin(t * 0.9 + u.ph) * 0.03;
        if (Math.random() < dt * 4) queueDrop(b.position.x - Math.sign(u.speed) * 1.4, u.z, 0.007, 0.08);
      }
      const span = 200, k = ((t * 2.2) % span) - span / 2;     // the flock crosses every ~90 s
      const lead = new V3(k, 17 + Math.sin(t * 0.2) * 1.5, -70);
      scenery.birds.forEach(bd => {
        const u = bd.userData;
        bd.position.copy(lead).add(new V3(-u.off.z, u.off.y, u.off.x));
        const pa = bd.geometry.attributes.position.array, f = Math.sin(t * 6 + u.ph) * 0.35;
        pa[1] = u.base[1] + f; pa[10] = u.base[10] + f;
        bd.geometry.attributes.position.needsUpdate = true;
      });
      for (let i = 0; i < FF; i++) {
        const h = ffHomes[i], sd = ffSeed[i];
        ffPos[i * 3] = h[0] + Math.sin(t * 0.4 + sd) * 0.8;
        ffPos[i * 3 + 1] = h[1] + Math.sin(t * 0.7 + sd * 2) * 0.35;
        ffPos[i * 3 + 2] = h[2] + Math.cos(t * 0.35 + sd) * 0.8;
      }
      ffGeo.attributes.position.needsUpdate = true;
      ffMat.uniforms.time.value = t;
    };
  }

  const silhouette = new THREE.MeshLambertMaterial({ color: '#1a152c' });
  // (volcano is assigned in the mountains block above)
  const pineMat    = new THREE.MeshLambertMaterial({ color: '#141022' });
  /* ---------- islands: irregular rocky coast, wet-sand rim, mossy top, rocks, grass, fallen petals ---------- */
  const islands = [];
  const stoneMat = new THREE.MeshLambertMaterial({ color: '#5d5669', flatShading: true });
  function islandShape(isl, theta) {
    const p = isl.p;
    return 1 + 0.12 * Math.sin(3 * theta + p[0]) + 0.07 * Math.sin(5 * theta + p[1]) + 0.045 * Math.sin(9 * theta + p[2]);
  }
  function islandHeightT(isl, t, theta) {
    const bump = 0.06 * Math.sin(theta * 7 + isl.p[3]) * Math.sin(t * 9 + isl.p[0]) * (1 - t);
    return isl.h * (1 - Math.pow(Math.min(t, 1), 2.4)) + bump - 0.18 * Math.max(0, t - 0.9) / 0.1;
  }
  function islandHeight(x, z) {             // ground height at a world point (−1 if over open water)
    let best = -1;
    for (const isl of islands) {
      const u = (x - isl.cx) / isl.rx, v = (z - isl.cz) / isl.rz, th = Math.atan2(v, u);
      const t = Math.hypot(u, v) / islandShape(isl, th);
      if (t < 1) best = Math.max(best, islandHeightT(isl, t, th));
    }
    return best;
  }
  function island(cx, cz, rx, rz, h, seed) {
    const r = mulberry(seed);
    const isl = { cx, cz, rx, rz, h, p: [r() * 6, r() * 6, r() * 6, r() * 6] };
    islands.push(isl);
    const SEG = 128, RING = 30, pos = [], col = [], idx = [];
    const wet = C('#3a2e44'), sand = C('#a9827f'), moss = C('#3e4a43'), mossPink = C('#4d4259'), grass = C('#56634f'), tmp = new THREE.Color();
    pos.push(cx, h, cz); col.push(grass.r, grass.g, grass.b);
    for (let k = 1; k <= RING + 1; k++) {
      const t = k <= RING ? k / RING : 1.1;
      for (let j = 0; j < SEG; j++) {
        const th = (j / SEG) * Math.PI * 2, rad = t * islandShape(isl, th);
        const y = k <= RING ? islandHeightT(isl, t, th) : -0.7;
        pos.push(cx + Math.cos(th) * rad * rx, y, cz + Math.sin(th) * rad * rz);
        if (y < 0.02) tmp.copy(wet);
        else if (y < 0.09) tmp.copy(sand).lerp(wet, 1 - (y - 0.02) / 0.07);
        else {
          tmp.copy(moss).lerp(mossPink, 0.5 + 0.5 * Math.sin(th * 5 + t * 7 + isl.p[1]));
          tmp.lerp(grass, Math.max(0, 0.6 - t) * 0.9);
          if (y < 0.14) tmp.lerp(sand, (0.14 - y) / 0.05);
        }
        col.push(tmp.r, tmp.g, tmp.b);
      }
    }
    for (let j = 0; j < SEG; j++) idx.push(0, 1 + ((j + 1) % SEG), 1 + j);
    for (let k = 0; k < RING; k++) for (let j = 0; j < SEG; j++) {
      const a = 1 + k * SEG + j, b = 1 + k * SEG + ((j + 1) % SEG), c = a + SEG, d = b + SEG;
      idx.push(a, b, d, a, d, c);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    g.setIndex(idx); g.computeVertexNormals();
    const ground = new THREE.Mesh(g, new THREE.MeshLambertMaterial({ vertexColors: true }));
    scene.add(ground);

    // weathered rocks along the shore, some half sunk
    const d = new THREE.Object3D();
    const rocks = new THREE.InstancedMesh(new THREE.DodecahedronGeometry(1, 0), stoneMat, 22);
    for (let i = 0; i < 22; i++) {
      const th = r() * Math.PI * 2, t = i < 16 ? 0.9 + r() * 0.16 : 0.3 + r() * 0.5;
      const rad = t * islandShape(isl, th), sz = i < 16 ? 0.25 + r() * 0.55 : 0.12 + r() * 0.2;
      const x = cx + Math.cos(th) * rad * rx, z = cz + Math.sin(th) * rad * rz;
      d.position.set(x, (i < 16 ? Math.max(-0.15, islandHeightT(isl, Math.min(t, 1), th)) : islandHeightT(isl, t, th)) - sz * 0.25, z);
      d.rotation.set(r() * 3, r() * 3, r() * 3); d.scale.set(sz * (1 + r() * 0.6), sz * (0.55 + r() * 0.4), sz * (1 + r() * 0.5));
      d.updateMatrix(); rocks.setMatrixAt(i, d.matrix);
    }
    scene.add(rocks);

    // grass tufts + fallen petals on top
    const tufts = new THREE.InstancedMesh(new THREE.ConeGeometry(0.05, 0.22, 4), new THREE.MeshLambertMaterial({ color: '#3d5641' }), 90);
    const petalsG = new THREE.InstancedMesh(new THREE.CircleGeometry(0.05, 6).rotateX(-Math.PI / 2), new THREE.MeshLambertMaterial({ color: '#f2b3c6', emissive: '#4a1a28' }), 160);
    for (let i = 0; i < 250; i++) {
      const th = r() * Math.PI * 2, t = Math.sqrt(r()) * 0.85, rad = t * islandShape(isl, th);
      const x = cx + Math.cos(th) * rad * rx, z = cz + Math.sin(th) * rad * rz, y = islandHeightT(isl, t, th);
      if (i < 90) {
        d.position.set(x, y + 0.08, z); d.rotation.set((r() - 0.5) * 0.5, r() * 3, (r() - 0.5) * 0.5); d.scale.setScalar(0.7 + r() * 0.9);
        d.updateMatrix(); tufts.setMatrixAt(i, d.matrix);
      } else {
        d.position.set(x, y + 0.012, z); d.rotation.set(0, r() * 6, 0); d.scale.set(1 + r(), 1, 0.6 + r() * 0.5);
        d.updateMatrix(); petalsG.setMatrixAt(i - 90, d.matrix);
      }
    }
    scene.add(tufts, petalsG);
    return isl;
  }
  island(-12.6, -7.4, 6.6, 3.8, 0.42, 41);
  island(15.2, -13.6, 4.6, 2.9, 0.36, 43);
  // a small stone lantern (tōrō) glowing on the left island
  {
    const tr = new THREE.Group();
    [[new THREE.CylinderGeometry(0.2, 0.26, 0.1, 6), 0.05, stoneMat],
     [new THREE.CylinderGeometry(0.07, 0.09, 0.45, 8), 0.32, stoneMat],
     [new THREE.CylinderGeometry(0.18, 0.12, 0.08, 6), 0.58, stoneMat],
     [new THREE.BoxGeometry(0.2, 0.17, 0.2), 0.7, new THREE.MeshBasicMaterial({ color: '#ffd08a' })],
     [new THREE.ConeGeometry(0.3, 0.17, 6), 0.87, stoneMat],
     [new THREE.SphereGeometry(0.055, 8, 6), 0.98, stoneMat]].forEach(([g, y, m]) => { const o = new THREE.Mesh(g, m); o.position.y = y; tr.add(o); });
    const lx = -10.2, lz = -5.9;
    tr.position.set(lx, islandHeight(lx, lz) - 0.03, lz);
    const glowL = new THREE.PointLight('#ffb36b', 2.4, 4.5, 2); glowL.position.y = 0.7; tr.add(glowL);
    scene.add(tr);
  }
  function pine(x, y, z, s, seed) {
    const r = mulberry(seed), g = new THREE.Group();
    const curve = new THREE.CatmullRomCurve3([new V3(0, 0, 0), new V3(-0.15, 1.0, 0.05), new V3(0.25, 1.9, -0.05), new V3(-0.1, 2.7, 0.08), new V3(0.5, 3.4, 0)]);
    g.add(new THREE.Mesh(new THREE.TubeGeometry(curve, 24, 0.09, 6, false), pineMat));
    const pad = new THREE.SphereGeometry(1, 14, 8);
    [[0.5, 3.45, 0, 1.2], [-0.4, 2.7, 0.1, 0.9], [0.55, 2.2, -0.1, 1.1], [-0.6, 1.6, 0, 0.75], [0.3, 1.25, 0.2, 0.85]].forEach(([px, py, pz, pr]) => {
      const m = new THREE.Mesh(pad, pineMat);
      m.scale.set(pr * (0.9 + r() * 0.3), pr * 0.22, pr * 0.8);
      m.position.set(px, py, pz);
      g.add(m);
    });
    g.position.set(x, y, z); g.scale.setScalar(s); g.rotation.y = r() * 6;
    scene.add(g);
  }
  // sakura (cherry blossom) trees
  const barkMat = new THREE.MeshLambertMaterial({ color: '#2d1c1f' });
  const blossoms = [], treeSpots = [];
  const treesProc = new THREE.Group(); scene.add(treesProc);        // hand-built trees (fallback for the GLB)
  function sakura(x, y, z, s, seed) {
    const r = mulberry(seed), g = new THREE.Group();
    treeSpots.push({ x, y, z, s, rot: mulberry(seed * 7 + 3)() * Math.PI * 2 });
    const trunk = [new V3(0, -0.2, 0), new V3(0.12, 0.6, 0.05), new V3(-0.06, 1.2, 0), new V3(0.14, 1.75, -0.05)];
    g.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(trunk), 16, 0.13, 7), barkMat));
    const ends = [trunk[3].clone().add(new V3(0, 0.35, 0))];
    for (let b = 0; b < 7; b++) {
      const a = (b / 7) * Math.PI * 2 + r() * 0.6;
      const start = trunk[2 + (b % 2)].clone();
      const len = 0.9 + r() * 0.9;
      const droop = r() < 0.35 ? -0.55 : 0;
      const mid = start.clone().add(new V3(Math.cos(a) * len * 0.5, 0.35 + r() * 0.35, Math.sin(a) * len * 0.5));
      const end = start.clone().add(new V3(Math.cos(a) * len, 0.45 + r() * 0.5 + droop, Math.sin(a) * len));
      g.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3([start, mid, end]), 10, 0.045, 5), barkMat));
      ends.push(mid, end);
    }
    const gy = islandHeight(x, z);
    g.position.set(x, gy > -1 ? gy + 0.15 : y, z); g.scale.setScalar(s); g.rotation.y = r() * 6;
    treesProc.add(g); g.updateMatrixWorld(true);
    for (const e of ends) for (let k = 0; k < 7; k++) {
      const p = e.clone().add(new V3((r() - 0.5) * 0.8, (r() - 0.35) * 0.5, (r() - 0.5) * 0.8));
      blossoms.push({ p: g.localToWorld(p), s: (0.2 + r() * 0.26) * s, c: (r() * 5) | 0 });
    }
  }
  sakura(-13.8, 0.25, -7.4, 1.05, 1);
  sakura(-10.4, 0.15, -9.0, 0.72, 2);
  sakura(-14.6, 0.3, -8.8, 1.3, 3);
  sakura(14, 0.25, -13.5, 1.0, 4);
  sakura(16.3, 0.2, -12.6, 0.7, 5);
  {
    const PINKS = ['#f7c6d3', '#f3aec2', '#fbdbe4', '#eea0b6', '#ffe9ef'].map(C);
    const im = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 1), new THREE.MeshLambertMaterial({ color: '#ffffff', emissive: '#3a1420' }), blossoms.length);
    const d = new THREE.Object3D();
    blossoms.forEach((b, i) => {
      d.position.copy(b.p); d.rotation.set(Math.random() * 3, Math.random() * 3, 0);
      d.scale.set(b.s, b.s * 0.78, b.s); d.updateMatrix();
      im.setMatrixAt(i, d.matrix); im.setColorAt(i, PINKS[b.c]);
    });
    treesProc.add(im);
  }
  const treesModel = new THREE.Group(); scene.add(treesModel);

  /* =========================================================
     THE HOUSE — exterior + a real interior
     ========================================================= */
  const SEA_Y = -9;
  const seabedY = (x, z) => SEA_Y + Math.sin(x * 0.15) * 0.9 + Math.cos(z * 0.12 + x * 0.05) * 1.1 + Math.sin(x * 0.5 + z * 0.4) * 0.25;

  const house = new THREE.Group();
  const houseGlow = new THREE.PointLight('#ffb36b', 4, 7, 2);
  const wood  = new THREE.MeshLambertMaterial({ color: '#2b1d1f' });
  const woodIn = new THREE.MeshLambertMaterial({ color: '#4a3226' });
  const tileTex = canvasTex(128, 128, (x, w, h) => {
    x.fillStyle = '#2b2533'; x.fillRect(0, 0, w, h);
    for (let i = 0; i < w; i += 16) {
      const g = x.createLinearGradient(i, 0, i + 16, 0);
      g.addColorStop(0, '#1b1720'); g.addColorStop(0.5, '#4a4152'); g.addColorStop(1, '#1b1720');
      x.fillStyle = g; x.fillRect(i, 0, 16, h);
    }
    x.fillStyle = 'rgba(0,0,0,.35)'; for (let j = 0; j < h; j += 32) x.fillRect(0, j, w, 3);
  });
  tileTex.wrapS = tileTex.wrapT = THREE.RepeatWrapping;
  const roofM = new THREE.MeshLambertMaterial({ color: '#9a8aa6', map: tileTex, side: THREE.DoubleSide });
  const shojiTex = canvasTex(256, 128, (x) => {
    const g = x.createRadialGradient(128, 70, 10, 128, 70, 160);
    g.addColorStop(0, '#fff0cf'); g.addColorStop(1, '#f0c27f');
    x.fillStyle = g; x.fillRect(0, 0, 256, 128);
    x.strokeStyle = '#5a3a2a'; x.lineWidth = 3;
    for (let i = 1; i < 12; i++) { x.beginPath(); x.moveTo(i * 256 / 12, 0); x.lineTo(i * 256 / 12, 128); x.stroke(); }
    for (let j = 1; j < 4; j++) { x.beginPath(); x.moveTo(0, j * 32); x.lineTo(256, j * 32); x.stroke(); }
    x.lineWidth = 8; x.strokeStyle = '#3a241c'; x.strokeRect(0, 0, 256, 128);
  });
  shojiTex.anisotropy = 4;
  const doorTex = canvasTex(128, 128, (x) => {
    const g = x.createRadialGradient(64, 64, 10, 64, 64, 100);
    g.addColorStop(0, '#fff2d4'); g.addColorStop(1, '#f0c27f');
    x.fillStyle = g; x.fillRect(0, 0, 128, 128);
    x.strokeStyle = '#5a3a2a'; x.lineWidth = 3;
    for (let i = 1; i < 6; i++) { x.beginPath(); x.moveTo(i * 128 / 6, 0); x.lineTo(i * 128 / 6, 128); x.stroke(); }
    for (let j = 1; j < 4; j++) { x.beginPath(); x.moveTo(0, j * 32); x.lineTo(128, j * 32); x.stroke(); }
    x.lineWidth = 10; x.strokeStyle = '#3a241c'; x.strokeRect(0, 0, 128, 128);
  });
  const lit = new THREE.MeshBasicMaterial({ map: shojiTex });
  const doorMat = new THREE.MeshBasicMaterial({ map: doorTex });
  const hidden = new THREE.MeshBasicMaterial({ visible: false });

  // exterior walls (front face removed — the sliding doors take its place)
  const walls = new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.95, 1.4), [lit, lit, lit, lit, hidden, lit]);
  walls.position.y = 1.24;
  house.add(walls);
  const doorL = new THREE.Mesh(new THREE.BoxGeometry(0.99, 0.93, 0.02), doorMat);
  const doorR = doorL.clone();
  doorL.position.set(-0.495, 1.24, 0.7); doorR.position.set(0.495, 1.24, 0.7);
  house.add(doorL, doorR);

  // stilts reach all the way down to the lake bed
  {
    const stiltH = 0.74 - SEA_Y + 2;
    const stilt = new THREE.CylinderGeometry(0.045, 0.06, stiltH, 6);
    [[-1.1, -0.8], [1.1, -0.8], [-1.1, 0.8], [1.1, 0.8], [0, 0.8], [0, -0.8]].forEach(([sx, sz]) => {
      const m = new THREE.Mesh(stilt, wood); m.position.set(sx, 0.74 - stiltH / 2, sz); house.add(m);
    });
    const deck = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.08, 2.0), wood); deck.position.y = 0.74; house.add(deck);
    const railGeo = new THREE.BoxGeometry(2.6, 0.035, 0.035);
    [1.0, -1.0].forEach(z => { const m = new THREE.Mesh(railGeo, wood); m.position.set(0, 0.98, z); house.add(m); });
    const railGeo2 = new THREE.BoxGeometry(0.035, 0.035, 2.0);
    [-1.3, 1.3].forEach(xx => { const m = new THREE.Mesh(railGeo2, wood); m.position.set(xx, 0.98, 0); house.add(m); });
    const post = new THREE.BoxGeometry(0.04, 0.26, 0.04);
    for (let i = 0; i <= 8; i++) [-1.0, 1.0].forEach(z => {
      if (z > 0 && (i === 4 || i === 3 || i === 5)) return;    // gap in the front railing for the door
      const m = new THREE.Mesh(post, wood); m.position.set(-1.3 + i * 2.6 / 8, 0.86, z); house.add(m);
    });
    const pil = new THREE.BoxGeometry(0.08, 1.0, 0.08);
    [[-1, -0.7], [1, -0.7], [-1, 0.7], [1, 0.7]].forEach(([px, pz]) => { const m = new THREE.Mesh(pil, wood); m.position.set(px, 1.24, pz); house.add(m); });

    // curved roof with upturned eaves
    const eaveY = 1.7, ridgeY = 2.45;
    const base = [[-1.65, 1.2], [1.65, 1.2], [1.65, -1.2], [-1.65, -1.2]];
    const top  = [[-0.75, 0.22], [0.75, 0.22], [0.75, -0.22], [-0.75, -0.22]];
    const U = 16, Vn = 8, verts = [], idx = [], uvs = [];
    for (let f = 0; f < 4; f++) {
      const b0 = base[f], b1 = base[(f + 1) % 4], t0 = top[f], t1 = top[(f + 1) % 4];
      const off = verts.length / 3;
      for (let v = 0; v <= Vn; v++) {
        const kv = v / Vn;
        for (let u = 0; u <= U; u++) {
          const ku = u / U;
          const bx = lerp(b0[0], b1[0], ku), bz = lerp(b0[1], b1[1], ku);
          const tx = lerp(t0[0], t1[0], ku), tz = lerp(t0[1], t1[1], ku);
          const up = 0.2 * Math.pow(Math.abs(ku * 2 - 1), 3) * (1 - kv);
          verts.push(lerp(bx, tx, kv), eaveY + up + (ridgeY - eaveY) * Math.pow(kv, 1.7), lerp(bz, tz, kv)); uvs.push(ku * 10, kv * 3.2);
        }
      }
      for (let v = 0; v < Vn; v++) for (let u = 0; u < U; u++) {
        const a = off + v * (U + 1) + u, b = a + 1, c = a + U + 1, d = c + 1;
        idx.push(a, b, d, a, d, c);
      }
    }
    const rg = new THREE.BufferGeometry();
    rg.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
    rg.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2)); rg.setIndex(idx); rg.computeVertexNormals();
    house.add(new THREE.Mesh(rg, roofM));

    const lantern = new THREE.Mesh(new THREE.SphereGeometry(0.11, 16, 12), new THREE.MeshBasicMaterial({ color: '#ff5a33' }));
    lantern.scale.y = 1.35; lantern.position.set(-1.45, 1.42, 1.15); house.add(lantern);
    const ll = new THREE.PointLight('#ff7a45', 2.2, 5, 2); ll.position.copy(lantern.position); house.add(ll);
    const glow = houseGlow; glow.position.set(0, 1.0, 2.1); house.add(glow);

  }

  // ---- upgrades: second roof tier, eave trim, lanterns, beams, stone lantern ----
  function makeRoof(base, top, eaveY, ridgeY, upAmt) {
    const U = 14, Vn = 6, verts = [], idx = [], uvs = [];
    for (let f = 0; f < 4; f++) {
      const b0 = base[f], b1 = base[(f + 1) % 4], t0 = top[f], t1 = top[(f + 1) % 4];
      const off = verts.length / 3;
      for (let v = 0; v <= Vn; v++) {
        const kv = v / Vn;
        for (let u = 0; u <= U; u++) {
          const ku = u / U;
          const bx = lerp(b0[0], b1[0], ku), bz = lerp(b0[1], b1[1], ku);
          const tx = lerp(t0[0], t1[0], ku), tz = lerp(t0[1], t1[1], ku);
          const up = upAmt * Math.pow(Math.abs(ku * 2 - 1), 3) * (1 - kv);
          verts.push(lerp(bx, tx, kv), eaveY + up + (ridgeY - eaveY) * Math.pow(kv, 1.7), lerp(bz, tz, kv));
          uvs.push(ku * 6, kv * 2);
        }
      }
      for (let v = 0; v < Vn; v++) for (let u = 0; u < U; u++) {
        const a = off + v * (U + 1) + u, b = a + 1, c = a + U + 1, d = c + 1;
        idx.push(a, b, d, a, d, c);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    g.setIndex(idx); g.computeVertexNormals();
    return new THREE.Mesh(g, roofM);
  }
  const trimMat = new THREE.MeshLambertMaterial({ color: '#7a5236' });
  const goldMat = new THREE.MeshLambertMaterial({ color: '#d6a84e', emissive: '#4a3210' });
  {
    // eave trim along the main roof
    const pts = [];
    const base = [[-1.65, 1.2], [1.65, 1.2], [1.65, -1.2], [-1.65, -1.2]];
    for (let f = 0; f < 4; f++) {
      const b0 = base[f], b1 = base[(f + 1) % 4];
      for (let u = 0; u < 12; u++) {
        const ku = u / 12;
        pts.push(new V3(lerp(b0[0], b1[0], ku), 1.7 + 0.2 * Math.pow(Math.abs(ku * 2 - 1), 3), lerp(b0[1], b1[1], ku)));
      }
    }
    house.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts, true), 160, 0.024, 5, true), trimMat));

    // second tier: lit clerestory + small upper roof
    const tier = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.3, 0.62), lit); tier.position.y = 2.42; house.add(tier);
    [[-0.55, -0.31], [0.55, -0.31], [-0.55, 0.31], [0.55, 0.31]].forEach(([px, pz]) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.32, 0.05), wood); m.position.set(px, 2.42, pz); house.add(m);
    });
    house.add(makeRoof([[-0.98, 0.64], [0.98, 0.64], [0.98, -0.64], [-0.98, -0.64]], [[-0.36, 0.07], [0.36, 0.07], [0.36, -0.07], [-0.36, -0.07]], 2.56, 2.98, 0.13));
    const ridge2 = new THREE.Mesh(new THREE.BoxGeometry(0.86, 0.06, 0.1), wood); ridge2.position.y = 3.0; house.add(ridge2);
    [-0.45, 0.45].forEach(px => {
      const fin = new THREE.Mesh(new THREE.SphereGeometry(0.045, 10, 8), goldMat); fin.position.set(px, 3.06, 0); fin.scale.y = 1.6; house.add(fin);
    });

    // exterior beams framing the shoji
    const beamF = new THREE.BoxGeometry(2.06, 0.06, 0.05), beamS = new THREE.BoxGeometry(0.05, 0.06, 1.46);
    [[0, 1.69, 0.72, beamF], [0, 1.69, -0.72, beamF], [-1.02, 1.69, 0, beamS], [1.02, 1.69, 0, beamS],
     [0, 0.8, -0.72, beamF], [-1.02, 0.8, 0, beamS], [1.02, 0.8, 0, beamS]].forEach(([px, py, pz, g]) => {
      const m = new THREE.Mesh(g, wood); m.position.set(px, py, pz); house.add(m);
    });

    // twin red paper lanterns (chōchin) at the front eaves
    const chochinMat = new THREE.MeshBasicMaterial({ color: '#ff5a33' });
    const capMat = new THREE.MeshLambertMaterial({ color: '#1a1216' });
    const lant2 = new THREE.Mesh(new THREE.SphereGeometry(0.11, 16, 12), chochinMat);
    lant2.scale.y = 1.35; lant2.position.set(1.45, 1.42, 1.15); house.add(lant2);
    [-1.45, 1.45].forEach(px => {
      [1.58, 1.26].forEach(py => { const c = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.03, 12), capMat); c.position.set(px, py, 1.15); house.add(c); });
      const str = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, 0.14, 4), capMat); str.position.set(px, 1.66, 1.15); house.add(str);
    });

  }

  // ---- detail pass: tiles, ridges, rafters, brackets, wainscot, bracing, blinds, wind chime ----
  {
    const tileDark = new THREE.MeshLambertMaterial({ color: '#2a2430' });
    const tileEnd = new THREE.MeshLambertMaterial({ color: '#3a3342' });
    const raft = new THREE.MeshLambertMaterial({ color: '#3a2620' });
    const dummyH = new THREE.Object3D();
    const roofY = (ku, kv, eaveY, ridgeY, upAmt) => eaveY + upAmt * Math.pow(Math.abs(ku * 2 - 1), 3) * (1 - kv) + (ridgeY - eaveY) * Math.pow(kv, 1.7);

    // round tile ends (nokigawara) + rafter tails (taruki) all along the main eave
    const MB = [[-1.65, 1.2], [1.65, 1.2], [1.65, -1.2], [-1.65, -1.2]];
    const capPts = [], raftPts = [];
    for (let f = 0; f < 4; f++) {
      const b0 = MB[f], b1 = MB[(f + 1) % 4];
      const len = Math.hypot(b1[0] - b0[0], b1[1] - b0[1]), n = Math.round(len / 0.105);
      const out = Math.atan2(b1[0] - b0[0], b1[1] - b0[1]) - Math.PI / 2;      // outward facing yaw
      for (let i = 1; i < n; i++) {
        const ku = i / n, x = lerp(b0[0], b1[0], ku), z = lerp(b0[1], b1[1], ku);
        const y = roofY(ku, 0, 1.7, 2.45, 0.2);
        capPts.push([x, y, z, out]);
        if (i % 2 === 0) raftPts.push([x, y - 0.075, z, out]);
      }
    }
    const caps = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.045, 0.045, 0.05, 12).rotateX(Math.PI / 2), tileEnd, capPts.length);
    capPts.forEach(([x, y, z, a], i) => { dummyH.position.set(x, y + 0.01, z); dummyH.rotation.set(0, a, 0); dummyH.translateZ(0.02); dummyH.updateMatrix(); caps.setMatrixAt(i, dummyH.matrix); });
    house.add(caps);
    const rafters = new THREE.InstancedMesh(new THREE.BoxGeometry(0.035, 0.035, 0.42), raft, raftPts.length);
    raftPts.forEach(([x, y, z, a], i) => { dummyH.position.set(x, y, z); dummyH.rotation.set(0, a, 0); dummyH.translateZ(-0.16); dummyH.rotateX(-0.12); dummyH.updateMatrix(); rafters.setMatrixAt(i, dummyH.matrix); });
    house.add(rafters);

    // hip ridges with upturned end tiles (onigawara), on both roofs
    function hips(base, top, eaveY, ridgeY, upAmt, r) {
      for (let f = 0; f < 4; f++) {
        const pts = [];
        for (let k = 0; k <= 10; k++) {
          const kv = k / 10;
          pts.push(new V3(lerp(base[f][0], top[f][0], kv), roofY(0, kv, eaveY, ridgeY, upAmt) + r * 0.7, lerp(base[f][1], top[f][1], kv)));
        }
        house.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 24, r, 6), tileDark));
        const oni = new THREE.Mesh(new THREE.BoxGeometry(r * 3, r * 4.2, r * 1.6), tileDark);
        oni.position.copy(pts[0]).add(new V3(0, r * 1.4, 0));
        oni.rotation.y = Math.atan2(base[f][0], base[f][1]); oni.rotation.x = 0; oni.rotation.z = 0;
        house.add(oni);
        const kamon = new THREE.Mesh(new THREE.CircleGeometry(r * 0.8, 16), goldMat);
        kamon.position.copy(oni.position); kamon.rotation.y = oni.rotation.y; kamon.translateZ(r * 0.82);
        house.add(kamon);
      }
    }
    hips(MB, [[-0.75, 0.22], [0.75, 0.22], [0.75, -0.22], [-0.75, -0.22]], 1.7, 2.45, 0.2, 0.035);
    hips([[-0.98, 0.64], [0.98, 0.64], [0.98, -0.64], [-0.98, -0.64]], [[-0.36, 0.07], [0.36, 0.07], [0.36, -0.07], [-0.36, -0.07]], 2.56, 2.98, 0.13, 0.025);

    // heavier main ridge with end tiles
    const ridge = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.1, 0.17), tileDark); ridge.position.y = 2.5; house.add(ridge);
    [-1, 1].forEach(sd => {
      const end = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.2, 0.22), tileDark); end.position.set(sd * 0.87, 2.56, 0); house.add(end);
    });

    // bracket blocks (masugumi) on top of the corner pillars, holding up the eaves
    [[-1, -0.7], [1, -0.7], [-1, 0.7], [1, 0.7]].forEach(([px, pz]) => {
      [[0.13, 0.05, 1.745], [0.2, 0.04, 1.79], [0.09, 0.04, 1.83]].forEach(([w, h, y]) => {
        const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, w), raft); b.position.set(px, y, pz); house.add(b);
      });
    });

    // dark wooden wainscot (koshiita) under the shoji on the sides and back
    const plankTex = canvasTex(256, 64, (x, w, h) => {
      x.fillStyle = '#3b2721'; x.fillRect(0, 0, w, h);
      for (let i = 0; i < w; i += 21) { x.fillStyle = 'rgba(0,0,0,.4)'; x.fillRect(i, 0, 2, h); x.fillStyle = 'rgba(255,220,180,.05)'; x.fillRect(i + 3, 0, 6, h); }
    });
    const koshi = new THREE.MeshLambertMaterial({ map: plankTex });
    [[0, -0.712, 2.0, 0], [-1.012, 0, 1.4, Math.PI / 2], [1.012, 0, 1.4, Math.PI / 2]].forEach(([x, z, w, ry]) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, 0.26, 0.02), koshi); m.position.set(x, 0.9, z); m.rotation.y = ry; house.add(m);
    });

    // plank deck (engawa) instead of a plain board
    const deckTex = canvasTex(256, 256, (x, w, h) => {
      x.fillStyle = '#4a3328'; x.fillRect(0, 0, w, h);
      for (let j = 0; j < h; j += 16) { x.fillStyle = 'rgba(0,0,0,.45)'; x.fillRect(0, j, w, 2); x.fillStyle = `rgba(255,210,170,${0.03 + Math.random() * 0.04})`; x.fillRect(0, j + 3, w, 9); }
    });
    deckTex.wrapS = deckTex.wrapT = THREE.RepeatWrapping; deckTex.repeat.set(1, 1.4);
    house.children.forEach(o => { if (o.isMesh && o.geometry.type === 'BoxGeometry' && o.geometry.parameters.width === 2.6 && o.geometry.parameters.depth === 2.0) o.material = new THREE.MeshLambertMaterial({ map: deckTex }); });

    // stilts: horizontal ties + cross bracing under the deck
    const tie = (x0, z0, x1, z1, y) => {
      const len = Math.hypot(x1 - x0, z1 - z0), m = new THREE.Mesh(new THREE.BoxGeometry(len, 0.05, 0.05), wood);
      m.position.set((x0 + x1) / 2, y, (z0 + z1) / 2); m.rotation.y = -Math.atan2(z1 - z0, x1 - x0); house.add(m);
    };
    [0.45, -1.2, -3.5].forEach(y => { tie(-1.1, 0.8, 1.1, 0.8, y); tie(-1.1, -0.8, 1.1, -0.8, y); tie(-1.1, -0.8, -1.1, 0.8, y); tie(1.1, -0.8, 1.1, 0.8, y); });
    const brace = (a, b) => {
      const d = b.clone().sub(a), m = new THREE.Mesh(new THREE.BoxGeometry(0.04, d.length(), 0.04), wood);
      m.position.copy(a).add(b).multiplyScalar(0.5); m.quaternion.setFromUnitVectors(new V3(0, 1, 0), d.normalize()); house.add(m);
    };
    [0.8, -0.8].forEach(zz => {
      brace(new V3(-1.1, 0.45, zz), new V3(0, -1.2, zz)); brace(new V3(1.1, 0.45, zz), new V3(0, -1.2, zz));
      brace(new V3(-1.1, -1.2, zz), new V3(0, -3.5, zz)); brace(new V3(1.1, -1.2, zz), new V3(0, -3.5, zz));
    });
    [-1.1, 1.1].forEach(xx => { brace(new V3(xx, 0.45, -0.8), new V3(xx, -1.2, 0.8)); brace(new V3(xx, -1.2, -0.8), new V3(xx, -3.5, 0.8)); });

    // rolled bamboo blind (sudare), half down, on the side wall
    const sudareTex = canvasTex(128, 128, (x, w, h) => {
      x.clearRect(0, 0, w, h);
      for (let j = 0; j < h; j += 4) { x.fillStyle = j % 8 ? 'rgba(196,160,96,.92)' : 'rgba(168,128,70,.92)'; x.fillRect(0, j, w, 3); }
      x.fillStyle = 'rgba(90,40,24,.9)'; [24, 104].forEach(c => x.fillRect(c, 0, 3, h));
    });
    const sudare = new THREE.MeshLambertMaterial({ map: sudareTex, transparent: true, side: THREE.DoubleSide, alphaTest: 0.1 });
    [[-1.08, 0, 1.25, Math.PI / 2]].forEach(([x, z, w, ry]) => {      // side only: the back wall has the round window
      const m = new THREE.Mesh(new THREE.PlaneGeometry(w, 0.48), sudare); m.position.set(x, 1.45, z); m.rotation.y = ry; house.add(m);
      const roll = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, w, 10).rotateZ(Math.PI / 2), new THREE.MeshLambertMaterial({ color: '#b08a50' }));
      roll.position.set(x, 1.68, z); roll.rotation.y = ry; house.add(roll);
    });

    // glass wind chime (fūrin) under the front eave, swaying in the breeze
    const chainMat = new THREE.MeshLambertMaterial({ color: '#6b4a2e', emissive: '#1a0f06' });
    furin = new THREE.Group();
    const bell = new THREE.Mesh(new THREE.SphereGeometry(0.05, 16, 10, 0, Math.PI * 2, 0, Math.PI / 1.7), new THREE.MeshLambertMaterial({ color: '#cfe8f0', emissive: '#4a6a78', transparent: true, opacity: 0.85, side: THREE.DoubleSide }));
    bell.position.y = -0.1;
    const cord = new THREE.Mesh(new THREE.CylinderGeometry(0.003, 0.003, 0.22, 4), chainMat); cord.position.y = -0.17;
    const tanzaku = new THREE.Mesh(new THREE.PlaneGeometry(0.035, 0.13), new THREE.MeshLambertMaterial({ color: '#d8402f', side: THREE.DoubleSide }));
    tanzaku.position.y = -0.32;
    furin.add(bell, cord, tanzaku);
    furin.position.set(0.72, 1.74, 1.08);
    house.add(furin);
  }

  /* ---------- the samurai, kneeling in seiza inside the house by the round window
     (click him on the Contact page → his eye → the hidden gallery).
     If assets/models/samurai.glb exists it replaces this procedural figure. ---------- */
  const samurai = new THREE.Group();
  const samuraiHead = new THREE.Group();
  const samuraiProc = new THREE.Group();       // the hand-built figure (fallback for the GLB)
  const eyeMat = new THREE.MeshBasicMaterial({ color: '#ffc861' });
  const D = 0.2;                                // how much lower the upper body sits when kneeling
  const EYE_LOCAL = new V3(-0.027, 0.712 - D, 0.07);
  {
    const indigo = new THREE.MeshLambertMaterial({ color: '#1e2a48' });
    const lacquer = new THREE.MeshLambertMaterial({ color: '#1c1417' });
    const redLace = new THREE.MeshLambertMaterial({ color: '#b3302a', emissive: '#2a0806' });
    const skin = new THREE.MeshLambertMaterial({ color: '#e2b690' });
    const add = (g, m, x, y, z, rx = 0, ry = 0, rz = 0, parent = samuraiProc) => {
      const mesh = new THREE.Mesh(g, m); mesh.position.set(x, y, z); mesh.rotation.set(rx, ry, rz); parent.add(mesh); return mesh;
    };
    // kneeling hakama: folded legs spread on the tatami
    const legs = add(new THREE.SphereGeometry(1, 20, 12), indigo, 0, 0.065, 0.04); legs.scale.set(0.17, 0.075, 0.2);
    [-1, 1].forEach(sd => { const k = add(new THREE.SphereGeometry(1, 14, 10), indigo, sd * 0.075, 0.07, 0.17); k.scale.set(0.065, 0.06, 0.07); });
    // kusazuri skirt plates
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * Math.PI * 2;
      const m = add(new THREE.BoxGeometry(0.075, 0.09, 0.012), lacquer, Math.sin(a) * 0.13, 0.31 - D + 0.02, Math.cos(a) * 0.13);
      m.rotation.order = 'YXZ'; m.rotation.set(0.35, a, 0);
    }
    add(new THREE.CylinderGeometry(0.118, 0.118, 0.035, 14), redLace, 0, 0.36 - D, 0);          // obi
    add(new THREE.CylinderGeometry(0.135, 0.112, 0.24, 14), lacquer, 0, 0.49 - D, 0);           // dō (cuirass)
    [0.43, 0.49, 0.55].forEach(y => add(new THREE.TorusGeometry(0.13 - (y - 0.43) * 0.1, 0.006, 4, 24), redLace, 0, y - D, 0, Math.PI / 2));
    [-1, 1].forEach(sd => {
      add(new THREE.BoxGeometry(0.03, 0.15, 0.13), lacquer, sd * 0.17, 0.53 - D, 0, 0, 0, sd * 0.3);
      [0.5, 0.55].forEach(y => add(new THREE.BoxGeometry(0.032, 0.008, 0.132), redLace, sd * 0.17 + sd * (0.6 - y) * 0.3, y - D, 0, 0, 0, sd * 0.3));
      // arms resting, hands on the thighs
      add(new THREE.CylinderGeometry(0.032, 0.028, 0.2, 8), indigo, sd * 0.15, 0.26, 0.07, 0.75, 0, sd * 0.15);
      add(new THREE.SphereGeometry(0.03, 8, 6), skin, sd * 0.12, 0.15, 0.15);
    });
    // katana laid on the tatami in front of him
    const saya = new THREE.CatmullRomCurve3([new V3(-0.2, 0.012, 0.3), new V3(0.02, 0.016, 0.31), new V3(0.18, 0.012, 0.3)]);
    samuraiProc.add(new THREE.Mesh(new THREE.TubeGeometry(saya, 12, 0.013, 6), new THREE.MeshLambertMaterial({ color: '#0f0d10' })));
    add(new THREE.CylinderGeometry(0.026, 0.026, 0.008, 12), goldMat, 0.185, 0.014, 0.3, 0, 0, Math.PI / 2);
    add(new THREE.CylinderGeometry(0.013, 0.013, 0.12, 6), new THREE.MeshLambertMaterial({ color: '#d9d0c0' }), 0.25, 0.013, 0.3, 0, 0, Math.PI / 2);

    // head (turns to follow the cursor)
    samuraiProc.add(samuraiHead);
    add(new THREE.CylinderGeometry(0.035, 0.04, 0.05, 8), skin, 0, 0.625 - D, 0, 0, 0, 0, samuraiHead);
    add(new THREE.SphereGeometry(0.075, 24, 18), skin, 0, 0.7 - D, 0, 0, 0, 0, samuraiHead);
    add(new THREE.BoxGeometry(0.11, 0.05, 0.03), new THREE.MeshLambertMaterial({ color: '#5a1612' }), 0, 0.66 - D, 0.06, 0, 0, 0, samuraiHead);
    add(new THREE.SphereGeometry(0.09, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2), lacquer, 0, 0.722 - D, -0.004, 0, 0, 0, samuraiHead);
    add(new THREE.CylinderGeometry(0.095, 0.14, 0.075, 18, 1, true, Math.PI * 0.3, Math.PI * 1.4), lacquer, 0, 0.69 - D, -0.005, 0, 0, 0, samuraiHead);
    add(new THREE.BoxGeometry(0.16, 0.012, 0.03), lacquer, 0, 0.73 - D, 0.075, 0, 0, 0, samuraiHead);
    [-1, 1].forEach(sd => {
      const c = new THREE.CatmullRomCurve3([new V3(0, 0.74 - D, 0.085), new V3(sd * 0.05, 0.8 - D, 0.1), new V3(sd * 0.09, 0.9 - D, 0.09)]);
      samuraiHead.add(new THREE.Mesh(new THREE.TubeGeometry(c, 10, 0.008, 5), goldMat));
      add(new THREE.SphereGeometry(0.012, 40, 30), eyeMat, sd * 0.027, 0.712 - D, 0.064, 0, 0, 0, samuraiHead);
      add(new THREE.SphereGeometry(0.0055, 32, 24), new THREE.MeshBasicMaterial({ color: '#0b0604' }), sd * 0.027, 0.712 - D, 0.0745, 0, 0, 0, samuraiHead);
      add(new THREE.BoxGeometry(0.03, 0.007, 0.008), new THREE.MeshBasicMaterial({ color: '#120b0a' }), sd * 0.028, 0.729 - D, 0.071, 0, 0, sd * 0.35, samuraiHead);
    });
    add(new THREE.CircleGeometry(0.02, 16), goldMat, 0, 0.75 - D, 0.09, 0, 0, 0, samuraiHead);
  }
  samurai.add(samuraiProc);
  // a small zabuton cushion under him
  {
    const cushion = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.03, 0.34), new THREE.MeshLambertMaterial({ color: '#6b1f24' }));
    cushion.position.y = -0.005; samurai.add(cushion);
  }
  // invisible, generous hit area so he's easy to click
  {
    const hit = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.62, 0.42), new THREE.MeshBasicMaterial({ visible: false }));
    hit.position.y = 0.3; samurai.add(hit);
  }
  const SAMURAI_HOME = new V3(-0.66, 0.8, -0.36);     // house-local: on the tatami, in front of the round window
  samurai.scale.setScalar(0.8);
  samurai.position.copy(SAMURAI_HOME);
  samurai.rotation.y = 0.75;                          // facing whoever comes through the door
  house.add(samurai);

  // ---- interior room ----
  const interior = new THREE.Group();
  house.add(interior);
  {
    const X = 0.97, Z = 0.67, Y0 = 0.785, Y1 = 1.695, YM = (Y0 + Y1) / 2, HH = Y1 - Y0;
    const plasterTex = canvasTex(256, 256, (x, w, h) => {
      x.fillStyle = '#eadcc2'; x.fillRect(0, 0, w, h);
      const r = mulberry(5);
      for (let i = 0; i < 2600; i++) {
        x.fillStyle = r() < 0.5 ? `rgba(120,90,50,${0.03 + r() * 0.05})` : `rgba(255,250,235,${0.05 + r() * 0.08})`;
        x.fillRect(r() * w, r() * h, 1 + r() * 3, 1 + r() * 3);
      }
    });
    plasterTex.wrapS = plasterTex.wrapT = THREE.RepeatWrapping; plasterTex.repeat.set(2, 1);
    const plaster = new THREE.MeshLambertMaterial({ color: '#ffffff', map: plasterTex });
    // floor — two tatami mats
    const tatami = canvasTex(1024, 704, (x, w, h) => {
      x.fillStyle = '#cdbf86'; x.fillRect(0, 0, w, h);
      const r = mulberry(9);
      // three mats across, two deep: mats run alternately horizontally and vertically
      const mats = [[0, 0, 1 / 3, 0.5, 0], [1 / 3, 0, 1 / 3, 0.5, 1], [2 / 3, 0, 1 / 3, 0.5, 0], [0, 0.5, 1 / 3, 0.5, 1], [1 / 3, 0.5, 1 / 3, 0.5, 0], [2 / 3, 0.5, 1 / 3, 0.5, 1]];
      for (const [mx, my, mw, mh, vertical] of mats) {
        const X0 = mx * w, Y0m = my * h, Wm = mw * w, Hm = mh * h;
        x.fillStyle = `hsl(48, 38%, ${58 + r() * 6}%)`; x.fillRect(X0, Y0m, Wm, Hm);
        x.strokeStyle = 'rgba(90,75,30,.22)'; x.lineWidth = 1.2;
        if (vertical) for (let k = X0; k < X0 + Wm; k += 4) { x.beginPath(); x.moveTo(k, Y0m); x.lineTo(k, Y0m + Hm); x.stroke(); }
        else for (let k = Y0m; k < Y0m + Hm; k += 4) { x.beginPath(); x.moveTo(X0, k); x.lineTo(X0 + Wm, k); x.stroke(); }
        x.fillStyle = '#23211a';                       // cloth borders (heri) on the long sides
        if (vertical) { x.fillRect(X0, Y0m, 10, Hm); x.fillRect(X0 + Wm - 10, Y0m, 10, Hm); }
        else { x.fillRect(X0, Y0m, Wm, 10); x.fillRect(X0, Y0m + Hm - 10, Wm, 10); }
        x.strokeStyle = 'rgba(40,30,10,.5)'; x.lineWidth = 2; x.strokeRect(X0 + 1, Y0m + 1, Wm - 2, Hm - 2);
      }
    });
    tatami.anisotropy = 8;
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(2 * X, 2 * Z), new THREE.MeshLambertMaterial({ map: tatami }));
    floor.rotation.x = -Math.PI / 2; floor.position.y = Y0; interior.add(floor);
    // ceiling — wooden planks
    const planks = canvasTex(256, 128, (x, w, h) => {
      x.fillStyle = '#3d2a21'; x.fillRect(0, 0, w, h);
      x.fillStyle = '#2a1c16'; for (let i = 0; i < w; i += 32) x.fillRect(i, 0, 3, h);
    });
    const ceil = new THREE.Mesh(new THREE.PlaneGeometry(2 * X, 2 * Z), new THREE.MeshLambertMaterial({ map: planks }));
    ceil.rotation.x = Math.PI / 2; ceil.position.y = Y1; interior.add(ceil);
    // back wall with a round window (marumado) looking out over the lake
    const WIN = { x: -0.42, y: YM + 0.02, r: 0.25 };
    const bw = new THREE.Shape();
    bw.moveTo(-X, Y0); bw.lineTo(X, Y0); bw.lineTo(X, Y1); bw.lineTo(-X, Y1); bw.closePath();
    const hole = new THREE.Path(); hole.absarc(WIN.x, WIN.y, WIN.r, 0, Math.PI * 2, true);
    bw.holes.push(hole);
    const back = new THREE.Mesh(new THREE.ShapeGeometry(bw, 48), plaster);
    back.position.z = -Z; interior.add(back);
    const frame = new THREE.Mesh(new THREE.TorusGeometry(WIN.r, 0.022, 10, 48), woodIn);
    frame.position.set(WIN.x, WIN.y, -Z + 0.01); interior.add(frame);
    // side walls
    [-1, 1].forEach(s => {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(2 * Z, HH), plaster);
      m.rotation.y = -s * Math.PI / 2; m.position.set(s * X, YM, 0); interior.add(m);
    });
    // posts & beams
    const postG = new THREE.BoxGeometry(0.05, HH, 0.05);
    [[-X, -Z], [X, -Z], [-X, Z], [X, Z], [0.2, -Z]].forEach(([px, pz]) => { const m = new THREE.Mesh(postG, woodIn); m.position.set(px, YM, pz); interior.add(m); });
    const beamZ = new THREE.BoxGeometry(2 * X, 0.04, 0.03), beamX = new THREE.BoxGeometry(0.03, 0.04, 2 * Z);
    [[0, -Z + 0.02, beamZ], [-X + 0.02, 0, beamX], [X - 0.02, 0, beamX]].forEach(([px, pz, g]) => { const m = new THREE.Mesh(g, woodIn); m.position.set(px, Y1 - 0.18, pz); interior.add(m); });
    // tokonoma alcove floor + ikebana under the window
    const toko = new THREE.Mesh(new THREE.BoxGeometry(0.75, 0.04, 0.26), woodIn); toko.position.set(0.58, Y0 + 0.02, -Z + 0.13); interior.add(toko);
    const vase = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.05, 0.14, 16), new THREE.MeshLambertMaterial({ color: '#2d3c4f' }));
    vase.position.set(-0.78, Y0 + 0.07, -Z + 0.14); interior.add(vase);
    const branch = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3([new V3(0, 0, 0), new V3(0.04, 0.12, 0), new V3(0.14, 0.22, 0.02), new V3(0.26, 0.26, 0.03)]), 12, 0.006, 4), woodIn);
    branch.position.set(-0.78, Y0 + 0.14, -Z + 0.14); interior.add(branch);
    const blossom = new THREE.MeshBasicMaterial({ color: '#f6bccb' });
    [[0.05, 0.13], [0.11, 0.2], [0.17, 0.23], [0.24, 0.26], [0.2, 0.27], [0.08, 0.17]].forEach(([bx, by]) => {
      const m = new THREE.Mesh(new THREE.SphereGeometry(0.018, 8, 6), blossom); m.position.set(-0.78 + bx, Y0 + 0.14 + by, -Z + 0.15); interior.add(m);
    });
    // andon floor lantern + warm room light
    const andon = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.18, 0.1), new THREE.MeshBasicMaterial({ map: doorTex }));
    andon.position.set(-0.8, Y0 + 0.09, 0.4); interior.add(andon);
    const roomLight = new THREE.PointLight('#ffc98a', 0.7, 2.6, 2); roomLight.position.set(-0.6, Y0 + 0.4, 0.3); house.add(roomLight);
    const roomFill = new THREE.PointLight('#ffe2b8', 0.3, 2.5, 2); roomFill.position.set(0.3, Y1 - 0.15, 0); house.add(roomFill);

    // ---- furnishing pass ----
    const darkWood = new THREE.MeshLambertMaterial({ color: '#2e1f19' });
    // coffered ceiling (sao-buchi): thin battens under the planks
    for (let i = -3; i <= 3; i++) { const b = new THREE.Mesh(new THREE.BoxGeometry(0.018, 0.02, 2 * Z), darkWood); b.position.set(i * 0.27, Y1 - 0.012, 0); interior.add(b); }
    [-0.33, 0, 0.33].forEach(z => { const b = new THREE.Mesh(new THREE.BoxGeometry(2 * X, 0.025, 0.03), darkWood); b.position.set(0, Y1 - 0.015, z); interior.add(b); });

    // fusuma: painted sliding panels on the left wall — gold-leaf clouds and an ink pine
    const fusumaTex = canvasTex(1024, 512, (x, w, h) => {
      const g = x.createLinearGradient(0, 0, 0, h); g.addColorStop(0, '#d8b46a'); g.addColorStop(1, '#c49a52');
      x.fillStyle = g; x.fillRect(0, 0, w, h);
      const r = mulberry(13);
      for (let i = 0; i < 700; i++) { x.fillStyle = `rgba(255,236,170,${r() * 0.18})`; x.fillRect(r() * w, r() * h, 22, 22); }   // gold-leaf squares
      x.fillStyle = 'rgba(250,240,215,.55)';                                                                                     // drifting clouds
      [[200, 120, 260], [640, 90, 220], [820, 330, 300], [300, 380, 240]].forEach(([cx, cy, cw]) => {
        x.beginPath(); x.ellipse(cx, cy, cw / 2, 26, 0, 0, 6.283); x.fill();
        x.beginPath(); x.ellipse(cx + cw * 0.2, cy - 16, cw / 3, 22, 0, 0, 6.283); x.fill();
      });
      x.strokeStyle = '#2b2018'; x.lineCap = 'round';                                                                              // ink pine branch
      const br = (x0, y0, x1, y1, wdt) => { x.lineWidth = wdt; x.beginPath(); x.moveTo(x0, y0); x.quadraticCurveTo((x0 + x1) / 2, (y0 + y1) / 2 - 40, x1, y1); x.stroke(); };
      br(40, 470, 330, 250, 22); br(330, 250, 610, 300, 12); br(330, 250, 420, 140, 9); br(520, 280, 700, 210, 7);
      x.fillStyle = 'rgba(40,58,44,.9)';
      [[420, 140], [610, 300], [700, 210], [250, 300], [520, 260]].forEach(([px, py]) => {
        for (let k = 0; k < 26; k++) { const a = r() * 6.28, l = 20 + r() * 40; x.fillRect(px + Math.cos(a) * l * 0.6, py + Math.sin(a) * l * 0.35, 3, 12); }
      });
      x.fillStyle = 'rgba(40,25,15,.85)'; [w / 4, w / 2, 3 * w / 4].forEach(px => x.fillRect(px - 3, 0, 6, h));                 // panel joints
      x.strokeStyle = '#2b1d16'; x.lineWidth = 16; x.strokeRect(0, 0, w, h);
    });
    const fusuma = new THREE.Mesh(new THREE.PlaneGeometry(2 * Z - 0.08, HH - 0.22), new THREE.MeshLambertMaterial({ map: fusumaTex }));
    fusuma.rotation.y = Math.PI / 2; fusuma.position.set(-X + 0.006, Y0 + (HH - 0.22) / 2 + 0.01, 0); interior.add(fusuma);
    [-0.32, 0.32].forEach(z => {                                                                                                    // round pulls (hikite)
      const pull = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.014, 0.006, 16).rotateZ(Math.PI / 2), goldMat);
      pull.position.set(-X + 0.01, Y0 + 0.36, z); interior.add(pull);
    });

    // ranma: a lattice transom band above the beams, glowing with the light behind it
    const ranmaTex = canvasTex(1024, 96, (x, w, h) => {
      x.fillStyle = '#ffdcae'; x.fillRect(0, 0, w, h);
      x.strokeStyle = 'rgba(58,39,30,.75)'; x.lineWidth = 2.2;
      for (let i = -h; i < w + h; i += 18) { x.beginPath(); x.moveTo(i, 0); x.lineTo(i + h, h); x.stroke(); x.beginPath(); x.moveTo(i + h, 0); x.lineTo(i, h); x.stroke(); }
      x.lineWidth = 10; x.strokeRect(0, 0, w, h);
    });
    const ranmaMat = new THREE.MeshBasicMaterial({ map: ranmaTex, color: '#d9b48a' });
    ranmaTex.repeat.set(1, 1);
    const ranmaB = new THREE.Mesh(new THREE.PlaneGeometry(2 * X, 0.1), ranmaMat); ranmaB.position.set(0, Y1 - 0.075, -Z + 0.004); interior.add(ranmaB);
    const ranmaL = new THREE.Mesh(new THREE.PlaneGeometry(2 * Z, 0.1), ranmaMat); ranmaL.rotation.y = Math.PI / 2; ranmaL.position.set(-X + 0.004, Y1 - 0.075, 0); interior.add(ranmaL);

    // tokonoma: hanging ensō scroll + a small bonsai on the raised platform
    const scrollTex = canvasTex(128, 320, (x, w, h) => {
      x.fillStyle = '#6e543d'; x.fillRect(0, 0, w, h);
      x.fillStyle = '#f4ecd8'; x.fillRect(12, 34, w - 24, h - 68);
      x.strokeStyle = '#1d1712'; x.lineCap = 'round';
      for (let k = 0; k < 40; k++) { const a0 = 0.5 + k * 0.14; x.lineWidth = 9 - k * 0.15; x.beginPath(); x.arc(w / 2, 130, 34, a0, a0 + 0.2); x.stroke(); }
      x.fillStyle = '#c8372a'; x.fillRect(w / 2 + 14, 230, 14, 14);
    });
    const kake = new THREE.Mesh(new THREE.PlaneGeometry(0.17, 0.42), new THREE.MeshLambertMaterial({ map: scrollTex }));
    kake.position.set(0.58, Y0 + 0.47, -Z + 0.006); interior.add(kake);
    [0.21, -0.21].forEach(dy => { const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.2, 8).rotateZ(Math.PI / 2), darkWood); rod.position.set(0.58, Y0 + 0.47 + dy, -Z + 0.012); interior.add(rod); });
    {
      const pot = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.035, 0.07), new THREE.MeshLambertMaterial({ color: '#3a4458' }));
      pot.position.set(0.66, Y0 + 0.058, -Z + 0.13); interior.add(pot);
      const trunk = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3([new V3(0, 0, 0), new V3(0.02, 0.05, 0), new V3(-0.03, 0.09, 0), new V3(0.01, 0.13, 0)]), 10, 0.008, 5), darkWood);
      trunk.position.set(0.66, Y0 + 0.075, -Z + 0.13); interior.add(trunk);
      const leaf = new THREE.MeshLambertMaterial({ color: '#3e5a3c' });
      [[-0.04, 0.1, 0.045], [0.03, 0.13, 0.04], [0.0, 0.16, 0.035]].forEach(([dx, dy, r]) => { const m = new THREE.Mesh(new THREE.SphereGeometry(r, 10, 8), leaf); m.scale.y = 0.55; m.position.set(0.66 + dx, Y0 + 0.075 + dy, -Z + 0.13); interior.add(m); });
    }

    // a low round table (chabudai) with a tea set, steam curling up
    const tea = new THREE.Group();
    {
      const top = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.17, 0.018, 40), new THREE.MeshLambertMaterial({ color: '#5a3424' }));
      top.position.y = 0.105; tea.add(top);
      const rim = new THREE.Mesh(new THREE.TorusGeometry(0.17, 0.006, 6, 40).rotateX(Math.PI / 2), darkWood); rim.position.y = 0.105; tea.add(rim);
      for (let i = 0; i < 4; i++) { const a = i * Math.PI / 2 + Math.PI / 4, leg = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.1, 0.02), darkWood); leg.position.set(Math.cos(a) * 0.11, 0.05, Math.sin(a) * 0.11); tea.add(leg); }
      const iron = new THREE.MeshLambertMaterial({ color: '#2a2a2e' });
      const pot = new THREE.Mesh(new THREE.SphereGeometry(0.045, 20, 14), iron); pot.scale.y = 0.8; pot.position.set(0.03, 0.148, 0.01); tea.add(pot);
      const lid = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.025, 0.01, 16), iron); lid.position.set(0.03, 0.184, 0.01); tea.add(lid);
      const spout = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.01, 0.05, 8), iron); spout.position.set(0.075, 0.155, 0.01); spout.rotation.z = -1.0; tea.add(spout);
      const handle = new THREE.Mesh(new THREE.TorusGeometry(0.035, 0.004, 6, 20, Math.PI), new THREE.MeshLambertMaterial({ color: '#8a6a3a' })); handle.position.set(0.03, 0.18, 0.01); tea.add(handle);
      const cupMat = new THREE.MeshLambertMaterial({ color: '#e9e2d4' }), teaMat = new THREE.MeshBasicMaterial({ color: '#7d8a3a' });
      [[-0.07, 0.06], [-0.04, -0.08]].forEach(([cx, cz]) => {
        const cup = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.016, 0.03, 16), cupMat); cup.position.set(cx, 0.129, cz); tea.add(cup);
        const tsurf = new THREE.Mesh(new THREE.CircleGeometry(0.018, 16).rotateX(-Math.PI / 2), teaMat); tsurf.position.set(cx, 0.141, cz); tea.add(tsurf);
      });
    }
    tea.scale.setScalar(0.62); tea.position.set(-0.16, Y0, -0.36); interior.add(tea);
    const steamTex = radialTex([[0, 'rgba(255,255,255,.55)'], [1, 'rgba(255,255,255,0)']]);
    const steam = [];
    for (let i = 0; i < 7; i++) {
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: steamTex, transparent: true, depthWrite: false, opacity: 0 }));
      sp.userData = { ph: i / 7, base: new V3(-0.16 + 0.02 + (i % 2 ? 0.01 : -0.01), Y0 + 0.12, -0.36 + 0.006) };
      interior.add(sp); steam.push(sp);
    }
    const guest = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.025, 0.2), new THREE.MeshLambertMaterial({ color: '#2f3a5c' }));
    guest.scale.setScalar(0.75); guest.position.set(0.06, Y0 + 0.01, -0.3); guest.rotation.y = 0.3; interior.add(guest);

    // warm halo around the floor lantern
    const andonGlow = new THREE.Sprite(new THREE.SpriteMaterial({ map: radialTex([[0, 'rgba(255,190,110,.5)'], [1, 'rgba(255,190,110,0)']]), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
    andonGlow.scale.setScalar(0.55); andonGlow.position.set(-0.8, Y0 + 0.1, 0.4); interior.add(andonGlow);

    // sunset light through the round window: a warm oval of light on the tatami, with dust motes above it
    const sunPatch = new THREE.Mesh(
      new THREE.CircleGeometry(1, 48).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ map: radialTex([[0, 'rgba(255,196,140,.55)'], [0.6, 'rgba(255,170,120,.25)'], [1, 'rgba(255,170,120,0)']]), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending })
    );
    sunPatch.scale.set(0.34, 1, 0.22); sunPatch.position.set(WIN.x + 0.08, Y0 + 0.003, -Z + 0.42); interior.add(sunPatch);
    const beamMat = { uniforms: { time: { value: 0 } } };
    const DN = 40, dpos = new Float32Array(DN * 3), dseed = new Float32Array(DN);
    for (let i = 0; i < DN; i++) { dpos[i * 3] = WIN.x + (Math.random() - 0.3) * 0.4; dpos[i * 3 + 1] = Y0 + 0.1 + Math.random() * 0.6; dpos[i * 3 + 2] = -Z + 0.05 + Math.random() * 0.7; dseed[i] = Math.random() * 100; }
    const dgeo = new THREE.BufferGeometry(); dgeo.setAttribute('position', new THREE.BufferAttribute(dpos, 3));
    const dust = new THREE.Points(dgeo, new THREE.PointsMaterial({ color: '#ffd9b0', size: 1.6, sizeAttenuation: false, transparent: true, opacity: 0.55, depthWrite: false, blending: THREE.AdditiveBlending }));
    interior.add(dust);

    updateRoom = (dt, t) => {
      beamMat.uniforms.time.value = t;
      sunPatch.material.opacity = 0.85 + Math.sin(t * 0.7) * 0.15;
      for (const sp of steam) {
        const u = sp.userData, k = (t * 0.22 + u.ph) % 1;
        sp.position.set(u.base.x + Math.sin(t * 1.3 + u.ph * 9) * 0.02 * k, u.base.y + k * 0.22, u.base.z + Math.cos(t + u.ph * 5) * 0.015 * k);
        sp.scale.setScalar(0.02 + k * 0.06);
        sp.material.opacity = Math.sin(k * Math.PI) * 0.35;
      }
      const a = dgeo.attributes.position.array;
      for (let i = 0; i < DN; i++) {
        a[i * 3] += Math.sin(t * 0.3 + dseed[i]) * 0.004 * dt; a[i * 3 + 1] += Math.cos(t * 0.25 + dseed[i]) * 0.006 * dt - 0.002 * dt;
        if (a[i * 3 + 1] < Y0 + 0.05) a[i * 3 + 1] = Y0 + 0.7;
      }
      dgeo.attributes.position.needsUpdate = true;
    };
  }

  house.position.set(1.7, 0, -3.6);
  house.rotation.y = 0.4;
  scene.add(house);
  house.updateMatrixWorld(true);
  const H2W = (x, y, z) => house.localToWorld(new V3(x, y, z));
  const doorCenter = H2W(0, 1.24, 0.7);
  const houseCore = H2W(0, 2.2, 0);

  /* =========================================================
     TORII — pillars run down to the lake bed too
     ========================================================= */
  const toriiRed = new THREE.MeshLambertMaterial({ color: '#c23b2c', emissive: '#3a0d08' });
  const torii = new THREE.Group();
  {
    const red = toriiRed;
    const blk = new THREE.MeshLambertMaterial({ color: '#1f1418' });
    const t = torii;
    const pillarH = 3.0 - SEA_Y + 1;
    [-0.9, 0.9].forEach(px => {
      const m = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.13, pillarH, 12), red);
      m.position.set(px, 3.0 - pillarH / 2, 0); t.add(m);
    });
    const nuki = new THREE.Mesh(new THREE.BoxGeometry(2.5, 0.14, 0.12), red); nuki.position.y = 2.45; t.add(nuki);
    const shimaki = new THREE.Mesh(new THREE.BoxGeometry(2.9, 0.16, 0.22), red); shimaki.position.y = 2.95; t.add(shimaki);
    const ks = new THREE.Shape();
    ks.moveTo(-1.85, 0.12); ks.quadraticCurveTo(0, -0.08, 1.85, 0.12); ks.lineTo(1.9, 0.32);
    ks.quadraticCurveTo(0, 0.12, -1.9, 0.32); ks.closePath();
    const kg = new THREE.ExtrudeGeometry(ks, { depth: 0.3, bevelEnabled: false }); kg.translate(0, 0, -0.15);
    const kasagi = new THREE.Mesh(kg, blk); kasagi.position.y = 2.95; t.add(kasagi);
    const gk = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.45, 0.1), red); gk.position.y = 2.7; t.add(gk);
    t.position.set(6.2, 0, -9.5); t.rotation.y = -0.25;
    // (removed from the lake by request — kept out of the scene)
  }

  /* =========================================================
     Ripple simulation (lake surface) — runs on the CPU and is uploaded
     as a texture, so it works the same on every GPU / driver.
     ========================================================= */
  const SIM = 192;
  const REGION = { x: -14, z: -18, size: 30 };
  let simCur = new Float32Array(SIM * SIM), simPrev = new Float32Array(SIM * SIM);
  const floatLinear = renderer.extensions.has('OES_texture_float_linear');
  const rippleData = floatLinear ? new Float32Array(SIM * SIM) : new Uint16Array(SIM * SIM);
  const rippleTex = new THREE.DataTexture(rippleData, SIM, SIM, THREE.RedFormat, floatLinear ? THREE.FloatType : THREE.HalfFloatType);
  rippleTex.magFilter = rippleTex.minFilter = THREE.LinearFilter;
  rippleTex.needsUpdate = true;

  function simDrop(u, v, r, s) {
    const cx = u * SIM, cy = v * SIM, rr = Math.max(1.2, r * SIM), r2 = rr * rr;
    const x0 = Math.max(1, Math.floor(cx - rr)), x1 = Math.min(SIM - 2, Math.ceil(cx + rr));
    const y0 = Math.max(1, Math.floor(cy - rr)), y1 = Math.min(SIM - 2, Math.ceil(cy + rr));
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const d2 = (x - cx) * (x - cx) + (y - cy) * (y - cy);
      if (d2 < r2) simCur[y * SIM + x] += (0.5 + Math.cos(Math.sqrt(d2) / rr * Math.PI) * 0.5) * s;
    }
  }
  function simStep() {
    const c = simCur, n = simPrev;
    for (let y = 1; y < SIM - 1; y++) {
      let i = y * SIM + 1;
      for (let x = 1; x < SIM - 1; x++, i++) n[i] = ((c[i - 1] + c[i + 1] + c[i - SIM] + c[i + SIM]) * 0.5 - n[i]) * 0.984;
    }
    simPrev = c; simCur = n;
  }
  function simUpload() {
    if (floatLinear) rippleData.set(simCur);
    else for (let i = 0; i < SIM * SIM; i++) rippleData[i] = THREE.DataUtils.toHalfFloat(clamp(simCur[i], -60000, 60000));
    rippleTex.needsUpdate = true;
  }

  const dropQueue = [];
  function queueDrop(wx, wz, radius, strength) {
    const u = (wx - REGION.x) / REGION.size, v = 1 - (wz - REGION.z) / REGION.size;
    if (u < 0.01 || u > 0.99 || v < 0.01 || v > 0.99) return;
    if (dropQueue.length < 64) dropQueue.push([u, v, radius, strength]);
  }
  const RIPPLE_GLSL = `
    uniform sampler2D tRipple; uniform vec4 region; uniform float time;
    float hgt(vec2 uv){ return texture2D(tRipple, uv).r; }
    vec2 rippleN = vec2(0.0);
    vec2 waveNormal(vec2 p){
      vec2 n2 = vec2(cos(p.x * 1.3 + time * 0.8), sin(p.y * 1.7 - time * 0.65)) * 0.0055;
      n2 += vec2(sin(p.x * 2.9 - p.y * 1.3 + time * 1.2), cos(p.y * 3.1 + p.x * 0.7 + time * 0.95)) * 0.003;
      n2 += vec2(sin(p.y * 0.6 + time * 0.3), cos(p.x * 0.5 - time * 0.35)) * 0.0045;
      vec2 ruv = vec2((p.x - region.x) / region.z, 1.0 - (p.y - region.y) / region.z);
      if (ruv.x > 0.0 && ruv.x < 1.0 && ruv.y > 0.0 && ruv.y < 1.0) {
        float t = region.w;
        float dx = hgt(ruv - vec2(t, 0.0)) - hgt(ruv + vec2(t, 0.0));
        float dz = hgt(ruv + vec2(0.0, t)) - hgt(ruv - vec2(0.0, t));
        vec2 e = min(ruv, 1.0 - ruv);
        rippleN = vec2(dx, dz) * 1.2 * smoothstep(0.0, 0.1, min(e.x, e.y));
        n2 += rippleN;
      }
      return n2;
    }`;
  const rippleU = {
    tRipple: { value: rippleTex }, region: { value: new THREE.Vector4(REGION.x, REGION.z, REGION.size, 1 / SIM) }, time: { value: 0 }
  };

  /* =========================================================
     LAKE SURFACE — mirror from above, Snell's window from below
     ========================================================= */
  const water = new Reflector(new THREE.PlaneGeometry(900, 900), {
    shader: {
      name: 'LakeShader',
      uniforms: {
        color: { value: null }, tDiffuse: { value: null }, textureMatrix: { value: null },
        deepColor: { value: C('#141c33') }, sunDir: { value: SUN_DIR }, ...rippleU, ...fogU
      },
      vertexShader: `
        uniform mat4 textureMatrix; varying vec4 vUv; varying vec3 vWorld;
        void main(){
          vUv = textureMatrix * vec4(position, 1.0);
          vec4 wp = modelMatrix * vec4(position, 1.0); vWorld = wp.xyz;
          gl_Position = projectionMatrix * viewMatrix * wp;
        }`,
      fragmentShader: `
        uniform vec3 color; uniform sampler2D tDiffuse; uniform vec3 deepColor, sunDir;
        ${RIPPLE_GLSL}
        ${FOG_GLSL}
        varying vec4 vUv; varying vec3 vWorld;
        void main(){
          vec2 n2 = waveNormal(vWorld.xz);
          vec3 N = normalize(vec3(n2.x, 1.0, n2.y));
          vec3 V = normalize(cameraPosition - vWorld);
          float dist = length(cameraPosition - vWorld);
          vec4 uv = vUv; uv.xy += N.xz * 0.4 * uv.w;
          vec3 refl = texture2DProj(tDiffuse, uv).rgb * color;
          float fres = 0.3 + 0.7 * pow(1.0 - max(dot(N, V), 0.0), 3.0);
          vec3 col = mix(deepColor, refl, clamp(fres, 0.0, 1.0));
          col += vec3(1.0, 0.8, 0.62) * pow(max(dot(N, normalize(sunDir + V)), 0.0), 350.0) * 1.4;
          col += vec3(0.9, 0.85, 1.0) * clamp(length(n2) - 0.03, 0.0, 0.25) * 0.5;
          // light & shadow on the ripple rings so they read on any reflection
          float ring = dot(rippleN, vec2(0.45, -0.89));
          col += vec3(1.0, 0.9, 0.92) * clamp(ring * 1.0, 0.0, 0.35);
          col *= 1.0 - clamp(-ring * 0.8, 0.0, 0.25);
          col = mix(col, uFogColor, smoothstep(uFogNear, uFogFar, dist) * 0.55);
          gl_FragColor = vec4(col, 1.0);
          #include <colorspace_fragment>
        }`
    },
    color: C('#d9cbe0'),
    textureWidth: Math.round(W * DPR * 0.6), textureHeight: Math.round(H * DPR * 0.6), clipBias: 0.003
  });
  water.rotation.x = -Math.PI / 2;
  scene.add(water);
  // Reflector clones the uniforms it's given — re-link the live ones so ripples, time and fog reach the lake
  Object.assign(water.material.uniforms, rippleU, fogU);

  const underside = new THREE.Mesh(new THREE.PlaneGeometry(900, 900), new THREE.ShaderMaterial({
    uniforms: { ...rippleU, ...fogU },
    vertexShader: `varying vec3 vWorld; void main(){ vec4 wp = modelMatrix * vec4(position,1.0); vWorld = wp.xyz; gl_Position = projectionMatrix * viewMatrix * wp; }`,
    fragmentShader: `
      ${RIPPLE_GLSL}
      ${FOG_GLSL}
      varying vec3 vWorld;
      void main(){
        vec2 n2 = waveNormal(vWorld.xz);
        vec3 V = normalize(cameraPosition - vWorld);
        float snell = smoothstep(0.45, 0.9, -V.y + n2.x * 2.0);
        vec3 col = mix(vec3(0.16, 0.11, 0.26), vec3(1.0, 0.8, 0.72), snell);      // the sunset seen through the surface
        col += (n2.x + n2.y) * 1.6;
        col = applyFog(col, length(cameraPosition - vWorld));
        gl_FragColor = vec4(col, 1.0);
        #include <colorspace_fragment>
      }`
  }));
  underside.rotation.x = Math.PI / 2;
  underside.position.y = -0.002;
  scene.add(underside);

  /* =========================================================
     UNDERWATER — seabed, rocks, seaweed, light shafts, koi, bubbles
     ========================================================= */
  const under = new THREE.Group();
  scene.add(under);
  {
    const g = new THREE.PlaneGeometry(220, 220, 110, 110);
    g.rotateX(-Math.PI / 2); g.translate(0, 0, -30);
    const pos = g.attributes.position, cols = [];
    const sandA = C('#3d3150'), sandB = C('#8a6a80'), tmp = new THREE.Color();
    for (let i = 0; i < pos.count; i++) {
      const y = seabedY(pos.getX(i), pos.getZ(i));
      pos.setY(i, y);
      tmp.copy(sandA).lerp(sandB, clamp((y - SEA_Y + 1.5) / 3, 0, 1));
      cols.push(tmp.r, tmp.g, tmp.b);
    }
    g.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
    g.computeVertexNormals();
    const bedMat = new THREE.MeshLambertMaterial({ vertexColors: true });
    bedMat.onBeforeCompile = sh => {
      sh.uniforms.time = rippleU.time;
      sh.vertexShader = 'varying vec3 vWp;\n' + sh.vertexShader.replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\n  vWp = (modelMatrix * vec4(transformed, 1.0)).xyz;');
      sh.fragmentShader = 'uniform float time;\nvarying vec3 vWp;\n' + sh.fragmentShader.replace('#include <dithering_fragment>', `#include <dithering_fragment>
        vec2 q = vWp.xz * 0.85;
        float a = sin(q.x + time * 0.7 + sin(q.y * 1.3 + time * 0.5) * 1.4);
        float b = sin(q.y * 1.1 - time * 0.6 + sin(q.x * 0.9 - time * 0.4) * 1.4);
        float caus = pow(0.5 + 0.25 * (a + b), 5.0);
        gl_FragColor.rgb += vec3(1.0, 0.72, 0.68) * caus * 0.55;`);
    };
    under.add(new THREE.Mesh(g, bedMat));

    const rockMat = new THREE.MeshLambertMaterial({ color: '#3a3150', flatShading: true });
    const r = mulberry(55);
    for (let i = 0; i < 26; i++) {
      const x = -18 + r() * 36, z = -26 + r() * 30, s = 0.4 + r() * 1.6;
      const m = new THREE.Mesh(new THREE.IcosahedronGeometry(1, 0), rockMat);
      m.scale.set(s * (1 + r()), s * 0.7, s); m.rotation.set(r(), r() * 6, r());
      m.position.set(x, seabedY(x, z) + s * 0.2, z);
      under.add(m);
    }
  }

  // seaweed — instanced ribbons swaying in the current, bending away from the cursor
  const cursorW = new V3(0, -100, 0);
  const weedMat = new THREE.ShaderMaterial({
    side: THREE.DoubleSide,
    uniforms: { time: rippleU.time, uCursor: { value: cursorW }, ...fogU },
    vertexShader: `
      uniform float time; uniform vec3 uCursor;
      varying float vH; varying vec3 vW;
      void main(){
        vec4 base = modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
        vec4 wp = modelMatrix * instanceMatrix * vec4(position, 1.0);
        float k = uv.y, k2 = k * k;
        float ph = base.x * 0.7 + base.z * 0.5;
        wp.x += sin(time * 1.1 + ph) * 0.5 * k2;
        wp.z += cos(time * 0.8 + ph * 1.3) * 0.35 * k2;
        vec3 d = wp.xyz - uCursor; d.y *= 0.5;
        float push = max(0.0, 2.2 - length(d)) / 2.2;
        wp.xz += normalize(d.xz + 1e-4) * push * 1.4 * k2;
        vH = k; vW = wp.xyz;
        gl_Position = projectionMatrix * viewMatrix * wp;
      }`,
    fragmentShader: `
      ${FOG_GLSL}
      varying float vH; varying vec3 vW;
      void main(){
        vec3 c = mix(vec3(0.08, 0.06, 0.14), vec3(0.42, 0.5, 0.42), vH);
        gl_FragColor = vec4(applyFog(c, length(cameraPosition - vW)), 1.0);
        #include <colorspace_fragment>
      }`
  });
  {
    const g = new THREE.PlaneGeometry(0.2, 1, 1, 10); g.translate(0, 0.5, 0);
    const n = mobile ? 180 : 320, weeds = new THREE.InstancedMesh(g, weedMat, n);
    const r = mulberry(13), d = new THREE.Object3D();
    for (let i = 0; i < n; i++) {
      const x = -20 + r() * 40, z = -24 + r() * 32;
      d.position.set(x, seabedY(x, z) - 0.1, z);
      d.rotation.set(0, r() * 6, 0);
      d.scale.set(0.7 + r() * 0.8, 1.6 + r() * 4.2, 1);
      d.updateMatrix(); weeds.setMatrixAt(i, d.matrix);
    }
    weeds.frustumCulled = false;
    under.add(weeds);
  }

  // sunken stone lanterns glowing on the lake bed (echo the lanterns above)
  {
    const glowTex = radialTex([[0, 'rgba(255,190,120,.7)'], [0.4, 'rgba(255,150,110,.18)'], [1, 'rgba(255,150,110,0)']]);
    const stone = new THREE.MeshLambertMaterial({ color: '#4a4058', flatShading: true });
    [[-4.5, -3.2, 0.3], [5.2, -6.5, -0.4], [-1.2, -9.5, 0.9]].forEach(([x, z, tilt]) => {
      const tr = new THREE.Group();
      [[new THREE.CylinderGeometry(0.3, 0.38, 0.14, 6), 0.07], [new THREE.CylinderGeometry(0.11, 0.13, 0.7, 8), 0.49],
       [new THREE.CylinderGeometry(0.27, 0.18, 0.12, 6), 0.88], [new THREE.ConeGeometry(0.45, 0.26, 6), 1.3]].forEach(([geo, y]) => {
        const o = new THREE.Mesh(geo, stone); o.position.y = y; tr.add(o);
      });
      const fire = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.26, 0.3), new THREE.MeshBasicMaterial({ color: '#ffc27a' })); fire.position.y = 1.07; tr.add(fire);
      const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }));
      halo.scale.setScalar(3.2); halo.position.y = 1.07; tr.add(halo);
      tr.position.set(x, seabedY(x, z) - 0.05, z); tr.rotation.set(tilt * 0.3, tilt, tilt * 0.2);
      under.add(tr);
    });
  }

  // sakura petals drifting down through the water
  const UPN = mobile ? 60 : 120;
  const upetals = new THREE.InstancedMesh(new THREE.CircleGeometry(0.05, 6), new THREE.MeshBasicMaterial({ color: '#f6bccb', side: THREE.DoubleSide, transparent: true, opacity: 0.85 }), UPN);
  upetals.frustumCulled = false;
  const UP = [];
  for (let i = 0; i < UPN; i++) UP.push({ x: rand(-10, 10), y: rand(-8, -0.3), z: rand(-12, 5), s: rand(0.6, 1.4), ph: rand(0, 6), sp: rand(0.12, 0.3) });
  under.add(upetals);

  // light shafts from the surface
  const shafts = [];
  {
    const t = canvasTex(64, 256, (x, w, h) => {
      const g = x.createLinearGradient(0, 0, 0, h);
      g.addColorStop(0, 'rgba(255,255,255,.9)'); g.addColorStop(1, 'rgba(255,255,255,0)');
      x.fillStyle = g; x.fillRect(0, 0, w, h);
      const e = x.createLinearGradient(0, 0, w, 0);
      e.addColorStop(0, 'rgba(0,0,0,1)'); e.addColorStop(0.5, 'rgba(0,0,0,0)'); e.addColorStop(1, 'rgba(0,0,0,1)');
      x.globalCompositeOperation = 'destination-out'; x.fillStyle = e; x.fillRect(0, 0, w, h);
    });
    const r = mulberry(17);
    for (let i = 0; i < 12; i++) {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(1.2 + r() * 2.2, 13), new THREE.MeshBasicMaterial({
        map: t, color: '#ffd0bc', transparent: true, opacity: 0.12 + r() * 0.12, blending: THREE.AdditiveBlending, depthWrite: false, fog: false
      }));
      m.position.set(-14 + r() * 28, -6.3, -16 + r() * 20);
      m.userData.ph = r() * 6;
      under.add(m); shafts.push(m);
    }
  }

  // koi — a wiggling body + fins, patterned per fish
  const koi = [];
  {
    const body = new THREE.SphereGeometry(0.5, 24, 14); body.scale(0.34, 0.3, 1.0);
    const ts = new THREE.Shape(); ts.moveTo(0.4, 0); ts.quadraticCurveTo(0.6, 0.12, 0.9, 0.28); ts.lineTo(0.78, 0); ts.lineTo(0.9, -0.28); ts.quadraticCurveTo(0.6, -0.12, 0.4, 0);
    const tail = new THREE.ShapeGeometry(ts); tail.rotateY(Math.PI / 2);
    const fin = new THREE.ShapeGeometry(new THREE.Shape().absellipse(0, 0, 0.16, 0.07, 0, Math.PI * 2));
    fin.rotateX(-Math.PI / 2);
    const finL = fin.clone(); finL.rotateY(0.6); finL.translate(0.2, -0.06, 0.18);
    const finR = fin.clone(); finR.rotateY(-0.6); finR.translate(-0.2, -0.06, 0.18);
    const geo = mergeGeometries([body.toNonIndexed(), tail.toNonIndexed(), finL.toNonIndexed(), finR.toNonIndexed()]);
    const PAL = [['#f4efe6', '#e5532b'], ['#f6c65e', '#e89a25'], ['#f4efe6', '#1e1d22', '#d6402a'], ['#e5532b', '#f4efe6'], ['#f4efe6', '#e5532b'], ['#ece7dc', '#2a2a30']];
    const r = mulberry(99);
    for (let i = 0; i < (mobile ? 4 : 7); i++) {
      const pal = PAL[i % PAL.length];
      const map = canvasTex(128, 64, (x, w, h) => {
        x.fillStyle = pal[0]; x.fillRect(0, 0, w, h);
        for (let k = 0; k < 7; k++) {
          x.fillStyle = pal[1 + (k % (pal.length - 1))];
          x.beginPath(); x.ellipse(r() * w, r() * h, 8 + r() * 22, 6 + r() * 14, r() * 3, 0, 6.283); x.fill();
        }
      });
      const mat = new THREE.ShaderMaterial({
        side: THREE.DoubleSide,
        uniforms: { map: { value: map }, phase: { value: 0 }, ...fogU },
        vertexShader: `
          uniform float phase; varying vec2 vUv; varying float vShade; varying vec3 vW;
          void main(){
            vec3 p = position;
            float t = clamp((0.5 - p.z) / 1.4, 0.0, 1.0);
            p.x += sin(phase - p.z * 4.0) * 0.18 * t * t;
            vec3 n = normalize(mat3(modelMatrix) * normal);
            vShade = 0.55 + 0.5 * max(n.y, 0.0);
            vUv = uv; vec4 wp = modelMatrix * vec4(p, 1.0); vW = wp.xyz;
            gl_Position = projectionMatrix * viewMatrix * wp;
          }`,
        fragmentShader: `
          uniform sampler2D map; ${FOG_GLSL}
          varying vec2 vUv; varying float vShade; varying vec3 vW;
          void main(){
            vec3 c = texture2D(map, vUv).rgb * vShade;
            gl_FragColor = vec4(applyFog(c, length(cameraPosition - vW)), 1.0);
            #include <colorspace_fragment>
          }`
      });
      const m = new THREE.Mesh(geo, mat);
      const s = 0.7 + r() * 0.5;
      m.scale.setScalar(s);
      m.userData = {
        pos: new V3(-6 + r() * 12, -2.5 - r() * 5, -6 + r() * 9), dir: new V3(r() - 0.5, 0, r() - 0.5).normalize(),
        target: new V3(), retarget: 0, speed: 0.6 + r() * 0.4, v: 0.7, ph: r() * 6
      };
      under.add(m); koi.push(m);
    }
  }

  // bubbles
  const BN = mobile ? 90 : 160;
  const bubbles = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 10, 8), new THREE.MeshBasicMaterial({ color: '#f8e4ee', transparent: true, opacity: 0.4, depthWrite: false }), BN);
  bubbles.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  bubbles.frustumCulled = false;
  under.add(bubbles);
  const B = [];
  let bubbleCursor = 0;
  for (let i = 0; i < BN; i++) B.push(resetBubble({}, true));
  function resetBubble(b, anywhere) {
    b.x = rand(-12, 12); b.z = rand(-14, 2.5);
    b.y = anywhere ? rand(SEA_Y, -0.5) : seabedY(b.x, b.z);
    b.r = rand(0.02, 0.07); b.vy = rand(0.5, 1.2); b.ph = rand(0, 6);
    return b;
  }
  function emitBubbles(p, n, spread = 0.3) {
    for (let i = 0; i < n; i++) {
      const b = B[bubbleCursor]; bubbleCursor = (bubbleCursor + 1) % BN;
      b.x = p.x + rand(-spread, spread); b.y = p.y + rand(-spread, spread); b.z = p.z + rand(-spread, spread);
      b.r = rand(0.02, 0.09); b.vy = rand(0.8, 1.8);
    }
  }

  /* =========================================================
     SAKURA petals (above the water)
     ========================================================= */
  const PN = reduceMotion ? 40 : (mobile ? 90 : 160);
  const ps = new THREE.Shape();
  ps.moveTo(0, -1); ps.bezierCurveTo(0.9, -0.6, 0.8, 0.6, 0.15, 1); ps.lineTo(0, 0.82); ps.lineTo(-0.15, 1);
  ps.bezierCurveTo(-0.8, 0.6, -0.9, -0.6, 0, -1);
  const petalGeo = new THREE.ShapeGeometry(ps); petalGeo.scale(0.055, 0.055, 0.055);
  const petals = new THREE.InstancedMesh(petalGeo, new THREE.MeshBasicMaterial({ color: '#ffffff', side: THREE.DoubleSide }), PN);
  petals.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  petals.frustumCulled = false;
  const PCOL = ['#f6c1cc', '#f9d4dc', '#f2a9b9', '#fbe3e8'].map(C);
  const P = [];
  for (let i = 0; i < PN; i++) { petals.setColorAt(i, PCOL[i % PCOL.length]); P.push(spawnPetal({}, true)); }
  scene.add(petals);
  function spawnPetal(p, anywhere) {
    p.x = rand(-12, 14); p.z = rand(-16, 7); p.y = anywhere ? rand(0.2, 9) : rand(7, 10);
    p.vy = -rand(0.35, 0.65); p.seed = rand(0, 100);
    p.rx = rand(0, 6); p.ry = rand(0, 6); p.rz = rand(0, 6);
    p.sx = rand(-2, 2); p.sy = rand(-2, 2); p.sz = rand(-2, 2);
    p.landed = false; p.life = 0; p.scale = rand(0.7, 1.3);
    return p;
  }

  /* =========================================================
     INTERACTIVE PROPS on the lake
     ========================================================= */
  // soft light that follows the cursor across the water
  const cursorGlowMat = new THREE.MeshBasicMaterial({
    map: radialTex([[0, 'rgba(255,240,220,.7)'], [0.35, 'rgba(255,215,185,.22)'], [1, 'rgba(255,215,185,0)']]),
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0
  });
  const cursorGlow = new THREE.Mesh(new THREE.PlaneGeometry(2.2, 2.2).rotateX(-Math.PI / 2), cursorGlowMat);
  cursorGlow.position.y = 0.03;
  scene.add(cursorGlow);
  let hoverPoint = null;

  // floating paper lanterns (tōrō nagashi) — push them around, click to launch more
  const lanternTex = canvasTex(64, 64, (x, w, h) => {
    const g = x.createRadialGradient(32, 38, 4, 32, 32, 42);
    g.addColorStop(0, '#fff7e0'); g.addColorStop(1, '#ffae55');
    x.fillStyle = g; x.fillRect(0, 0, w, h);
    x.strokeStyle = '#4a2c1e'; x.lineWidth = 5; x.strokeRect(2, 2, 60, 60);
    x.lineWidth = 2; x.beginPath(); x.moveTo(32, 2); x.lineTo(32, 62); x.moveTo(2, 32); x.lineTo(62, 32); x.stroke();
  });
  const lanternBoxGeo = new THREE.BoxGeometry(0.2, 0.22, 0.2);
  const lanternBoxMat = new THREE.MeshBasicMaterial({ map: lanternTex });
  const lanternRoofGeo = new THREE.ConeGeometry(0.19, 0.08, 4); lanternRoofGeo.rotateY(Math.PI / 4);
  const lanternBaseGeo = new THREE.BoxGeometry(0.27, 0.04, 0.27);
  const lanternGlowMat = new THREE.MeshBasicMaterial({
    map: radialTex([[0, 'rgba(255,190,110,.75)'], [1, 'rgba(255,190,110,0)']]),
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending
  });
  const lanternGlowGeo = new THREE.PlaneGeometry(1.5, 1.5).rotateX(-Math.PI / 2);
  const lanterns = [];
  function addLantern(x, z, launched) {
    const g = new THREE.Group();
    const box = new THREE.Mesh(lanternBoxGeo, lanternBoxMat); box.position.y = 0.15;
    const roof = new THREE.Mesh(lanternRoofGeo, wood); roof.position.y = 0.3;
    const base = new THREE.Mesh(lanternBaseGeo, wood); base.position.y = 0.03;
    const gl = new THREE.Mesh(lanternGlowGeo, lanternGlowMat); gl.position.y = 0.02;
    g.add(box, roof, base, gl);
    g.position.set(x, 0, z); g.rotation.y = rand(0, 6);
    g.userData = { vx: launched ? rand(-0.2, 0.2) : rand(0.04, 0.12), vz: launched ? rand(-0.35, -0.15) : rand(-0.04, 0.04), ph: rand(0, 6), grow: launched ? 0 : 1 };
    g.scale.setScalar(launched ? 0.01 : 1);
    scene.add(g); lanterns.push(g);
    if (lanterns.length > 18) scene.remove(lanterns.shift());
  }
  [[-6, -2], [-3.5, 2.5], [-1.5, -6], [4, 1.5], [6.5, -3], [9, -7], [-8.5, -9], [2.2, 4.5]].forEach(([x, z]) => addLantern(x, z, false));
  const houseXZ = new THREE.Vector2(house.position.x, house.position.z);
  function updateLanterns(dt, t) {
    for (const g of lanterns) {
      const u = g.userData;
      if (u.grow < 1) { u.grow = Math.min(1, u.grow + dt * 2.5); g.scale.setScalar(easeInOut(u.grow)); }
      if (hoverPoint) {
        const dx = g.position.x - hoverPoint.x, dz = g.position.z - hoverPoint.z, d = Math.hypot(dx, dz);
        if (d < 1.4 && d > 0.001) { const f = (1.4 - d) * 2.4 * dt; u.vx += dx / d * f; u.vz += dz / d * f; }
      }
      // keep clear of the house
      const hx = g.position.x - houseXZ.x, hz = g.position.z - houseXZ.y, hd = Math.hypot(hx, hz);
      if (hd < 2.1) { u.vx += hx / hd * dt * 1.5; u.vz += hz / hd * dt * 1.5; }
      const sp = Math.hypot(u.vx, u.vz);
      const damp = sp > 0.12 ? 1 - dt * 0.9 : 1;
      u.vx = u.vx * damp + 0.03 * dt; u.vz *= damp;
      g.position.x += u.vx * dt; g.position.z += u.vz * dt;
      g.position.y = Math.sin(t * 1.6 + u.ph) * 0.018;
      g.rotation.x = Math.sin(t * 1.3 + u.ph) * 0.06; g.rotation.z = Math.cos(t * 1.1 + u.ph) * 0.06;
      if (sp > 0.15 && Math.random() < dt * 12) queueDrop(g.position.x, g.position.z, 0.008, 0.12);
      if (g.position.x > 16) g.position.x = -16;
      if (g.position.z < -17) g.position.z = 7;
      if (g.position.z > 8) u.vz -= dt;
    }
  }

  // a koi that leaps out of the water when you click
  const jumper = new THREE.Mesh(koi[0].geometry, koi[0].material.clone());
  jumper.material.uniforms.uFogNear.value = 40; jumper.material.uniforms.uFogFar.value = 400;
  jumper.visible = false; jumper.scale.setScalar(0.9);
  scene.add(jumper);
  let leap = null;
  function startLeap(p) {
    if (leap) return;
    const a = rand(0, Math.PI * 2), dir = new V3(Math.cos(a), 0, Math.sin(a));
    leap = { from: p.clone().addScaledVector(dir, -1.0), to: p.clone().addScaledVector(dir, 1.0), k: 0, ph: 0 };
    queueDrop(leap.from.x, leap.from.z, 0.022, 0.9);
    jumper.visible = true;
  }
  function updateLeap(dt) {
    if (!leap) return;
    leap.k += dt / 1.15; leap.ph += dt * 14;
    const k = Math.min(1, leap.k);
    const pos = leap.from.clone().lerp(leap.to, k); pos.y = Math.sin(k * Math.PI) * 1.35 - 0.25;
    const k2 = Math.min(1, k + 0.02);
    const next = leap.from.clone().lerp(leap.to, k2); next.y = Math.sin(k2 * Math.PI) * 1.35 - 0.25;
    jumper.position.copy(pos);
    if (next.distanceToSquared(pos) > 1e-8) jumper.lookAt(next);
    jumper.material.uniforms.phase.value = leap.ph;
    if (k >= 1) {
      queueDrop(leap.to.x, leap.to.z, 0.026, 1.1);
      jumper.visible = false; leap = null;
    }
  }

  // hovering the house / torii (they're clickable)
  let hovered = null;
  // on the right island, on the open ground in front of its sakura trees
  { const dx = 13.0, dz = -11.8; duelGroup.position.set(dx, Math.max(0, islandHeight(dx, dz)) - 0.03, dz); }
  duelGroup.scale.setScalar(0.5);
  scene.add(duelGroup);
  const pickables = [house, volcano, duelGroup];
  function pick() {
    const hits = raycaster.intersectObjects(pickables, true);
    for (const h of hits) {
      if (h.point.y < 0) continue;
      let o = h.object;
      while (o && o !== samurai && o !== house && o !== torii && o !== volcano && o !== duelGroup) o = o.parent;
      return o === samurai ? 'samurai' : o === house ? 'house' : o === torii ? 'torii' : o === volcano ? 'mountain' : o === duelGroup ? 'duel' : null;
    }
    return null;
  }
  function setHovered(v) {
    if (v === hovered) return;
    hovered = v;
    onHover(!!v);
  }

  /* =========================================================
     Camera — poses, spline travel, parallax
     ========================================================= */
  const scrollK = { projects: 0, about: 0 };
  const portrait = () => W / H < 0.9;
  const pose = (pos, target, fov, par) => ({ pos, target, fov, par });
  const POSE = {
    home: () => pose(new V3(portrait() ? 0.9 : 0, 1.7, portrait() ? 11.5 : 10.5), new V3(portrait() ? 1.5 : 0.6, 1.9, -4), portrait() ? 62 : 45, 1),
    projects: () => {
      const k = scrollK.projects;
      return pose(new V3(0, -2.2 - k * 4.8, 6.5 - k * 1.5), new V3(0.3, -3.4 - k * 5.2, -4), portrait() ? 72 : 58, 0.7);
    },
    about: () => {
      const k = scrollK.about;
      return pose(new V3(0, 40 + k * 5, 14), new V3(0, 47 + k * 4, -30), portrait() ? 70 : 55, 0.9);
    },
    contact: () => pose(H2W(0.28, 1.25, 0.5), H2W(-0.18, 1.2, -0.68), portrait() ? 80 : 64, 0.12),
    doorOut: () => pose(H2W(0, 1.25, 2.3), H2W(0, 1.22, 0), portrait() ? 70 : 55, 0.3),
    surface: () => pose(new V3(0.1, 0.9, 7.8), new V3(0.4, -1.2, 0), 52, 0.6),
    below: () => pose(new V3(0.15, -1.1, 7.2), new V3(0.3, -2.4, -2), 56, 0.6),
    clouds: () => pose(new V3(0, 16, 12.5), new V3(0.3, 26, -14), 52, 0.8),
    toMountain: () => pose(new V3(-14, 17, -48), new V3(-36, 30, -116), 50, 0.3),   // arc up over the lake
    ski: () => pose(new V3(-29, 33.5, -97), new V3(-38, 31, -118), 46, 0),
    samuraiFace: () => { const { eye, fwd } = eyeFrame(); return pose(eye.clone().addScaledVector(fwd, 0.45).add(new V3(0, 0.04, 0)), eye.clone(), 40, 0.05); },
    gallery: () => { const { eye, fwd } = eyeFrame(); return pose(eye.clone().addScaledVector(fwd, 0.022), eye.clone().addScaledVector(fwd, -0.3), 18, 0); }
  };
  function eyeFrame() {
    samurai.updateMatrixWorld(true);
    const eye = samurai.localToWorld(EYE_LOCAL.clone());
    const fwd = new V3(0, 0, 1).applyQuaternion(samurai.getWorldQuaternion(new THREE.Quaternion())).normalize();
    return { eye, fwd };
  }
  const ROUTE = { projects: ['surface', 'below', 'projects'], about: ['clouds', 'about'], contact: ['doorOut', 'contact'], gallery: ['doorOut', 'contact', 'samuraiFace', 'gallery'], ski: ['toMountain', 'ski'] };

  let page = initialPage;
  const cam = POSE[page]();
  let travel = null;
  const currentPose = () => pose(cam.pos.clone(), cam.target.clone(), cam.fov, cam.par);

  function routeNames(from, to) {
    const a = ['home', ...(ROUTE[from] || [])], b = ['home', ...(ROUTE[to] || [])];
    let k = 0;
    while (k < a.length && k < b.length && a[k] === b[k]) k++;
    return [...a.slice(k - 1, a.length - 1).reverse(), ...b.slice(k)];
  }
  function travelTime(from, to) {
    if (from === to) return 0;
    if (reduceMotion) return 600;
    const legs = routeNames(from, to).length;
    return clamp(900 + legs * 430 + (to === 'gallery' || from === 'gallery' ? 500 : 0), 1600, 3800);
  }
  function startTravel(from, to, ms) {
    if (to === 'gallery' || from === 'gallery') { samuraiHead.rotation.set(0, 0, 0); }
    const poses = [currentPose(), ...routeNames(from, to).map(n => POSE[n]())];
    const posCurve = new THREE.CatmullRomCurve3(poses.map(p => p.pos), false, 'centripetal');
    const tgtCurve = new THREE.CatmullRomCurve3(poses.map(p => p.target), false, 'centripetal');
    page = to;
    return new Promise(resolve => {
      travel = { poses, posCurve, tgtCurve, t0: performance.now(), ms: Math.max(1, ms), resolve, toGallery: to === 'gallery', toSki: to === 'ski' || from === 'ski' };
    });
  }
  function stepCamera(dt, now) {
    if (travel) {
      const k = clamp((now - travel.t0) / travel.ms, 0, 1), e = easeInOut(k);
      travel.posCurve.getPointAt(e, cam.pos);
      travel.tgtCurve.getPointAt(e, cam.target);
      const f = e * (travel.poses.length - 1), i = Math.min(Math.floor(f), travel.poses.length - 2), fr = f - i;
      cam.fov = lerp(travel.poses[i].fov, travel.poses[i + 1].fov, fr);
      cam.par = lerp(travel.poses[i].par, travel.poses[i + 1].par, fr);
      if (k >= 1) { const r = travel.resolve; travel = null; r(); }
    } else {
      const goal = POSE[page](), a = 1 - Math.exp(-dt * 4);
      cam.pos.lerp(goal.pos, a); cam.target.lerp(goal.target, a);
      cam.fov = lerp(cam.fov, goal.fov, a); cam.par = lerp(cam.par, goal.par, a);
    }
  }

  /* =========================================================
     Pointer
     ========================================================= */
  const raycaster = new THREE.Raycaster();
  const plane = new THREE.Plane(new V3(0, 1, 0), 0);
  const ndc = new THREE.Vector2(), hit = new V3();
  const mouse = { x: 0, y: 0, sx: 0, sy: 0, active: false };
  let lastHit = null;
  function setRay(x, y) {
    ndc.set((x / W) * 2 - 1, -(y / H) * 2 + 1);
    raycaster.setFromCamera(ndc, camera);
  }
  function waterHit(x, y) {
    setRay(x, y);
    if (camera.position.y <= 0.05) return null;
    return raycaster.ray.intersectPlane(plane, hit) ? hit.clone() : null;
  }

  /* =========================================================
     Per-frame world updates
     ========================================================= */
  const dummy = new THREE.Object3D();
  let updraft = 0, prevCamY = cam.pos.y, doorOpen = page === 'contact' ? 1 : 0, simTick = 0;
  const tmpC = new THREE.Color();

  const lastRay = new THREE.Ray();
  const _eyeW = new V3();
  let lastRayAt = -1e9;
  const _cp = new V3(), _pp = new V3();
  function updatePetals(dt, t) {
    const windOn = page === 'home' && performance.now() - lastRayAt < 400;
    if (updraft > 0) updraft -= dt;
    for (let i = 0; i < PN; i++) {
      const p = P[i];
      if (p.landed) {
        p.x += 0.12 * dt; p.life -= dt;
        if (p.life <= 0 || updraft > 0) spawnPetal(p, false);
      } else {
        if (updraft > 0) p.vy += (6 - p.vy) * dt * 2.5;
        else p.vy += (-0.5 - p.vy) * dt * 1.5;
        p.x += (Math.sin(t * 0.7 + p.seed) * 0.35 + 0.25) * dt;
        p.z += Math.cos(t * 0.5 + p.seed) * 0.15 * dt;
        p.y += p.vy * dt;
        if (windOn) {
          _pp.set(p.x, p.y, p.z);
          lastRay.closestPointToPoint(_pp, _cp);
          const d = _cp.distanceTo(_pp);
          if (d < 1.1 && d > 1e-4) {
            _pp.sub(_cp).multiplyScalar((1.1 - d) / d * dt * 7);
            p.x += _pp.x; p.y += _pp.y; p.z += _pp.z;
            p.sx += (Math.random() - 0.5) * 2; p.sz += (Math.random() - 0.5) * 2;
          }
        }
        p.rx += p.sx * dt; p.ry += p.sy * dt; p.rz += p.sz * dt;
        if (p.y <= 0.012 && updraft <= 0) {
          p.landed = true; p.y = 0.012; p.life = rand(4, 9); p.rx = -Math.PI / 2; p.ry = 0;
          queueDrop(p.x, p.z, 0.006, 0.05);
        }
        if (p.y > 30) spawnPetal(p, false);
      }
      dummy.position.set(p.x, p.y, p.z);
      dummy.rotation.set(p.rx, p.ry, p.rz);
      dummy.scale.setScalar(p.landed ? p.scale * Math.min(1, p.life) : p.scale);
      dummy.updateMatrix();
      petals.setMatrixAt(i, dummy.matrix);
    }
    petals.instanceMatrix.needsUpdate = true;
  }

  function updateUnderwater(dt, t) {
    for (const s of shafts) {
      s.rotation.y = Math.atan2(camera.position.x - s.position.x, camera.position.z - s.position.z);
      s.rotation.z = 0.12 + Math.sin(t * 0.3 + s.userData.ph) * 0.04;
    }
    if (!reduceMotion && Math.random() < dt * 8) {
      const b = B[bubbleCursor]; bubbleCursor = (bubbleCursor + 1) % BN; resetBubble(b, false);
    }
    for (let i = 0; i < BN; i++) {
      const b = B[i];
      b.y += b.vy * dt; b.vy += (0.9 - b.vy) * dt * 0.5;
      b.x += Math.sin(t * 2.2 + b.ph) * 0.12 * dt;
      if (b.y > -0.06) resetBubble(b, false);
      dummy.position.set(b.x, b.y, b.z); dummy.rotation.set(0, 0, 0); dummy.scale.setScalar(b.r);
      dummy.updateMatrix(); bubbles.setMatrixAt(i, dummy.matrix);
    }
    bubbles.instanceMatrix.needsUpdate = true;
    for (let i = 0; i < UPN; i++) {
      const p = UP[i];
      p.y -= p.sp * dt; p.x += Math.sin(t * 0.6 + p.ph) * 0.15 * dt; p.z += Math.cos(t * 0.5 + p.ph) * 0.1 * dt;
      if (p.y < seabedY(p.x, p.z) + 0.05) { p.y = -0.3; p.x = rand(-10, 10); p.z = rand(-12, 5); }
      dummy.position.set(p.x, p.y, p.z); dummy.rotation.set(t * 0.8 + p.ph, t * 0.5 + p.ph * 2, 0); dummy.scale.set(p.s, p.s * 0.7, 1);
      dummy.updateMatrix(); upetals.setMatrixAt(i, dummy.matrix);
    }
    upetals.instanceMatrix.needsUpdate = true;

    for (const k of koi) {
      const u = k.userData;
      u.retarget -= dt;
      if (u.retarget <= 0 || u.pos.distanceTo(u.target) < 0.6) {
        u.target.set(rand(-7, 7), rand(-1.6, -8), rand(-8, 3.5)); u.retarget = rand(4, 8);
      }
      const desired = u.target.clone().sub(u.pos).normalize();
      let boost = 1;
      const away = u.pos.clone().sub(cursorW), d = away.length();
      if (d < 2.6) { desired.copy(away.normalize()); boost = 1 + (2.6 - d) * 1.6; }
      u.dir.lerp(desired, Math.min(1, dt * (boost > 1 ? 5 : 1.1))).normalize();
      u.dir.y = clamp(u.dir.y, -0.5, 0.5); u.dir.normalize();
      u.v = lerp(u.v, u.speed * boost, Math.min(1, dt * 2));
      u.pos.addScaledVector(u.dir, u.v * dt);
      u.pos.y = clamp(u.pos.y, -8.2, -0.8);
      u.ph += dt * (5 + u.v * 6);
      k.position.copy(u.pos);
      k.lookAt(u.pos.clone().add(u.dir));
      k.material.uniforms.phase.value = u.ph;
    }
  }

  function updateSky(dt, t, night) {
    starMat.opacity = 0.35 + night * 0.65;
    sunMat.opacity = 1 - night; sun.visible = night < 0.99; streakMat.opacity = 0.55 * (1 - night);
    domeCloudMat.opacity = 1 - night;
    moonMat.opacity = night; moonGlowMat.opacity = night;
    skyMat.uniforms.night.value = night;
    cloudMat.color.set('#f2c7c4').lerp(tmpC.set('#7b80b8'), night);
    cloudMat.opacity = 0.75 - night * 0.25;
    for (const c of clouds) {
      const u = c.userData;
      u.home.x += u.speed * dt;
      if (u.home.x > 140) u.home.x -= 280;
      u.push.multiplyScalar(1 - Math.min(1, dt * 1.5));
      c.position.copy(u.home).add(u.push);
    }
    const a = t * 0.05;
    cranes.forEach((g, i) => {
      const u = g.userData;
      const cx = Math.sin(a) * 32, cz = -42 + Math.cos(a) * 22;
      const dir = new V3(Math.cos(a) * 32, 0, -Math.sin(a) * 22).normalize();
      const side = new V3(-dir.z, 0, dir.x);
      g.position.set(cx, 50 + u.off.y, cz).addScaledVector(side, u.off.x).addScaledVector(dir, -u.off.z);
      g.lookAt(g.position.clone().sub(dir));
      const f = Math.sin(t * 4 + u.ph) * 0.6;
      u.wl.rotation.z = f; u.wr.rotation.z = -f;
    });
  }

  function updateEnvironment(dt) {
    const cy = camera.position.y;
    const underK = smooth(0.15, -0.35, cy);
    const depth = clamp(-cy / 9, 0, 1);
    const skiing = page === 'ski' || (travel && travel.toSki);
    skiNight = lerp(skiNight, skiing ? 0 : 1, 1 - Math.exp(-dt * 3));
    const night = smooth(6, 34, cy) * skiNight;

    const fogCol = scene.fog.color;
    fogCol.copy(FOG_DUSK).lerp(FOG_NIGHT, night);
    tmpC.copy(FOG_SHALLOW).lerp(FOG_DEEP, depth);
    fogCol.lerp(tmpC, underK);
    scene.fog.near = lerp(28, 0.3, underK);
    scene.fog.far = lerp(lerp(240, 320, night), lerp(30, 17, depth), underK);
    fogU.uFogNear.value = scene.fog.near; fogU.uFogFar.value = scene.fog.far;
    scene.background = underK > 0.5 ? fogCol : null;

    hemi.color.copy(HEMI_SKY).lerp(HEMI_WATER, underK);
    hemi.groundColor.copy(HEMI_GROUND).lerp(HEMI_WATER_G, underK);
    hemi.intensity = lerp(1.25, 1.6, underK) - night * 0.4;
    sunLight.intensity = 1.3 * (1 - underK) * (1 - night * 0.7);

    skyGroup.visible = cy > -0.05;
    water.visible = cy > -0.05;
    underside.visible = cy < 0.05;
    under.visible = cy < 0.6;
    petals.visible = cy > -0.05 && cy < 25;
    mist.forEach(m => { m.visible = cy > 0; });
    cranes.forEach(g => { g.visible = cy > 4; });
    interior.visible = camera.position.distanceTo(doorCenter) < 4;

    // doors slide open as the camera approaches them
    const want = camera.position.distanceTo(doorCenter) < 1.9 ? 1 : 0;
    doorOpen = lerp(doorOpen, want, 1 - Math.exp(-dt * 5));
    doorL.position.x = -0.495 - doorOpen * 0.72;
    doorR.position.x = 0.495 + doorOpen * 0.72;

    // crossing the surface makes a splash
    if ((prevCamY > 0) !== (cy > 0)) {
      queueDrop(camera.position.x, camera.position.z - 1.5, 0.05, 0.9);
      if (cy < 0) emitBubbles(new V3(camera.position.x, -1.2, camera.position.z - 3), 60, 1.6);
    }
    prevCamY = cy;
    return night;
  }

  /* =========================================================
     Public API
     ========================================================= */
  const api = {
    canvas,
    get page() { return page; },
    travelTime,
    travel(from, to, ms) { if (to === 'about') updraft = ms / 1000; return startTravel(from, to, ms); },
    jump(p) { page = p; Object.assign(cam, POSE[p]()); },
    setScroll(p, k) { scrollK[p] = clamp(k, 0, 1); },
    pointer(x, y, speed) {
      mouse.x = (x / W) * 2 - 1; mouse.y = (y / H) * 2 - 1; mouse.active = true;
      if (travel) { lastHit = null; hoverPoint = null; setHovered(null); return; }
      if (page === 'home') {
        const h = waterHit(x, y);
        lastRay.copy(raycaster.ray); lastRayAt = performance.now();
        setHovered(pick());
        if (!h || h.distanceTo(camera.position) > 60) { lastHit = null; hoverPoint = null; return; }
        hoverPoint = h;
        const st = clamp(0.07 + speed * 0.008, 0.07, 0.32);
        if (lastHit) {
          const d = lastHit.distanceTo(h), n = Math.min(10, Math.max(1, Math.ceil(d / 0.18)));
          for (let i = 1; i <= n; i++) {
            const k = i / n;
            queueDrop(lerp(lastHit.x, h.x, k), lerp(lastHit.z, h.z, k), 0.014, st);
          }
        } else queueDrop(h.x, h.z, 0.014, st);
        lastHit = h;
      } else if (page === 'contact') {
        setRay(x, y);
        setHovered(pick() === 'samurai' ? 'samurai' : null);
      } else if (page === 'projects') {
        setRay(x, y);
        raycaster.ray.at(6, cursorW);
        if (speed > 8 && Math.random() < 0.35) emitBubbles(cursorW, 1, 0.1);
      } else if (page === 'about') {
        setRay(x, y);
        const p = new V3();
        for (const c of clouds) {
          const toC = c.position.clone().sub(raycaster.ray.origin);
          const along = toC.dot(raycaster.ray.direction);
          if (along < 0) continue;
          raycaster.ray.at(along, p);
          const off = c.position.clone().sub(p), d = off.length();
          if (d < 14) c.userData.push.addScaledVector(off.normalize(), (14 - d) * 0.02 * Math.min(speed, 40) * 0.1);
        }
      }
    },
    leave() { lastHit = null; hoverPoint = null; mouse.active = false; cursorW.set(0, -100, 0); setHovered(null); },
    click(x, y) {
      if (travel) return;
      if (page === 'contact') {
        setRay(x, y);
        if (pick() === 'samurai') onNavigate('gallery');
        return;
      }
      if (page === 'home') {
        const h = waterHit(x, y);
        const what = pick();
        if (what === 'house' || what === 'samurai') { onNavigate('contact'); return; }
        if (what === 'duel') { if (duel) duel.clashNow(); return; }
        if (what === 'mountain') { onNavigate('ski'); return; }
        if (h && h.distanceTo(camera.position) < 60) {
          queueDrop(h.x, h.z, 0.03, 1.4);
          addLantern(h.x, h.z, true);
          startLeap(h);
        }
      }
      else if (page === 'projects') { setRay(x, y); const p = raycaster.ray.at(6, new V3()); emitBubbles(p, 18, 0.25); }
    },
    resize(w, h) {
      W = w; H = h;
      renderer.setSize(W, H, false);
      water.getRenderTarget().setSize(Math.round(W * DPR * 0.6), Math.round(H * DPR * 0.6));
    },
    render(dt, t) {
      const now = performance.now();
      stepCamera(dt, now);

      // camera with gentle mouse parallax
      if (!mouse.active) { mouse.x *= 0.98; mouse.y *= 0.98; }
      mouse.sx += (mouse.x - mouse.sx) * Math.min(1, dt * 2.5);
      mouse.sy += (mouse.y - mouse.sy) * Math.min(1, dt * 2.5);
      camera.position.set(cam.pos.x + mouse.sx * 1.1 * cam.par, cam.pos.y - mouse.sy * 0.35 * cam.par, cam.pos.z);
      if (page === 'contact' && !travel) camera.position.set(cam.pos.x + mouse.sx * 0.04, cam.pos.y - mouse.sy * 0.02, cam.pos.z);
      camera.lookAt(cam.target);
      const near = camera.position.distanceTo(houseCore) < 3.4 ? 0.005 : 0.05;
      if (camera.fov !== cam.fov || camera.aspect !== W / H || camera.near !== near) {
        camera.fov = cam.fov; camera.aspect = W / H; camera.near = near; camera.updateProjectionMatrix();
      }
      skyGroup.position.copy(camera.position);

      const night = updateEnvironment(dt);

      // lake ripples (only simulated while you can see the surface)
      const cy = camera.position.y;
      if (cy > -6 && cy < 30) {
        if (!reduceMotion && cy > 0 && Math.random() < dt * 0.35) queueDrop(rand(-10, 12), rand(-14, 6), 0.01, 0.14);
        while (dropQueue.length) { const [u, v, r, st] = dropQueue.shift(); simDrop(u, v, r, st); }
        simTick += dt * 60;
        let steps = 0;
        while (simTick >= 1 && steps < 3) { simStep(); simTick -= 1; steps++; }
        if (simTick > 3) simTick = 0;
        simUpload();
      } else dropQueue.length = 0;
      rippleU.time.value = t;

      if (petals.visible) updatePetals(dt, t);
      if (cy > -0.05 && cy < 30) { updateLanterns(dt, t); updateLeap(dt); scenery.update(dt, t); if (duel) duel.update(dt, t); }
      duelGroup.visible = cy > -0.05;
      const glowOn = page === 'home' && !travel && hoverPoint && !hovered;
      if (hoverPoint) cursorGlow.position.set(hoverPoint.x, 0.03, hoverPoint.z);
      cursorGlowMat.opacity = lerp(cursorGlowMat.opacity, glowOn ? 1 : 0, 1 - Math.exp(-dt * 8));
      cursorGlow.visible = cursorGlowMat.opacity > 0.01;
      houseGlow.intensity = lerp(houseGlow.intensity, hovered === 'house' ? 14 : 4, 1 - Math.exp(-dt * 6));
      {
        const still = page !== 'contact' || !!travel;
        const ay = still ? 0 : clamp(mouse.sx * 0.7, -0.6, 0.6), ax = still ? 0 : clamp(mouse.sy * 0.25, -0.2, 0.25);
        const kk = 1 - Math.exp(-dt * (still ? 10 : 4));
        samuraiHead.rotation.y = lerp(samuraiHead.rotation.y, ay, kk);
        samuraiHead.rotation.x = lerp(samuraiHead.rotation.x, ax, kk);
        samuraiProc.position.y = Math.sin(t * 1.4) * 0.0025;     // breathing
        if (updateRoom && interior.visible) updateRoom(dt, t);
        if (furin) { furin.rotation.z = Math.sin(t * 1.7) * 0.12 + Math.sin(t * 4.3) * 0.03; furin.rotation.x = Math.sin(t * 1.3 + 1) * 0.08; }
        updateHeadRig(dt, t);
        if (modelEyes.length) {
          const d = camera.position.distanceTo(modelEyes[0].getWorldPosition(_eyeW));
          const want = lerp(0.2, 0.9, smooth(0.55, 0.035, d)) + (hovered === 'samurai' ? 0.06 : 0);
          irisMat.uniforms.uPupil.value = lerp(irisMat.uniforms.uPupil.value, want, 1 - Math.exp(-dt * 7));
          irisMat.uniforms.uTime.value = t;
          irisMat.uniforms.uGlow.value = lerp(irisMat.uniforms.uGlow.value, hovered === 'samurai' ? 1 : 0.25 + Math.max(0, Math.sin(t * 0.9)) * 0.3, 1 - Math.exp(-dt * 6));
        }
        const glint = hovered === 'samurai' ? 1 : 0.55 + Math.max(0, Math.sin(t * 0.9)) * 0.25;
        eyeMat.color.setRGB(1 * glint + 0.2, 0.78 * glint + 0.1, 0.38 * glint);
      }
      toriiRed.emissive.lerp(tmpC.set(hovered === 'torii' ? '#a8261a' : '#3a0d08'), 1 - Math.exp(-dt * 6));
      if (volcano) volcano.material.emissive.lerp(tmpC.set(hovered === 'mountain' ? '#4a2a48' : '#000000'), 1 - Math.exp(-dt * 6));
      if (under.visible) updateUnderwater(dt, t);
      if (cy > 4) updateSky(dt, t, night);
      else if (night === 0 && skyMat.uniforms.night.value !== 0) updateSky(dt, t, 0);

      renderer.render(scene, camera);
    }
  };

  /* =========================================================
     Detailed models (generated with Hunyuan3D) — listed in
     assets/models/scene-models.json; each replaces its hand-built fallback.
     { "samurai": { "file": "samurai.glb", "height": 0.62, "rotationY": 0 } }
     ========================================================= */

  // Untextured meshes get painted by region (normalized model-space position → material colour).
  const PAINTERS = {
    sakura(nx, h, nz) {
      const r = Math.hypot(nx, nz);
      if (h < 0.4 && r < 0.3) return 'bark';                         // trunk + root flares
      return (Math.sin(nx * 23.0 + h * 17.0) * Math.cos(nz * 19.0 - h * 11.0) > 0.25) ? 'blossomDeep' : 'blossom';
    },
    fighter(nx, h, nz) {
      if (h > 0.9) return 'gold';
      if (h < 0.06) return 'saya';
      if (h < 0.45) return 'indigo';
      return 'lacquer';
    },
    samurai(nx, h, nz) {
      const ax = Math.abs(nx);
      if (h > 0.875) return 'gold';                                      // kuwagata crest
      if (h > 0.8) return (ax < 0.08 && nz > 0.4 && h < 0.83) ? 'gold' : 'lacquer';   // kabuto (+ front emblem)
      if (h > 0.69) {
        if (ax < 0.13 && nz > 0.05) return h > 0.765 ? 'skin' : 'mask';  // eyes band / menpō
        return 'lacquer';                                                // fukigaeshi + neck guard
      }
      if (h > 0.43) {
        if (h > 0.64 && ax < 0.1) return 'collar';                       // kimono collar
        if (ax > 0.36) return (h < 0.5 && ax > 0.4) ? 'cord' : 'lacquer'; // sode, red bottom edge
        if (ax > 0.2 && h > 0.58 && nz > 0.2) return 'cord';             // red shoulder cords
        return (h * 34) % 1 < 0.17 ? 'cord' : 'lacquer';                 // laced dō
      }
      if (h > 0.385) return ax < 0.42 ? 'obi' : 'lacquer';               // obi belt / forearm guards
      if (h > 0.255) {
        if (ax > 0.24 && ax < 0.5 && nz > 0.05 && h < 0.35) return 'skin'; // hands on the thighs
        if (ax > 0.62) return ax > 0.92 ? 'gold' : 'saya';               // katana
        return h < 0.285 ? 'cord' : 'lacquer';                           // kusazuri plates
      }
      if (ax > 0.62 && h > 0.15) return ax > 0.92 ? 'gold' : 'saya';
      return 'indigo';                                                   // hakama
    }
  };
  const PAINT = {
    gold: C('#c9a046'), lacquer: C('#17121a'), skin: C('#d39a72'), mask: C('#7a1a16'), collar: C('#2a3150'),
    cord: C('#a32a24'), obi: C('#5e5266'), saya: C('#0e0c0e'), indigo: C('#1f2742'),
    bark: C('#4a2a26'), blossom: C('#e990b4'), blossomDeep: C('#c4628c')
  };
  function measureModel(obj) {
    obj.updateMatrixWorld(true);
    const inv = new THREE.Matrix4().copy(obj.matrixWorld).invert();
    const box = new THREE.Box3(), v = new V3(), m = new THREE.Matrix4();
    obj.traverse(o => { if (o.isMesh) { m.multiplyMatrices(inv, o.matrixWorld); const p = o.geometry.attributes.position; for (let i = 0; i < p.count; i++) box.expandByPoint(v.fromBufferAttribute(p, i).applyMatrix4(m)); } });
    return { box, center: box.getCenter(new V3()), half: box.getSize(new V3()).multiplyScalar(0.5) };
  }
  function paintModel(obj, painter) {
    obj.updateMatrixWorld(true);
    const inv = new THREE.Matrix4().copy(obj.matrixWorld).invert();
    const box = new THREE.Box3();
    const v = new V3(), m = new THREE.Matrix4();
    obj.traverse(o => { if (o.isMesh) { m.multiplyMatrices(inv, o.matrixWorld); const p = o.geometry.attributes.position; for (let i = 0; i < p.count; i++) box.expandByPoint(v.fromBufferAttribute(p, i).applyMatrix4(m)); } });
    const c = box.getCenter(new V3()), half = box.getSize(new V3()).multiplyScalar(0.5);
    obj.traverse(o => {
      if (!o.isMesh || o.userData.keepMaterial) return;
      m.multiplyMatrices(inv, o.matrixWorld);
      const p = o.geometry.attributes.position, cols = new Float32Array(p.count * 3);
      for (let i = 0; i < p.count; i++) {
        v.fromBufferAttribute(p, i).applyMatrix4(m);
        const col = PAINT[painter((v.x - c.x) / half.x, (v.y - box.min.y) / (half.y * 2), (v.z - c.z) / half.z)];
        cols[i * 3] = col.r; cols[i * 3 + 1] = col.g; cols[i * 3 + 2] = col.b;
      }
      o.geometry.setAttribute('color', new THREE.BufferAttribute(cols, 3));
      o.material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.5, metalness: 0.15 });
    });
    return { box, center: c, half };
  }

  // Front-project the generator's reference image onto the mesh (it was built from that exact view),
  // and blend to the region paint on faces that look away from the front.
  function projectTexture(obj, frame, proj, onReady, rig = true) {
    const [bx0, by0, bx1, by1] = proj.bbox;
    new THREE.TextureLoader().load('assets/models/' + proj.image, tex => {
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.anisotropy = 4;
      const { box } = frame, size = box.getSize(new V3());
      const inv = new THREE.Matrix4().copy(obj.matrixWorld).invert();
      const m = new THREE.Matrix4(), nm = new THREE.Matrix3(), v = new V3(), n = new V3();
      obj.traverse(o => {
        if (!o.isMesh || o.userData.keepMaterial) return;
        m.multiplyMatrices(inv, o.matrixWorld); nm.getNormalMatrix(m);
        const g = o.geometry, p = g.attributes.position, nrm = g.attributes.normal;
        const uv = new Float32Array(p.count * 2), back = new Float32Array(p.count), head = new Float32Array(p.count);
        for (let i = 0; i < p.count; i++) {
          v.fromBufferAttribute(p, i).applyMatrix4(m);
          const fx = (v.x - box.min.x) / size.x, fy = (box.max.y - v.y) / size.y;
          uv[i * 2] = proj.fit === 'height'
            ? (bx0 + bx1) / 2 + (v.x - (box.min.x + box.max.x) / 2) / size.y * (by1 - by0)
            : bx0 + fx * (bx1 - bx0);
          uv[i * 2 + 1] = 1 - (by0 + fy * (by1 - by0));
          const nz = nrm ? n.fromBufferAttribute(nrm, i).applyMatrix3(nm).normalize().z : 1;
          back[i] = smooth(0.2, -0.3, nz);
          const h = (v.y - box.min.y) / size.y;                       // head turns fully, chest a little
          head[i] = 0.25 * smooth(0.45, 0.66, h) + 0.75 * smooth(0.66, 0.72, h);
        }
        g.setAttribute('aHead', new THREE.BufferAttribute(head, 1));
        const uHeadMat = { value: new THREE.Matrix4() };
        const M = m.clone(), Minv = m.clone().invert();
        if (rig) rigMeshes.push({ uHeadMat, M, Minv });
        g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
        g.setAttribute('aBack', new THREE.BufferAttribute(back, 1));
        const mat = new THREE.MeshStandardMaterial({ map: tex, vertexColors: true, roughness: 0.55, metalness: 0.12 });
        mat.onBeforeCompile = sh => {
          sh.uniforms.uHeadMat = uHeadMat;
          sh.vertexShader = 'attribute float aBack;\nattribute float aHead;\nuniform mat4 uHeadMat;\nvarying float vBack;\n' + sh.vertexShader
            .replace('#include <color_vertex>', '#include <color_vertex>\n  vBack = aBack;')
            .replace('#include <beginnormal_vertex>', 'vec3 objectNormal = normalize( mix( vec3( normal ), mat3( uHeadMat ) * vec3( normal ), aHead ) );')
            .replace('#include <begin_vertex>', 'vec3 transformed = mix( vec3( position ), ( uHeadMat * vec4( position, 1.0 ) ).xyz, aHead );');
          sh.fragmentShader = 'varying float vBack;\n' + sh.fragmentShader
            .replace('#include <map_fragment>', 'vec4 projTex = texture2D( map, vMapUv );\n  diffuseColor.rgb = mix( projTex.rgb, vColor, vBack );')
            .replace('#include <color_fragment>', '');
        };
        o.material = mat;
      });
      if (rig) {
        headRig.pivot.set(frame.center.x, box.min.y + size.y * 0.69, frame.center.z);
        headRig.obj = obj;
      }
      onReady && onReady();
    });
  }
  const rigMeshes = [];
  const headRig = { obj: null, pivot: new V3(), yaw: 0, pitch: 0, lx: 0, ly: 0 };
  let eyeRig = null;
  const _rq = new THREE.Matrix4(), _rx = new THREE.Matrix4(), _rt = new THREE.Matrix4(), _rp = new V3(), _ndc = new THREE.Vector2();
  let blinkT = 3, blinkK = 0;
  function updateHeadRig(dt, t) {
    if (!headRig.obj) return;
    const obj = headRig.obj, piv = headRig.pivot;
    let yaw = 0, pitch = 0, lx = 0, ly = 0;
    if ((page === 'contact' || page === 'samuraiFace') && !travel && mouse.active) {   // samuraiFace: debug-only close-up
      _ndc.set(mouse.x, -mouse.y);
      raycaster.setFromCamera(_ndc, camera);
      const pivW = obj.localToWorld(piv.clone());
      raycaster.ray.at(raycaster.ray.origin.distanceTo(pivW) * 0.9, _rp);
      const tl = obj.worldToLocal(_rp.clone()).sub(piv);
      const hz = Math.max(0.05, tl.z), horiz = Math.hypot(tl.x, hz);
      const ay = Math.atan2(tl.x, hz), ap = Math.atan2(tl.y, horiz);
      yaw = clamp(ay, -0.7, 0.7); pitch = clamp(-ap, -0.32, 0.32);
      lx = clamp(ay / 0.9, -1, 1); ly = clamp(ap / 0.5, -1, 1);
    }
    const k = 1 - Math.exp(-dt * (travel ? 8 : 3.2));
    headRig.yaw = lerp(headRig.yaw, yaw, k); headRig.pitch = lerp(headRig.pitch, pitch, k);
    headRig.lx = lerp(headRig.lx, lx, 1 - Math.exp(-dt * 9)); headRig.ly = lerp(headRig.ly, ly, 1 - Math.exp(-dt * 9));
    // root-space head transform about the neck pivot
    _rt.makeTranslation(piv.x, piv.y, piv.z)
      .multiply(_rq.makeRotationY(headRig.yaw))
      .multiply(_rx.makeRotationX(headRig.pitch))
      .multiply(new THREE.Matrix4().makeTranslation(-piv.x, -piv.y, -piv.z));
    for (const r of rigMeshes) r.uHeadMat.value.copy(r.Minv).multiply(_rt).multiply(r.M);
    if (eyeRig) { eyeRig.matrix.copy(_rt); eyeRig.matrixWorldNeedsUpdate = true; }
    // eyes: look at the cursor, blink now and then
    irisMat.uniforms.uLook.value.set(headRig.lx, headRig.ly);
    blinkT -= dt;
    if (blinkT <= 0 && !(travel && travel.toGallery)) { blinkK = 1; blinkT = 2.5 + Math.random() * 4.5; }
    if (blinkK > 0) blinkK = Math.max(0, blinkK - dt * 4.2);
    const b = blinkK > 0 ? Math.sin(blinkK * Math.PI) : 0;
    irisMat.uniforms.uOpen.value = 1 - b * 0.95;
  }

  // The samurai's eyes: almond-shaped with lids, iris looks at the cursor, blinks (js/eyeShader.js)
  const irisMat = makeEyeMaterial({ almond: true, lid: '#2a120c' });
  const modelEyes = [];

  // find the eyes on the face: cast rays from the front at the eye band and put glowing eyes there
  function addModelEyes(obj, frame) {
    const { box, center, half } = frame;
    const rc = new THREE.Raycaster();
    const meshes = []; obj.traverse(o => { if (o.isMesh && !o.userData.keepMaterial) meshes.push(o); });
    const eyes = [];
    eyeRig = new THREE.Group(); eyeRig.matrixAutoUpdate = false; obj.add(eyeRig);
    for (const sd of [-1, 1]) {
      const local = new V3(center.x + sd * half.x * 0.083, box.min.y + half.y * 2 * 0.817, box.max.z + 1);
      const world = obj.localToWorld(local.clone());
      const dir = new V3(0, 0, -1).transformDirection(obj.matrixWorld);
      rc.set(world, dir);
      const hit = rc.intersectObjects(meshes, true)[0];
      if (!hit) continue;
      const pLocal = obj.worldToLocal(hit.point.clone());
      const r = half.y * 2 * 0.0118;
      const eye = new THREE.Mesh(new THREE.SphereGeometry(r, 64, 48), irisMat);
      eye.userData.keepMaterial = true;
      eye.scale.set(1.25, 1, 0.75);                               // wider than tall, flatter: sits in the socket
      eye.position.copy(pLocal).add(new V3(0, 0, -r * 0.12));
      eyeRig.add(eye);
      modelEyes.push(eye);
      eyes.push({ sd, eye });
    }
    return eyes;
  }

  /* ---------- two samurai duelling on the lake ----------
     One generated model, mirrored for the opponent. They circle, lunge, their blades clash
     in a burst of sparks, they push, spring apart and reset. Each step ripples the water;
     clicking them starts a clash right away. */
  function buildDuel(obj, cfg) {
    obj.traverse(o => { if (o.isMesh) o.material.side = THREE.DoubleSide; });
    const box = new THREE.Box3().setFromObject(obj), size = box.getSize(new V3());
    const k = (cfg.height ?? 1.75) / size.y;
    obj.scale.setScalar(k);
    obj.position.set(-(box.min.x + box.max.x) / 2 * k, -box.min.y * k, -(box.min.z + box.max.z) / 2 * k);
    const A = new THREE.Group(), B = new THREE.Group();
    A.add(obj); B.add(obj.clone(true));
    B.scale.x = -1;                                     // mirror: his sword points the other way
    duelGroup.add(A, B);

    // sparks + flash where the blades meet
    const SN = 60, sPos = new Float32Array(SN * 3), sVel = new Float32Array(SN * 3), sLife = new Float32Array(SN);
    const sGeo = new THREE.BufferGeometry(); sGeo.setAttribute('position', new THREE.BufferAttribute(sPos, 3));
    const sparks = new THREE.Points(sGeo, new THREE.PointsMaterial({
      map: radialTex([[0, 'rgba(255,240,200,1)'], [0.4, 'rgba(255,170,60,.7)'], [1, 'rgba(255,120,30,0)']]),
      size: 0.24, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending
    }));
    const flash = new THREE.Sprite(new THREE.SpriteMaterial({
      map: radialTex([[0, 'rgba(255,250,230,1)'], [0.3, 'rgba(255,200,120,.5)'], [1, 'rgba(255,160,80,0)']]),
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0
    }));
    const CLASH = new V3(0, cfg.clashY ?? 1.3, 0);
    flash.position.copy(CLASH);
    duelGroup.add(sparks, flash);
    for (let i = 0; i < SN; i++) sPos[i * 3 + 1] = -99;

    const T = 5.2;                       // seconds per exchange
    let offset = 0, lastP = 0, flashK = 0;
    const ease = x => x * x * (3 - 2 * x);
    const stepRipple = grp => {
      const w = grp.localToWorld(new V3(0, 0, 0));
      if (islandHeight(w.x, w.z) <= 0) queueDrop(w.x, w.z, 0.01, 0.22);    // only when standing on water
    };
    duel = {
      clashNow() { const p = (performanceTime() + offset) % T; offset += (1.55 - p + T) % T; },
      update(dt, t) {
        const p = (t + offset) % T;
        let gap = 1.0, lean = 0, bob = Math.sin(t * 2.2) * 0.02;
        if (p < 1.5) { gap = 1.0 + Math.sin(p * 2.1) * 0.06; lean = Math.sin(p * 2.1) * 0.03; }                 // stand-off
        else if (p < 1.9) { const k2 = ease((p - 1.5) / 0.4); gap = lerp(1.0, 0.5, k2); lean = 0.22 * k2; }       // lunge
        else if (p < 2.5) { gap = 0.5 + Math.sin((p - 1.9) * 40) * 0.012; lean = 0.22; }                            // blades locked
        else if (p < 3.0) { const k2 = ease((p - 2.5) / 0.5); gap = lerp(0.5, 1.2, k2); lean = lerp(0.22, -0.12, k2); bob += Math.sin(k2 * Math.PI) * 0.18; } // spring apart
        else { const k2 = ease(Math.min(1, (p - 3.0) / 1.2)); gap = lerp(1.2, 1.0, k2); lean = lerp(-0.12, 0, k2); }  // reset
        A.position.set(gap, Math.max(0, bob), 0); A.rotation.z = lean;
        B.position.set(-gap, Math.max(0, bob), 0); B.rotation.z = -lean;
        duelGroup.rotation.y = -0.2 + Math.sin(t * 0.12) * 0.25;                                                   // they slowly circle

        // events
        const crossed = x => lastP < x && p >= x;
        if (crossed(1.9) || (lastP > p && p >= 1.9)) {                                                              // clash!
          flashK = 1;
          for (let i = 0; i < SN; i++) {
            sPos[i * 3] = CLASH.x; sPos[i * 3 + 1] = CLASH.y; sPos[i * 3 + 2] = CLASH.z;
            const a = Math.random() * Math.PI * 2, e = Math.random() * 0.9 - 0.2, sp = 1.5 + Math.random() * 3.5;
            sVel[i * 3] = Math.cos(a) * Math.cos(e) * sp; sVel[i * 3 + 1] = Math.sin(e) * sp + 1.2; sVel[i * 3 + 2] = Math.sin(a) * Math.cos(e) * sp;
            sLife[i] = 0.4 + Math.random() * 0.5;
          }
          const w = duelGroup.localToWorld(new V3(0, 0, 0)); if (islandHeight(w.x, w.z) <= 0) queueDrop(w.x, w.z, 0.022, 0.45);
        }
        if (crossed(1.5) || crossed(2.5) || crossed(3.0)) { stepRipple(A); stepRipple(B); }
        lastP = p;

        flashK = Math.max(0, flashK - dt * 4);
        flash.material.opacity = flashK; flash.scale.setScalar(1.0 + (1 - flashK) * 2.4);
        for (let i = 0; i < SN; i++) {
          if (sLife[i] <= 0) { sPos[i * 3 + 1] = -99; continue; }
          sLife[i] -= dt; sVel[i * 3 + 1] -= 6 * dt;
          sPos[i * 3] += sVel[i * 3] * dt; sPos[i * 3 + 1] += sVel[i * 3 + 1] * dt; sPos[i * 3 + 2] += sVel[i * 3 + 2] * dt;
          if (sPos[i * 3 + 1] < 0.02) { sLife[i] = 0; }
        }
        sGeo.attributes.position.needsUpdate = true;
      }
    };
  }
  const performanceTime = () => performance.now() / 1000;

  const slots = { samurai: { parent: samurai, fallback: samuraiProc, height: 0.62 } };
  function placeTrees(gltfScene, cfg) {
    const box = new THREE.Box3().setFromObject(gltfScene), size = box.getSize(new V3());
    const unit = (cfg.height ?? 3.6) / Math.max(size.y, 1e-6);
    gltfScene.traverse(o => {
      if (!o.isMesh) return;
      const m = o.material;
      m.side = THREE.DoubleSide; m.metalness = 0; m.roughness = 0.85;
      if (m.map) {                      // petals catch the dusk light: faintly self-lit by their own colour
        m.map.anisotropy = 4;
        m.emissive = new THREE.Color('#ffffff'); m.emissiveMap = m.map; m.emissiveIntensity = 0.42;
      } else if (m.emissive) m.emissive.set('#3a1626');
    });
    treeSpots.forEach((sp, i) => {
      const t = i === 0 ? gltfScene : gltfScene.clone(true);
      const k = unit * sp.s * (0.9 + (i % 3) * 0.08);
      t.scale.setScalar(k);
      const gy = islandHeight(sp.x, sp.z);
      t.position.set(sp.x - (box.min.x + box.max.x) / 2 * k, (gy > -1 ? gy - 0.06 : sp.y - 0.25) - box.min.y * k, sp.z - (box.min.z + box.max.z) / 2 * k);
      const pivot = new THREE.Group(); pivot.position.set(sp.x, 0, sp.z); pivot.rotation.y = sp.rot;
      t.position.x -= sp.x; t.position.z -= sp.z; pivot.add(t);
      treesModel.add(pivot);
    });
    treesProc.visible = false;
  }
  (async () => {
    // Requests made while the page is still loading can get cancelled by the browser (seen as
    // "Failed to fetch" / net::ERR_ABORTED), which silently left the hand-built fallbacks in place.
    // So: wait for the page to finish loading, then retry with backoff.
    if (document.readyState !== 'complete') await new Promise(r => addEventListener('load', r, { once: true }));
    const wait = ms => new Promise(r => setTimeout(r, ms));
    let list = null;
    for (const delay of [0, 600, 1500, 3500]) {
      if (delay) await wait(delay);
      try { list = await (await fetch('assets/models/scene-models.json', { cache: 'no-cache' })).json(); break; }
      catch (e) { console.info('Model list not loaded yet, retrying…', e); }
    }
    if (!list) return;
    const gltf = new GLTFLoader();
    gltf.setMeshoptDecoder(MeshoptDecoder);
    const loader = {             // GLTFLoader.load with the same retries
      load(url, onLoad, _p, onError) {
        const attempt = (n) => gltf.load(url, onLoad, undefined, err => {
          if (n < 3) setTimeout(() => attempt(n + 1), [600, 1500, 3500][n]);
          else onError && onError(err);
        });
        attempt(0);
      }
    };
    for (const [name, cfg] of Object.entries(list || {})) {
      if (name === 'duel' && cfg && cfg.file) {
        loader.load('assets/models/' + cfg.file, g => {
          const obj = g.scene;
          const frame = paintModel(obj, PAINTERS[cfg.paint || 'fighter']);
          const go = () => buildDuel(obj, cfg);
          if (cfg.projection) projectTexture(obj, frame, cfg.projection, go, false); else go();
        }, undefined, err => console.warn('Duel model failed:', err));
        continue;
      }
      if (name === 'sakura' && cfg && cfg.file) {
        loader.load('assets/models/' + cfg.file, g => {
          const obj = g.scene;
          let textured = false;
          obj.traverse(o => { if (o.isMesh && o.material && o.material.map) textured = true; });
          if (textured || !PAINTERS.sakura) { placeTrees(obj, cfg); return; }
          const frame = paintModel(obj, PAINTERS.sakura);
          if (cfg.projection) projectTexture(obj, frame, cfg.projection, () => placeTrees(obj, cfg), false);
          else placeTrees(obj, cfg);
        }, undefined, err => console.warn('Tree model failed, keeping the hand-built trees:', err));
        continue;
      }
      const slot = slots[name];
      if (!slot || !cfg || !cfg.file) continue;
      loader.load('assets/models/' + cfg.file, gltf => {
        const obj = gltf.scene;
        const box = new THREE.Box3().setFromObject(obj), size = box.getSize(new V3());
        obj.scale.setScalar((cfg.height ?? slot.height) / Math.max(size.y, 1e-6));
        if (cfg.rotationY) obj.rotation.y = cfg.rotationY;
        box.setFromObject(obj);
        obj.position.set(-(box.min.x + box.max.x) / 2, -box.min.y, -(box.min.z + box.max.z) / 2);
        slot.parent.add(obj);
        obj.updateMatrixWorld(true);
        let textured = false;
        obj.traverse(o => { if (o.isMesh && o.material && o.material.map) textured = true; });
        const frame = (!textured && PAINTERS[cfg.paint || name]) ? paintModel(obj, PAINTERS[cfg.paint || name]) : null;
        if (frame && cfg.projection) projectTexture(obj, frame, cfg.projection);
        if (name === 'samurai') {
          obj.traverse(o => { if (o.isMesh) { o.castShadow = false; } });
          const eyes = addModelEyes(obj, frame || measureModel(obj));
          const right = eyes.find(e => e.sd < 0) || eyes[0];
          if (right) { samurai.updateMatrixWorld(true); EYE_LOCAL.copy(samurai.worldToLocal(right.eye.getWorldPosition(new V3()))); }
        }
        slot.fallback.visible = false;
      }, undefined, err => console.warn('Model failed, keeping fallback:', name, err));
    }
  })();

  camera.aspect = W / H; camera.fov = cam.fov; camera.updateProjectionMatrix();
  api.render(0.016, performance.now() / 1000);
  return api;
}
