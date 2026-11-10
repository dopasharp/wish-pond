// 3D 연못. 연못 화면(pond)과 던지는 폰(thrower)이 같은 장면을 씁니다.
import * as THREE from '../vendor/three.module.min.js';
import { POND, POT_PROFILE, potRadius, floorY, simulate, turtleHead } from './physics.js';
import { drawFace, METALS, designKey, sanitizeDesign } from './coin-art.js';

const SUN = new THREE.Vector3(-0.32, 0.13, -1).normalize();
const Y = new THREE.Vector3(0, 1, 0);

const SKY_GLSL = /* glsl */`
uniform vec3 uSun;
vec3 skyColor(vec3 d){
  d = normalize(d);
  float h = d.y;
  vec3 zen = vec3(0.035,0.055,0.15);
  vec3 mid = vec3(0.24,0.2,0.4);
  vec3 hor = vec3(1.05,0.52,0.3);
  vec3 c = mix(hor, mid, smoothstep(0.0,0.22,h));
  c = mix(c, zen, smoothstep(0.18,0.75,h));
  float s = max(dot(d, uSun), 0.0);
  c += vec3(1.0,0.5,0.22)*pow(s,6.0)*0.55 + vec3(1.0,0.75,0.45)*pow(s,60.0)*0.9 + vec3(1.0,0.9,0.7)*smoothstep(0.9993,0.9997,s)*6.0;
  c = mix(c, vec3(0.03,0.035,0.03), smoothstep(0.0,-0.1,h));
  return c;
}`;

// 물속 물체(바닥·동전·거북 아랫부분)에 수심 색 + 빛 일렁임(코스틱) 입히기
const CAUSTIC_GLSL = /* glsl */`
uniform float uTime;
varying vec3 vWPos;
vec2 cHash(vec2 p){ p = vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3))); return fract(sin(p) * 43758.5453); }
float cellEdge(vec2 p, float t){
  vec2 i = floor(p), f = fract(p); float d1 = 8.0, d2 = 8.0;
  for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
    vec2 g = vec2(float(x), float(y));
    vec2 o = cHash(i + g); o = 0.5 + 0.42 * sin(t + 6.2831 * o);
    float d = length(g + o - f);
    if (d < d1) { d2 = d1; d1 = d; } else if (d < d2) d2 = d;
  }
  return 1.0 - smoothstep(0.0, 0.14, d2 - d1);
}
float caustic(vec2 p, float t){ return cellEdge(p, t) * 0.65 + cellEdge(p * 1.37 + 3.1, t * 1.31) * 0.45; }`;
// ↑ 수면 아래 바닥에 일렁이는 빛 그물 (보로노이 경계 두 겹). GLSL 안에는 한글 주석 금지.
function underwater(material, shared, { caustics = true, tint = 0.62, glint = false } = {}) {
  material.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = shared.uTime;
    sh.vertexShader = 'varying vec3 vWPos;\n' + sh.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
      #ifdef USE_INSTANCING
        vWPos = (modelMatrix * instanceMatrix * vec4(transformed, 1.0)).xyz;
      #else
        vWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
      #endif`);
    sh.fragmentShader = CAUSTIC_GLSL + '\n' + sh.fragmentShader.replace('#include <dithering_fragment>', `
      float uwDepth = -vWPos.y;
      if (uwDepth > 0.0) {
        ${caustics ? `float cs = caustic(vWPos.xz * 2.6, uTime * 0.9);
        gl_FragColor.rgb += vec3(0.7, 0.95, 0.8) * cs * 0.16 * smoothstep(0.0, 0.08, uwDepth);` : ''}
        gl_FragColor.rgb = mix(gl_FragColor.rgb, vec3(0.012, 0.06, 0.055), clamp(uwDepth * 1.1, 0.0, ${tint.toFixed(2)}) * smoothstep(0.0, 0.03, uwDepth));
      }
      ${glint ? `float gl = step(0.9975, fract(sin(dot(floor(vWPos.xz * 140.0) + floor(uTime * 4.0) * 7.0, vec2(12.9898, 78.233))) * 43758.5453));
      gl_FragColor.rgb += vec3(1.0, 0.92, 0.7) * gl * 1.6;` : ''}
      #include <dithering_fragment>`);
  };
  material.customProgramCacheKey = () => `uw${caustics ? 1 : 0}${tint}${glint ? 1 : 0}`;
  return material;
}

function canvasTex(w, h, draw, repeat = 1) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeat, repeat);
  t.anisotropy = 4;
  return t;
}
function speckle(ctx, w, h, base, cols, n, rmax) {
  ctx.fillStyle = base; ctx.fillRect(0, 0, w, h);
  for (let i = 0; i < n; i++) {
    ctx.fillStyle = cols[i % cols.length];
    ctx.globalAlpha = 0.25 + Math.random() * 0.5;
    ctx.beginPath();
    ctx.ellipse(Math.random() * w, Math.random() * h, 1 + Math.random() * rmax, 1 + Math.random() * rmax * 0.8, Math.random() * 3, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

// 3D 값 노이즈 (바위 모양)
function hash3(x, y, z) { const s = Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453; return s - Math.floor(s); }
function vnoise(x, y, z) {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
  const xf = x - xi, yf = y - yi, zf = z - zi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf), w = zf * zf * (3 - 2 * zf);
  let r = 0;
  for (let i = 0; i < 2; i++) for (let j = 0; j < 2; j++) for (let k = 0; k < 2; k++) {
    r += hash3(xi + i, yi + j, zi + k) * (i ? u : 1 - u) * (j ? v : 1 - v) * (k ? w : 1 - w);
  }
  return r;
}
function rockGeometry(seed) {
  const g = new THREE.IcosahedronGeometry(1, 3);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const n = vnoise(x * 1.6 + seed, y * 1.6, z * 1.6) * 0.45 + vnoise(x * 4 + seed, y * 4, z * 4) * 0.12;
    const k = 0.75 + n;
    p.setXYZ(i, x * k, Math.max(-0.35, y) * k, z * k);
  }
  g.computeVertexNormals();
  return g;
}

/* ---------- 동전 면 아틀라스: 연못 바닥 동전 수백 개를 한 번에 그리기 ---------- */
class FaceAtlas {
  constructor(size, cell) {
    this.size = size; this.cell = cell; this.n = size / cell;
    this.canvas = document.createElement('canvas');
    this.canvas.width = this.canvas.height = size;
    this.ctx = this.canvas.getContext('2d');
    this.tex = new THREE.CanvasTexture(this.canvas);
    this.tex.colorSpace = THREE.SRGBColorSpace;
    this.tex.anisotropy = 4;
    this.map = new Map(); // key → {front, back}
    this.order = [];
    this.next = 2;
    this.dirty = false;
    // 0,1번 칸: 기본 동전 (칸이 모자랄 때)
    const def = { metal: 'gold', rim: 'plain', stamp: '', text: '', back: '' };
    this.draw(0, def, 'front'); this.draw(1, def, 'back');
  }
  cellUV(i) { const col = i % this.n, row = Math.floor(i / this.n); return [col, this.n - row - 1]; }
  draw(i, design, side) {
    const col = i % this.n, row = Math.floor(i / this.n);
    drawFace(this.ctx, design, side, this.cell, col * this.cell, row * this.cell);
    this.dirty = true;
  }
  get(design) {
    const key = designKey(design);
    let e = this.map.get(key);
    if (e) return e;
    if (this.next + 2 > this.n * this.n) {
      // 가장 오래된 디자인 칸 재사용
      const old = this.order.shift();
      e = this.map.get(old); this.map.delete(old);
      this.onEvict && this.onEvict(old);
      e = { front: e.front, back: e.back };
    } else {
      e = { front: this.next, back: this.next + 1 }; this.next += 2;
    }
    this.draw(e.front, design, 'front'); this.draw(e.back, design, 'back');
    this.map.set(key, e); this.order.push(key);
    return e;
  }
  flush() { if (this.dirty) { this.tex.needsUpdate = true; this.dirty = false; } }
}

/* ---------- 파티클 (물방울·반짝이·기포) ---------- */
class Particles {
  constructor(max, additive) {
    this.max = max;
    this.pos = new Float32Array(max * 3);
    this.vel = new Float32Array(max * 3);
    this.life = new Float32Array(max);
    this.age = new Float32Array(max);
    this.size = new Float32Array(max);
    this.col = new Float32Array(max * 3);
    this.kind = new Uint8Array(max); // 0 물방울, 1 반짝이, 2 기포
    this.alpha = new Float32Array(max);
    this.i = 0;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    g.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1));
    g.setAttribute('aColor', new THREE.BufferAttribute(this.col, 3));
    g.setAttribute('aAlpha', new THREE.BufferAttribute(this.alpha, 1));
    this.geo = g;
    this.mat = new THREE.ShaderMaterial({
      uniforms: { uScale: { value: 400 } },
      vertexShader: `attribute float aSize; attribute vec3 aColor; attribute float aAlpha; varying vec3 vC; varying float vA; uniform float uScale;
        void main(){ vC=aColor; vA=aAlpha; vec4 mv = modelViewMatrix*vec4(position,1.); gl_Position = projectionMatrix*mv; gl_PointSize = aSize*uScale/(-mv.z); }`,
      fragmentShader: `varying vec3 vC; varying float vA; void main(){ vec2 d=gl_PointCoord-.5; float r=length(d); if(r>.5) discard; float a = smoothstep(.5,.15,r)*vA; gl_FragColor=vec4(vC*(1.+ (1.-r*2.)*.6), a); }`,
      transparent: true, depthWrite: false, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    this.points = new THREE.Points(g, this.mat);
    this.points.frustumCulled = false;
  }
  spawn(x, y, z, vx, vy, vz, life, size, r, g, b, kind = 0) {
    const i = this.i; this.i = (this.i + 1) % this.max;
    this.pos.set([x, y, z], i * 3); this.vel.set([vx, vy, vz], i * 3); this.col.set([r, g, b], i * 3);
    this.life[i] = life; this.age[i] = 0; this.size[i] = size; this.kind[i] = kind; this.alpha[i] = 1;
  }
  update(dt, onPop) {
    for (let i = 0; i < this.max; i++) {
      if (this.life[i] <= 0) { this.alpha[i] = 0; continue; }
      this.age[i] += dt;
      const k = this.age[i] / this.life[i];
      if (k >= 1) { this.life[i] = 0; this.alpha[i] = 0; continue; }
      const j = i * 3;
      if (this.kind[i] === 0) {
        this.vel[j + 1] -= 9.8 * dt;
        if (this.pos[j + 1] < 0 && this.vel[j + 1] < 0) { this.life[i] = 0; this.alpha[i] = 0; onPop && onPop(this.pos[j], this.pos[j + 2], 0.12); continue; }
        this.alpha[i] = 0.85;
      } else if (this.kind[i] === 1) {
        this.vel[j] *= 0.96; this.vel[j + 1] = this.vel[j + 1] * 0.96 + 0.3 * dt; this.vel[j + 2] *= 0.96;
        this.alpha[i] = (1 - k) * (0.6 + 0.4 * Math.sin(this.age[i] * 30 + i));
      } else {
        this.vel[j] += (Math.random() - 0.5) * dt * 0.8;
        if (this.pos[j + 1] >= -0.01) { this.life[i] = 0; this.alpha[i] = 0; onPop && onPop(this.pos[j], this.pos[j + 2], 0.05); continue; }
        this.alpha[i] = 0.55;
      }
      this.pos[j] += this.vel[j] * dt; this.pos[j + 1] += this.vel[j + 1] * dt; this.pos[j + 2] += this.vel[j + 2] * dt;
    }
    this.geo.attributes.position.needsUpdate = true;
    this.geo.attributes.aAlpha.needsUpdate = true;
    this.geo.attributes.aSize.needsUpdate = true;
    this.geo.attributes.aColor.needsUpdate = true;
  }
}

/* ======================================================================== */
export function createWorld(canvas, { mode = 'pond', quality } = {}) {
  const mobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent) || Math.min(innerWidth, innerHeight) < 600;
  const low = quality ? quality === 'low' : mobile;
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: !low || devicePixelRatio < 2, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, low ? 1.75 : 2));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0x1a1630, 14, 42);
  const camera = new THREE.PerspectiveCamera(mode === 'pond' ? 40 : 60, 1, 0.05, 120);
  scene.add(camera);
  const shared = { uTime: { value: 0 } };
  const clock = new THREE.Clock();

  /* --- 하늘 --- */
  const skyMat = new THREE.ShaderMaterial({
    uniforms: { uSun: { value: SUN } },
    vertexShader: `varying vec3 vDir; void main(){ vDir = normalize(position); vec4 p = projectionMatrix*modelViewMatrix*vec4(position,1.); gl_Position = p.xyww; }`,
    fragmentShader: SKY_GLSL + `
      varying vec3 vDir;
      float h2(vec2 p){ return fract(sin(dot(p, vec2(12.9898,78.233)))*43758.5453); }
      void main(){
        vec3 c = skyColor(vDir);
        vec2 sp = vDir.xz/(vDir.y+0.2)*90.;
        float st = step(0.996, h2(floor(sp))) * smoothstep(0.25,0.7,vDir.y);
        c += st*0.8;
        gl_FragColor = vec4(c,1.);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
    side: THREE.BackSide, depthWrite: false, fog: false,
  });
  const sky = new THREE.Mesh(new THREE.SphereGeometry(80, 48, 24), skyMat);
  sky.renderOrder = -10;
  scene.add(sky);

  // 금속 반사용 환경맵 (하늘 + 석등 불빛)
  {
    const pm = new THREE.PMREMGenerator(renderer);
    const envScene = new THREE.Scene();
    envScene.add(new THREE.Mesh(new THREE.SphereGeometry(50, 32, 16), new THREE.ShaderMaterial({
      uniforms: { uSun: { value: SUN } }, side: THREE.BackSide,
      vertexShader: 'varying vec3 vDir; void main(){ vDir=normalize(position); gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.); }',
      fragmentShader: SKY_GLSL + '\nvarying vec3 vDir; void main(){ gl_FragColor=vec4(skyColor(vDir)*1.3,1.); }',
    })));
    [[-6, 2, -6], [7, 2, -5], [0, 6, 8]].forEach(([x, y, z], i) => {
      const m = new THREE.Mesh(new THREE.SphereGeometry(i === 2 ? 3 : 1.2, 12, 8), new THREE.MeshBasicMaterial({ color: i === 2 ? 0x8899cc : 0xffb060 }));
      m.position.set(x, y, z); envScene.add(m);
    });
    scene.environment = pm.fromScene(envScene, 0.02).texture;
    pm.dispose();
  }

  /* --- 빛 --- */
  scene.add(new THREE.HemisphereLight(0x8a90c8, 0x2a2018, 0.9));
  const sun = new THREE.DirectionalLight(0xffb27a, 2.2);
  sun.position.copy(SUN).multiplyScalar(20);
  scene.add(sun);
  const fill = new THREE.DirectionalLight(0x9fb4ff, 0.5);
  fill.position.set(2, 6, 8);
  scene.add(fill);

  /* --- 땅 --- */
  const mossTex = canvasTex(512, 512, (c, w, h) => speckle(c, w, h, '#26301f', ['#334126', '#1d2617', '#3d4a2a', '#4a4630', '#202a1a'], 2600, 7), 10);
  const ground = new THREE.Mesh(new THREE.RingGeometry(POND.R + 0.2, 45, 96, 4), new THREE.MeshStandardMaterial({ map: mossTex, roughness: 0.97, color: 0xb0b0a0 }));
  ground.rotation.x = -Math.PI / 2; ground.position.y = POND.GROUND - 0.02;
  scene.add(ground);
  // 디딤돌 길 (던지는 자리)
  const stepTex = canvasTex(256, 256, (c, w, h) => speckle(c, w, h, '#7d776c', ['#6a645a', '#8e887c', '#5a554c'], 900, 5), 1);
  const stepMat = new THREE.MeshStandardMaterial({ map: stepTex, roughness: 0.9 });
  [[0, 5.5, 0.55], [-0.35, 6.6, 0.5], [0.3, 7.6, 0.5], [-0.1, 8.7, 0.48]].forEach(([x, z, r], i) => {
    const s = new THREE.Mesh(new THREE.CylinderGeometry(r, r * 1.04, 0.08, 28), stepMat);
    s.position.set(x, POND.GROUND + 0.01, z); s.scale.z = 0.8; s.rotation.y = i;
    scene.add(s);
  });

  /* --- 연못 바닥 --- */
  const pebbleTex = canvasTex(512, 512, (c, w, h) => {
    c.fillStyle = '#5b5444'; c.fillRect(0, 0, w, h);
    for (let i = 0; i < 1400; i++) {
      const r = 3 + Math.random() * 11, x = Math.random() * w, y = Math.random() * h;
      const l = 40 + Math.random() * 45;
      c.fillStyle = `hsl(${30 + Math.random() * 25},${10 + Math.random() * 20}%,${l}%)`;
      c.beginPath(); c.ellipse(x, y, r, r * (0.6 + Math.random() * 0.4), Math.random() * 3, 0, Math.PI * 2); c.fill();
      c.fillStyle = 'rgba(255,255,255,.12)'; c.beginPath(); c.ellipse(x - r * 0.25, y - r * 0.3, r * 0.4, r * 0.25, 0, 0, Math.PI * 2); c.fill();
    }
  }, 5);
  const floorGeo = new THREE.RingGeometry(0.001, POND.R + 0.6, 128, 48);
  {
    const p = floorGeo.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), z = -p.getY(i);
      const r = Math.hypot(x, z);
      const y = r <= POND.R ? floorY(x, z) : -0.07 + (r - POND.R) * 0.3;
      p.setXYZ(i, x, y, z);
    }
    floorGeo.computeVertexNormals();
  }
  const floorMat = underwater(new THREE.MeshStandardMaterial({ map: pebbleTex, roughness: 0.95, color: 0xcfc7b0 }), shared);
  const floor = new THREE.Mesh(floorGeo, floorMat);
  scene.add(floor);

  /* --- 돌 테두리 --- */
  const rockTex = canvasTex(256, 256, (c, w, h) => speckle(c, w, h, '#8b857a', ['#77716a', '#9d978a', '#6c6a5c', '#5d6a4a'], 1200, 6), 1);
  const rockMat = underwater(new THREE.MeshStandardMaterial({ map: rockTex, roughness: 0.9, color: 0xffffff }), shared, { caustics: false });
  const rockGeos = [rockGeometry(1.3), rockGeometry(7.7), rockGeometry(4.1)];
  const rocks = [];
  const RN = low ? 40 : 52;
  const rnd = mulberry(42);
  const dummy = new THREE.Object3D();
  rockGeos.forEach((g, gi) => {
    const items = [];
    for (let i = gi; i < RN; i += 3) items.push(i);
    const im = new THREE.InstancedMesh(g, rockMat, items.length);
    items.forEach((i, k) => {
      const a = (i / RN) * Math.PI * 2 + rnd() * 0.05;
      const r = POND.R + 0.4 + rnd() * 0.15;
      dummy.position.set(Math.cos(a) * r, -0.02, Math.sin(a) * r);
      dummy.scale.set(0.3 + rnd() * 0.18, 0.15 + rnd() * 0.08, 0.26 + rnd() * 0.12);
      dummy.rotation.set(0, -a + rnd() * 0.6, 0);
      dummy.updateMatrix();
      im.setMatrixAt(k, dummy.matrix);
      const c = 0.75 + rnd() * 0.35;
      im.setColorAt(k, new THREE.Color(c, c * (0.97 + rnd() * 0.05), c * (0.9 + rnd() * 0.06)));
    });
    scene.add(im); rocks.push(im);
  });

  /* --- 돌거북 --- */
  const T = POND.turtle;
  const shellTex = canvasTex(1024, 512, (c, w, h) => {
    speckle(c, w, h, '#556450', ['#4a5845', '#62705a', '#3e4a3a', '#6f7a5e'], 3000, 6);
    c.strokeStyle = 'rgba(25,32,22,.75)'; c.lineWidth = 7;
    const s = 70;
    for (let row = -1; row < h / (s * 0.86) + 1; row++) {
      for (let col = -1; col < w / s + 1; col++) {
        const cx = col * s * 1.5, cy = row * s * 1.73 + (col % 2 ? s * 0.86 : 0);
        c.beginPath();
        for (let k = 0; k <= 6; k++) { const a = (k / 6) * Math.PI * 2; c[k ? 'lineTo' : 'moveTo'](cx + Math.cos(a) * s, cy + Math.sin(a) * s); }
        c.stroke();
      }
    }
    c.fillStyle = 'rgba(80,110,50,.35)';
    for (let i = 0; i < 40; i++) { c.beginPath(); c.arc(Math.random() * w, h * 0.6 + Math.random() * h * 0.4, 6 + Math.random() * 24, 0, 7); c.fill(); }
  }, 1);
  shellTex.wrapS = THREE.RepeatWrapping;
  const stoneMat = underwater(new THREE.MeshStandardMaterial({ color: 0x8a9480, roughness: 0.8 }), shared, { caustics: false });
  const shellMat = underwater(new THREE.MeshStandardMaterial({ map: shellTex, roughness: 0.75, color: 0xd8dcc8 }), shared, { caustics: false });
  const turtle = new THREE.Group();
  turtle.position.set(T.x, 0, T.z);
  turtle.rotation.y = -T.yaw;
  const shell = new THREE.Mesh(new THREE.SphereGeometry(1, 64, 32), shellMat);
  shell.scale.set(T.rx, T.ry, T.rz); shell.position.y = T.y;
  turtle.add(shell);
  const rimShell = new THREE.Mesh(new THREE.TorusGeometry(1, 0.06, 10, 64), stoneMat);
  rimShell.rotation.x = Math.PI / 2; rimShell.scale.set(T.rx * 1.0, T.rz * 1.0, 1); rimShell.position.y = T.y + 0.03;
  turtle.add(rimShell);
  const head = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 16), stoneMat);
  head.scale.set(0.19, 0.16, 0.27); head.position.set(0, 0.08, T.rz + 0.12); head.rotation.x = -0.25;
  turtle.add(head);
  const eyeMat = new THREE.MeshStandardMaterial({ color: 0x0a0a08, roughness: 0.2 });
  [-1, 1].forEach((sx) => {
    const e = new THREE.Mesh(new THREE.SphereGeometry(0.028, 12, 8), eyeMat);
    e.position.set(sx * 0.11, 0.15, T.rz + 0.27); turtle.add(e);
  });
  [[-1, 1], [1, 1], [-1, -1], [1, -1]].forEach(([sx, sz]) => {
    const l = new THREE.Mesh(new THREE.SphereGeometry(1, 20, 12), stoneMat);
    l.scale.set(0.2, 0.08, 0.13); l.position.set(sx * T.rx * 0.88, -0.02, sz * T.rz * 0.62); l.rotation.y = sx * sz * 0.6;
    turtle.add(l);
  });
  scene.add(turtle);

  /* --- 항아리 --- */
  const P = POND.pot;
  const potPts = [];
  const hgt = P.top - P.base;
  potPts.push(new THREE.Vector2(0.001, 0));
  for (let i = 0; i <= 40; i++) { const u = i / 40; potPts.push(new THREE.Vector2(potRadius(u), u * hgt)); }
  potPts.push(new THREE.Vector2(potRadius(1) - 0.015, hgt + 0.025));
  potPts.push(new THREE.Vector2(potRadius(1) - 0.045, hgt + 0.005));
  for (let i = 40; i >= 2; i--) { const u = i / 40; potPts.push(new THREE.Vector2(Math.max(0.05, potRadius(u) - 0.045), u * hgt)); }
  potPts.push(new THREE.Vector2(0.001, 0.07));
  const potMat = underwater(new THREE.MeshPhysicalMaterial({ color: 0x3a2214, roughness: 0.28, clearcoat: 1, clearcoatRoughness: 0.12, side: THREE.DoubleSide }), shared, { caustics: false });
  const pot = new THREE.Mesh(new THREE.LatheGeometry(potPts, 64), potMat);
  pot.position.set(P.x, P.base, P.z);
  scene.add(pot);
  // 항아리 입구 안쪽 어둠 + 금빛 (동전이 모이면 빛남)
  const potGlow = new THREE.Mesh(new THREE.CircleGeometry(potRadius(1) - 0.05, 32), new THREE.MeshBasicMaterial({ color: 0xffc44d, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }));
  potGlow.rotation.x = -Math.PI / 2; potGlow.position.set(P.x, P.top - 0.02, P.z);
  scene.add(potGlow);

  /* --- 연잎 + 연꽃 --- */
  const padTex = canvasTex(256, 256, (c, w, h) => {
    const g = c.createRadialGradient(w / 2, h / 2, 5, w / 2, h / 2, w / 2);
    g.addColorStop(0, '#6e9a3e'); g.addColorStop(1, '#2f5a26'); c.fillStyle = g; c.fillRect(0, 0, w, h);
    c.strokeStyle = 'rgba(190,220,140,.35)'; c.lineWidth = 2;
    for (let i = 0; i < 18; i++) { const a = (i / 18) * Math.PI * 2; c.beginPath(); c.moveTo(w / 2, h / 2); c.lineTo(w / 2 + Math.cos(a) * w / 2, h / 2 + Math.sin(a) * h / 2); c.stroke(); }
  }, 1);
  const padMat = new THREE.MeshStandardMaterial({ map: padTex, roughness: 0.45, side: THREE.DoubleSide });
  const pads = [];
  const petalMat = new THREE.MeshStandardMaterial({ color: 0xffb3cf, roughness: 0.5, emissive: 0x552233, emissiveIntensity: 0.4 });
  [[2.75, 1.0, 0.36, 1], [-2.9, 0.5, 0.32, 0], [-2.4, -2.5, 0.4, 1], [0.35, -3.25, 0.3, 0], [3.1, -1.1, 0.27, 0], [-0.4, 2.7, 0.24, 0], [2.0, 2.6, 0.3, 0]].forEach(([x, z, r, flower], i) => {
    const g = new THREE.Group();
    const pad = new THREE.Mesh(new THREE.CircleGeometry(r, 40, 0.3, Math.PI * 2 - 0.6), padMat);
    pad.rotation.x = -Math.PI / 2; g.add(pad);
    if (flower) {
      for (let ring = 0; ring < 2; ring++) for (let k = 0; k < 8; k++) {
        const pe = new THREE.Mesh(new THREE.SphereGeometry(1, 12, 8), petalMat);
        const a = (k / 8) * Math.PI * 2 + ring * 0.4;
        pe.scale.set(0.045, 0.025, 0.12 - ring * 0.03);
        pe.position.set(Math.cos(a) * 0.08, 0.06 + ring * 0.03, Math.sin(a) * 0.08);
        pe.rotation.set(0, -a + Math.PI / 2, 0); pe.rotateX(-0.7 - ring * 0.4);
        g.add(pe);
      }
      const c = new THREE.Mesh(new THREE.SphereGeometry(0.035, 12, 8), new THREE.MeshStandardMaterial({ color: 0xffe066, emissive: 0x664400 }));
      c.position.y = 0.09; g.add(c);
    }
    g.position.set(x, 0.006, z); g.rotation.y = i * 1.7;
    g.userData.phase = i * 1.3;
    scene.add(g); pads.push(g);
  });

  /* --- 석등 --- */
  const lanternStone = new THREE.MeshStandardMaterial({ color: 0x9a948a, roughness: 0.9, map: rockTex });
  const lanterns = [];
  [[-3.9, -4.9], [4.3, -4.2], [-5.2, 2.2]].forEach(([x, z], i) => {
    const g = new THREE.Group();
    const add = (geo, y, s = 1) => { const m = new THREE.Mesh(geo, lanternStone); m.position.y = y; m.scale.setScalar(s); g.add(m); return m; };
    add(new THREE.CylinderGeometry(0.32, 0.38, 0.14, 8), 0.07);
    add(new THREE.CylinderGeometry(0.1, 0.13, 0.75, 8), 0.5);
    add(new THREE.CylinderGeometry(0.3, 0.2, 0.12, 6), 0.92);
    const box = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.3, 0.34), new THREE.MeshStandardMaterial({ color: 0xffc070, emissive: 0xffa040, emissiveIntensity: 2.2 }));
    box.position.y = 1.13; g.add(box);
    [0, 1, 2, 3].forEach((k) => { const p = add(new THREE.BoxGeometry(0.06, 0.32, 0.06), 1.13); p.position.x = (k % 2 ? 1 : -1) * 0.18; p.position.z = (k > 1 ? 1 : -1) * 0.18; });
    const roof = add(new THREE.ConeGeometry(0.42, 0.26, 6), 1.42);
    roof.rotation.y = Math.PI / 6;
    add(new THREE.SphereGeometry(0.07, 10, 8), 1.6);
    g.position.set(x, POND.GROUND, z);
    if (i < (low ? 2 : 3)) {
      const pl = new THREE.PointLight(0xffa950, i === 2 ? 3 : 5, 9, 1.8);
      pl.position.set(0, 1.13, 0); g.add(pl);
    }
    scene.add(g); lanterns.push(box);
  });

  /* --- 먼 숲 실루엣 --- */
  {
    const treeMat = new THREE.MeshStandardMaterial({ color: 0x16211f, roughness: 1, flatShading: true });
    const n = low ? 46 : 70;
    const im = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 1), treeMat, n);
    const r2 = mulberry(9);
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + r2() * 0.1;
      const r = 15 + r2() * 8;
      dummy.position.set(Math.cos(a) * r, 0.3 + r2() * 1.2, Math.sin(a) * r);
      const s = 1.2 + r2() * 1.6;
      dummy.scale.set(s, s * (0.9 + r2() * 0.7), s);
      dummy.rotation.set(r2(), r2() * 3, 0);
      dummy.updateMatrix(); im.setMatrixAt(i, dummy.matrix);
    }
    scene.add(im);
  }

  /* --- 반딧불 --- */
  const FF = low ? 24 : 48;
  const ffGeo = new THREE.BufferGeometry();
  const ffPos = new Float32Array(FF * 3), ffSeed = new Float32Array(FF);
  for (let i = 0; i < FF; i++) {
    const a = Math.random() * Math.PI * 2, r = 2.5 + Math.random() * 5;
    ffPos.set([Math.cos(a) * r, 0.3 + Math.random() * 1.6, Math.sin(a) * r], i * 3); ffSeed[i] = Math.random() * 100;
  }
  ffGeo.setAttribute('position', new THREE.BufferAttribute(ffPos, 3));
  ffGeo.setAttribute('aSeed', new THREE.BufferAttribute(ffSeed, 1));
  const ffMat = new THREE.ShaderMaterial({
    uniforms: { uTime: shared.uTime },
    vertexShader: `attribute float aSeed; uniform float uTime; varying float vA;
      void main(){ vec3 p = position + vec3(sin(uTime*.3+aSeed)*.6, sin(uTime*.5+aSeed*2.)*.25, cos(uTime*.27+aSeed)*.6);
        vA = pow(.5+.5*sin(uTime*1.7+aSeed*3.), 3.);
        vec4 mv = modelViewMatrix*vec4(p,1.); gl_Position=projectionMatrix*mv; gl_PointSize = 26.*vA/(-mv.z)*10.; }`,
    fragmentShader: `varying float vA; void main(){ float r=length(gl_PointCoord-.5); gl_FragColor=vec4(1.,.92,.45, smoothstep(.5,0.,r)*vA); }`,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  });
  const fireflies = new THREE.Points(ffGeo, ffMat);
  fireflies.frustumCulled = false;
  scene.add(fireflies);

  /* --- 물 --- */
  const RIP = 16;
  const ripples = Array.from({ length: RIP }, () => new THREE.Vector4(0, 0, -99, 0));
  let ripI = 0;
  const reflScale = low ? 0.4 : 0.55;
  const reflRT = new THREE.WebGLRenderTarget(16, 16); // 8비트: HalfFloat 반사는 일부 모바일 GPU에서 깨짐
  const texMatrix = new THREE.Matrix4();
  const waterMat = new THREE.ShaderMaterial({
    uniforms: {
      uTime: shared.uTime, uSun: { value: SUN }, uRipples: { value: ripples },
      uReflect: { value: reflRT.texture }, uTexMatrix: { value: texMatrix },
    },
    vertexShader: `uniform mat4 uTexMatrix; varying vec3 vW; varying vec4 vRef;
      void main(){ vec4 w = modelMatrix*vec4(position,1.); vW = w.xyz; vRef = uTexMatrix*w; gl_Position = projectionMatrix*viewMatrix*w; }`,
    fragmentShader: SKY_GLSL + `
      uniform float uTime; uniform vec4 uRipples[${RIP}]; uniform sampler2D uReflect;
      varying vec3 vW; varying vec4 vRef;
      vec2 wave(vec2 p, vec2 dir, float freq, float amp, float speed){
        float ph = dot(p, normalize(dir))*freq + uTime*speed;
        return normalize(dir) * cos(ph) * freq * amp;
      }
      void main(){
        vec2 p = vW.xz;
        vec2 g = vec2(0.);
        g += wave(p, vec2(1.,.3), 3.1, .006, 1.3);
        g += wave(p, vec2(-.4,1.), 4.7, .004, 1.7);
        g += wave(p, vec2(.7,-.8), 7.3, .0024, 2.3);
        g += wave(p, vec2(-1.,-.2), 11.9, .0013, 3.1);
        g += wave(p, vec2(.2,1.), 17.0, .0008, 3.9);
        g += wave(p, vec2(.9,.5), 23.0, .0005, 4.6);
        for (int i = 0; i < ${RIP}; i++) {
          vec4 r = uRipples[i];
          float age = uTime - r.z;
          if (r.w <= 0. || age < 0. || age > 5.) continue;
          vec2 d = p - r.xy; float dist = length(d) + 1e-4;
          float x = dist - age * 0.7;
          float env = x > 0. ? exp(-x*x*90.) : exp(-x*x*5.);
          float amp = r.w * 0.012 * exp(-age*0.9) / (0.4 + dist*2.);
          g += (d/dist) * amp * 30. * cos(x*30.) * env;
        }
        vec3 n = normalize(vec3(-g.x, 1., -g.y));
        vec3 v = normalize(cameraPosition - vW);
        float fres = 0.02 + 0.98*pow(1. - max(dot(n, v), 0.), 5.);
        vec3 refl;
        ${'#ifdef USE_RT'}
          vec2 uv = vRef.xy / vRef.w + n.xz * 0.045;
          refl = texture2D(uReflect, uv).rgb;
        ${'#else'}
          refl = skyColor(reflect(-v, n));
        ${'#endif'}
        float spec = pow(max(dot(reflect(-v, n), uSun), 0.), 350.) * 9.;
        float r = length(p);
        vec3 deep = vec3(0.01, 0.055, 0.06);
        float a = mix(0.5, 0.97, fres);
        a = max(a, smoothstep(${(POND.R - 0.25).toFixed(2)}, ${POND.R.toFixed(2)}, r) * 0.6);
        float rf = max(fres, 0.1);
        vec3 col = deep * (1. - rf) * 0.8 + refl * rf + vec3(1., .8, .55) * spec;
        gl_FragColor = vec4(col / max(a, 0.001), a);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
    transparent: true, depthWrite: false, defines: { USE_RT: '' },
  });
  const water = new THREE.Mesh(new THREE.CircleGeometry(POND.R + 0.15, 160), waterMat);
  water.rotation.x = -Math.PI / 2;
  water.renderOrder = 5;
  scene.add(water);
  function addRipple(x, z, strength = 1) {
    ripples[ripI].set(x, z, shared.uTime.value, strength);
    ripI = (ripI + 1) % RIP;
  }

  // 반사 카메라
  const mirrorCam = new THREE.PerspectiveCamera();
  const clipPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0.0);
  const _v = new THREE.Vector3(), _t = new THREE.Vector3(), _m = new THREE.Matrix4();
  function renderReflection() {
    camera.updateMatrixWorld();
    mirrorCam.copy(camera);
    _v.setFromMatrixPosition(camera.matrixWorld);
    _m.extractRotation(camera.matrixWorld);
    _t.set(0, 0, -1).applyMatrix4(_m).add(_v);
    mirrorCam.position.set(_v.x, -_v.y, _v.z);
    mirrorCam.up.set(0, 1, 0).applyMatrix4(_m); mirrorCam.up.y *= -1;
    mirrorCam.lookAt(_t.x, -_t.y, _t.z);
    mirrorCam.updateMatrixWorld();
    texMatrix.set(0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0, 0.5, 0.5, 0, 0, 0, 1);
    texMatrix.multiply(mirrorCam.projectionMatrix).multiply(mirrorCam.matrixWorldInverse);
    water.visible = false; particles.points.visible = false; bubblesP.points.visible = false;
    const hv = handCoin && handCoin.visible; if (handCoin) handCoin.visible = false;
    renderer.clippingPlanes = [clipPlane];
    renderer.setRenderTarget(reflRT);
    renderer.clear();
    renderer.render(scene, mirrorCam);
    renderer.setRenderTarget(null);
    renderer.clippingPlanes = [];
    water.visible = true; particles.points.visible = true; bubblesP.points.visible = true;
    if (handCoin) handCoin.visible = hv;
  }

  /* --- 파티클 --- */
  const particles = new Particles(low ? 500 : 900, false);
  const sparks = new Particles(low ? 200 : 400, true);
  const bubblesP = new Particles(low ? 150 : 300, false);
  scene.add(particles.points, sparks.points, bubblesP.points);
  // 물기둥 (튀어 오르는 왕관)
  const crownMat = new THREE.MeshBasicMaterial({ color: 0xdff4ff, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide });
  const crowns = Array.from({ length: 6 }, () => {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(1, 0.6, 1, 28, 1, true), crownMat.clone());
    m.visible = false; scene.add(m); return { m, t: -1, s: 1 };
  });
  let crownI = 0;
  // 성공 빛기둥
  const pillarMat = new THREE.ShaderMaterial({
    uniforms: { uA: { value: 0 }, uColor: { value: new THREE.Color(0xffd36b) } },
    vertexShader: 'varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.); }',
    fragmentShader: 'uniform float uA; uniform vec3 uColor; varying vec2 vUv; void main(){ float a = (1.-vUv.y)*(1.-vUv.y)*uA*(.6+.4*sin(vUv.x*40.)); gl_FragColor=vec4(uColor*2., a*.5); }',
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
  });
  const pillar = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.5, 5, 32, 1, true), pillarMat);
  pillar.visible = false; scene.add(pillar);
  let pillarT = -1;

  function splashFx(x, z, speed) {
    const s = Math.min(1, speed / 9);
    addRipple(x, z, 0.6 + s * 1.2);
    setTimeout(() => addRipple(x, z, 0.35 + s * 0.5), 180);
    const n = Math.round((low ? 22 : 40) * (0.4 + s));
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, h = 0.6 + Math.random() * 0.4;
      const sp = 0.4 + Math.random() * 1.3 * (0.5 + s);
      particles.spawn(x, 0.01, z, Math.cos(a) * sp * 0.6, (1.4 + Math.random() * 2.2) * (0.5 + s) * h, Math.sin(a) * sp * 0.6, 1.5, 0.018 + Math.random() * 0.022, 0.85, 0.95, 1);
    }
    // 가운데 물기둥
    for (let i = 0; i < 6; i++) particles.spawn(x, 0.02, z, (Math.random() - 0.5) * 0.15, 2.2 + s * 2.4 + Math.random(), (Math.random() - 0.5) * 0.15, 1.5, 0.03, 0.9, 0.97, 1);
    const c = crowns[crownI]; crownI = (crownI + 1) % crowns.length;
    c.t = 0; c.s = 0.5 + s; c.m.position.set(x, 0, z); c.m.visible = true;
  }
  function sparkFx(x, y, z, color = [1, 0.85, 0.4], n = 14) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, e = Math.random() * 1.2;
      sparks.spawn(x, y, z, Math.cos(a) * Math.cos(e) * 1.4, Math.sin(e) * 1.6, Math.sin(a) * Math.cos(e) * 1.4, 0.5 + Math.random() * 0.4, 0.03 + Math.random() * 0.03, ...color, 1);
    }
  }
  function successFx(x, y, z, zone) {
    pillar.position.set(x, y + 2.5, z); pillar.visible = true; pillarT = 0;
    pillarMat.uniforms.uColor.value.set(zone === 'pot' ? 0xffc04a : 0x9dffcf);
    for (let i = 0; i < (low ? 40 : 80); i++) {
      const a = Math.random() * Math.PI * 2, r = Math.random() * 0.5;
      sparks.spawn(x + Math.cos(a) * r, y + Math.random() * 0.3, z + Math.sin(a) * r, Math.cos(a) * 0.4, 0.8 + Math.random() * 2.2, Math.sin(a) * 0.4, 1.4 + Math.random(), 0.035 + Math.random() * 0.04, 1, 0.85 + Math.random() * 0.15, 0.4 + Math.random() * 0.4, 1);
    }
    if (zone === 'pot') potGlowT = 0;
  }
  let potGlowT = -1;

  /* --- 동전 --- */
  const COIN_SEG = low ? 32 : 48;
  const coinGeo = new THREE.CylinderGeometry(POND.COIN_R, POND.COIN_R, POND.COIN_H, COIN_SEG, 1);
  // 앞·뒷면 그림이 똑바로 보이도록 원판 UV 회전 (기본 UV는 90° 돌아가 있음)
  {
    const uv = coinGeo.attributes.uv, idx = coinGeo.index;
    coinGeo.groups.slice(1).forEach((g, gi) => {
      const done = new Set();
      for (let k = g.start; k < g.start + g.count; k++) {
        const v = idx.getX(k); if (done.has(v)) continue; done.add(v);
        const u0 = uv.getX(v), v0 = uv.getY(v);
        if (gi === 0) uv.setXY(v, v0, 1 - u0); else uv.setXY(v, 1 - v0, u0);
      }
    });
  }
  const ridgeTex = canvasTex(256, 8, (c, w, h) => { for (let x = 0; x < w; x++) { const v = x % 4 < 2 ? 200 : 120; c.fillStyle = `rgb(${v},${v},${v})`; c.fillRect(x, 0, 1, h); } }, 1);
  ridgeTex.repeat.set(1, 1);
  const atlas = new FaceAtlas(low ? 1024 : 2048, 128);
  const atlasCells = 1 / atlas.n;

  function faceMaterial(which) {
    const m = new THREE.MeshStandardMaterial({ map: atlas.tex, metalness: 0.75, roughness: 0.3, emissive: 0xffffff, emissiveMap: atlas.tex, emissiveIntensity: 0.18 });
    const base = underwater(m, shared, { tint: 0.3, glint: true });
    const prev = m.onBeforeCompile;
    m.onBeforeCompile = (sh) => {
      prev(sh);
      sh.vertexShader = 'attribute vec4 aCells;\n' + sh.vertexShader.replace('#include <uv_vertex>', `#include <uv_vertex>
        vMapUv = (aCells.${which} + uv) * ${atlasCells.toFixed(6)};
        vEmissiveMapUv = vMapUv;`);
    };
    m.customProgramCacheKey = () => 'face' + which + 'g';
    return base;
  }
  const CAP = low ? 240 : 420;
  const fieldGeo = coinGeo.clone();
  const cellAttr = new THREE.InstancedBufferAttribute(new Float32Array(CAP * 4), 4);
  fieldGeo.setAttribute('aCells', cellAttr);
  const sideMat = underwater(new THREE.MeshStandardMaterial({ map: ridgeTex, metalness: 1, roughness: 0.3, color: 0xffffff }), shared, { caustics: false, tint: 0.3 });
  const field = new THREE.InstancedMesh(fieldGeo, [sideMat, faceMaterial('xy'), faceMaterial('zw')], CAP);
  field.count = 0;
  field.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  field.frustumCulled = false;
  scene.add(field);
  const fieldRecords = new Array(CAP);
  let fieldNext = 0;
  atlas.onEvict = (key) => {
    for (let i = 0; i < field.count; i++) {
      const r = fieldRecords[i];
      if (r && designKey(r.design) === key) { cellAttr.setXYZW(i, ...atlas.cellUV(0), ...atlas.cellUV(1)); }
    }
    cellAttr.needsUpdate = true;
  };
  const _q = new THREE.Quaternion(), _p = new THREE.Vector3(), _s = new THREE.Vector3(1, 1, 1);
  function addToField(record, pos, quat) {
    const design = sanitizeDesign(record.design);
    const e = atlas.get(design);
    const i = fieldNext; fieldNext = (fieldNext + 1) % CAP;
    field.count = Math.max(field.count, i + 1);
    _m.compose(pos, quat, _s);
    field.setMatrixAt(i, _m);
    field.setColorAt(i, new THREE.Color(METALS[design.metal].side));
    cellAttr.setXYZW(i, ...atlas.cellUV(e.front), ...atlas.cellUV(e.back));
    fieldRecords[i] = record;
    field.instanceMatrix.needsUpdate = true;
    if (field.instanceColor) field.instanceColor.needsUpdate = true;
    cellAttr.needsUpdate = true;
  }
  function restQuat(rest, q = new THREE.Quaternion()) {
    const n = new THREE.Vector3(rest.nx, rest.ny, rest.nz).normalize();
    q.setFromUnitVectors(Y, n);
    q.multiply(new THREE.Quaternion().setFromAxisAngle(Y, rest.yaw));
    if (rest.flip) q.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI));
    return q;
  }

  // 한 개짜리 동전 (날아가는 중, 손에 든 동전) — 선명한 개별 텍스처
  function makeCoinMesh(design, size = low ? 256 : 384) {
    const d = sanitizeDesign(design);
    const mk = (side) => {
      const c = document.createElement('canvas'); c.width = c.height = size;
      drawFace(c.getContext('2d'), d, side, size);
      const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
      return underwater(new THREE.MeshStandardMaterial({ map: t, metalness: d.metal === 'jade' ? 0.2 : 0.75, roughness: METALS[d.metal].roughness, emissive: 0xffffff, emissiveMap: t, emissiveIntensity: 0.15 }), shared, { tint: 0.3 });
    };
    const side = underwater(new THREE.MeshStandardMaterial({ map: ridgeTex, color: METALS[d.metal].side, metalness: d.metal === 'jade' ? 0.2 : 1, roughness: 0.3 }), shared, { caustics: false, tint: 0.3 });
    const mesh = new THREE.Mesh(coinGeo, [side, mk('front'), mk('back')]);
    mesh.userData.dispose = () => mesh.material.forEach((m) => { m.map && m.map !== ridgeTex && m.map.dispose(); m.dispose(); });
    return mesh;
  }

  /* --- 날아가는 동전 --- */
  const flights = [];
  const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _dir = new THREE.Vector3();
  const qa = new THREE.Quaternion(), qb = new THREE.Quaternion();
  const X = new THREE.Vector3(1, 0, 0);
  function framePos(sim, t, out) {
    const f = sim.frames, n = f.length / 3;
    const x = Math.min(n - 1, Math.max(0, t * sim.fps));
    const i = Math.floor(x), k = x - i, j = Math.min(n - 1, i + 1);
    out.set(f[i * 3] + (f[j * 3] - f[i * 3]) * k, f[i * 3 + 1] + (f[j * 3 + 1] - f[i * 3 + 1]) * k, f[i * 3 + 2] + (f[j * 3 + 2] - f[i * 3 + 2]) * k);
    return out;
  }
  /**
   * record: { design, launch, ... }  opts: { onEvent(ev), onDone(), follow, fromHand }
   */
  function playThrow(record, opts = {}) {
    const sim = simulate(record.launch);
    const mesh = opts.mesh || makeCoinMesh(record.design);
    scene.add(mesh);
    const impact = sim.events.find((e) => e.type !== 'stone' && e.type !== 'ceramic');
    const fl = {
      record, sim, mesh, t: 0, ei: 0, opts,
      impactT: impact ? impact.t : sim.duration,
      spinRate: (5 + (record.launch.spin || 0.5) * 9) * Math.PI * 2,
      qImpact: null, qRest: restQuat(sim.rest), handFrom: opts.fromHand ? opts.fromHand.clone() : null,
      headQ: new THREE.Quaternion(), done: false, bubbleT: 0,
    };
    flights.push(fl);
    if (opts.follow) follow.target = fl;
    return sim;
  }
  function updateFlight(fl, dt) {
    fl.t += dt;
    const { sim, mesh } = fl;
    const t = fl.t;
    framePos(sim, t, _a);
    if (fl.handFrom && t < 0.12) _a.lerp(fl.handFrom, 1 - t / 0.12);
    mesh.position.copy(_a);
    // 이벤트
    while (fl.ei < sim.events.length && sim.events[fl.ei].t <= t) {
      const ev = sim.events[fl.ei++];
      if (ev.type === 'splash') splashFx(ev.x, ev.z, ev.speed);
      else if (ev.type === 'stone' || ev.type === 'ceramic') sparkFx(ev.x, ev.y, ev.z, [1, 0.9, 0.6], 10);
      else if (ev.type === 'turtle' || ev.type === 'potland') successFx(ev.x, ev.y, ev.z, ev.type === 'turtle' ? 'turtle' : 'pot');
      else if (ev.type === 'ground') sparkFx(ev.x, ev.y, ev.z, [0.6, 0.55, 0.4], 6);
      fl.opts.onEvent && fl.opts.onEvent(ev, fl);
    }
    const end = sim.duration;
    if (t < fl.impactT) {
      framePos(sim, t + 1 / 60, _b);
      _dir.subVectors(_b, _a); _dir.y = 0;
      if (_dir.lengthSq() > 1e-8) fl.headQ.setFromAxisAngle(Y, Math.atan2(_dir.x, _dir.z));
      qa.setFromAxisAngle(X, t * fl.spinRate);
      mesh.quaternion.copy(fl.headQ).multiply(qa);
      // 반짝이 꼬리
      if (fl.opts.follow && Math.random() < 0.6) sparks.spawn(_a.x, _a.y, _a.z, 0, 0.05, 0, 0.5, 0.025, 1, 0.85, 0.45, 1);
    } else if (t < end) {
      if (!fl.qImpact) fl.qImpact = mesh.quaternion.clone();
      const k = (t - fl.impactT) / Math.max(0.01, end - fl.impactT);
      const e = 1 - Math.pow(1 - k, 2);
      mesh.quaternion.copy(fl.qImpact).slerp(fl.qRest, e);
      qb.setFromAxisAngle(new THREE.Vector3(Math.cos(t * 3), 0, Math.sin(t * 3)), Math.sin(t * 7) * 0.7 * (1 - k));
      mesh.quaternion.premultiply(qb);
      if (_a.y < -0.02) {
        fl.bubbleT -= dt;
        if (fl.bubbleT <= 0) { fl.bubbleT = 0.06 + Math.random() * 0.1; bubblesP.spawn(_a.x, _a.y, _a.z, 0, 0.35 + Math.random() * 0.25, 0, 3, 0.012 + Math.random() * 0.012, 0.85, 0.95, 1, 2); }
      }
    } else {
      // 멈춘 뒤 "따르르" 흔들림
      const k = Math.min(1, (t - end) / 0.8);
      const amp = 0.22 * (1 - k) * (1 - k);
      const rate = 10 + 40 * k;
      qb.setFromAxisAngle(new THREE.Vector3(Math.cos(t * rate), 0, Math.sin(t * rate)), amp);
      mesh.quaternion.copy(fl.qRest).premultiply(qb);
      if (k >= 1) {
        fl.done = true;
        mesh.quaternion.copy(fl.qRest);
        addToField(fl.record, mesh.position, mesh.quaternion);
        scene.remove(mesh);
        mesh.userData.dispose && mesh.userData.dispose();
        fl.opts.onDone && fl.opts.onDone(fl);
      }
    }
  }

  /** 이미 연못에 있는 동전 (애니메이션 없이 바로) */
  function placeCoin(record) {
    const rest = record.land && Number.isFinite(record.land.x) ? record.land : simulate(record.launch).rest;
    _p.set(rest.x, rest.y, rest.z);
    addToField(record, _p, restQuat(rest, _q));
  }

  /* --- 카메라 --- */
  const follow = { target: null, hold: 0 };
  const camHome = { pos: new THREE.Vector3(), look: new THREE.Vector3() };
  const camLook = new THREE.Vector3();
  function setHome() {
    const asp = camera.aspect;
    if (mode === 'pond') {
      const k = asp < 1 ? 1.25 / Math.max(0.45, asp) : asp < 1.5 ? 1.15 : 1;
      camHome.pos.set(0, 6.4 * k, 7.6 * k); camHome.look.set(0, -0.5, -0.4);
      camera.fov = asp < 1 ? 46 : 40;
    } else {
      camHome.pos.set(0, 2.9, 6.9); camHome.look.set(0, -0.35, -1.1);
      camera.fov = asp < 0.75 ? 64 : 52;
    }
    camera.updateProjectionMatrix();
  }
  function resize() {
    const w = canvas.clientWidth || innerWidth, h = canvas.clientHeight || innerHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    setHome();
    const pr = renderer.getPixelRatio();
    reflRT.setSize(Math.max(64, Math.round(w * pr * reflScale)), Math.max(64, Math.round(h * pr * reflScale)));
    [particles, sparks, bubblesP].forEach((p) => (p.mat.uniforms.uScale.value = h * pr * 0.9));
  }
  resize();
  camera.position.copy(camHome.pos); camLook.copy(camHome.look); camera.lookAt(camLook);
  addEventListener('resize', resize);

  /* --- 손에 든 동전 (던지는 폰) --- */
  let handCoin = null, handMode = 'hidden', handDrag = { x: 0, y: 0 }, handFlip = 0;
  const handPose = { edit: new THREE.Vector3(0, 0.3, -0.9), ready: new THREE.Vector3(0, -0.36, -0.95) };
  function setHandCoin(design) {
    if (handCoin) { camera.remove(handCoin); handCoin.userData.dispose(); }
    handCoin = makeCoinMesh(design, 512);
    handCoin.renderOrder = 10;
    camera.add(handCoin);
    handCoin.visible = handMode !== 'hidden';
    return handCoin;
  }
  function setHandMode(m) { handMode = m; if (handCoin) handCoin.visible = m !== 'hidden'; handDrag = { x: 0, y: 0 }; }
  function setHandDrag(x, y) { handDrag = { x, y }; }
  function handWorldPos() { return handCoin ? handCoin.getWorldPosition(new THREE.Vector3()) : null; }
  /** 손 동전을 그대로 던짐 */
  function throwFromHand(record, opts = {}) {
    const from = handWorldPos();
    const mesh = handCoin; // 같은 메시를 장면으로 옮겨 이어서 날림
    if (mesh) { camera.remove(mesh); mesh.renderOrder = 0; }
    handCoin = null;
    return playThrow(record, { ...opts, mesh: mesh || undefined, fromHand: from });
  }

  /* --- 선택 (동전 탭) --- */
  const ray = new THREE.Raycaster();
  function pick(clientX, clientY) {
    const r = canvas.getBoundingClientRect();
    ray.setFromCamera(new THREE.Vector2(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1), camera);
    // 동전이 작으니 근처 동전을 찾아줌
    const hits = ray.intersectObject(field, false);
    if (hits.length) return fieldRecords[hits[0].instanceId] || null;
    const plane = new THREE.Plane(Y, 0.5);
    let best = null, bd = 0.35;
    const o = ray.ray;
    for (let i = 0; i < field.count; i++) {
      field.getMatrixAt(i, _m); _p.setFromMatrixPosition(_m);
      const d = o.distanceToPoint(_p);
      if (d < bd) { bd = d; best = fieldRecords[i]; }
    }
    void plane;
    return best;
  }

  /* --- 루프 --- */
  let running = true, last = performance.now(), timeScale = 1;
  const listeners = [];
  function frame(now) {
    if (!running) return;
    requestAnimationFrame(frame);
    const dt = Math.min(0.05, (now - last) / 1000) * timeScale; last = now;
    shared.uTime.value += dt;
    const time = shared.uTime.value;

    for (let i = flights.length - 1; i >= 0; i--) {
      updateFlight(flights[i], dt);
      if (flights[i].done) { if (follow.target === flights[i]) { follow.target = null; follow.hold = 1.4; } flights.splice(i, 1); }
    }
    particles.update(dt, (x, z, s) => Math.random() < 0.35 && addRipple(x, z, s));
    sparks.update(dt);
    bubblesP.update(dt, (x, z, s) => Math.random() < 0.5 && addRipple(x, z, s));
    crowns.forEach((c) => {
      if (c.t < 0) return;
      c.t += dt;
      const k = c.t / 0.45;
      if (k >= 1) { c.t = -1; c.m.visible = false; return; }
      c.m.scale.set(0.05 + k * 0.22 * c.s, (0.04 + Math.sin(k * Math.PI) * 0.22) * c.s, 0.05 + k * 0.22 * c.s);
      c.m.position.y = c.m.scale.y / 2;
      c.m.material.opacity = 0.55 * (1 - k);
    });
    if (pillarT >= 0) {
      pillarT += dt;
      const k = pillarT / 2.6;
      pillarMat.uniforms.uA.value = Math.sin(Math.min(1, k) * Math.PI) * 1.2;
      pillar.rotation.y += dt;
      if (k >= 1) { pillarT = -1; pillar.visible = false; }
    }
    if (potGlowT >= 0) {
      potGlowT += dt;
      potGlow.material.opacity = Math.max(0, 0.8 * Math.sin(Math.min(1, potGlowT / 2) * Math.PI));
      if (potGlowT > 2) potGlowT = -1;
    }
    pads.forEach((g) => { g.position.y = 0.006 + Math.sin(time * 0.8 + g.userData.phase) * 0.004; g.rotation.z = Math.sin(time * 0.6 + g.userData.phase) * 0.02; });
    lanterns.forEach((b, i) => (b.material.emissiveIntensity = 2 + Math.sin(time * 7 + i * 2) * 0.12 + Math.sin(time * 13 + i) * 0.08));

    // 카메라
    const lerp = 1 - Math.exp(-dt * 2.6);
    let wantPos = camHome.pos, wantLook = camHome.look;
    if (follow.target && !follow.target.done) {
      const m = follow.target.mesh.position;
      const behind = _b.set(m.x * 0.6, Math.max(0.9, m.y + 1.05), Math.max(m.z + 2.3, -1));
      wantPos = behind.lerp(camHome.pos, 0.25);
      wantLook = _dir.copy(m);
      follow.last = wantLook.clone(); follow.lastPos = wantPos.clone();
    } else if (follow.hold > 0) {
      follow.hold -= dt;
      wantPos = follow.lastPos || wantPos; wantLook = follow.last || wantLook;
    }
    if (mode === 'pond') {
      const drift = _t.set(Math.sin(time * 0.07) * 0.35, Math.sin(time * 0.05) * 0.12, 0);
      camera.position.lerp(_v.copy(wantPos).add(drift), lerp * 0.5);
    } else {
      camera.position.lerp(wantPos, lerp);
    }
    camLook.lerp(wantLook, lerp);
    camera.lookAt(camLook);

    // 손 동전
    if (handCoin && handCoin.parent === camera) {
      const pose = handMode === 'edit' ? handPose.edit : handPose.ready;
      handCoin.position.set(pose.x + handDrag.x * 0.35, pose.y + handDrag.y * 0.35 + Math.sin(time * 1.6) * 0.008, pose.z);
      if (handMode === 'edit') {
        handCoin.rotation.set(Math.PI / 2 + handFlip * Math.PI, Math.sin(time * 0.8) * 0.25, Math.sin(time * 0.6) * 0.35, 'XYZ');
      } else {
        handCoin.rotation.set(Math.PI / 2 - 0.55 - handDrag.y * 0.8, Math.sin(time * 1.3) * 0.12, handDrag.x * 0.5, 'XYZ');
      }
    }

    atlas.flush();
    renderReflection();
    renderer.render(scene, camera);
    listeners.forEach((f) => f(dt, time));
  }
  requestAnimationFrame(frame);

  return {
    THREE, scene, camera, renderer,
    playThrow, placeCoin, addRipple, pick,
    setHandCoin, setHandMode, setHandDrag, throwFromHand,
    flipHandCoin() { handFlip ^= 1; },
    onFrame: (f) => listeners.push(f),
    get flying() { return flights.length; },
    get coinCount() { return field.count; },
    turtleHead,
    stop() { running = false; },
    setTimeScale(k) { timeScale = k; },
  };
}

function mulberry(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
