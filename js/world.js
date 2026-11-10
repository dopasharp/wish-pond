// 3D 연못. 연못 화면(pond)과 던지는 폰(thrower)이 같은 장면을 씁니다.
import * as THREE from '../vendor/three.module.min.js';
import { POND, POT_PROFILE, potRadius, floorY, simulate, turtleHead } from './physics.js';
import { drawFace, METALS, designKey, sanitizeDesign } from './coin-art.js';

const SUN = new THREE.Vector3(-0.38, 0.78, 0.5).normalize();
const Y = new THREE.Vector3(0, 1, 0);

// 맑은 낮 하늘 + 분홍빛 지평선 + 몽글몽글 구름
const SKY_GLSL = /* glsl */`
uniform vec3 uSun;
float sHash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float sNoise(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);
  return mix(mix(sHash(i), sHash(i+vec2(1.,0.)), f.x), mix(sHash(i+vec2(0.,1.)), sHash(i+vec2(1.,1.)), f.x), f.y); }
float fbm(vec2 p){ float a = 0.5, s = 0.0; for (int i = 0; i < 5; i++) { s += a * sNoise(p); p *= 2.03; a *= 0.5; } return s; }
vec3 skyColor(vec3 d){
  d = normalize(d);
  float h = d.y;
  vec3 zen = vec3(0.16, 0.42, 0.95);
  vec3 mid = vec3(0.45, 0.7, 1.0);
  vec3 hor = vec3(1.0, 0.82, 0.86);
  vec3 c = mix(hor, mid, smoothstep(0.0, 0.25, h));
  c = mix(c, zen, smoothstep(0.25, 0.9, h));
  float s = max(dot(d, uSun), 0.0);
  c += vec3(1.0, 0.92, 0.75) * pow(s, 8.0) * 0.35 + vec3(1.0, 0.95, 0.85) * pow(s, 400.0) * 4.0;
  if (h > 0.0) {
    vec2 uv = d.xz / (h + 0.18) * 0.9;
    float cl = smoothstep(0.5, 0.78, fbm(uv + vec2(3.1, 7.7)));
    vec3 cc = mix(vec3(1.0, 0.9, 0.95), vec3(1.0), smoothstep(0.55, 0.8, fbm(uv * 1.7)));
    c = mix(c, cc * 1.15, cl * 0.85 * smoothstep(0.0, 0.12, h));
  }
  c = mix(c, vec3(0.92, 0.88, 0.82), smoothstep(0.0, -0.08, h));
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
        gl_FragColor.rgb += vec3(1.0, 1.0, 0.92) * cs * 0.32 * smoothstep(0.0, 0.08, uwDepth);` : ''}
        gl_FragColor.rgb = mix(gl_FragColor.rgb, gl_FragColor.rgb * vec3(0.72, 1.0, 1.05) + vec3(0.03, 0.12, 0.14), clamp(uwDepth * 1.1, 0.0, ${tint.toFixed(2)}) * smoothstep(0.0, 0.03, uwDepth));
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
    this.kind = new Uint8Array(max); // 0 물방울, 1 반짝이, 2 기포, 3 분수 물줄기(물결 없음)
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
      if (this.kind[i] === 0 || this.kind[i] === 3) {
        this.vel[j + 1] -= 9.8 * dt;
        if (this.pos[j + 1] < 0 && this.vel[j + 1] < 0) { this.life[i] = 0; this.alpha[i] = 0; if (this.kind[i] === 0 && onPop) onPop(this.pos[j], this.pos[j + 2], 0.12); continue; }
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
  renderer.toneMappingExposure = 0.82;
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0xeaf1fb, 28, 85);
  const camera = new THREE.PerspectiveCamera(mode === 'pond' ? 40 : 60, 1, 0.05, 160);
  scene.add(camera);
  const shared = { uTime: { value: 0 } };
  if (!low) { renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap; }
  const shadow = (o, cast = true, recv = true) => { o.traverse((m) => { if (m.isMesh) { m.castShadow = cast; m.receiveShadow = recv; } }); return o; };

  /* --- 하늘 --- */
  const skyMat = new THREE.ShaderMaterial({
    uniforms: { uSun: { value: SUN } },
    vertexShader: `varying vec3 vDir; void main(){ vDir = normalize(position); vec4 p = projectionMatrix*modelViewMatrix*vec4(position,1.); gl_Position = p.xyww; }`,
    fragmentShader: SKY_GLSL + `
      varying vec3 vDir;
      void main(){
        gl_FragColor = vec4(skyColor(vDir), 1.);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
    side: THREE.BackSide, depthWrite: false, fog: false,
  });
  const sky = new THREE.Mesh(new THREE.SphereGeometry(120, 48, 24), skyMat);
  sky.renderOrder = -10;
  scene.add(sky);

  // 금속·대리석 반사용 환경맵 (밝은 하늘 + 흰 궁전)
  {
    const pm = new THREE.PMREMGenerator(renderer);
    const envScene = new THREE.Scene();
    envScene.add(new THREE.Mesh(new THREE.SphereGeometry(50, 32, 16), new THREE.ShaderMaterial({
      uniforms: { uSun: { value: SUN } }, side: THREE.BackSide,
      vertexShader: 'varying vec3 vDir; void main(){ vDir=normalize(position); gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.); }',
      fragmentShader: SKY_GLSL + '\nvarying vec3 vDir; void main(){ gl_FragColor=vec4(skyColor(vDir),1.); }',
    })));
    const wall = new THREE.Mesh(new THREE.PlaneGeometry(40, 14), new THREE.MeshBasicMaterial({ color: 0xf3ead8 }));
    wall.position.set(0, 4, -9); envScene.add(wall);
    const sunBall = new THREE.Mesh(new THREE.SphereGeometry(3, 16, 8), new THREE.MeshBasicMaterial({ color: new THREE.Color(6, 5.6, 4.8) }));
    sunBall.position.copy(SUN).multiplyScalar(40); envScene.add(sunBall);
    scene.environment = pm.fromScene(envScene, 0.02).texture;
    pm.dispose();
  }

  /* --- 빛 --- */
  scene.add(new THREE.HemisphereLight(0xcfe4ff, 0xe8d2b0, 0.95));
  const sun = new THREE.DirectionalLight(0xffe9c8, 2.7);
  sun.position.copy(SUN).multiplyScalar(22);
  if (!low) {
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    Object.assign(sun.shadow.camera, { left: -13, right: 13, top: 13, bottom: -13, near: 1, far: 60 });
    sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.02;
  }
  scene.add(sun);

  /* --- 재질 텍스처 --- */
  const marbleTex = canvasTex(512, 512, (c, w, h) => {
    c.fillStyle = '#f6f3ec'; c.fillRect(0, 0, w, h);
    for (let i = 0; i < 900; i++) { c.fillStyle = `rgba(${200 + Math.random() * 40},${195 + Math.random() * 40},${190 + Math.random() * 40},.25)`; c.fillRect(Math.random() * w, Math.random() * h, 3, 3); }
    c.lineCap = 'round';
    for (let k = 0; k < 14; k++) {
      c.strokeStyle = k % 5 === 0 ? 'rgba(212,175,95,.35)' : `rgba(150,150,160,${0.12 + Math.random() * 0.18})`;
      c.lineWidth = 0.6 + Math.random() * 2.2;
      let x = Math.random() * w, y = Math.random() * h;
      c.beginPath(); c.moveTo(x, y);
      for (let j = 0; j < 8; j++) { x += (Math.random() - 0.3) * 90; y += (Math.random() - 0.5) * 70; c.quadraticCurveTo(x - 30, y + 20, x, y); }
      c.stroke();
    }
  }, 1);
  const travTex = canvasTex(512, 512, (c, w, h) => {
    const n = 4, s = w / n;
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
      const l = 78 + Math.random() * 7;
      c.fillStyle = `hsl(${32 + Math.random() * 8},${28 + Math.random() * 14}%,${l}%)`;
      c.fillRect(i * s, j * s, s, s);
      for (let k = 0; k < 40; k++) { c.fillStyle = 'rgba(160,130,90,.12)'; c.fillRect(i * s + Math.random() * s, j * s + Math.random() * s, 2 + Math.random() * 10, 1.5); }
    }
    c.strokeStyle = 'rgba(170,150,120,.55)'; c.lineWidth = 3;
    for (let i = 0; i <= n; i++) { c.beginPath(); c.moveTo(i * s, 0); c.lineTo(i * s, h); c.stroke(); c.beginPath(); c.moveTo(0, i * s); c.lineTo(w, i * s); c.stroke(); }
  }, 1);
  const blockTex = canvasTex(512, 512, (c, w, h) => {
    c.fillStyle = '#e6d6b8'; c.fillRect(0, 0, w, h);
    for (let i = 0; i < 1500; i++) { c.fillStyle = `rgba(170,140,100,${Math.random() * 0.12})`; c.fillRect(Math.random() * w, Math.random() * h, 1 + Math.random() * 8, 1); }
    c.strokeStyle = 'rgba(175,155,125,.5)'; c.lineWidth = 2;
    for (let r = 0; r < 8; r++) {
      const y = r * 64; c.beginPath(); c.moveTo(0, y); c.lineTo(w, y); c.stroke();
      for (let x = (r % 2) * 64; x < w; x += 128) { c.beginPath(); c.moveTo(x, y); c.lineTo(x, y + 64); c.stroke(); }
    }
  }, 1);
  const marble = (color = 0xffffff, rough = 0.32, map = marbleTex) => new THREE.MeshStandardMaterial({ color, map, roughness: rough, metalness: 0 });
  const gold = new THREE.MeshStandardMaterial({ color: 0xf2c55c, metalness: 1, roughness: 0.22 });
  const dummy = new THREE.Object3D();

  /* --- 광장 바닥 --- */
  const plazaTex = travTex.clone(); plazaTex.needsUpdate = true; plazaTex.repeat.set(26, 26);
  const ground = new THREE.Mesh(new THREE.RingGeometry(POND.R + 0.6, 60, 128, 4), new THREE.MeshStandardMaterial({ map: plazaTex, roughness: 0.75 }));
  ground.rotation.x = -Math.PI / 2; ground.position.y = POND.GROUND - 0.02;
  ground.receiveShadow = true;
  scene.add(ground);

  /* --- 연못 바닥: 청록·흰색·금색 모자이크 --- */
  const mosaicTex = canvasTex(1024, 1024, (c, w, h) => {
    const n = 128, s = w / n;
    c.fillStyle = '#d9eef0'; c.fillRect(0, 0, w, h);
    const pal = ['#f4fbfb', '#cdeff1', '#9fe0e6', '#6fcfd9', '#3fb5c7'];
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
      const x = (i + 0.5) / n * 2 - 1, y = (j + 0.5) / n * 2 - 1;
      const r = Math.hypot(x, y), a = Math.atan2(y, x);
      const ring = Math.floor(r * 14), ray = Math.floor(((a + Math.PI) / (Math.PI * 2)) * 24);
      let col = pal[(ring + (ray % 2 ? 1 : 0)) % 3];
      if (ring % 4 === 3) col = pal[3 + (ray % 2)];
      if (r < 0.12) col = (ring + ray) % 2 ? '#f2d488' : '#fff3c9';
      if (ring === 9 && ray % 3 === 0) col = '#f2d488';
      if (Math.random() < 0.06) col = pal[Math.floor(Math.random() * 3)];
      c.fillStyle = col;
      c.fillRect(i * s + 0.6, j * s + 0.6, s - 1.2, s - 1.2);
    }
  }, 1);
  mosaicTex.wrapS = mosaicTex.wrapT = THREE.ClampToEdgeWrapping;
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
  const floor = new THREE.Mesh(floorGeo, underwater(new THREE.MeshStandardMaterial({ map: mosaicTex, roughness: 0.4 }), shared));
  floor.receiveShadow = true;
  scene.add(floor);

  /* --- 대리석 테두리 (몰딩) --- */
  {
    const pts = [[POND.R - 0.02, -0.5], [POND.R, 0.22], [POND.R + 0.03, 0.29], [POND.R + 0.1, 0.33], [POND.R + 0.2, POND.RIM_TOP + 0.01], [POND.RIM_OUT - 0.18, POND.RIM_TOP + 0.01],
      [POND.RIM_OUT - 0.07, 0.31], [POND.RIM_OUT - 0.02, 0.25], [POND.RIM_OUT, 0.17], [POND.RIM_OUT + 0.06, 0.12], [POND.RIM_OUT + 0.1, 0.02]].map(([r, y]) => new THREE.Vector2(r, y));
    const rimTex = marbleTex.clone(); rimTex.needsUpdate = true; rimTex.repeat.set(14, 1);
    const rim = new THREE.Mesh(new THREE.LatheGeometry(pts, 200), underwater(marble(0xffffff, 0.28, rimTex), shared, { caustics: false, tint: 0.3 }));
    shadow(rim); scene.add(rim);
    // 금빛 띠
    const band = new THREE.Mesh(new THREE.TorusGeometry(POND.RIM_OUT + 0.005, 0.018, 8, 200), gold);
    band.rotation.x = Math.PI / 2; band.position.y = 0.2; scene.add(band);
  }

  /* --- 귀여운 대리석 거북 --- */
  const T = POND.turtle;
  const shellTex = canvasTex(1024, 512, (c, w, h) => {
    const g = c.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, '#f7fffb'); g.addColorStop(0.55, '#c9eedf'); g.addColorStop(1, '#9fdcc6');
    c.fillStyle = g; c.fillRect(0, 0, w, h);
    c.strokeStyle = 'rgba(214,168,70,.85)'; c.lineWidth = 5;
    const s = 78;
    for (let row = -1; row < h / (s * 0.86) + 1; row++) for (let col = -1; col < w / s + 1; col++) {
      const cx = col * s * 1.5, cy = row * s * 1.73 + (col % 2 ? s * 0.86 : 0);
      c.beginPath();
      for (let k = 0; k <= 6; k++) { const a = (k / 6) * Math.PI * 2; c[k ? 'lineTo' : 'moveTo'](cx + Math.cos(a) * s * 0.92, cy + Math.sin(a) * s * 0.92); }
      c.stroke();
      c.fillStyle = 'rgba(255,255,255,.35)'; c.beginPath(); c.arc(cx - 14, cy - 16, 12, 0, 7); c.fill();
    }
  }, 1);
  const shellMat = underwater(new THREE.MeshPhysicalMaterial({ map: shellTex, roughness: 0.25, clearcoat: 1, clearcoatRoughness: 0.08, sheen: 0.4, sheenColor: new THREE.Color(0xc8fff0) }), shared, { caustics: false, tint: 0.3 });
  const bodyMat = underwater(marble(0xfdfaf4, 0.3), shared, { caustics: false, tint: 0.3 });
  const turtle = new THREE.Group();
  turtle.position.set(T.x, 0, T.z);
  turtle.rotation.y = -T.yaw;
  const shellMesh = new THREE.Mesh(new THREE.SphereGeometry(1, 64, 32), shellMat);
  shellMesh.scale.set(T.rx, T.ry, T.rz); shellMesh.position.y = T.y;
  turtle.add(shellMesh);
  const shellRim = new THREE.Mesh(new THREE.TorusGeometry(1, 0.05, 10, 72), gold);
  shellRim.rotation.x = Math.PI / 2; shellRim.scale.set(T.rx * 1.01, T.rz * 1.01, 1); shellRim.position.y = T.y + 0.035;
  turtle.add(shellRim);
  const head = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 20), bodyMat);
  head.scale.set(0.26, 0.23, 0.27); head.position.set(0, 0.16, T.rz + 0.16);
  turtle.add(head);
  const eyeMat = new THREE.MeshPhysicalMaterial({ color: 0x1d1a24, roughness: 0.1, clearcoat: 1 });
  const hiMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
  const blushMat = new THREE.MeshStandardMaterial({ color: 0xffa9c2, roughness: 0.6, transparent: true, opacity: 0.85 });
  [-1, 1].forEach((sx) => {
    const e = new THREE.Mesh(new THREE.SphereGeometry(0.052, 16, 12), eyeMat);
    e.position.set(sx * 0.12, 0.22, T.rz + 0.37); turtle.add(e);
    const hl = new THREE.Mesh(new THREE.SphereGeometry(0.017, 8, 6), hiMat);
    hl.position.set(sx * 0.12 + 0.015, 0.24, T.rz + 0.42); turtle.add(hl);
    const b = new THREE.Mesh(new THREE.SphereGeometry(0.045, 12, 8), blushMat);
    b.scale.set(1, 0.55, 0.4); b.position.set(sx * 0.19, 0.13, T.rz + 0.33); turtle.add(b);
  });
  const smile = new THREE.Mesh(new THREE.TorusGeometry(0.045, 0.008, 6, 16, Math.PI), new THREE.MeshBasicMaterial({ color: 0x6b4a4a }));
  smile.position.set(0, 0.13, T.rz + 0.425); smile.rotation.z = Math.PI; turtle.add(smile);
  [[-1, 1], [1, 1], [-1, -1], [1, -1]].forEach(([sx, sz]) => {
    const l = new THREE.Mesh(new THREE.SphereGeometry(1, 20, 12), bodyMat);
    l.scale.set(0.2, 0.09, 0.15); l.position.set(sx * T.rx * 0.9, 0.0, sz * T.rz * 0.6); l.rotation.y = sx * sz * 0.6;
    turtle.add(l);
  });
  shadow(turtle);
  scene.add(turtle);

  /* --- 금테 대리석 항아리 --- */
  const P = POND.pot;
  const potPts = [];
  const hgt = P.top - P.base;
  potPts.push(new THREE.Vector2(0.001, 0));
  for (let i = 0; i <= 40; i++) { const u = i / 40; potPts.push(new THREE.Vector2(potRadius(u), u * hgt)); }
  potPts.push(new THREE.Vector2(potRadius(1) - 0.015, hgt + 0.025));
  potPts.push(new THREE.Vector2(potRadius(1) - 0.045, hgt + 0.005));
  for (let i = 40; i >= 2; i--) { const u = i / 40; potPts.push(new THREE.Vector2(Math.max(0.05, potRadius(u) - 0.045), u * hgt)); }
  potPts.push(new THREE.Vector2(0.001, 0.07));
  const potTex = marbleTex.clone(); potTex.needsUpdate = true; potTex.repeat.set(3, 1);
  const potMat = underwater(new THREE.MeshPhysicalMaterial({ color: 0xffffff, map: potTex, roughness: 0.2, clearcoat: 1, clearcoatRoughness: 0.06, side: THREE.DoubleSide }), shared, { caustics: false, tint: 0.3 });
  const pot = new THREE.Mesh(new THREE.LatheGeometry(potPts, 64), potMat);
  pot.position.set(P.x, P.base, P.z);
  shadow(pot); scene.add(pot);
  [[1, 0.022], [0.52, 0.016], [0.86, 0.012]].forEach(([u, t]) => {
    const ring = new THREE.Mesh(new THREE.TorusGeometry(potRadius(u) + (u === 1 ? -0.012 : 0.004), t, 8, 64), gold);
    ring.rotation.x = Math.PI / 2; ring.position.set(P.x, P.base + u * hgt + (u === 1 ? 0.022 : 0), P.z);
    scene.add(ring);
  });
  const potGlow = new THREE.Mesh(new THREE.CircleGeometry(potRadius(1) - 0.05, 32), new THREE.MeshBasicMaterial({ color: 0xffc44d, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }));
  potGlow.rotation.x = -Math.PI / 2; potGlow.position.set(P.x, P.top - 0.02, P.z);
  scene.add(potGlow);

  /* --- 궁전 파사드 + 폭포 (바로크 분수 광장) --- */
  const FZ = -7.4; // 벽 앞면
  const facade = new THREE.Group();
  const wallMat = new THREE.MeshStandardMaterial({ map: blockTex, roughness: 0.85 });
  const blk = (w, h, d, x, y, z, mat = wallMat) => { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat); m.position.set(x, y, z); facade.add(m); return m; };
  const wallTex = (m, rx, ry) => { const t = blockTex.clone(); t.needsUpdate = true; t.repeat.set(rx, ry); m.material = new THREE.MeshStandardMaterial({ map: t, roughness: 0.85 }); };
  wallTex(blk(8.6, 8.2, 1, -5.8, 4.1, FZ - 0.5), 4, 4);
  wallTex(blk(8.6, 8.2, 1, 5.8, 4.1, FZ - 0.5), 4, 4);
  wallTex(blk(3.2, 3.4, 1, 0, 6.5, FZ - 0.5), 1.5, 1.7);
  blk(20.6, 0.8, 1.6, 0, 0.4, FZ + 0.1, marble(0xf3eee4, 0.5));
  const colMat = marble(0xfbf8f1, 0.35);
  [-7.4, -5.0, -2.35, 2.35, 5.0, 7.4].forEach((x) => {
    blk(0.95, 0.42, 0.95, x, 1.01, FZ + 0.42, colMat);
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.33, 0.37, 4.75, 28), colMat);
    shaft.position.set(x, 3.6, FZ + 0.42); facade.add(shaft);
    blk(1.0, 0.36, 1.0, x, 6.15, FZ + 0.42, colMat);
    const cap = new THREE.Mesh(new THREE.TorusGeometry(0.36, 0.06, 8, 24), gold);
    cap.rotation.x = Math.PI / 2; cap.position.set(x, 5.95, FZ + 0.42); facade.add(cap);
  });
  blk(20.8, 0.85, 1.7, 0, 6.75, FZ + 0.15, marble(0xf7f2e8, 0.45));
  blk(21.2, 0.24, 2.0, 0, 7.3, FZ + 0.2, marble(0xffffff, 0.4));
  blk(10.5, 1.5, 1.1, 0, 8.15, FZ - 0.2, marble(0xf3ece0, 0.5));
  blk(10.9, 0.18, 1.3, 0, 8.95, FZ - 0.2, marble(0xffffff, 0.4));
  // 왕관 장식
  const crest = new THREE.Mesh(new THREE.SphereGeometry(0.42, 24, 16, 0, Math.PI * 2, 0, Math.PI / 2), gold);
  crest.position.set(0, 9.04, FZ - 0.1); facade.add(crest);
  const star = new THREE.Mesh(new THREE.OctahedronGeometry(0.22), gold); star.position.set(0, 9.7, FZ - 0.1); facade.add(star);
  // 창문
  const glassMat = new THREE.MeshPhysicalMaterial({ color: 0x9ec3dc, roughness: 0.05, metalness: 0.2, clearcoat: 1 });
  const frameMat = marble(0xffffff, 0.4);
  [-6.2, -3.65, 3.65, 6.2].forEach((x) => {
    blk(1.45, 2.1, 0.12, x, 4.0, FZ + 0.03, frameMat);
    blk(1.12, 1.78, 0.06, x, 4.0, FZ + 0.08, glassMat);
    blk(1.75, 0.16, 0.32, x, 5.18, FZ + 0.12, frameMat);
    const ped = new THREE.Mesh(new THREE.CylinderGeometry(0.95, 0.95, 0.3, 3, 1), frameMat);
    ped.rotation.set(Math.PI / 2, 0, Math.PI / 2); ped.scale.set(1, 1, 0.32); ped.position.set(x, 5.5, FZ + 0.1); facade.add(ped);
    blk(1.6, 0.14, 0.4, x, 2.88, FZ + 0.15, frameMat);
    for (let k = -2; k <= 2; k++) { const b = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.07, 0.42, 8), frameMat); b.position.set(x + k * 0.28, 2.6, FZ + 0.15); facade.add(b); }
    blk(1.6, 0.1, 0.38, x, 2.36, FZ + 0.15, frameMat);
  });
  // 가운데 반원 벽감 (금빛 모자이크 돔)
  const nicheMat = new THREE.MeshStandardMaterial({ color: 0xf4ead6, roughness: 0.6, side: THREE.DoubleSide, map: blockTex });
  const niche = new THREE.Mesh(new THREE.CylinderGeometry(1.5, 1.5, 4.2, 40, 1, true, Math.PI / 2, Math.PI), nicheMat);
  niche.position.set(0, 2.9, FZ); facade.add(niche);
  const domeTex = canvasTex(512, 256, (c, w, h) => {
    const g = c.createLinearGradient(0, 0, 0, h); g.addColorStop(0, '#fff2b8'); g.addColorStop(1, '#e2a93a');
    c.fillStyle = g; c.fillRect(0, 0, w, h);
    for (let i = 0; i < 2600; i++) { c.fillStyle = `rgba(255,${200 + Math.random() * 55},${120 + Math.random() * 100},${Math.random() * 0.6})`; c.fillRect(Math.random() * w, Math.random() * h, 4, 4); }
    c.strokeStyle = 'rgba(255,255,255,.6)'; c.lineWidth = 3;
    for (let k = 0; k < 16; k++) { c.beginPath(); c.moveTo(k * w / 16, 0); c.lineTo(k * w / 16, h); c.stroke(); }
  }, 1);
  const dome = new THREE.Mesh(new THREE.SphereGeometry(1.5, 40, 20, Math.PI, Math.PI, 0, Math.PI / 2), new THREE.MeshStandardMaterial({ map: domeTex, metalness: 0.65, roughness: 0.3, side: THREE.DoubleSide, emissive: 0xffc860, emissiveIntensity: 0.25 }));
  dome.position.set(0, 5.0, FZ); facade.add(dome);
  const arch = new THREE.Mesh(new THREE.TorusGeometry(1.62, 0.13, 12, 48, Math.PI), marble(0xffffff, 0.35));
  arch.position.set(0, 5.0, FZ + 0.05); facade.add(arch);
  [-1.62, 1.62].forEach((x) => blk(0.3, 4.2, 0.32, x, 2.9, FZ + 0.05, marble(0xffffff, 0.35)));
  // 넘쳐흐르는 대리석 수반 (폭포가 시작되는 곳)
  const basin = new THREE.Mesh(new THREE.SphereGeometry(0.95, 40, 16, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), marble(0xffffff, 0.25));
  basin.scale.set(1, 0.42, 0.75); basin.position.set(0, 1.62, FZ + 0.6); facade.add(basin);
  const basinRim = new THREE.Mesh(new THREE.TorusGeometry(0.95, 0.045, 10, 48), gold);
  basinRim.rotation.x = Math.PI / 2; basinRim.scale.set(1, 0.75, 1); basinRim.position.set(0, 1.62, FZ + 0.6); facade.add(basinRim);
  const basinWater = new THREE.Mesh(new THREE.CircleGeometry(0.92, 40), new THREE.MeshPhysicalMaterial({ color: 0x7fe3ee, roughness: 0.05, transmission: 0, transparent: true, opacity: 0.85 }));
  basinWater.rotation.x = -Math.PI / 2; basinWater.scale.set(1, 0.75, 1); basinWater.position.set(0, 1.6, FZ + 0.6); facade.add(basinWater);
  const pedestal = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.35, 0.3, 24), marble(0xffffff, 0.3));
  pedestal.position.set(0, 1.45, FZ + 0.6); facade.add(pedestal);
  // 폭포 계단
  const stepMat = marble(0xf7f3ea, 0.4);
  blk(3.3, 1.3, 1.0, 0, 0.65, -6.9, stepMat);
  blk(3.1, 0.85, 0.8, 0, 0.425, -6.0, stepMat);
  blk(2.9, 0.5, 0.74, 0, 0.25, -5.23, stepMat);
  shadow(facade, true, true);
  scene.add(facade);

  // 흐르는 물 리본 (계단을 타고 연못으로)
  const fallPath = [[-6.85, 1.6], [-6.72, 1.45], [-6.62, 1.34], [-6.42, 1.33], [-6.37, 1.2], [-6.32, 0.95], [-6.28, 0.88], [-5.62, 0.88], [-5.58, 0.75], [-5.53, 0.55], [-5.5, 0.53], [-4.9, 0.53], [-4.84, 0.45], [-4.8, 0.37], [-4.0, 0.37], [-3.94, 0.25], [-3.88, 0.1], [-3.85, -0.02]];
  const fallGeo = (() => {
    const W = 2.3, segX = 12, pos = [], uv = [], idx = [];
    let len = 0;
    fallPath.forEach(([z, y], i) => {
      if (i) len += Math.hypot(z - fallPath[i - 1][0], y - fallPath[i - 1][1]);
      const w = W * (1 - 0.12 * (i / fallPath.length));
      for (let k = 0; k <= segX; k++) { pos.push((k / segX - 0.5) * w, y + 0.02, z); uv.push(k / segX, len); }
    });
    for (let i = 0; i < fallPath.length - 1; i++) for (let k = 0; k < segX; k++) {
      const a = i * (segX + 1) + k, b = a + segX + 1;
      idx.push(a, b, a + 1, a + 1, b, b + 1);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx); g.computeVertexNormals();
    return g;
  })();
  const fallMat = new THREE.ShaderMaterial({
    uniforms: { uTime: shared.uTime },
    vertexShader: 'varying vec2 vUv; varying vec3 vN; void main(){ vUv=uv; vN=normalize(normalMatrix*normal); gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.); }',
    fragmentShader: `uniform float uTime; varying vec2 vUv; varying vec3 vN;
      float h(vec2 p){ return fract(sin(dot(p, vec2(12.9898,78.233)))*43758.5453); }
      float n2(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.-2.*f); return mix(mix(h(i),h(i+vec2(1,0)),f.x),mix(h(i+vec2(0,1)),h(i+vec2(1,1)),f.x),f.y); }
      void main(){
        vec2 q = vec2(vUv.x * 18., vUv.y * 3. - uTime * 2.6);
        float st = n2(q) * 0.6 + n2(q * 2.3 + 4.) * 0.4;
        float steep = 1. - abs(vN.y);
        float foam = smoothstep(0.45, 0.85, st) * (0.5 + steep * 0.8);
        vec3 col = mix(vec3(0.35, 0.82, 0.9), vec3(1.), foam);
        float edge = smoothstep(0., 0.08, vUv.x) * smoothstep(1., 0.92, vUv.x);
        gl_FragColor = vec4(col * 1.2, (0.62 + foam * 0.38 + steep * 0.25) * edge);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
    transparent: true, depthWrite: false, side: THREE.DoubleSide,
  });
  const fall = new THREE.Mesh(fallGeo, fallMat);
  fall.renderOrder = 6;
  scene.add(fall);

  // 테두리의 금빛 물고기 분수구 + 물줄기
  const jets = [];
  [[-1, -2.55], [1, -2.55], [-1, 1.2], [1, 1.2]].forEach(([sx, a0]) => {
    const a = sx > 0 ? a0 : Math.PI - a0;
    const x = Math.cos(a) * (POND.R + 0.18), z = Math.sin(a) * (POND.R + 0.18);
    const spout = new THREE.Group();
    const body = new THREE.Mesh(new THREE.SphereGeometry(0.13, 20, 14), gold); body.scale.set(1, 0.9, 1.5); spout.add(body);
    const tail = new THREE.Mesh(new THREE.ConeGeometry(0.1, 0.18, 12), gold); tail.rotation.x = -Math.PI / 2; tail.position.z = -0.24; spout.add(tail);
    spout.position.set(x, POND.RIM_TOP + 0.12, z); spout.lookAt(0, POND.RIM_TOP + 0.25, 0);
    scene.add(spout);
    const dir = new THREE.Vector3(-x, 0, -z).normalize();
    jets.push({ x: x + dir.x * 0.2, y: POND.RIM_TOP + 0.15, z: z + dir.z * 0.2, vx: dir.x * 1.45, vy: 2.3, vz: dir.z * 1.45, acc: 0 });
  });

  // 무지개 (폭포 물보라 위)
  const rainbow = new THREE.Mesh(new THREE.RingGeometry(1.55, 1.95, 64, 1, 0, Math.PI), new THREE.ShaderMaterial({
    uniforms: { uTime: shared.uTime },
    vertexShader: 'varying vec2 vP; void main(){ vP=position.xy; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.); }',
    fragmentShader: `uniform float uTime; varying vec2 vP;
      vec3 hsv(float h){ return clamp(abs(mod(h*6.+vec3(0.,4.,2.),6.)-3.)-1.,0.,1.); }
      void main(){ float r = (length(vP) - 1.55) / 0.4; float ang = atan(vP.y, vP.x);
        float fade = smoothstep(0., .5, ang) * smoothstep(3.1416, 2.64, ang) * smoothstep(0., .2, r) * smoothstep(1., .8, r);
        gl_FragColor = vec4(hsv(0.83 - r * 0.83), fade * (0.2 + 0.06 * sin(uTime * 0.7))); }`,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
  }));
  rainbow.position.set(0, -0.15, -3.75);
  scene.add(rainbow);

  /* --- 연잎·연꽃 + 떠다니는 꽃잎 --- */
  const padTex = canvasTex(256, 256, (c, w, h) => {
    const g = c.createRadialGradient(w / 2, h / 2, 5, w / 2, h / 2, w / 2);
    g.addColorStop(0, '#a6d86a'); g.addColorStop(1, '#4f9a3c'); c.fillStyle = g; c.fillRect(0, 0, w, h);
    c.strokeStyle = 'rgba(230,255,190,.45)'; c.lineWidth = 2;
    for (let i = 0; i < 18; i++) { const a = (i / 18) * Math.PI * 2; c.beginPath(); c.moveTo(w / 2, h / 2); c.lineTo(w / 2 + Math.cos(a) * w / 2, h / 2 + Math.sin(a) * h / 2); c.stroke(); }
  }, 1);
  const padMat = new THREE.MeshStandardMaterial({ map: padTex, roughness: 0.35, side: THREE.DoubleSide });
  const pads = [];
  const petalMat = new THREE.MeshPhysicalMaterial({ color: 0xffc2d8, roughness: 0.4, sheen: 1, sheenColor: new THREE.Color(0xffffff), emissive: 0xff7aa8, emissiveIntensity: 0.12 });
  [[2.75, 1.0, 0.36, 1], [-2.9, 0.6, 0.32, 1], [-2.5, -2.5, 0.34, 0], [3.0, -1.0, 0.27, 0], [-0.6, 2.75, 0.26, 1], [2.1, 2.7, 0.3, 0]].forEach(([x, z, r, flower], i) => {
    const g = new THREE.Group();
    const pad = new THREE.Mesh(new THREE.CircleGeometry(r, 40, 0.3, Math.PI * 2 - 0.6), padMat);
    pad.rotation.x = -Math.PI / 2; g.add(pad);
    if (flower) {
      for (let ring = 0; ring < 3; ring++) for (let k = 0; k < 8; k++) {
        const pe = new THREE.Mesh(new THREE.SphereGeometry(1, 12, 8), petalMat);
        const a = (k / 8) * Math.PI * 2 + ring * 0.4;
        pe.scale.set(0.05, 0.025, 0.13 - ring * 0.03);
        pe.position.set(Math.cos(a) * (0.08 - ring * 0.02), 0.06 + ring * 0.035, Math.sin(a) * (0.08 - ring * 0.02));
        pe.rotation.set(0, -a + Math.PI / 2, 0); pe.rotateX(-0.6 - ring * 0.45);
        g.add(pe);
      }
      const c = new THREE.Mesh(new THREE.SphereGeometry(0.035, 12, 8), new THREE.MeshStandardMaterial({ color: 0xffe066, emissive: 0xaa7700, emissiveIntensity: 0.4 }));
      c.position.y = 0.1; g.add(c);
    }
    g.position.set(x, 0.006, z); g.rotation.y = i * 1.7;
    g.userData.phase = i * 1.3;
    scene.add(g); pads.push(g);
  });
  const PETALS = low ? 26 : 50;
  const petalGeo = new THREE.CircleGeometry(0.045, 10); petalGeo.scale(1, 0.6, 1); petalGeo.rotateX(-Math.PI / 2);
  const floatPetals = new THREE.InstancedMesh(petalGeo, new THREE.MeshStandardMaterial({ color: 0xffd0e0, roughness: 0.5, side: THREE.DoubleSide, emissive: 0xff8fb5, emissiveIntensity: 0.15 }), PETALS);
  const petalSeeds = Array.from({ length: PETALS }, () => ({ r: 0.8 + Math.random() * 2.8, a: Math.random() * Math.PI * 2, s: (0.02 + Math.random() * 0.05) * (Math.random() < 0.5 ? 1 : -1), rot: Math.random() * 6 }));
  scene.add(floatPetals);

  /* --- 사이프러스 나무 + 꽃 화분 --- */
  {
    const leaf = new THREE.MeshStandardMaterial({ color: 0x3f7a4a, roughness: 0.8 });
    const trunk = new THREE.MeshStandardMaterial({ color: 0x8a6a4a, roughness: 0.9 });
    [[-10.4, -6.2], [10.4, -6.2], [-11.8, -2.4], [11.8, -2.4], [-12.5, 2.5], [12.5, 2.5]].forEach(([x, z], i) => {
      const g = new THREE.Group();
      const h = 4.6 + (i % 3) * 0.6;
      const c = new THREE.Mesh(new THREE.SphereGeometry(1, 20, 14), leaf); c.scale.set(0.75, h / 2, 0.75); c.position.y = h / 2 + 0.5; g.add(c);
      const t = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.14, 0.8, 8), trunk); t.position.y = 0.4; g.add(t);
      g.position.set(x, 0, z); shadow(g, true, false); scene.add(g);
    });
    const flowerCols = [0xff9ec4, 0xffffff, 0xffc4dd, 0xd9b8ff, 0xffe08a];
    const bloom = new THREE.SphereGeometry(1, 10, 8);
    [[-6.6, -3.2], [6.6, -3.2], [-7.2, 2.6], [7.2, 2.6]].forEach(([x, z]) => {
      const g = new THREE.Group();
      const potM = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 0.5, 0.75, 32), marble(0xffffff, 0.35));
      potM.position.y = 0.38; g.add(potM);
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.7, 0.03, 8, 40), gold); ring.rotation.x = Math.PI / 2; ring.position.y = 0.74; g.add(ring);
      const bush = new THREE.Mesh(new THREE.SphereGeometry(0.72, 20, 14), new THREE.MeshStandardMaterial({ color: 0x5b9a55, roughness: 0.9 }));
      bush.position.y = 1.05; bush.scale.y = 0.75; g.add(bush);
      for (let k = 0; k < 34; k++) {
        const f = new THREE.Mesh(bloom, new THREE.MeshStandardMaterial({ color: flowerCols[k % flowerCols.length], roughness: 0.6, emissive: flowerCols[k % flowerCols.length], emissiveIntensity: 0.08 }));
        const a = Math.random() * Math.PI * 2, e = Math.random() * 1.2;
        f.position.set(Math.cos(a) * Math.cos(e) * 0.7, 1.05 + Math.sin(e) * 0.52, Math.sin(a) * Math.cos(e) * 0.7);
        f.scale.setScalar(0.08 + Math.random() * 0.05); g.add(f);
      }
      g.position.set(x, 0, z); shadow(g); scene.add(g);
    });
  }

  /* --- 금빛 반짝이 (신비로운 빛 입자) --- */
  const FF = low ? 40 : 90;
  const ffGeo = new THREE.BufferGeometry();
  const ffPos = new Float32Array(FF * 3), ffSeed = new Float32Array(FF);
  for (let i = 0; i < FF; i++) {
    const a = Math.random() * Math.PI * 2, r = Math.random() * 5.5;
    ffPos.set([Math.cos(a) * r, 0.2 + Math.random() * 3, Math.sin(a) * r - 0.8], i * 3); ffSeed[i] = Math.random() * 100;
  }
  ffGeo.setAttribute('position', new THREE.BufferAttribute(ffPos, 3));
  ffGeo.setAttribute('aSeed', new THREE.BufferAttribute(ffSeed, 1));
  const ffMat = new THREE.ShaderMaterial({
    uniforms: { uTime: shared.uTime },
    vertexShader: `attribute float aSeed; uniform float uTime; varying float vA; varying float vS;
      void main(){ vec3 p = position + vec3(sin(uTime*.25+aSeed)*.5, mod(uTime*.12+aSeed, 3.) - 1.5, cos(uTime*.2+aSeed)*.5);
        vA = pow(.5+.5*sin(uTime*2.1+aSeed*3.), 4.); vS = aSeed;
        vec4 mv = modelViewMatrix*vec4(p,1.); gl_Position=projectionMatrix*mv; gl_PointSize = (7. + 9.*vA)/(-mv.z)*10.; }`,
    fragmentShader: `varying float vA; varying float vS; void main(){ vec2 d = gl_PointCoord-.5; float r=length(d);
        float star = max(0., 1. - abs(d.x)*14.) * max(0., 1. - abs(d.y)*2.2) + max(0., 1. - abs(d.y)*14.) * max(0., 1. - abs(d.x)*2.2);
        float a = (smoothstep(.5,0.,r)*.35 + star) * vA * .9;
        vec3 c = mix(vec3(1.,.86,.5), vec3(1.,.8,.95), fract(vS));
        gl_FragColor=vec4(c, a); }`,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  });
  const fireflies = new THREE.Points(ffGeo, ffMat);
  fireflies.frustumCulled = false;
  scene.add(fireflies);

  // 장면 애니메이션 (연잎 흔들림, 꽃잎 표류, 물줄기·폭포 물보라)
  let jetParticles = null;
  function animateScene(dt, time) {
    pads.forEach((g) => { g.position.y = 0.006 + Math.sin(time * 0.8 + g.userData.phase) * 0.004; g.rotation.z = Math.sin(time * 0.6 + g.userData.phase) * 0.02; });
    petalSeeds.forEach((p, i) => {
      p.a += p.s * dt * 0.4; p.rot += dt * 0.3;
      dummy.position.set(Math.cos(p.a) * p.r, 0.004 + Math.sin(time + i) * 0.003, Math.sin(p.a) * p.r - 0.3);
      dummy.rotation.set(0, p.rot, 0); dummy.scale.setScalar(1); dummy.updateMatrix();
      floatPetals.setMatrixAt(i, dummy.matrix);
    });
    floatPetals.instanceMatrix.needsUpdate = true;
    if (jetParticles) {
      jets.forEach((j) => {
        j.acc += dt * (low ? 40 : 70);
        while (j.acc >= 1) {
          j.acc -= 1;
          jetParticles.spawn(j.x, j.y, j.z, j.vx * (0.96 + Math.random() * 0.08), j.vy * (0.97 + Math.random() * 0.06), j.vz * (0.96 + Math.random() * 0.08), 2, 0.026 + Math.random() * 0.012, 0.85, 0.97, 1, 3);
        }
      });
      if (Math.random() < dt * (low ? 25 : 45)) {
        jetParticles.spawn((Math.random() - 0.5) * 2.0, 0.02, -3.85 + Math.random() * 0.2, (Math.random() - 0.5) * 0.5, 0.5 + Math.random() * 1.1, 0.3 + Math.random() * 0.5, 1.2, 0.04 + Math.random() * 0.04, 0.95, 1, 1, 3);
      }
    }
  }

  /* --- 물 --- */
  const RIP = 16;
  const ripples = Array.from({ length: RIP }, () => new THREE.Vector4(0, 0, -99, 0));
  let ripI = 0;
  const reflScale = low ? 0.4 : 0.55;
  // 계속 물결이 이는 곳: 폭포 아래 + 물고기 분수구 물줄기 떨어지는 곳 (x, z, 세기, 반경)
  const waterSources = [new THREE.Vector4(0, -3.86, 1.0, 1.0)];
  jets.forEach((j) => {
    const t = (j.vy + Math.sqrt(j.vy * j.vy + 2 * 9.8 * j.y)) / 9.8;
    waterSources.push(new THREE.Vector4(j.x + j.vx * t, j.z + j.vz * t, 0.45, 0.0));
  });
  const reflRT = new THREE.WebGLRenderTarget(16, 16); // 8비트: HalfFloat 반사는 일부 모바일 GPU에서 깨짐
  const texMatrix = new THREE.Matrix4();
  const waterMat = new THREE.ShaderMaterial({
    uniforms: {
      uTime: shared.uTime, uSun: { value: SUN }, uRipples: { value: ripples }, uSrc: { value: waterSources },
      uReflect: { value: reflRT.texture }, uTexMatrix: { value: texMatrix },
    },
    vertexShader: `uniform mat4 uTexMatrix; varying vec3 vW; varying vec4 vRef;
      void main(){ vec4 w = modelMatrix*vec4(position,1.); vW = w.xyz; vRef = uTexMatrix*w; gl_Position = projectionMatrix*viewMatrix*w; }`,
    fragmentShader: SKY_GLSL + `
      uniform float uTime; uniform vec4 uRipples[${RIP}]; uniform vec4 uSrc[5]; uniform sampler2D uReflect;
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
        float foam = 0.;
        for (int i = 0; i < 5; i++) {
          vec4 sr = uSrc[i];
          vec2 d = p - sr.xy; d.x = sign(d.x) * max(abs(d.x) - sr.w, 0.);
          float dist = length(d) + 1e-4;
          g += (d / dist) * sr.z * 0.05 * cos(dist * 26. - uTime * 7.) * exp(-dist * 1.6);
          foam += sr.z * exp(-dist * dist * (i == 0 ? 10. : 60.)) * (0.6 + 0.4 * sNoise(p * 9. + vec2(0., uTime * 2.)));
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
        vec3 deep = vec3(0.08, 0.5, 0.58);
        float a = mix(0.36, 0.95, fres);
        a = max(a, smoothstep(${(POND.R - 0.25).toFixed(2)}, ${POND.R.toFixed(2)}, r) * 0.6);
        float rf = max(fres, 0.1);
        float glit = step(0.9965, fract(sin(dot(floor(p * 70.) + floor(uTime * 5.) * 3.1, vec2(12.9898, 78.233))) * 43758.5453)) * smoothstep(0.2, 0.0, abs(n.x) + abs(n.z) - 0.05);
        vec3 col = deep * (1. - rf) * 0.9 + refl * rf + vec3(1., .95, .85) * spec + vec3(1.) * glit * 1.8;
        col = mix(col, vec3(1.1), clamp(foam, 0., 0.85));
        a = max(a, clamp(foam, 0., 0.9));
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
  jetParticles = particles;
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
    const m = new THREE.MeshStandardMaterial({ map: atlas.tex, metalness: 0.7, roughness: 0.28, emissive: 0xffffff, emissiveMap: atlas.tex, emissiveIntensity: 0.38 });
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
      camHome.pos.set(0, 6.6 * k, 10.8 * k); camHome.look.set(0, 0.9, -2.3);
      camera.fov = asp < 1 ? 46 : 40;
    } else {
      camHome.pos.set(0, 2.7, 7.0); camHome.look.set(0, 0.35, -2.2);
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
    animateScene(dt, time);

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
