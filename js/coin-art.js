// 동전 앞·뒷면 그림. 꾸미기 화면, 날아가는 동전, 연못 바닥 동전이 모두 이 그림을 씁니다.

export const METALS = {
  gold:   { name: '금',   base: '#d9a93a', hi: '#fff0b0', lo: '#7a5410', side: 0xd8a83c, metalness: 1, roughness: 0.28 },
  silver: { name: '은',   base: '#c6ccd2', hi: '#ffffff', lo: '#5d656d', side: 0xd2d8de, metalness: 1, roughness: 0.25 },
  bronze: { name: '동',   base: '#b8743c', hi: '#ffd2a0', lo: '#5a2e10', side: 0xb87440, metalness: 1, roughness: 0.32 },
  rose:   { name: '로즈', base: '#e3a59a', hi: '#fff0ea', lo: '#8a4a44', side: 0xe6aa9e, metalness: 1, roughness: 0.27 },
  jade:   { name: '옥',   base: '#5fae8f', hi: '#d9fff0', lo: '#1e5a44', side: 0x6cb898, metalness: 0.15, roughness: 0.18 },
};
export const RIMS = { plain: '민무늬', dots: '구슬', wave: '물결', star: '별' };
export const STAMPS = ['🐢', '🍀', '⭐', '💖', '🌙', '🐉', '🦊', '🐱', '🌸', '🔥', '🎓', '💪', '🍑', '🌈', '👑', '🙏'];

export const DEFAULT_DESIGN = { metal: 'gold', rim: 'dots', stamp: '🐢', text: '소원', back: '' };

const clampText = (s, n) => Array.from(String(s || '').replace(/\s+/g, ' ').trim()).slice(0, n).join('');

export function sanitizeDesign(d) {
  const o = d || {};
  return {
    metal: METALS[o.metal] ? o.metal : 'gold',
    rim: RIMS[o.rim] ? o.rim : 'plain',
    stamp: clampText(o.stamp, 2),
    text: clampText(o.text, 4),
    back: clampText(o.back, 4),
  };
}
export const designKey = (d) => `${d.metal}|${d.rim}|${d.stamp}|${d.text}|${d.back}`;

const FONT = '"Black Han Sans","Pretendard Variable",system-ui,sans-serif';

function rimPattern(ctx, c, r, rim, m) {
  ctx.save();
  ctx.lineWidth = r * 0.035;
  ctx.strokeStyle = m.lo;
  ctx.globalAlpha = 0.55;
  ctx.beginPath(); ctx.arc(c, c, r * 0.8, 0, Math.PI * 2); ctx.stroke();
  ctx.globalAlpha = 0.75;
  ctx.fillStyle = m.lo;
  if (rim === 'dots') {
    for (let i = 0; i < 36; i++) {
      const a = (i / 36) * Math.PI * 2;
      ctx.beginPath(); ctx.arc(c + Math.cos(a) * r * 0.885, c + Math.sin(a) * r * 0.885, r * 0.032, 0, Math.PI * 2); ctx.fill();
    }
  } else if (rim === 'wave') {
    ctx.beginPath();
    for (let i = 0; i <= 240; i++) {
      const a = (i / 240) * Math.PI * 2;
      const rr = r * (0.885 + Math.sin(a * 18) * 0.035);
      const x = c + Math.cos(a) * rr, y = c + Math.sin(a) * rr;
      i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
    }
    ctx.lineWidth = r * 0.03; ctx.stroke();
  } else if (rim === 'star') {
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2;
      star(ctx, c + Math.cos(a) * r * 0.885, c + Math.sin(a) * r * 0.885, r * 0.05, a);
    }
  }
  ctx.restore();
}
function star(ctx, x, y, s, rot) {
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const a = rot + (i / 10) * Math.PI * 2;
    const rr = i % 2 ? s * 0.45 : s;
    ctx[i ? 'lineTo' : 'moveTo'](x + Math.cos(a) * rr, y + Math.sin(a) * rr);
  }
  ctx.closePath(); ctx.fill();
}

// 금속 판 + 테두리 + 양각 느낌
function plate(ctx, size, m) {
  const c = size / 2, r = size / 2;
  const g = ctx.createRadialGradient(c * 0.7, c * 0.6, r * 0.05, c, c, r);
  g.addColorStop(0, m.hi); g.addColorStop(0.45, m.base); g.addColorStop(1, m.lo);
  ctx.fillStyle = g; ctx.fillRect(0, 0, size, size);
  // 브러시 결
  ctx.save(); ctx.globalAlpha = 0.07; ctx.strokeStyle = '#000';
  for (let i = 0; i < 60; i++) {
    ctx.beginPath(); ctx.arc(c, c, (i / 60) * r, 0, Math.PI * 2); ctx.lineWidth = 0.6; ctx.stroke();
  }
  ctx.restore();
  // 바깥 테두리 턱
  ctx.save();
  ctx.lineWidth = r * 0.07; ctx.strokeStyle = m.hi; ctx.globalAlpha = 0.6;
  ctx.beginPath(); ctx.arc(c, c, r * 0.955, Math.PI * 0.9, Math.PI * 1.9); ctx.stroke();
  ctx.strokeStyle = m.lo; ctx.globalAlpha = 0.6;
  ctx.beginPath(); ctx.arc(c, c, r * 0.955, -Math.PI * 0.1, Math.PI * 0.9); ctx.stroke();
  ctx.restore();
}

function engrave(ctx, text, x, y, px, m) {
  ctx.font = `${px}px ${FONT}`;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillStyle = m.lo; ctx.globalAlpha = 0.9; ctx.fillText(text, x + px * 0.04, y + px * 0.05);
  ctx.fillStyle = m.hi; ctx.globalAlpha = 0.85; ctx.fillText(text, x - px * 0.03, y - px * 0.03);
  ctx.fillStyle = m.base; ctx.globalAlpha = 1; ctx.fillText(text, x, y);
}

/** side: 'front' | 'back' → 정사각 캔버스(size×size)에 동전 면을 그립니다. */
export function drawFace(ctx, design, side, size, ox = 0, oy = 0) {
  const d = sanitizeDesign(design);
  const m = METALS[d.metal];
  ctx.save();
  ctx.translate(ox, oy);
  ctx.beginPath(); ctx.rect(0, 0, size, size); ctx.clip();
  plate(ctx, size, m);
  const c = size / 2, r = size / 2;
  rimPattern(ctx, c, r, d.rim, m);
  if (side === 'front') {
    if (d.stamp) {
      ctx.font = `${Math.round(size * (d.text ? 0.36 : 0.46))}px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.globalAlpha = 0.92;
      ctx.fillText(d.stamp, c, d.text ? c * 0.86 : c * 1.04);
      ctx.globalAlpha = 1;
    }
    if (d.text) {
      const n = Array.from(d.text).length;
      const px = Math.round(size * (d.stamp ? [0, 0.17, 0.16, 0.13, 0.11][n] : [0, 0.4, 0.3, 0.22, 0.17][n]));
      engrave(ctx, d.text, c, d.stamp ? c * 1.48 : c * 1.04, px, m);
    }
  } else {
    const label = d.back || '소원';
    const n = Array.from(label).length;
    engrave(ctx, label, c, c * 1.02, Math.round(size * [0, 0.4, 0.3, 0.22, 0.17][n]), m);
    // 바깥 둘레 글씨
    ctx.save();
    ctx.font = `${Math.round(size * 0.065)}px ${FONT}`;
    ctx.fillStyle = m.lo; ctx.globalAlpha = 0.8; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    const ring = '소원의 연못 · 도파# · WISH POND · ';
    const chars = Array.from(ring);
    chars.forEach((ch, i) => {
      const a = -Math.PI / 2 + (i / chars.length) * Math.PI * 2;
      ctx.save(); ctx.translate(c + Math.cos(a) * r * 0.66, c + Math.sin(a) * r * 0.66); ctx.rotate(a + Math.PI / 2);
      ctx.fillText(ch, 0, 0); ctx.restore();
    });
    ctx.restore();
  }
  ctx.restore();
}

/** 2D 미리보기용 (연못 팝업 등) */
export function faceDataURL(design, side = 'front', size = 192) {
  const cv = document.createElement('canvas');
  cv.width = cv.height = size;
  const ctx = cv.getContext('2d');
  ctx.beginPath(); ctx.arc(size / 2, size / 2, size / 2, 0, Math.PI * 2); ctx.clip();
  drawFace(ctx, design, side, size);
  return cv.toDataURL('image/png');
}
