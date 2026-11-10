// WebAudio로 즉석 합성하는 효과음 (음원 파일 없음).
// 동전: 금속 비조화 배음 / 물: 위로 올라가는 기포 공명음 + 필터 노이즈 / 주변음: 물소리·풀벌레·풍경
let ctx, master, comp, noiseBuf, verb;
let enabled = true;
let ambient = null;

export function unlockAudio() {
  if (!ctx) {
    try { if (navigator.audioSession) navigator.audioSession.type = 'playback'; } catch {}
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14; comp.ratio.value = 4;
    master = ctx.createGain();
    master.gain.value = 0.9;
    master.connect(comp).connect(ctx.destination);
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const data = noiseBuf.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    // 짧은 공간 울림 (야외 정원 느낌)
    verb = ctx.createConvolver();
    const len = ctx.sampleRate * 1.6;
    const ir = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = ir.getChannelData(ch);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3.2);
    }
    verb.buffer = ir;
    const vg = ctx.createGain(); vg.gain.value = 0.22;
    verb.connect(vg).connect(master);
  }
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}
export const audioReady = () => !!ctx && ctx.state === 'running';
export function setSoundEnabled(v) {
  enabled = !!v;
  if (master) master.gain.value = enabled ? 0.9 : 0;
}
export const soundEnabled = () => enabled;
const ok = () => enabled && ctx && ctx.state === 'running';

function out(node, wet = 0.5, pan = 0) {
  let n = node;
  if (pan && ctx.createStereoPanner) { const p = ctx.createStereoPanner(); p.pan.value = Math.max(-1, Math.min(1, pan)); n.connect(p); n = p; }
  n.connect(master);
  if (wet > 0) { const g = ctx.createGain(); g.gain.value = wet; n.connect(g).connect(verb); }
}
function env(t, peak, attack, release) {
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + attack + release);
  return g;
}
function noise(t, dur) {
  const s = ctx.createBufferSource();
  s.buffer = noiseBuf; s.loop = true;
  s.start(t, Math.random() * 1.5); s.stop(t + dur + 0.05);
  return s;
}
function osc(type, freq, t, dur) {
  const o = ctx.createOscillator();
  o.type = type; o.frequency.setValueAtTime(freq, t);
  o.start(t); o.stop(t + dur + 0.05);
  return o;
}
function filt(type, freq, q = 1) {
  const f = ctx.createBiquadFilter();
  f.type = type; f.frequency.value = freq; f.Q.value = q;
  return f;
}

/** 손가락으로 튕길 때 "팅~" (엄지로 동전 튕기는 소리) */
export function flick(power = 0.5) {
  if (!ok()) return;
  const t = ctx.currentTime;
  const base = 2900 + Math.random() * 300;
  [[1, 0.22, 0.9], [2.32, 0.12, 0.6], [3.87, 0.08, 0.45], [5.4, 0.05, 0.3]].forEach(([k, v, d]) => {
    osc('sine', base * k, t, d).connect(env(t, v * (0.6 + power * 0.5), 0.002, d)).connect(out1(0.4));
  });
  const hp = filt('highpass', 4000);
  noise(t, 0.02).connect(hp).connect(env(t, 0.2, 0.001, 0.02)).connect(out1(0));
  // 공기 가르는 소리
  const bp = filt('bandpass', 700, 1.2);
  bp.frequency.setValueAtTime(500, t);
  bp.frequency.exponentialRampToValueAtTime(1800, t + 0.15);
  bp.frequency.exponentialRampToValueAtTime(600, t + 0.4);
  noise(t, 0.45).connect(bp).connect(env(t, 0.25 + power * 0.25, 0.08, 0.35)).connect(out1(0.1));
}
function out1(wet) { const g = ctx.createGain(); out(g, wet); return g; }

/** 날아가는 동안 빙글빙글 도는 "윙윙" (회전 속도에 맞춘 진폭 변조) */
export function spinWhir(dur = 1, rate = 12) {
  if (!ok()) return;
  const t = ctx.currentTime;
  const bp = filt('bandpass', 2400, 3);
  const g = ctx.createGain(); g.gain.value = 0;
  const lfo = osc('sine', rate, t, dur);
  const lg = ctx.createGain(); lg.gain.value = 0.05;
  lfo.connect(lg).connect(g.gain);
  const e = env(t, 1, 0.05, dur);
  noise(t, dur).connect(bp).connect(g).connect(e).connect(out1(0));
}

/** 물에 빠지는 "퐁당!" — 세기(0~1)에 따라 첨벙 정도가 달라짐 */
export function splash(strength = 0.6, pan = 0) {
  if (!ok()) return;
  const t = ctx.currentTime;
  const s = Math.max(0.2, Math.min(1, strength));
  // 첨벙 (넓은 대역 노이즈 → 낮아짐)
  const bp = filt('bandpass', 1800, 0.8);
  bp.frequency.setValueAtTime(2600, t);
  bp.frequency.exponentialRampToValueAtTime(500, t + 0.3);
  const n = noise(t, 0.5);
  const g = env(t, 0.55 * s, 0.004, 0.32 + s * 0.15);
  const o1 = ctx.createGain(); out(o1, 0.6, pan);
  n.connect(bp).connect(g).connect(o1);
  // "퐁" — 물방울 공명은 음이 위로 올라감
  const f0 = 520 + Math.random() * 160;
  const o = osc('sine', f0, t + 0.01, 0.2);
  o.frequency.exponentialRampToValueAtTime(f0 * 2.6, t + 0.12);
  const o2 = ctx.createGain(); out(o2, 0.5, pan);
  o.connect(env(t + 0.01, 0.45, 0.004, 0.14)).connect(o2);
  // 튀어오른 물방울이 떨어지는 "똑똑"
  const drops = 3 + Math.round(s * 6);
  for (let i = 0; i < drops; i++) drip(t + 0.18 + Math.random() * (0.35 + s * 0.3), 0.08 + Math.random() * 0.1, pan);
}
function drip(t, vol, pan) {
  const f = 900 + Math.random() * 1500;
  const o = osc('sine', f, t, 0.08);
  o.frequency.exponentialRampToValueAtTime(f * 1.9, t + 0.05);
  const g = ctx.createGain(); out(g, 0.5, pan);
  o.connect(env(t, vol, 0.002, 0.06)).connect(g);
}

/** 가라앉으며 올라오는 뽀글뽀글 */
export function bubbles(count = 6, dur = 1.2) {
  if (!ok()) return;
  const t = ctx.currentTime;
  for (let i = 0; i < count; i++) {
    const at = t + Math.random() * dur;
    const f = 380 + Math.random() * 500;
    const o = osc('sine', f, at, 0.07);
    o.frequency.exponentialRampToValueAtTime(f * 1.7, at + 0.05);
    const lp = filt('lowpass', 1400);
    o.connect(env(at, 0.05 + Math.random() * 0.05, 0.003, 0.05)).connect(lp).connect(out1(0.3));
  }
}

/** 동전이 돌·금속에 부딪히는 "깡!" (비조화 배음 금속음) */
export function clink(strength = 0.7, pan = 0) {
  if (!ok()) return;
  const t = ctx.currentTime;
  const v = 0.25 + Math.min(1, strength) * 0.45;
  const f = 2100 + Math.random() * 500;
  [[1, 0.5, 0.35], [2.76, 0.32, 0.25], [5.4, 0.2, 0.16], [8.93, 0.1, 0.1], [0.5, 0.12, 0.2]].forEach(([k, a, d]) => {
    const g = ctx.createGain(); out(g, 0.5, pan);
    osc('sine', f * k, t, d).connect(env(t, a * v, 0.001, d)).connect(g);
  });
  const hp = filt('highpass', 5000);
  const g2 = ctx.createGain(); out(g2, 0.2, pan);
  noise(t, 0.03).connect(hp).connect(env(t, 0.35 * v, 0.001, 0.025)).connect(g2);
}

/** 항아리(도자기)에 부딪히는 "통~" */
export function ceramic(strength = 0.7) {
  if (!ok()) return;
  const t = ctx.currentTime;
  const v = 0.3 + Math.min(1, strength) * 0.4;
  [[310, 0.5, 0.6], [740, 0.3, 0.4], [1290, 0.2, 0.3], [2150, 0.12, 0.2]].forEach(([f, a, d]) => {
    osc('sine', f * (0.97 + Math.random() * 0.06), t, d).connect(env(t, a * v, 0.002, d)).connect(out1(0.5));
  });
  clink(strength * 0.6);
}

/** 항아리 안으로 쏙 들어가서 "달그락 땡그랑" */
export function potIn() {
  if (!ok()) return;
  [0.0, 0.32].forEach((d, i) => setTimeout(() => ceramic(0.5 - i * 0.2), d * 1000));
  rattle(0.45, 0.6);
  // 항아리 속 울림
  const t = ctx.currentTime + 0.3;
  const o = osc('sine', 180, t, 1.2);
  o.connect(env(t, 0.18, 0.02, 1.1)).connect(out1(0.8));
}

/** 동전이 바닥에서 "따르르르르" 돌다 멈춤 (오일러 디스크처럼 점점 빨라짐) */
export function rattle(delay = 0, vol = 0.5) {
  if (!ok()) return;
  const t0 = ctx.currentTime + delay;
  let t = t0, gap = 0.12;
  for (let i = 0; i < 22 && gap > 0.012; i++) {
    const f = 3200 + Math.random() * 900;
    const v = vol * (0.35 + 0.65 * (i / 22)) * 0.25;
    osc('sine', f, t, 0.03).connect(env(t, v, 0.001, 0.025)).connect(out1(0.2));
    osc('sine', f * 2.7, t, 0.02).connect(env(t, v * 0.5, 0.001, 0.015)).connect(out1(0));
    t += gap; gap *= 0.84;
  }
  const hp = filt('bandpass', 3000, 2);
  noise(t, 0.08).connect(hp).connect(env(t, vol * 0.25, 0.002, 0.07)).connect(out1(0.3));
}

/** 땅(풀밭)에 "툭" */
export function thud() {
  if (!ok()) return;
  const t = ctx.currentTime;
  const o = osc('sine', 160, t, 0.15);
  o.frequency.exponentialRampToValueAtTime(70, t + 0.12);
  o.connect(env(t, 0.35, 0.003, 0.12)).connect(out1(0.1));
  const lp = filt('lowpass', 1200);
  noise(t, 0.08).connect(lp).connect(env(t, 0.25, 0.002, 0.07)).connect(out1(0));
}

/** 대길: 절 종 + 풍경 소리 */
export function bell() {
  if (!ok()) return;
  const t = ctx.currentTime + 0.05;
  const f = 196;
  [[1, 0.5, 4.5], [2.0, 0.25, 3.5], [2.76, 0.22, 3], [5.4, 0.12, 2], [0.5, 0.25, 5]].forEach(([k, a, d]) => {
    const o = osc('sine', f * k, t, d);
    const tr = osc('sine', 3.2, t, d); const tg = ctx.createGain(); tg.gain.value = f * k * 0.002; tr.connect(tg).connect(o.frequency);
    o.connect(env(t, a * 0.5, 0.004, d)).connect(out1(0.9));
  });
  chimes(0.4, 7);
}
/** 풍경 */
export function chimes(at = 0, n = 5) {
  if (!ok()) return;
  const scale = [1318.5, 1567.98, 1760, 2093, 2349.3, 2637];
  for (let i = 0; i < n; i++) {
    const t = ctx.currentTime + at + i * (0.11 + Math.random() * 0.12);
    const f = scale[Math.floor(Math.random() * scale.length)];
    [[1, 0.12, 1.6], [2.76, 0.04, 0.9]].forEach(([k, a, d]) => osc('sine', f * k, t, d).connect(env(t, a, 0.002, d)).connect(out1(0.8)));
  }
}
/** 길: 맑은 상승 아르페지오 */
export function sparkle() {
  if (!ok()) return;
  const t = ctx.currentTime + 0.05;
  [1046.5, 1318.5, 1568, 2093].forEach((f, i) => {
    const s = t + i * 0.08;
    osc('triangle', f, s, 0.6).connect(env(s, 0.14, 0.004, 0.55)).connect(out1(0.7));
  });
  chimes(0.35, 4);
}
/** 아쉬움 */
export function aww() {
  if (!ok()) return;
  const t = ctx.currentTime + 0.05;
  const lp = filt('lowpass', 900); const g = ctx.createGain(); out(g, 0.3); lp.connect(g);
  [[392, 0], [349.2, 0.18]].forEach(([f, d]) => {
    const o = osc('triangle', f, t + d, 0.3);
    o.frequency.exponentialRampToValueAtTime(f * 0.9, t + d + 0.28);
    o.connect(env(t + d, 0.14, 0.02, 0.28)).connect(lp);
  });
}
export function tick() {
  if (!ok()) return;
  const t = ctx.currentTime;
  osc('sine', 2400, t, 0.03).connect(env(t, 0.06, 0.001, 0.03)).connect(out1(0));
}
export function cheerPop() {
  if (!ok()) return;
  const t = ctx.currentTime;
  [880, 1320].forEach((f, i) => osc('triangle', f, t + i * 0.06, 0.15).connect(env(t + i * 0.06, 0.12, 0.003, 0.12)).connect(out1(0.3)));
}

/** 주변음: 분수 물소리 + 폭포 + 새소리 + 가끔 풍경 */
export function startAmbient(level = 1) {
  if (!ctx || ambient) return;
  const g = ctx.createGain(); g.gain.value = 0;
  g.gain.linearRampToValueAtTime(0.5 * level, ctx.currentTime + 2);
  g.connect(master);
  // 폭포·분수: 넓은 대역 노이즈 두 겹 (낮은 웅웅 + 높은 쏴아)
  const len = ctx.sampleRate * 4;
  const b = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let ch = 0; ch < 2; ch++) { const d = b.getChannelData(ch); let last = 0; for (let i = 0; i < len; i++) { const w = Math.random() * 2 - 1; last = (last + 0.06 * w) / 1.06; d[i] = last * 2.2 + w * 0.12; } }
  const src = ctx.createBufferSource(); src.buffer = b; src.loop = true;
  const lp = filt('lowpass', 1600); const hp = filt('highpass', 120);
  const wg = ctx.createGain(); wg.gain.value = 0.4;
  const lfo = ctx.createOscillator(); lfo.frequency.value = 0.09; const lg = ctx.createGain(); lg.gain.value = 0.08;
  lfo.connect(lg).connect(wg.gain); lfo.start();
  src.connect(hp).connect(lp).connect(wg).connect(g); src.start();
  const sp = filt('bandpass', 3800, 0.7); const sg = ctx.createGain(); sg.gain.value = 0.06;
  src.connect(sp).connect(sg).connect(g);
  // 물줄기 떨어지는 졸졸
  const trickle = setInterval(() => { if (ok() && Math.random() < 0.8) drip(ctx.currentTime, 0.012 + Math.random() * 0.02, Math.random() * 2 - 1); }, 140);
  // 새소리: 짧게 올라가는 지저귐
  const birds = setInterval(() => {
    if (!ok() || Math.random() < 0.45) return;
    const t0 = ctx.currentTime, pan = Math.random() * 2 - 1, base = 2600 + Math.random() * 1600, n = 2 + Math.floor(Math.random() * 4);
    for (let i = 0; i < n; i++) {
      const t = t0 + i * (0.09 + Math.random() * 0.05);
      const o = osc('sine', base, t, 0.08);
      o.frequency.exponentialRampToValueAtTime(base * (1.25 + Math.random() * 0.3), t + 0.06);
      const e = env(t, 0.035 * level, 0.005, 0.07);
      if (ctx.createStereoPanner) { const p = ctx.createStereoPanner(); p.pan.value = pan; o.connect(e).connect(p).connect(master); } else o.connect(e).connect(master);
    }
  }, 1700);
  const wind = setInterval(() => { if (Math.random() < 0.3) chimes(0, 2 + Math.floor(Math.random() * 3)); }, 8000);
  ambient = { g, src, lfo, timers: [trickle, birds, wind] };
}
export function stopAmbient() {
  if (!ambient) return;
  ambient.timers.forEach(clearInterval);
  ambient.g.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.5);
  const a = ambient; ambient = null;
  setTimeout(() => { try { a.src.stop(); a.lfo.stop(); } catch {} }, 700);
}

/** 물리 이벤트 → 효과음 (연못 화면·폰 공통) */
export function eventSound(ev, { near = true } = {}) {
  const pan = Math.max(-1, Math.min(1, (ev.x || 0) / 4));
  const k = near ? 1 : 0.7;
  switch (ev.type) {
    case 'splash': splash(Math.min(1, ev.speed / 9) * k, pan); bubbles(5, 1.4); break;
    case 'stone': clink(Math.min(1, ev.speed / 8) * k, pan); break;
    case 'ceramic': ceramic(Math.min(1, ev.speed / 8) * k); break;
    case 'potland': potIn(); setTimeout(sparkle, 500); break;
    case 'turtle': clink(0.6 * k, pan); rattle(0.05, 0.6); setTimeout(bell, 700); break;
    case 'ground': thud(); break;
    case 'settle': rattle(0, 0.18); break;
  }
}
