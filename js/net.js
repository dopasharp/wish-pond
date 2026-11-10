// 연못 <-> 폰 연동 레이어.
// - firebase: Realtime Database + 익명 로그인 (서로 다른 기기 간 연동, 동전이 계속 남음)
// - local:    localStorage + BroadcastChannel (같은 브라우저의 탭끼리, Firebase 설정 전 테스트용)
import { firebaseConfig } from './firebase-config.js?v=2';

const ROOT = 'wishPond';
const SDK = 'https://www.gstatic.com/firebasejs/10.12.2';
const params = new URLSearchParams(location.search);
const cfg = firebaseConfig || {};
const configured = !!cfg.databaseURL && !/YOUR_/.test(`${cfg.apiKey}${cfg.databaseURL}`);
export const mode = params.has('local') || !configured ? 'local' : 'firebase';

export function newId() {
  const t = Date.now().toString(36).padStart(9, '0');
  const r = Array.from(crypto.getRandomValues(new Uint8Array(6)), (b) => 'abcdefghijklmnopqrstuvwxyz0123456789'[b % 36]).join('');
  return t + r;
}

/** @returns {Promise<Api>} */
export async function connect(role) {
  return mode === 'local' ? localApi(role) : firebaseApi(role);
}

async function firebaseApi(role) {
  const [{ initializeApp }, d, a] = await Promise.all([
    import(`${SDK}/firebase-app.js`),
    import(`${SDK}/firebase-database.js`),
    import(`${SDK}/firebase-auth.js`),
  ]);
  const app = initializeApp(firebaseConfig);
  const auth = a.getAuth(app);
  const cred = await a.signInAnonymously(auth);
  const uid = cred.user.uid;
  const db = d.getDatabase(app);
  const ref = (p = '') => d.ref(db, `${ROOT}${p ? '/' + p : ''}`);

  // 접속 표시 (끊기면 자동 삭제). 던지는 폰은 닉네임·동전 디자인도 같이 올려서 연못 화면에 캐릭터로 보여요.
  let info = {};
  const me = ref(`presence/${uid}`);
  d.onValue(d.ref(db, '.info/connected'), (s) => {
    if (s.val() !== true) return;
    d.onDisconnect(me).remove();
    d.set(me, { ...info, role, at: d.serverTimestamp() });
  });

  return {
    mode, uid,
    async watchCoins(limit, onCoin) {
      const q = d.query(ref('coins'), d.orderByKey(), d.limitToLast(limit));
      const snap = await d.get(q);
      let lastKey = null;
      snap.forEach((c) => { lastKey = c.key; onCoin(c.key, c.val(), true); });
      const live = lastKey ? d.query(ref('coins'), d.orderByKey(), d.startAfter(lastKey)) : d.query(ref('coins'), d.orderByKey());
      d.onChildAdded(live, (c) => onCoin(c.key, c.val(), false));
    },
    watchTotal(cb) { d.onValue(ref('stats/total'), (s) => cb(s.val() || 0)); },
    async throwCoin(id, coin) {
      await d.update(ref(), {
        [`coins/${id}`]: { ...coin, uid, at: d.serverTimestamp() },
        [`users/${uid}/lastAt`]: d.serverTimestamp(),
      });
      d.runTransaction(ref('stats/total'), (n) => (n || 0) + 1).catch(() => {});
      return id;
    },
    watchWishes(limit, cb) {
      d.onValue(d.query(ref('wishes'), d.orderByKey(), d.limitToLast(limit)), (s) => {
        const list = [];
        s.forEach((c) => { list.push(wishView(c.key, c.val(), uid)); });
        cb(list.reverse().filter((w) => !w.hidden));
      });
    },
    async postWish(id, { text, zone }) {
      await d.set(ref(`wishes/${id}`), { text, zone, uid, at: d.serverTimestamp() });
      return id;
    },
    cheer(id) { return d.set(ref(`wishes/${id}/cheers/${uid}`), true); },
    report(id) { return d.set(ref(`wishes/${id}/reports/${uid}`), true); },
    setPresence(next) {
      info = { nick: String(next.nick || '').slice(0, 10), design: next.design || null };
      d.update(me, info).catch(() => {});
    },
    // cb([{ uid, nick, design }]) — 지금 접속한 던지는 사람들
    watchPresence(cb) {
      d.onValue(ref('presence'), (s) => {
        const list = [];
        s.forEach((c) => { const v = c.val(); if (v && v.role === 'thrower') list.push({ uid: c.key, nick: v.nick || '', design: v.design || null }); });
        cb(list);
      });
    },
  };
}

function wishView(id, w, uid) {
  const cheers = w.cheers ? Object.keys(w.cheers).length : 0;
  const reports = w.reports ? Object.keys(w.reports).length : 0;
  return { id, text: w.text, zone: w.zone, at: w.at, cheers, cheered: !!(w.cheers && w.cheers[uid]), mine: w.uid === uid, hidden: reports >= 3 };
}

// ---------------------------------------------------------------- local mode
function localApi(role) {
  const KEY = 'wishpond:local';
  const load = () => { try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch { return {}; } };
  const save = (db) => { try { localStorage.setItem(KEY, JSON.stringify(db)); } catch {} };
  let uid = sessionStorage.getItem('wishpond:uid');
  if (!uid) { uid = 'L' + newId(); sessionStorage.setItem('wishpond:uid', uid); }
  const ch = new BroadcastChannel('wishpond');
  const subs = { coin: [], wishes: [], total: [], presence: [] };
  const peers = new Map();
  const db = () => { const x = load(); x.coins ||= {}; x.wishes ||= {}; x.total ||= 0; return x; };
  const emitWishes = () => subs.wishes.forEach((f) => f());
  const emitTotal = () => subs.total.forEach((f) => f(db().total));
  const emitPresence = () => {
    const now = Date.now();
    const list = [];
    peers.forEach((p, id) => { if (now - p.at < 20000 && p.role === 'thrower') list.push({ uid: id, nick: p.nick || '', design: p.design || null }); });
    subs.presence.forEach((f) => f(list));
  };
  ch.onmessage = ({ data: m }) => {
    if (m.type === 'coin') subs.coin.forEach((f) => f(m.id, m.coin, false));
    else if (m.type === 'wishes') emitWishes();
    else if (m.type === 'total') emitTotal();
    else if (m.type === 'hello') { peers.set(m.uid, { role: m.role, nick: m.nick, design: m.design, at: Date.now() }); emitPresence(); }
    else if (m.type === 'bye') { peers.delete(m.uid); emitPresence(); }
  };
  let info = {};
  const hello = () => ch.postMessage({ type: 'hello', uid, role, ...info });
  hello(); setInterval(() => { hello(); emitPresence(); }, 3000);
  addEventListener('pagehide', () => ch.postMessage({ type: 'bye', uid }));

  return {
    mode, uid,
    async watchCoins(limit, onCoin) {
      const all = Object.entries(db().coins).sort(([a], [b]) => (a < b ? -1 : 1)).slice(-limit);
      all.forEach(([id, c]) => onCoin(id, c, true));
      subs.coin.push(onCoin);
    },
    watchTotal(cb) { subs.total.push(cb); cb(db().total); },
    async throwCoin(id, coin) {
      const x = db();
      const c = { ...coin, uid, at: Date.now() };
      x.coins[id] = c; x.total += 1;
      // 로컬 저장 공간 보호: 오래된 동전 정리
      const keys = Object.keys(x.coins).sort();
      while (keys.length > 600) delete x.coins[keys.shift()];
      save(x);
      ch.postMessage({ type: 'coin', id, coin: c });
      ch.postMessage({ type: 'total' });
      emitTotal();
      return id;
    },
    watchWishes(limit, cb) {
      const run = () => {
        const list = Object.entries(db().wishes).sort(([a], [b]) => (a < b ? 1 : -1)).slice(0, limit).map(([id, w]) => wishView(id, w, uid));
        cb(list.filter((w) => !w.hidden));
      };
      subs.wishes.push(run); run();
    },
    async postWish(id, { text, zone }) {
      const x = db(); x.wishes[id] = { text, zone, uid, at: Date.now() }; save(x);
      ch.postMessage({ type: 'wishes' }); emitWishes();
      return id;
    },
    async cheer(id) {
      const x = db(); const w = x.wishes[id]; if (!w) return;
      (w.cheers ||= {})[uid] = true; save(x); ch.postMessage({ type: 'wishes' }); emitWishes();
    },
    async report(id) {
      const x = db(); const w = x.wishes[id]; if (!w) return;
      (w.reports ||= {})[uid] = true; save(x); ch.postMessage({ type: 'wishes' }); emitWishes();
    },
    setPresence(next) { info = { nick: next.nick || '', design: next.design || null }; hello(); },
    watchPresence(cb) { subs.presence.push(cb); emitPresence(); },
  };
}
