// 연못 화면: 모든 사람의 동전이 실시간으로 날아와 쌓이고, 성취한 소원이 흘러가요.
import { createWorld } from './world.js?v=8';
import { connect, mode, explainError } from './net.js?v=8';
import { windAt } from './physics.js?v=8';
import { faceDataURL } from './coin-art.js?v=8';
import { ZONES, timeAgo, esc } from './game.js?v=8';
import * as sfx from './sound.js?v=8';
import { hypeBurst } from './hype.js?v=8';

const $ = (id) => document.getElementById(id);
const world = createWorld($('scene'), { mode: 'pond' });
// 불꽃 효과음은 장면에서 쏘고 터지는 순간에 맞춤
world.onFx((type, p) => {
  if (!soundOn) return;
  const pan = Math.max(-1, Math.min(1, p.x / 5));
  if (type === 'launch') sfx.fireworkLaunch(pan, 0.5);
  else if (type === 'burst') sfx.fireworkPop(pan, 0.6);
});
const coinUrl = new URL('coin.html', location.href);
if (mode === 'local') coinUrl.searchParams.set('local', '');

// QR
(() => {
  const qr = window.qrcode(0, 'M');
  qr.addData(coinUrl.href); qr.make();
  $('qr').innerHTML = qr.createSvgTag({ cellSize: 4, margin: 2, scalable: true });
  $('qr-link').href = coinUrl.href;
  $('qr-link').textContent = coinUrl.host + coinUrl.pathname.replace(/\/$/, '');
})();
// QR 접기/펼치기 (상태는 이 기기에 기억)
function setQr(open) {
  $('qr-card').hidden = !open; $('qr-open').hidden = open;
  try { localStorage.setItem('wishpond:qr', open ? '1' : '0'); } catch {}
}
$('qr-fold').onclick = () => setQr(false);
$('qr-open').onclick = () => setQr(true);
try { if (localStorage.getItem('wishpond:qr') === '0') setQr(false); } catch {}
setTimeout(() => $('orbit-hint').classList.add('gone'), 9000);

if (mode === 'local') {
  $('mode-note').hidden = false;
  $('mode-note').textContent = '로컬 테스트 모드: 같은 브라우저의 다른 탭에서 coin.html을 열어 던져 보세요.';
}

// 소리 (브라우저 정책상 한 번 눌러야 켜짐)
let soundOn = false;
$('sound-btn').onclick = () => {
  soundOn = !soundOn;
  if (soundOn) { sfx.unlockAudio(); sfx.setSoundEnabled(true); sfx.startAmbient(1); }
  else { sfx.stopAmbient(); sfx.setSoundEnabled(false); }
  $('sound-btn').textContent = soundOn ? '🔊 소리 끄기' : '🔇 소리 켜기';
};
$('fs-btn').onclick = () => {
  if (document.fullscreenElement) document.exitFullscreen();
  else document.documentElement.requestFullscreen?.().catch(() => {});
};

// 바람
function showWind() {
  const w = windAt();
  const arrow = w > 0.05 ? '→' : w < -0.05 ? '←' : '·';
  $('wind').textContent = `바람 ${arrow} ${Math.abs(w).toFixed(1)}`;
}
showWind(); setInterval(showWind, 1000);

// 피드 (누가 던졌는지)
function feed(html, cls = '') {
  const el = document.createElement('div');
  el.className = 'feed-item ' + cls;
  el.innerHTML = html;
  $('feed').prepend(el);
  while ($('feed').children.length > 5) $('feed').lastChild.remove();
  setTimeout(() => el.classList.add('out'), 6500);
  setTimeout(() => el.remove(), 7200);
}
let bannerTimer;
function banner(html) {
  const b = $('banner');
  b.innerHTML = html; b.hidden = false;
  b.classList.remove('show'); void b.offsetWidth; b.classList.add('show');
  clearTimeout(bannerTimer); bannerTimer = setTimeout(() => (b.hidden = true), 6000);
}

let realPeople = [], fakeCrowd = []; // fakeCrowd: 콘솔 testCrowd()용
const seen = new Set();
function nickOf(c) { return c.nick ? `${esc(c.nick)}님` : '누군가'; }

function onCoin(id, coin, initial) {
  if (seen.has(id) || !coin || !coin.launch) return;
  seen.add(id);
  coin.id = id;
  if (initial) { world.placeCoin(coin); return; }
  const fly = (hand) => world.playThrow(coin, {
    fromHand: hand, blend: 0.45,
    onEvent(ev) {
      const win = ev.type === 'turtle' || ev.type === 'potland';
      // 성공하면 던진 사람은 만세, 나머지는 그쪽 보고 박수
      const clappers = win ? world.celebrate(coin.uid, ev.x, ev.z) : 0;
      if (soundOn) sfx.eventSound(ev, { near: false, crowd: clappers + 3 });
      if (win) {
        const zone = ev.type === 'turtle' ? 'turtle' : 'pot';
        const z = ZONES[zone];
        hypeBurst(zone);
        setTimeout(() => banner(`<span class="banner-emoji">${z.emoji}</span><b>${z.grade}!</b> ${nickOf(coin)}의 동전이 ${z.label}에 올라갔어요`), 1700); // 큰 "소원 성취!" 도장이 사라질 때쯤
      }
    },
  });
  // 연못 둘레에 그 사람이 있으면 팔을 크게 휘두른 뒤 손에서 동전이 떠남
  if (!world.personThrow(coin.uid, fly)) fly(null);
  feed(`<span class="feed-coin" style="background-image:url(${faceDataURL(coin.design, 'front', 64)})"></span>${nickOf(coin)}의 동전 ${coin.shot ? `<em>${coin.shot}/3</em>` : ''}`);
}

// 동전 탭 → 확대
const canvas = $('scene');
canvas.addEventListener('click', (e) => {
  if (world.justDragged()) return;
  const rec = world.pick(e.clientX, e.clientY);
  const peek = $('peek');
  if (!rec) { peek.hidden = true; return; }
  const z = ZONES[(rec.land && rec.land.zone) || 'water'] || ZONES.water;
  peek.innerHTML = `<div class="peek-faces"><img src="${faceDataURL(rec.design, 'front', 160)}" alt="앞면"><img src="${faceDataURL(rec.design, 'back', 160)}" alt="뒷면"></div>
    <strong>${rec.nick ? esc(rec.nick) + '님의 동전' : '익명의 동전'}</strong><span>${z.emoji} ${z.label} · ${timeAgo(rec.at)}</span>`;
  peek.style.left = Math.min(innerWidth - 220, Math.max(10, e.clientX - 100)) + 'px';
  peek.style.top = Math.min(innerHeight - 220, Math.max(10, e.clientY - 230)) + 'px';
  peek.hidden = false;
  clearTimeout(peek._t); peek._t = setTimeout(() => (peek.hidden = true), 5000);
});

// 소원 성취 게시판 (접기/펼치기는 이 기기에 기억)
function setBoard(open) {
  $('board').classList.toggle('folded', !open);
  $('board-fold').setAttribute('aria-expanded', String(open));
  $('board-fold').querySelector('.board-toggle').textContent = open ? '－' : '＋';
  try { localStorage.setItem('wishpond:board', open ? '1' : '0'); } catch {}
}
$('board-fold').onclick = () => setBoard($('board').classList.contains('folded'));
try { if (localStorage.getItem('wishpond:board') === '0') setBoard(false); } catch {}

let knownWishes = null;
const heartSeen = new Map();
function renderBoard(list) {
  const ol = $('board-list');
  $('board-count').textContent = list.length ? list.length : '';
  if (!list.length) return;
  ol.innerHTML = list.slice(0, 8).map((w) => {
    const prev = heartSeen.get(w.id);
    const fresh = prev !== undefined && w.hearts > prev; // 방금 하트가 왔으면 퐁!
    heartSeen.set(w.id, w.hearts);
    return `<li class="${fresh ? 'loved' : ''}"><span class="board-emoji">${ZONES[w.zone]?.emoji || '✨'}</span><p>${esc(w.text)}</p><span class="board-meta">❤️ ${w.hearts} · 👏 ${w.cheers} · ${timeAgo(w.at)}</span>${fresh ? '<i class="board-heart" aria-hidden="true">❤️</i>' : ''}</li>`;
  }).join('');
  if (knownWishes) {
    const fresh = list.find((w) => !knownWishes.has(w.id));
    if (fresh) setTimeout(() => banner(`<span class="banner-emoji">🎉</span>누군가의 소원이 이뤄지는 중!<q>${esc(fresh.text)}</q>`), 1800);
  }
  knownWishes = new Set(list.map((w) => w.id));
}

function showNote(text) { $('mode-note').hidden = false; $('mode-note').textContent = text; }
(async () => {
  let api;
  try { api = await connect('pond'); } catch (e) { console.error(e); showNote('연못 연결 실패: ' + explainError(e)); return; }
  if (api.authError) showNote('보기만 가능: ' + explainError(api.authError));
  // 각각 따로 연결 (하나가 실패해도 나머지는 동작)
  const step = (name, fn) => Promise.resolve().then(fn).catch((e) => { console.error('[wish-pond]', name, e); showNote(`${name} 연결 실패: ${explainError(e)}`); });
  await step('동전', () => api.watchCoins(300, onCoin)); // 최근 300개만 받아 와서 바닥에 쌓음
  step('동전 수', () => api.watchTotal((n) => ($('total').textContent = `🪙 ${n.toLocaleString('ko-KR')}개`)));
  step('접속자', () => api.watchPresence((list) => { realPeople = list; $('online').textContent = `지금 ${list.length}명`; world.setPeople([...list, ...fakeCrowd]); }));
  step('게시판', () => api.watchWishes(20, renderBoard));
})();

window.testThrow = (power = Math.random(), aimX = Math.random() * 2 - 1, uid) => {
  const coin = { uid, nick: '테스트', design: { metal: ['gold', 'silver', 'bronze', 'rose', 'jade'][Math.floor(Math.random() * 5)], rim: 'dots', stamp: '🐢', text: '합격', back: '' }, launch: { power, aimX, spin: 0.6, wind: windAt(), seed: Math.floor(Math.random() * 2 ** 31) } };
  onCoin('t' + Math.random(), coin, false);
};
// 테스트용 가짜 접속자: testCrowd(6) 후 testThrow(0.5, 0, 'test0') → test0이 팔을 휘둘러 던짐
window.testSlow = (k = 0.25) => world.setTimeScale(k); // 슬로 모션으로 연출 확인
window.testCrowd = (n = 6) => {
  const stamps = ['🐢', '🍀', '💖', '⭐', '🌸', '🐟', '🎓', '💰'];
  fakeCrowd = Array.from({ length: n }, (_, i) => ({ uid: 'test' + i, nick: '테스트' + (i + 1), design: { metal: ['gold', 'silver', 'bronze', 'rose', 'jade'][i % 5], rim: 'dots', stamp: stamps[i % stamps.length], text: '소원', back: '' } }));
  world.setPeople([...realPeople, ...fakeCrowd]);
};
