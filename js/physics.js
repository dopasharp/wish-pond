// 동전 비행 물리. 던진 폰과 연못 화면이 똑같은 코드로 같은 궤적을 계산합니다 (DOM·three.js 없음).
// 좌표: 미터 단위, 수면 y=0, 연못 중심 (0,0,0). 던지는 사람은 남쪽(+z)에 서서 북쪽(-z)으로 던져요.

export const POND = {
  R: 4.0,            // 수면 반지름
  RIM_OUT: 4.85,     // 돌 테두리 바깥
  RIM_TOP: 0.34,     // 대리석 테두리 윗면 높이
  DEPTH: 0.62,       // 가운데 수심
  GROUND: 0.03,      // 연못 밖 광장 바닥 높이
  WALL_Z: -6.62,     // 뒤쪽 궁전 벽(기둥 앞면)
  COIN_R: 0.11,      // 잘 보이도록 실제보다 크게
  COIN_H: 0.016,
  hand: { x: 0, y: 1.35, z: 5.25 },
  // 돌거북: 등딱지는 타원체 (중심이 수면 살짝 아래)
  turtle: { x: -1.15, y: -0.06, z: -0.85, rx: 0.8, ry: 0.42, rz: 0.98, yaw: 0.45, headR: 0.22 },
  // 항아리: 바닥에서 솟아 있고 입구가 수면 위로
  pot: { x: 1.45, z: -1.55, base: -0.52, top: 0.56, lip: 0.33 },
};

// 항아리 옆모습 (u: 0=바닥, 1=입구) → 반지름. 메시(LatheGeometry)도 이 표를 씁니다.
export const POT_PROFILE = [[0, 0.27], [0.12, 0.4], [0.32, 0.5], [0.52, 0.53], [0.72, 0.46], [0.86, 0.34], [0.94, 0.33], [1, 0.36]];
export function potRadius(u) {
  if (u <= 0) return POT_PROFILE[0][1];
  for (let i = 1; i < POT_PROFILE.length; i++) {
    const [u1, r1] = POT_PROFILE[i];
    if (u <= u1) {
      const [u0, r0] = POT_PROFILE[i - 1];
      const k = (u - u0) / (u1 - u0);
      const s = k * k * (3 - 2 * k);
      return r0 + (r1 - r0) * s;
    }
  }
  return POT_PROFILE[POT_PROFILE.length - 1][1];
}
export const POT_MOUTH = 0.32; // 동전이 쏙 들어가는 입구 안쪽 반지름

// 연못 밖 바닥 높이 (뒤쪽 폭포 계단 포함)
export function groundY(x, z) {
  if (Math.abs(x) < 1.65) {
    if (z < -6.4) return 1.3;
    if (z < -5.6) return 0.85;
    if (z < -4.86) return 0.5;
  }
  return POND.GROUND;
}

export function floorY(x, z) {
  const r = Math.hypot(x, z) / POND.R;
  return -0.07 - POND.DEPTH * Math.max(0, 1 - r * r);
}

export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// 바람: 15초마다 바뀌고, 같은 시각이면 모든 기기에서 같은 값 (m/s², +는 오른쪽 = +x)
export const WIND_PERIOD = 15000;

// 던지는 자리 후보 (연못 앞쪽 반원, 궁전 뒤쪽은 제외). 각도 = π/2 ± …
export const SPOTS = [-1.2, -0.9, -0.6, -0.3, 0, 0.3, 0.6, 0.9, 1.2].map((d) => +(Math.PI / 2 + d).toFixed(4));
export function spotPos(ang, r = POND.hand.z) { return { x: Math.cos(ang) * r, z: Math.sin(ang) * r }; }
export function windAt(ms = Date.now()) {
  const slot = Math.floor(ms / WIND_PERIOD);
  const r = mulberry32(slot * 2654435761)();
  const r2 = mulberry32(slot * 97 + 13)();
  return Math.round(((r * 2 - 1) * (0.35 + r2 * 0.75)) * 100) / 100;
}

function turtleLocal(p) {
  const T = POND.turtle;
  const dx = p.x - T.x, dz = p.z - T.z;
  const c = Math.cos(-T.yaw), s = Math.sin(-T.yaw);
  return { x: dx * c - dz * s, y: p.y - T.y, z: dx * s + dz * c };
}
function turtleWorldDir(v) {
  const T = POND.turtle;
  const c = Math.cos(T.yaw), s = Math.sin(T.yaw);
  return { x: v.x * c - v.z * s, y: v.y, z: v.x * s + v.z * c };
}
export function turtleHead() {
  const T = POND.turtle;
  const d = turtleWorldDir({ x: 0, y: 0, z: T.rz + 0.12 });
  return { x: T.x + d.x, y: 0.08, z: T.z + d.z };
}
// 등딱지 안쪽이면 {normal, surface} 아니면 null
function shellHit(p) {
  const T = POND.turtle;
  const l = turtleLocal(p);
  const f = (l.x / T.rx) ** 2 + (l.y / T.ry) ** 2 + (l.z / T.rz) ** 2;
  if (f >= 1) return null;
  const k = 1 / Math.sqrt(f || 1e-6);
  const sl = { x: l.x * k, y: l.y * k, z: l.z * k };
  let n = { x: sl.x / T.rx ** 2, y: sl.y / T.ry ** 2, z: sl.z / T.rz ** 2 };
  const len = Math.hypot(n.x, n.y, n.z);
  n = turtleWorldDir({ x: n.x / len, y: n.y / len, z: n.z / len });
  const sw = turtleWorldDir(sl);
  return { normal: n, surface: { x: T.x + sw.x, y: T.y + sw.y, z: T.z + sw.z } };
}

const len3 = (v) => Math.hypot(v.x, v.y, v.z);
function bounce(v, n, rest, rng) {
  const d = v.x * n.x + v.y * n.y + v.z * n.z;
  if (d >= 0) return;
  v.x = (v.x - 2 * d * n.x) * rest + (rng() - 0.5) * 0.6;
  v.y = (v.y - 2 * d * n.y) * rest;
  v.z = (v.z - 2 * d * n.z) * rest + (rng() - 0.5) * 0.6;
}

/**
 * launch: { power 0..1, aimX -1..1, spin 0..1, wind, seed }
 * returns { frames: Float32Array(x,y,z @60fps), events: [{t,type,x,y,z,speed}], zone, rest, duration, dist }
 *   zone: 'turtle' | 'pot' | 'water' | 'out'
 *   rest: { x,y,z, nx,ny,nz (coin up vector), yaw, flip }
 */
export function simulate(launch) {
  const rng = mulberry32(launch.seed >>> 0);
  const power = Math.min(1, Math.max(0, +launch.power || 0));
  const aim = Math.min(1, Math.max(-1, +launch.aimX || 0));
  const wind = +launch.wind || 0;
  const H = POND.hand, P = POND.pot, R = POND.R;

  const speed = 3.4 + power * 6.2;
  const elev = 0.58 + (power - 0.5) * 0.1;
  const yaw = aim * 0.42;
  // 던지는 자리: 연못 둘레 각도 ang (π/2 = 정면 앞쪽). 기본 자리 기준 계산을 ang만큼 돌림
  const ang = Number.isFinite(+launch.ang) ? +launch.ang : Math.PI / 2;
  const rot = ang - Math.PI / 2, cr = Math.cos(rot), sr = Math.sin(rot);
  const turn = (x, z) => ({ x: x * cr - z * sr, z: x * sr + z * cr });
  const p0 = turn(H.x + aim * 0.12, H.z);
  const v0 = turn(Math.sin(yaw) * Math.cos(elev) * speed, -Math.cos(yaw) * Math.cos(elev) * speed);
  const p = { x: p0.x, y: H.y, z: p0.z };
  const v = { x: v0.x, y: Math.sin(elev) * speed, z: v0.z };

  const dt = 1 / 240;
  const frames = [];
  const events = [];
  let t = 0, step = 0, state = 'air', zone = 'water', bounces = 0, lastHit = -1;
  let rest = null;
  const ev = (type, extra) => events.push({ t: +t.toFixed(3), type, x: p.x, y: p.y, z: p.z, ...extra });
  const phase = rng() * Math.PI * 2, phase2 = rng() * Math.PI * 2;
  let sinkT = 0;

  const settle = (z, n, y) => {
    zone = z;
    rest = { x: p.x, y: y ?? p.y, z: p.z, nx: n.x, ny: n.y, nz: n.z, yaw: rng() * Math.PI * 2, flip: rng() < 0.5 ? 0 : 1 };
    state = 'rest';
  };

  while (t < 9 && state !== 'rest') {
    const prev = { x: p.x, y: p.y, z: p.z };
    if (state === 'air') {
      v.x += wind * dt;
      v.y -= 9.81 * dt;
      const drag = Math.exp(-0.04 * dt);
      v.x *= drag; v.z *= drag;
      p.x += v.x * dt; p.y += v.y * dt; p.z += v.z * dt;
      const r = Math.hypot(p.x, p.z);
      const dp = Math.hypot(p.x - P.x, p.z - P.z);
      const potU = (p.y - P.base) / (P.top - P.base);
      const canHit = t - lastHit > 0.05;

      if (dp < POT_MOUTH - 0.03 && prev.y >= P.top && p.y < P.top) {
        // 항아리 입구로 쏙
        ev('pot', { speed: len3(v) });
        state = 'inpot';
        v.x *= 0.15; v.z *= 0.15;
      } else if (canHit && potU >= 0 && potU <= 1.02 && dp < potRadius(potU) + POND.COIN_R * 0.3 && (potU < 0.85 || dp > POT_MOUTH - 0.03)) {
        const n = { x: (p.x - P.x) / (dp || 1), y: potU > 0.9 ? 0.8 : 0.15, z: (p.z - P.z) / (dp || 1) };
        const l = len3(n); n.x /= l; n.y /= l; n.z /= l;
        ev('ceramic', { speed: len3(v) });
        bounce(v, n, 0.45, rng); bounces++; lastHit = t;
        p.x = P.x + n.x * (potRadius(Math.min(1, potU)) + 0.1); p.z = P.z + n.z * (potRadius(Math.min(1, potU)) + 0.1);
      } else if (shellHit(p)) {
        const h = shellHit(p);
        if (h.normal.y > 0.84 && len3(v) < 9.5) {
          p.x = h.surface.x + h.normal.x * 0.008; p.y = h.surface.y + h.normal.y * 0.008; p.z = h.surface.z + h.normal.z * 0.008;
          ev('turtle', { speed: len3(v) });
          settle('turtle', h.normal);
        } else if (canHit) {
          ev('stone', { speed: len3(v) });
          bounce(v, h.normal, 0.42, rng); bounces++; lastHit = t;
          p.x = h.surface.x + h.normal.x * 0.03; p.y = h.surface.y + h.normal.y * 0.03; p.z = h.surface.z + h.normal.z * 0.03;
        }
      } else if (canHit && (() => { const hd = turtleHead(); return Math.hypot(p.x - hd.x, p.y - hd.y, p.z - hd.z) < POND.turtle.headR; })()) {
        const hd = turtleHead();
        const n = { x: p.x - hd.x, y: p.y - hd.y, z: p.z - hd.z };
        const l = len3(n) || 1; n.x /= l; n.y /= l; n.z /= l;
        ev('stone', { speed: len3(v) });
        bounce(v, n, 0.4, rng); bounces++; lastHit = t;
      } else if (canHit && r > R - 0.12 && r < POND.RIM_OUT && p.y < POND.RIM_TOP && v.y < 0) {
        // 돌 테두리에 "깡"
        const out = r > R + 0.35 ? 0.35 : -0.35;
        const n = { x: (p.x / r) * out, y: 1, z: (p.z / r) * out };
        const l = len3(n); n.x /= l; n.y /= l; n.z /= l;
        ev('stone', { speed: len3(v) });
        bounce(v, n, 0.38, rng); bounces++; lastHit = t;
        p.y = POND.RIM_TOP;
        if (bounces > 4 || len3(v) < 0.6) settle('out', { x: 0, y: 1, z: 0 }, POND.RIM_TOP);
      } else if (r < R - 0.12 && p.y <= 0 && prev.y > 0) {
        ev('splash', { speed: len3(v) });
        state = 'sink';
        const sp = len3(v);
        v.x *= 0.1; v.z *= 0.1; v.y = -Math.min(1.2, 0.25 + sp * 0.08);
      } else if (canHit && p.z < POND.WALL_Z && v.z < 0 && p.y < 8) {
        // 궁전 벽에 "깡"
        ev('stone', { speed: len3(v) });
        bounce(v, { x: 0, y: 0, z: 1 }, 0.35, rng); bounces++; lastHit = t;
        p.z = POND.WALL_Z;
      } else if (r >= POND.RIM_OUT && p.y <= groundY(p.x, p.z)) {
        p.y = groundY(p.x, p.z);
        ev('ground', { speed: len3(v) });
        settle('out', { x: 0, y: 1, z: 0 }, p.y);
      } else if (p.y < -2) {
        settle('out', { x: 0, y: 1, z: 0 }, POND.GROUND);
      }
    } else if (state === 'sink') {
      sinkT += dt;
      const dragH = Math.exp(-2.5 * dt);
      v.x *= dragH; v.z *= dragH;
      v.y += (-0.42 - v.y) * (1 - Math.exp(-4 * dt));
      // 낙엽처럼 흔들리며 가라앉기
      p.x += (v.x + Math.sin(sinkT * 5.1 + phase) * 0.18) * dt;
      p.z += (v.z + Math.cos(sinkT * 4.3 + phase2) * 0.14) * dt;
      p.y += v.y * dt;
      // 물속 장애물 밀어내기
      const dp = Math.hypot(p.x - P.x, p.z - P.z);
      const potU = (p.y - P.base) / (P.top - P.base);
      if (potU >= 0 && potU <= 1) {
        const pr = potRadius(potU) + POND.COIN_R;
        if (dp < pr) { p.x = P.x + ((p.x - P.x) / (dp || 1)) * pr; p.z = P.z + ((p.z - P.z) / (dp || 1)) * pr; }
      }
      const h = shellHit(p);
      if (h) { p.x = h.surface.x + h.normal.x * 0.02; p.y = Math.min(p.y, h.surface.y); p.z = h.surface.z + h.normal.z * 0.02; }
      const rr = Math.hypot(p.x, p.z);
      if (rr > R - 0.2) { p.x *= (R - 0.2) / rr; p.z *= (R - 0.2) / rr; }
      const fy = floorY(p.x, p.z) + POND.COIN_H / 2;
      if (p.y <= fy) {
        p.y = fy;
        ev('settle', { speed: 0 });
        // 바닥 경사에 맞춘 기울기
        const e = 0.05, gx = (floorY(p.x + e, p.z) - floorY(p.x - e, p.z)) / (2 * e), gz = (floorY(p.x, p.z + e) - floorY(p.x, p.z - e)) / (2 * e);
        const n = { x: -gx, y: 1, z: -gz }; const l = len3(n);
        settle('water', { x: n.x / l, y: n.y / l, z: n.z / l });
      }
    } else if (state === 'inpot') {
      v.y -= 9.81 * dt;
      p.x += v.x * dt; p.y += v.y * dt; p.z += v.z * dt;
      const dp = Math.hypot(p.x - P.x, p.z - P.z);
      const inner = potRadius(Math.max(0, (p.y - P.base) / (P.top - P.base))) - 0.06 - POND.COIN_R;
      if (dp > inner && inner > 0) { p.x = P.x + ((p.x - P.x) / dp) * inner; p.z = P.z + ((p.z - P.z) / dp) * inner; v.x *= -0.3; v.z *= -0.3; }
      const bottom = P.base + 0.07;
      if (p.y <= bottom) {
        p.y = bottom + rng() * 0.02;
        ev('potland', { speed: 0 });
        settle('pot', { x: (rng() - 0.5) * 0.3, y: 1, z: (rng() - 0.5) * 0.3 });
      }
    }
    t += dt;
    if (++step % 4 === 0 || state === 'rest') frames.push(p.x, p.y, p.z);
  }
  if (!rest) settle(zone, { x: 0, y: 1, z: 0 });
  const nl = Math.hypot(rest.nx, rest.ny, rest.nz); rest.nx /= nl; rest.ny /= nl; rest.nz /= nl;

  const T = POND.turtle;
  const dist = Math.min(Math.hypot(rest.x - T.x, rest.z - T.z), Math.hypot(rest.x - P.x, rest.z - P.z));
  return { frames: new Float32Array(frames), fps: 60, events, zone, rest, duration: t, dist, bounces, ang };
}

// 한 번 던진 결과의 점수 (0~100, 소원 성취 확률)
export function scoreOf(sim, seed) {
  const r = mulberry32((seed >>> 0) ^ 0x9e3779b9)();
  if (sim.zone === 'turtle') return 95 + Math.floor(r * 5);
  if (sim.zone === 'pot') return 86 + Math.floor(r * 9);
  if (sim.zone === 'water') return Math.round(32 + 46 * Math.max(0, 1 - sim.dist / 3.2) + r * 6);
  return 10 + Math.floor(r * 15);
}
export const isSuccess = (zone) => zone === 'turtle' || zone === 'pot';
