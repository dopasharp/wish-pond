// 연못 화면: 모든 사람의 동전이 실시간으로 날아와 쌓이고, 성취한 소원이 흘러가요.
import { createWorld } from './world.js?v=1';
import { connect, mode } from './net.js?v=2';
import { windAt } from './physics.js?v=1';
import { faceDataURL } from './coin-art.js?v=1';
import { ZONES, timeAgo, esc } from './game.js?v=1';
import * as sfx from './sound.js?v=1';

const $ = (id) => document.getElementById(id);
const world = createWorld($('scene'), { mode: 'pond' });
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

const seen = new Set();
function nickOf(c) { return c.nick ? `${esc(c.nick)}님` : '누군가'; }

function onCoin(id, coin, initial) {
  if (seen.has(id) || !coin || !coin.launch) return;
  seen.add(id);
  coin.id = id;
  if (initial) { world.placeCoin(coin); return; }
  world.playThrow(coin, {
    onEvent(ev) {
      if (soundOn) sfx.eventSound(ev, { near: false });
      if (ev.type === 'turtle' || ev.type === 'potland') {
        const z = ZONES[ev.type === 'turtle' ? 'turtle' : 'pot'];
        banner(`<span class="banner-emoji">${z.emoji}</span><b>${z.grade}!</b> ${nickOf(coin)}의 동전이 ${z.label}에 올라갔어요`);
      }
    },
  });
  feed(`<span class="feed-coin" style="background-image:url(${faceDataURL(coin.design, 'front', 64)})"></span>${nickOf(coin)}의 동전 ${coin.shot ? `<em>${coin.shot}/3</em>` : ''}`);
}

// 동전 탭 → 확대
const canvas = $('scene');
canvas.addEventListener('click', (e) => {
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

// 소원 성취 게시판
let knownWishes = null;
function renderBoard(list) {
  const ol = $('board-list');
  if (!list.length) return;
  ol.innerHTML = list.slice(0, 8).map((w) => `<li><span class="board-emoji">${ZONES[w.zone]?.emoji || '✨'}</span><p>${esc(w.text)}</p><span class="board-meta">👏 ${w.cheers} · ${timeAgo(w.at)}</span></li>`).join('');
  if (knownWishes) {
    const fresh = list.find((w) => !knownWishes.has(w.id));
    if (fresh) setTimeout(() => banner(`<span class="banner-emoji">🎉</span>누군가의 소원이 이뤄지는 중!<q>${esc(fresh.text)}</q>`), 1800);
  }
  knownWishes = new Set(list.map((w) => w.id));
}

(async () => {
  try {
    const api = await connect('pond');
    await api.watchCoins(380, onCoin);
    api.watchTotal((n) => ($('total').textContent = `🪙 ${n.toLocaleString('ko-KR')}개`));
    api.watchPresence((n) => ($('online').textContent = `지금 ${n}명`));
    api.watchWishes(30, renderBoard);
  } catch (e) {
    console.error(e);
    $('mode-note').hidden = false;
    $('mode-note').textContent = '연못 연결에 실패했어요. 잠시 후 새로고침해 주세요.';
  }
})();

window.testThrow = (power = Math.random(), aimX = Math.random() * 2 - 1) => {
  const coin = { nick: '테스트', design: { metal: ['gold', 'silver', 'bronze', 'rose', 'jade'][Math.floor(Math.random() * 5)], rim: 'dots', stamp: '🐢', text: '합격', back: '' }, launch: { power, aimX, spin: 0.6, wind: windAt(), seed: Math.floor(Math.random() * 2 ** 31) } };
  onCoin('t' + Math.random(), coin, false);
};
