// 던지는 폰: 닉네임 → 동전 꾸미기 → 소원 → 3번 던지기 → 결과 → (성공 시) 익명 게시판
import { createWorld } from './world.js?v=3';
import { connect, mode, newId } from './net.js?v=3';
import { windAt, simulate, scoreOf, isSuccess } from './physics.js?v=3';
import { METALS, RIMS, STAMPS, DEFAULT_DESIGN, sanitizeDesign } from './coin-art.js?v=3';
import { ZONES, SHOTS, shotMessage, finalResult, timeAgo, esc } from './game.js?v=3';
import { cleanWish, cleanNick } from './filter.js?v=3';
import * as sfx from './sound.js?v=3';

const $ = (id) => document.getElementById(id);
const store = {
  get(k, d) { try { const v = localStorage.getItem('wishpond:' + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem('wishpond:' + k, JSON.stringify(v)); } catch {} },
};
const vibrate = (p) => { try { navigator.vibrate && navigator.vibrate(p); } catch {} };
const track = (n, p) => window.DopaSharp && window.DopaSharp.track(n, p);

const world = createWorld($('scene'), { mode: 'thrower' });

let design = sanitizeDesign(store.get('design', DEFAULT_DESIGN));
let nick = store.get('nick', '');
let api = null;
const mine = new Set();
const myWishes = new Set(store.get('myWishes', []));
let round = null; // { id, shots: [], wish, share }
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
  presTimer = setTimeout(() => api && api.setPresence && api.setPresence({ nick, design }), 1200); // 연타해도 DB 쓰기는 한 번
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
  const arrow = w > 0.05 ? '→' : w < -0.05 ? '←' : '·';
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
  const launch = { power: +power.toFixed(3), aimX: +aimX.toFixed(3), spin: +spin.toFixed(2), wind: windAt(), seed: (crypto.getRandomValues(new Uint32Array(1))[0] >>> 1) };
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
      if (ev.type === 'turtle' || ev.type === 'potland') vibrate([40, 60, 40, 60, 80]);
    },
    onDone() { afterShot(sim, shot); },
  });
  // 연못에 기록 (네트워크가 느려도 게임은 계속)
  if (api) api.throwCoin(id, coin).catch((e) => { console.warn(e); showToast('연못 연결이 불안정해요. 동전은 이 폰에만 보여요.', 2600, 'warn'); });
}

function afterShot(sim, shot) {
  const z = sim.zone;
  showToast(shotMessage(sim), 2600, isSuccess(z) ? 'good' : z === 'out' ? 'bad' : '');
  if (shot < SHOTS) {
    setTimeout(() => { busy = false; world.setHandCoin(design); world.setHandMode('ready'); }, 900);
  } else {
    setTimeout(finishRound, 1700);
  }
}

async function finishRound() {
  const best = round.shots.reduce((a, b) => (b.score > a.score ? b : a));
  const res = finalResult(best);
  const success = round.shots.some((s) => isSuccess(s.zone));
  const bestZone = round.shots.find((s) => s.zone === 'turtle') ? 'turtle' : round.shots.find((s) => s.zone === 'pot') ? 'pot' : best.zone;
  track('game_complete', { zone: bestZone, score: best.score });
  if (success) sfx.bell(); else if (best.score < 40) sfx.aww(); else sfx.sparkle();
  let detail = res.detail;
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
    art: res.art, title: res.title, stat: `소원 성취 확률 ${best.score}%`, detail: `${zones} · ${detail}`,
    shareText: `🪙 소원의 연못 — ${res.title} (성취 확률 ${best.score}%)`,
    retryLabel: '다시 빌기 (동전 3개)',
    onRetry: () => go('wish'),
  });
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
function renderWishes() {
  const ol = $('wish-list');
  if (!wishes.length) { ol.innerHTML = '<li class="empty">아직 성취한 소원이 없어요. 첫 번째 주인공이 되어 보세요!</li>'; return; }
  ol.innerHTML = wishes.map((w) => {
    const me = w.mine || myWishes.has(w.id);
    return `<li data-id="${w.id}" class="${me ? 'mine' : ''}">
      <span class="w-emoji">${ZONES[w.zone]?.emoji || '✨'}</span>
      <div class="w-body"><p>${esc(w.text)}</p><span class="w-meta">${me ? '<b>내 소원</b> · ' : ''}${timeAgo(w.at)}</span></div>
      <button class="cheer" type="button" data-act="cheer" ${myCheers.has(w.id) || me ? 'disabled' : ''} aria-label="응원하기">👏 <span>${w.cheers}</span></button>
      ${me ? '' : '<button class="report" type="button" data-act="report" aria-label="신고">🚩</button>'}
    </li>`;
  }).join('');
}
$('wish-list').addEventListener('click', async (e) => {
  const btn = e.target.closest('[data-act]'); if (!btn || !api) return;
  const id = btn.closest('li').dataset.id;
  if (btn.dataset.act === 'cheer') {
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
function openBoard() { $('sheet-board').hidden = false; renderWishes(); sfx.tick(); }
$('board-btn').onclick = openBoard;
$('again-btn').onclick = () => go('wish');
$('board-close').onclick = () => ($('sheet-board').hidden = true);

function onWishes(list) {
  wishes = list;
  // 내 소원에 새 응원이 오면 알림
  let gained = 0;
  list.forEach((w) => {
    if (!(w.mine || myWishes.has(w.id))) return;
    const before = lastCheers[w.id] ?? w.cheers;
    if (w.cheers > before) gained += w.cheers - before;
    lastCheers[w.id] = w.cheers;
  });
  store.set('cheerCounts', lastCheers);
  if (gained > 0) { showToast(`👏 누군가 내 소원을 응원했어요! (+${gained})`, 3000, 'good'); sfx.cheerPop(); }
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
    sharePresence();
    api.watchCoins(60, onCoin); // 폰은 최근 동전만 (데이터 절약)
    api.watchWishes(30, onWishes);
  } catch (e) {
    console.error(e);
    $('net-note').textContent = '연못 연결에 실패했어요. 혼자 연습은 할 수 있어요.';
  }
})();

go('intro');
world.setHandCoin(design);
