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

/** 연결 오류를 사람이 고칠 수 있는 문장으로 */
export function explainError(e) {
  const code = String((e && (e.code || e.message)) || e || '');
  if (/operation-not-allowed|admin-restricted/i.test(code)) return '익명 로그인이 꺼져 있어요 → Firebase 콘솔 Authentication › 로그인 방법 › 익명 사용 설정';
  if (/configuration-not-found/i.test(code)) return 'Authentication이 시작되지 않았어요 → Firebase 콘솔 Authentication › 시작하기 후 익명 사용 설정';
  if (/api-key|invalid-api-key|API_KEY/i.test(code)) return 'API 키가 맞지 않거나 제한돼 있어요 → 프로젝트 설정의 웹 앱 apiKey 확인';
  if (/unauthorized-domain|requests-from-referer|referer/i.test(code)) return '이 사이트 주소가 허용되지 않았어요 → Authentication › 설정 › 승인된 도메인에 dopasharp.github.io 추가 (API 키 웹사이트 제한도 확인)';
  if (/permission[_ -]denied/i.test(code)) return 'DB 규칙이 막고 있어요 → Realtime Database › 규칙을 저장소의 database.rules.json으로 다시 게시';
  if (/network-request-failed|Failed to fetch|dynamically imported/i.test(code)) return 'Firebase에 접속하지 못했어요 → 인터넷·광고 차단기 확인 후 새로고침';
  return '연결 오류: ' + code.slice(0, 120);
}

async function firebaseApi(role) {
  const [{ initializeApp }, d, a] = await Promise.all([
    import(`${SDK}/firebase-app.js`),
    import(`${SDK}/firebase-database.js`),
    import(`${SDK}/firebase-auth.js`),
  ]);
  const app = initializeApp(firebaseConfig);
  const auth = a.getAuth(app);
  // 로그인에 실패해도 보기(읽기)는 되게 계속 진행하고, 이유는 authError로 알려줌
  let uid = null, authError = null;
  try { uid = (await a.signInAnonymously(auth)).user.uid; } catch (e) { authError = e; console.error('[wish-pond] 익명 로그인 실패', e); }
  const db = d.getDatabase(app);
  const ref = (p = '') => d.ref(db, `${ROOT}${p ? '/' + p : ''}`);

  // 접속 표시 (끊기면 자동 삭제). 던지는 폰은 닉네임·동전 디자인도 같이 올려서 연못 화면에 캐릭터로 보여요.
  let info = {};
  const me = ref(`presence/${uid || 'anon'}`);
  d.onValue(d.ref(db, '.info/connected'), (s) => {
    if (s.val() !== true || !uid) return;
    d.onDisconnect(me).remove();
    d.set(me, { ...info, role, at: d.serverTimestamp() });
  });

  async function bump(log, field, id, current) {
    let n = current || 0;
    for (let i = 0; i < 4; i++) {
      try {
        await d.update(ref(), { [`${log}/${id}/${uid}`]: true, [`wishes/${id}/${field}`]: n + 1 });
        return n + 1;
      } catch (e) {
        // 그 사이 다른 사람이 먼저 눌렀으면 최신 숫자로 다시
        const snap = await d.get(ref(`wishes/${id}/${field}`));
        n = snap.val() || 0;
        const done = await d.get(ref(`${log}/${id}/${uid}`)).catch(() => null);
        if (done && done.exists()) return n;
      }
    }
    throw new Error('BUMP_FAILED');
  }

  return {
    mode, uid, authError,
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
    // 응원·신고: 한 사람당 한 번 기록(wishCheers, 아무도 안 읽음) + 소원에는 숫자만 올림 → 소원 목록이 가볍게 유지돼요.
    cheer(id, current) { return bump('wishCheers', 'n', id, current); },
    report(id, current) { return bump('wishReports', 'r', id, current); },
    setPresence(next) {
      info = { nick: String(next.nick || '').slice(0, 10), design: next.design || null };
      if (uid) d.update(me, info).catch((e) => console.warn('[wish-pond] presence', e));
    },
    // cb([{ uid, nick, design }]) — 지금 접속한 던지는 사람들
    // 화면을 꺼 두면 연결을 끊어 동시 접속 수·데이터를 아낌 (돌아오면 다시 연결)
    sleep() { d.goOffline(db); },
    wake() { d.goOnline(db); },
    // 바뀐 사람만 받아오도록 child 이벤트 사용 (전체 목록을 매번 다시 받지 않음)
    watchPresence(cb) {
      const map = new Map();
      let t;
      const emit = () => { clearTimeout(t); t = setTimeout(() => cb([...map.values()]), 150); };
      const put = (c) => { const v = c.val(); if (v && v.role === 'thrower') map.set(c.key, { uid: c.key, nick: v.nick || '', design: v.design || null }); else map.delete(c.key); emit(); };
      d.onChildAdded(ref('presence'), put);
      d.onChildChanged(ref('presence'), put);
      d.onChildRemoved(ref('presence'), (c) => { map.delete(c.key); emit(); });
      emit();
    },
  };
}

function wishView(id, w, uid) {
  const cheers = w.n || 0;
  const reports = w.r || 0;
  return { id, text: w.text, zone: w.zone, at: w.at, cheers, reports, mine: w.uid === uid, hidden: reports >= 3 };
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
      w.n = (w.n || 0) + 1; save(x); ch.postMessage({ type: 'wishes' }); emitWishes();
    },
    async report(id) {
      const x = db(); const w = x.wishes[id]; if (!w) return;
      w.r = (w.r || 0) + 1; save(x); ch.postMessage({ type: 'wishes' }); emitWishes();
    },
    setPresence(next) { info = { nick: next.nick || '', design: next.design || null }; hello(); },
    watchPresence(cb) { subs.presence.push(cb); emitPresence(); },
    sleep() {}, wake() {},
  };
}
