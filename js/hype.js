// 성공 순간 화면 연출 (연못 화면·폰 공통): 번쩍 + 회전하는 햇살 + 큼직한 "소원 성취!" 도장 + 색종이 비
import { ZONES } from './game.js?v=8';

const CONFETTI = ['#ff6b9e', '#ffd36b', '#4fd1e8', '#7be38f', '#b58cff', '#ff9d5c', '#ffffff'];
const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

/** over: 결과 카드 위에 색종이만 (도장·번쩍 없이) */
export function hypeBurst(zone, { sub = '', over = false } = {}) {
  const z = ZONES[zone] || ZONES.turtle;
  const root = document.createElement('div');
  root.className = `hype hype-${zone}${over ? ' hype-over' : ''}`;
  root.setAttribute('aria-hidden', 'true');
  root.innerHTML = over ? '' : `<div class="hype-flash"></div><div class="hype-rays"></div>
    <div class="hype-stamp"><span class="hype-emoji">${z.emoji}</span><b>${z.grade}!</b>${sub ? `<small>${sub}</small>` : ''}</div>`;
  if (!reduced()) {
    const n = innerWidth < 600 ? 46 : 80;
    const frag = document.createDocumentFragment();
    for (let i = 0; i < n; i++) {
      const c = document.createElement('i');
      const coin = i % 9 === 0;
      c.className = coin ? 'hype-coin' : 'hype-bit';
      if (coin) c.textContent = '🪙';
      else c.style.background = CONFETTI[i % CONFETTI.length];
      // 가운데에서 팡 터져 올라갔다가 하늘하늘 떨어짐
      const dx = (Math.random() * 2 - 1) * 52, up = 18 + Math.random() * 34;
      c.style.setProperty('--dx', dx.toFixed(1) + 'vw');
      c.style.setProperty('--up', up.toFixed(1) + 'vh');
      c.style.setProperty('--fall', (60 + Math.random() * 50).toFixed(1) + 'vh');
      c.style.setProperty('--rot', ((Math.random() * 2 - 1) * 900).toFixed(0) + 'deg');
      c.style.setProperty('--d', (2.2 + Math.random() * 1.4).toFixed(2) + 's');
      c.style.setProperty('--delay', (Math.random() * 0.25).toFixed(2) + 's');
      c.style.setProperty('--w', (6 + Math.random() * 8).toFixed(0) + 'px');
      frag.appendChild(c);
    }
    root.appendChild(frag);
  }
  document.body.appendChild(root);
  setTimeout(() => root.remove(), 4200);
}
