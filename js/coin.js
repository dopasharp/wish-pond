// 던지는 폰: 닉네임 → 동전 꾸미기 → 소원 → 3번 던지기 → 결과 → (성공 시) 익명 게시판
import { createWorld } from './world.js?v=8';
import { connect, mode, newId, explainError } from './net.js?v=8';
import { windAt, simulate, scoreOf, isSuccess, SPOTS } from './physics.js?v=8';
import { METALS, RIMS, STAMPS, DEFAULT_DESIGN, sanitizeDesign } from './coin-art.js?v=8';
import { ZONES, SHOTS, shotMessage, finalResult, timeAgo, esc } from './game.js?v=8';
import { cleanWish, cleanNick } from './filter.js?v=8';
import * as sfx from './sound.js?v=8';
import { hypeBurst } from './hype.js?v=8';

const $ = (id) => document.getElementById(id);
const store = {
  get(k, d) { try { const v = localStorage.getItem('wishpond:' + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem('wishpond:' + k, JSON.stringify(v)); } catch {} },
};
const vibrate = (p) => { try { navigator.vibrate && navigator.vibrate(p); } catch {} };
const track = (n, p) => window.DopaSharp && window.DopaSharp.track(n, p);

const world = createWorld($('scene'), { mode: 'thrower' });
// 불꽃 효과음은 장면에서 쏘고 터지는 순간에 맞춤
world.onFx((type, p) => {
  const pan = Math.max(-1, Math.min(1, p.x / 5));
  if (type === 'launch') sfx.fireworkLaunch(pan, 0.45);
  else if (type === 'burst') sfx.fireworkPop(pan, 0.6);
});

let design = sanitizeDesign(store.get('design', DEFAULT_DESIGN));
let nick = store.get('nick', '');
let api = null;
const mine = new Set();
const myWishes = new Set(store.get('myWishes', []));
let round = null; // { id, shots: [], wish, share }
// 내가 서서 던지는 자리 (연못 둘레, 판마다 랜덤 · 다른 사람이 있는 자리는 되도록 피함)
let spot = SPOTS[Math.floor(Math.random() * SPOTS.length)];
let othersSpots = [];
function pickSpot() {
  const free = SPOTS.filter((a) => a !== spot && !othersSpots.some((o) => Math.abs(o - a) < 0.2));
  const pool = free.length ? free : SPOTS.filter((a) => a !== spot);
  spot = pool[Math.floor(Math.random() * pool.length)];
  world.setThrowSpot(spot);
  sharePresence();
}
let busy = false;

/* ---------------- 단계 전환 ---------------- */
function go(step) {
  document.body.dataset.step = step;
  ['intro', 'design', 'wish'].forEach((s) => ($(`sheet-${s}`).hidden = s !== step));
  if (step === 'design') { world.setHandCoin(design); world.setHandMode('edit'); }
  else if (step === 'wish') { world.setHandCoin(design); world.setHandMode('edit'); setTimeout(() => $('wish').focus(), 250); }
  else if (step === 'throw') { world.setHandCoin(design); world.setHandMode('ready'); renderCoinsLeft(); }
  else world.setHandMode('hidden');
}

/* ---------------- 1. 시작 ---------------- */
$('nick').value = nick;
$('start-btn').onclick = () => {
  enableMotion(); // iOS는 탭 안에서 바로 권한을 물어야 해요
  sfx.unlockAudio(); sfx.setSoundEnabled(store.get('sound', true)); if (store.get('sound', true)) sfx.startAmbient(0.55);
  syncSoundBtn();
  nick = cleanNick($('nick').value); store.set('nick', nick);
  sharePresence();
  sfx.tick();
  go('design');
};
if (mode === 'local') $('net-note').textContent = '로컬 테스트 모드 (같은 브라우저의 연못 탭과 연결돼요)';

/* ---------------- 2. 꾸미기 ---------------- */
function radio(container, items, current, onPick, render) {
  container.innerHTML = '';
  items.forEach(([value, label]) => {
    const b = document.createElement('button');
    b.type = 'button'; b.setAttribute('role', 'radio'); b.setAttribute('aria-checked', String(value === current));
    b.dataset.value = value; b.innerHTML = render ? render(value, label) : esc(label);
    b.onclick = () => { onPick(value); container.querySelectorAll('[role=radio]').forEach((x) => x.setAttribute('aria-checked', String(x === b))); sfx.tick(); };
    container.appendChild(b);
  });
}
let presTimer;
function sharePresence() {
  clearTimeout(presTimer);
  presTimer = setTimeout(() => api && api.setPresence && api.setPresence({ nick, design, spot }), 1200); // 연타해도 DB 쓰기는 한 번
}
function updateDesign(patch) {
  design = sanitizeDesign({ ...design, ...patch });
  store.set('design', design);
  sharePresence();
  world.setHandCoin(design);
  world.setHandMode(document.body.dataset.step === 'throw' ? 'ready' : 'edit');
}
radio($('metals'), Object.entries(METALS).map(([k, m]) => [k, m.name]), design.metal, (v) => updateDesign({ metal: v }),
  (v, label) => `<span class="swatch" style="background:radial-gradient(circle at 35% 30%, ${METALS[v].hi}, ${METALS[v].base} 55%, ${METALS[v].lo})"></span>${label}`);
radio($('rims'), Object.entries(RIMS), design.rim, (v) => updateDesign({ rim: v }));
radio($('stamps'), [['', '없음'], ...STAMPS.map((s) => [s, s])], design.stamp, (v) => { $('stamp-custom').value = ''; updateDesign({ stamp: v }); });
$('stamp-custom').addEventListener('input', (e) => {
  const v = Array.from(e.target.value.trim()).slice(0, 2).join('');
  if (!v) return;
  $('stamps').querySelectorAll('[role=radio]').forEach((x) => x.setAttribute('aria-checked', 'false'));
  updateDesign({ stamp: v });
});
$('text-front').value = design.text; $('text-back').value = design.back;
let typeTimer;
['text-front', 'text-back'].forEach((id) => $(id).addEventListener('input', () => {
  clearTimeout(typeTimer);
  typeTimer = setTimeout(() => updateDesign({ text: $('text-front').value, back: $('text-back').value }), 120);
}));
$('flip-btn').onclick = () => { world.flipHandCoin(); sfx.flick(0.2); };

// 🎲 랜덤 꾸미기: 재질·테두리·그림·앞뒤 글자를 무작위로
const RANDOM_FRONT = ['합격', '대박', '행운', '사랑', '건강', '부자', '소원', '럭키', '꿈', '승리', '로또', '취뽀', '연애', '성공', '힐링', '파이팅'];
const RANDOM_BACK = ['2026', 'WISH', 'LUCK', '♡', '★', '777', '1등', '오늘', '꼭', 'LOVE', '도파#', '굿럭'];
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
function syncDesignControls() {
  const mark = (id, v) => $(id).querySelectorAll('[role=radio]').forEach((x) => x.setAttribute('aria-checked', String(x.dataset.value === v)));
  mark('metals', design.metal); mark('rims', design.rim); mark('stamps', design.stamp);
  $('stamp-custom').value = ''; $('text-front').value = design.text; $('text-back').value = design.back;
}
$('random-btn').onclick = () => {
  let next;
  do {
    next = { metal: pick(Object.keys(METALS)), rim: pick(Object.keys(RIMS)), stamp: Math.random() < 0.08 ? '' : pick(STAMPS), text: Math.random() < 0.1 ? '' : pick(RANDOM_FRONT), back: pick(RANDOM_BACK) };
  } while (next.metal === design.metal && next.stamp === design.stamp);
  updateDesign(next);
  syncDesignControls();
  sfx.flick(0.3); vibrate(8);
  const b = $('random-btn'); b.classList.remove('spin'); void b.offsetWidth; b.classList.add('spin');
};
$('design-done').onclick = () => { sfx.tick(); go('wish'); };

/* ---------------- 3. 소원 ---------------- */
$('wish').value = store.get('wish', '');
const wishCount = () => ($('wish-count').textContent = Array.from($('wish').value).length);
$('wish').addEventListener('input', wishCount); wishCount();
$('share-wish').checked = store.get('share', true);
$('wish-back').onclick = () => go('design');
$('wish-done').onclick = () => {
  const wish = $('wish').value.trim();
  store.set('wish', wish); store.set('share', $('share-wish').checked);
  round = { id: newId(), shots: [], wish, share: $('share-wish').checked };
  pickSpot();
  sfx.chimes(0, 3);
  go('throw');
  $('hint').classList.remove('gone');
};

/* ---------------- 던지기 ---------------- */
function renderCoinsLeft() {
  const used = round ? round.shots.length : 0;
  $('coins-left').innerHTML = Array.from({ length: SHOTS }, (_, i) => `<span class="${i < used ? 'used' : ''}">🪙</span>`).join('');
}
function showWind() {
  const w = windAt();
  // 바람은 동서(x) 방향. 내 자리에서 보면 어느 쪽인지로 바꿔서 화살표 표시
  const f = { x: -Math.cos(spot), z: -Math.sin(spot) }, rt = { x: -f.z, z: f.x };
  const side = w * rt.x, ahead = w * f.x;
  let arrow = '·';
  if (Math.abs(w) > 0.05) arrow = Math.abs(side) >= Math.abs(ahead) ? (side > 0 ? '→' : '←') : (ahead > 0 ? '↑' : '↓');
  $('wind').textContent = `바람 ${arrow} ${Math.abs(w).toFixed(1)}`;
  $('wind').classList.toggle('strong', Math.abs(w) > 0.7);
}
showWind(); setInterval(showWind, 1000);

let toastTimer;
function showToast(html, ms = 2400, cls = '') {
  const t = $('shot-toast');
  t.innerHTML = html; t.className = 'shot-toast ' + cls; t.hidden = false;
  void t.offsetWidth; t.classList.add('show');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => (t.hidden = true), ms);
}

// 스와이프 감지
const touch = $('touch');
let drag = null;
touch.addEventListener('pointerdown', (e) => {
  if (inputMode !== 'finger') return;
  if (document.body.dataset.step !== 'throw' || busy || !round || round.shots.length >= SHOTS) return;
  touch.setPointerCapture(e.pointerId);
  drag = { id: e.pointerId, x0: e.clientX, y0: e.clientY, pts: [{ x: e.clientX, y: e.clientY, t: e.timeStamp }] };
});
touch.addEventListener('pointermove', (e) => {
  if (!drag || e.pointerId !== drag.id) return;
  drag.pts.push({ x: e.clientX, y: e.clientY, t: e.timeStamp });
  if (drag.pts.length > 30) drag.pts.shift();
  const w = innerWidth, h = innerHeight;
  world.setHandDrag(Math.max(-0.5, Math.min(0.5, (e.clientX - drag.x0) / w)), Math.max(-0.2, Math.min(0.6, (drag.y0 - e.clientY) / h)));
});
const endDrag = (e) => {
  if (!drag || e.pointerId !== drag.id) return;
  const d = drag; drag = null;
  // 마지막 움직임 기준 120ms 구간의 속도 (느린 기기에서 손 뗀 시점이 늦게 와도 정확하게)
  const b = d.pts[d.pts.length - 1];
  let a = d.pts[0];
  for (let i = d.pts.length - 2; i >= 0; i--) { a = d.pts[i]; if (b.t - a.t >= 120) break; }
  const dt = Math.max(16, b.t - a.t);
  const vy = (a.y - b.y) / dt; // 위로 = +, px/ms
  const vx = (b.x - a.x) / dt;
  const total = d.y0 - b.y;
  const screensPerSec = (vy * 1000) / innerHeight;
  if (screensPerSec < 0.7 || total < 30) { world.setHandDrag(0, 0); return; }
  const power = Math.max(0, Math.min(1, (screensPerSec - 0.8) / 4.6));
  const aimX = Math.max(-1, Math.min(1, (vx / Math.max(0.1, vy)) * 1.6 + ((b.x - innerWidth / 2) / innerWidth) * 0.35));
  const spin = Math.max(0.2, Math.min(1, screensPerSec / 5));
  throwCoin({ power, aimX, spin });
};
touch.addEventListener('pointerup', endDrag);
touch.addEventListener('pointercancel', (e) => { if (drag && e.pointerId === drag.id) { drag = null; world.setHandDrag(0, 0); } });

/* ---------------- 동작 센서: 휘둘러 던지기 + 기울여 조준 ---------------- */
// 기본은 '폰 휘두르기'. 센서가 없거나 권한이 거부되면 자동으로 손가락 모드.
let inputMode = store.get('input', 'motion'); // 'motion' | 'finger'
let motionOK = null; // null: 아직 모름, true/false
let motionSeen = false, motionCooldown = 0, aimNow = 0, swing = null, lastJingle = 0;
const oriBuf = [];
const SWING_THR = 13; // m/s² 이 이상이면 던지기 시작 (동전은 도끼보다 가볍게)
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
async function enableMotion() {
  try {
    for (const Ev of [window.DeviceMotionEvent, window.DeviceOrientationEvent]) {
      if (Ev && typeof Ev.requestPermission === 'function') {
        const r = await Ev.requestPermission();
        if (r !== 'granted') throw new Error('denied');
      }
    }
    addEventListener('devicemotion', onMotion);
    addEventListener('deviceorientation', onOrientation);
    setTimeout(() => { if (!motionSeen) { motionOK = false; syncInput('이 기기엔 동작 센서가 없어서 손가락 모드로 바꿨어요'); } else motionOK = true; }, 1500);
  } catch {
    motionOK = false;
    syncInput('센서 권한이 없어서 손가락 모드로 바꿨어요');
  }
  keepAwake();
}
function useMotion() { return inputMode === 'motion' && motionOK !== false; }
function syncInput(msg) {
  const motion = useMotion();
  document.body.classList.toggle('motion-mode', motion);
  $('input-btn').setAttribute('aria-pressed', String(!motion));
  $('input-btn').textContent = motion ? '☝️ 손가락으로 던지기' : '📱 폰 휘둘러 던지기';
  $('hint').innerHTML = motion ? '📱 폰을 앞으로 <b>휙!</b> 휘둘러 던지기<br><small>좌우로 기울여 조준 · 폰을 꽉 쥐세요</small>' : '↑ 동전을 위로 휙! 밀어서 던지기';
  $('aim').hidden = !motion;
  if (msg) showToast(msg, 2600, 'warn');
}
$('input-btn').onclick = () => {
  if (motionOK === false && inputMode === 'finger') { showToast('이 기기에선 동작 센서를 쓸 수 없어요', 2200, 'warn'); return; }
  inputMode = useMotion() ? 'finger' : 'motion';
  store.set('input', inputMode);
  if (inputMode === 'motion' && motionOK == null) enableMotion();
  syncInput(); sfx.tick();
};
function onOrientation(e) {
  if (e.gamma == null) return;
  const t = performance.now();
  oriBuf.push({ t, g: e.gamma });
  while (oriBuf.length && t - oriBuf[0].t > 1200) oriBuf.shift();
  if (!swing && !busy) {
    aimNow = clamp(e.gamma / 32, -1, 1);
    $('aim').firstElementChild.style.left = `${50 + aimNow * 46}%`;
    if (useMotion() && document.body.dataset.step === 'throw') world.setHandDrag(aimNow * 0.25, 0);
  }
}
// 휘두르기 직전(흔들리기 전) 기울기
function aimBefore(t) {
  let pick = null;
  for (const o of oriBuf) if (o.t <= t - 180) pick = o;
  return pick ? clamp(pick.g / 32, -1, 1) : aimNow;
}
function onMotion(e) {
  let mag;
  const a = e.acceleration;
  if (a && a.x != null) mag = Math.hypot(a.x || 0, a.y || 0, a.z || 0);
  else {
    const g = e.accelerationIncludingGravity;
    if (!g || g.x == null) return;
    mag = Math.max(0, Math.hypot(g.x || 0, g.y || 0, g.z || 0) - 9.81);
  }
  motionSeen = true;
  if (!useMotion() || document.body.dataset.step !== 'throw' || busy || !round || round.shots.length >= SHOTS) { swing = null; return; }
  const t = performance.now();
  if (t < motionCooldown) return;
  if (!swing) {
    if (mag > SWING_THR) { swing = { start: t, peak: mag, aim: aimBefore(t) }; return; }
    // 살짝 흔들면 손 안에서 동전이 달그락
    if (mag > 4 && t - lastJingle > 160) {
      lastJingle = t;
      world.setHandDrag(aimNow * 0.25 + (Math.random() - 0.5) * 0.04, Math.min(0.12, mag / 80));
      sfx.flick(Math.min(0.25, mag / 60)); vibrate(5);
    }
    return;
  }
  if (mag > swing.peak) swing.peak = mag;
  if (t - swing.start > 150) {
    const power = clamp(0.12 + (swing.peak - SWING_THR) / (SWING_THR * 1.6), 0, 1);
    const aimX = swing.aim;
    swing = null;
    throwCoin({ power, aimX, spin: clamp(0.4 + power * 0.6, 0.2, 1) });
  }
}
let wakeLock = null;
async function keepAwake() {
  try { if ('wakeLock' in navigator && !wakeLock) { wakeLock = await navigator.wakeLock.request('screen'); wakeLock.addEventListener('release', () => { wakeLock = null; }); } } catch {}
}
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && motionOK) keepAwake(); });
syncInput();

// 데스크톱 테스트: 스페이스로 무작위 던지기
addEventListener('keydown', (e) => {
  if (e.code === 'Space' && document.body.dataset.step === 'throw' && !busy) { e.preventDefault(); throwCoin({ power: 0.35 + Math.random() * 0.45, aimX: Math.random() * 1.6 - 0.8, spin: 0.6 }); }
});

function showPower(p) {
  const el = $('power');
  el.hidden = false;
  el.firstElementChild.style.width = Math.round(p * 100) + '%';
  el.dataset.label = `힘 ${Math.round(p * 100)}%`;
  clearTimeout(el._t); el._t = setTimeout(() => (el.hidden = true), 2200);
}

function throwCoin({ power, aimX, spin }) {
  if (busy || !round || round.shots.length >= SHOTS) return;
  busy = true;
  const shot = round.shots.length + 1;
  if (shot === 1) track('game_start', { method: 'swipe' });
  const launch = { power: +power.toFixed(3), aimX: +aimX.toFixed(3), spin: +spin.toFixed(2), wind: windAt(), ang: spot, seed: (crypto.getRandomValues(new Uint32Array(1))[0] >>> 1) };
  const id = newId();
  mine.add(id);
  const sim = simulate(launch);
  const score = scoreOf(sim, launch.seed);
  const r = sim.rest;
  const coin = {
    nick, design, launch, round: round.id, shot, score,
    land: { x: +r.x.toFixed(3), y: +r.y.toFixed(3), z: +r.z.toFixed(3), nx: +r.nx.toFixed(3), ny: +r.ny.toFixed(3), nz: +r.nz.toFixed(3), yaw: +r.yaw.toFixed(3), flip: r.flip, zone: sim.zone },
  };
  round.shots.push({ zone: sim.zone, score, sim });
  renderCoinsLeft();
  $('hint').classList.add('gone');
  sfx.flick(power); sfx.spinWhir(Math.min(1.6, sim.events[0] ? sim.events[0].t : 1), 6 + spin * 10);
  vibrate(12);
  showPower(power);

  world.throwFromHand({ ...coin, id }, {
    follow: true,
    onEvent(ev) {
      sfx.eventSound(ev);
      if (ev.type === 'splash') vibrate(25);
      if (ev.type === 'stone' || ev.type === 'ceramic') vibrate(15);
      if (ev.type === 'turtle' || ev.type === 'potland') {
        hypeBurst(ev.type === 'turtle' ? 'turtle' : 'pot');
        vibrate([40, 50, 40, 50, 120, 80, 30, 40, 30, 40, 30, 40, 30]); // 쿵쿵 쾅! 짝짝짝
      }
    },
    onDone() { afterShot(sim, shot); },
  });
  // 연못에 기록 (네트워크가 느려도 게임은 계속)
  if (api) api.throwCoin(id, coin).catch((e) => { console.warn(e); showToast('연못에 기록 못 했어요: ' + explainError(e), 4000, 'warn'); });
}

function afterShot(sim, shot) {
  const z = sim.zone;
  const toast = () => showToast(shotMessage(sim), 2600, isSuccess(z) ? 'good' : z === 'out' ? 'bad' : '');
  if (isSuccess(z)) setTimeout(toast, 700); else toast(); // 성공이면 큰 도장이 지나간 뒤에
  if (shot < SHOTS) {
    setTimeout(() => { busy = false; motionCooldown = performance.now() + 700; world.setHandCoin(design); world.setHandMode('ready'); }, 900);
  } else {
    setTimeout(finishRound, 1700);
  }
}

async function finishRound() {
  const best = round.shots.reduce((a, b) => (b.score > a.score ? b : a));
  const success = round.shots.some((s) => isSuccess(s.zone));
  const bestZone = round.shots.find((s) => s.zone === 'turtle') ? 'turtle' : round.shots.find((s) => s.zone === 'pot') ? 'pot' : best.zone;
  const res = finalResult(bestZone);
  track('game_complete', { zone: bestZone, score: best.score });
  if (success) { sfx.bell(); sfx.fanfare(0.9, bestZone === 'turtle'); } else sfx.sparkle(); // 실패해도 밝게
  let detail = res.detail;
  if (success && round.wish) detail = `“${round.wish}” — ${detail}`;
  if (success && round.wish && round.share && api) {
    try {
      const wid = newId();
      await api.postWish(wid, { text: cleanWish(round.wish), zone: bestZone });
      myWishes.add(wid); store.set('myWishes', [...myWishes].slice(-30));
      detail += ' 소원이 익명으로 성취 게시판에 올라갔어요. 응원이 오면 알려드릴게요!';
    } catch (e) { console.warn(e); }
  }
  const zones = round.shots.map((s) => ZONES[s.zone].emoji).join(' ');
  window.DopaSharp.showResult({
    art: res.art, title: res.title, stat: res.stat, detail: `${zones} · ${detail}`,
    shareText: success ? `🪙 소원의 연못 — ${res.title} ${ZONES[bestZone].emoji}` : '🪙 소원의 연못 — 거북 등에 동전을 올리면 소원이 이루어진대요!',
    retryLabel: success ? '소원 하나 더 빌기 🪙×3' : '다시 해보기 🪙×3',
    onRetry: () => go('wish'),
  });
  if (success) hypeBurst(bestZone, { over: true }); // 결과 카드 위로 색종이 한 번 더 팡!
  busy = false;
  go('done');
}

/* ---------------- 다른 사람 동전 ---------------- */
const seen = new Set();
function onCoin(id, coin, initial) {
  if (seen.has(id) || mine.has(id) || !coin || !coin.launch) return;
  seen.add(id);
  if (initial) { world.placeCoin(coin); return; }
  world.playThrow(coin, { onEvent: (ev) => (ev.type === 'splash' || ev.type === 'turtle' || ev.type === 'potland') && sfx.eventSound(ev, { near: false }) });
}

/* ---------------- 성취 게시판 ---------------- */
let wishes = [];
const lastCheers = store.get('cheerCounts', {});
const myCheers = new Set(store.get('myCheers', []));
const myHearts = new Set(store.get('myHearts', []));
const lastHearts = store.get('heartCounts', {});
function renderWishes() {
  const ol = $('wish-list');
  if (!wishes.length) { ol.innerHTML = '<li class="empty">아직 성취한 소원이 없어요. 첫 번째 주인공이 되어 보세요!</li>'; return; }
  ol.innerHTML = wishes.map((w) => {
    const me = w.mine || myWishes.has(w.id);
    return `<li data-id="${w.id}" class="${me ? 'mine' : ''}">
      <span class="w-emoji">${ZONES[w.zone]?.emoji || '✨'}</span>
      <div class="w-body"><p>${esc(w.text)}</p><span class="w-meta">${me ? '<b>내 소원</b> · ' : ''}${timeAgo(w.at)}</span></div>
      <div class="w-acts">
        <button class="heart${myHearts.has(w.id) ? ' on' : ''}" type="button" data-act="heart" ${myHearts.has(w.id) || me ? 'disabled' : ''} aria-label="하트" aria-pressed="${myHearts.has(w.id)}">${myHearts.has(w.id) ? '❤️' : '🤍'} <span>${w.hearts}</span></button>
        <button class="cheer" type="button" data-act="cheer" ${myCheers.has(w.id) || me ? 'disabled' : ''} aria-label="응원하기">👏 <span>${w.cheers}</span></button>
      </div>
      ${me ? '' : '<button class="report" type="button" data-act="report" aria-label="신고">🚩</button>'}
    </li>`;
  }).join('');
}
$('wish-list').addEventListener('click', async (e) => {
  const btn = e.target.closest('[data-act]'); if (!btn || !api) return;
  const id = btn.closest('li').dataset.id;
  if (btn.dataset.act === 'heart') {
    btn.disabled = true; btn.classList.add('on', 'pop'); btn.setAttribute('aria-pressed', 'true'); sfx.cheerPop(); vibrate([8, 40, 8]);
    const n = btn.querySelector('span'); n.textContent = +n.textContent + 1;
    btn.firstChild.textContent = '❤️ ';
    floatHearts(btn);
    myHearts.add(id); store.set('myHearts', [...myHearts].slice(-300));
    const w = wishes.find((x) => x.id === id);
    if (w) w.hearts += 1;
    try { await api.heart(id, w ? w.hearts - 1 : 0); } catch (err) { console.warn(err); }
  } else if (btn.dataset.act === 'cheer') {
    btn.disabled = true; btn.classList.add('pop'); sfx.cheerPop(); vibrate(10);
    const n = btn.querySelector('span'); n.textContent = +n.textContent + 1;
    myCheers.add(id); store.set('myCheers', [...myCheers].slice(-200));
    const w = wishes.find((x) => x.id === id);
    try { await api.cheer(id, w ? w.cheers : 0); } catch (err) { console.warn(err); }
  } else if (btn.dataset.act === 'report' && confirm('이 소원을 신고할까요? 신고가 쌓이면 숨겨져요.')) {
    const w = wishes.find((x) => x.id === id);
    try { await api.report(id, w ? w.reports : 0); showToast('신고했어요. 고마워요.', 1800); } catch (err) { console.warn(err); }
  }
});
// 하트 누르면 작은 하트들이 퐁퐁 떠오름
function floatHearts(btn) {
  const r = btn.getBoundingClientRect();
  for (let i = 0; i < 7; i++) {
    const h = document.createElement('i');
    h.className = 'heart-float'; h.textContent = ['❤️', '💖', '💗'][i % 3];
    h.style.left = r.left + r.width / 2 + 'px'; h.style.top = r.top + 'px';
    h.style.setProperty('--dx', ((Math.random() * 2 - 1) * 46).toFixed(0) + 'px');
    h.style.setProperty('--d', (0.8 + Math.random() * 0.5).toFixed(2) + 's');
    h.style.animationDelay = (i * 0.05).toFixed(2) + 's';
    document.body.appendChild(h); setTimeout(() => h.remove(), 1600);
  }
}
function openBoard() { $('sheet-board').hidden = false; renderWishes(); sfx.tick(); }
$('board-btn').onclick = openBoard;
$('again-btn').onclick = () => go('wish');
$('board-close').onclick = () => ($('sheet-board').hidden = true);

function onWishes(list) {
  wishes = list;
  // 내 소원에 새 응원이 오면 알림
  let gained = 0, loved = 0;
  list.forEach((w) => {
    if (!(w.mine || myWishes.has(w.id))) return;
    const before = lastCheers[w.id] ?? w.cheers;
    if (w.cheers > before) gained += w.cheers - before;
    lastCheers[w.id] = w.cheers;
    const hb = lastHearts[w.id] ?? w.hearts;
    if (w.hearts > hb) loved += w.hearts - hb;
    lastHearts[w.id] = w.hearts;
  });
  store.set('cheerCounts', lastCheers); store.set('heartCounts', lastHearts);
  if (loved > 0) { showToast(`❤️ 누군가 내 소원에 하트를 보냈어요! (+${loved})`, 3000, 'good'); sfx.cheerPop(); }
  else if (gained > 0) { showToast(`👏 누군가 내 소원을 응원했어요! (+${gained})`, 3000, 'good'); sfx.cheerPop(); }
  $('board-btn').textContent = `🎉 성취 게시판${list.length ? ' ' + list.length : ''}`;
  if (!$('sheet-board').hidden) renderWishes();
}

/* ---------------- 소리 ---------------- */
function syncSoundBtn() { $('sound-btn').textContent = store.get('sound', true) ? '🔊' : '🔇'; }
$('sound-btn').onclick = () => {
  const on = !store.get('sound', true); store.set('sound', on);
  sfx.unlockAudio(); sfx.setSoundEnabled(on);
  if (on) sfx.startAmbient(0.55); else sfx.stopAmbient();
  syncSoundBtn();
};
syncSoundBtn();
let sleepTimer;
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    sfx.stopAmbient();
    sleepTimer = setTimeout(() => api && api.sleep(), 30000); // 30초 넘게 다른 앱에 있으면 연결 끊기
  } else {
    clearTimeout(sleepTimer); api && api.wake();
    if (store.get('sound', true) && sfx.audioReady()) sfx.startAmbient(0.55);
  }
});

/* ---------------- 연결 ---------------- */
(async () => {
  try {
    api = await connect('thrower');
    api.watchPresence((list) => { othersSpots = list.filter((p) => p.uid !== api.uid && Number.isFinite(+p.spot)).map((p) => +p.spot); });
    sharePresence();
    api.watchCoins(60, onCoin); // 폰은 최근 동전만 (데이터 절약)
    api.watchWishes(30, onWishes);
    if (api.authError) $('net-note').textContent = '⚠️ ' + explainError(api.authError) + ' (혼자 연습은 할 수 있어요)';
  } catch (e) {
    console.error(e);
    $('net-note').textContent = '⚠️ 연못 연결 실패: ' + explainError(e) + ' (혼자 연습은 할 수 있어요)';
  }
})();

go('intro');
world.setThrowSpot(spot);
world.setHandCoin(design);
