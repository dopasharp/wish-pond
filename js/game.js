// 판정 문구, 결과 문구 등 게임 공통 데이터
export const ZONES = {
  turtle: { emoji: '🐢', label: '거북 등', grade: '대길', color: '#9dffcf' },
  pot:    { emoji: '🏺', label: '항아리', grade: '길', color: '#ffd36b' },
  water:  { emoji: '💧', label: '연못', grade: '소길', color: '#8fd3ff' },
  out:    { emoji: '🌿', label: '연못 밖', grade: '아쉬움', color: '#c7b99a' },
};
export const SHOTS = 3;

export function shotMessage(sim) {
  const z = sim.zone;
  if (z === 'turtle') return '🐢 거북 등에 올라갔어요! 대길!';
  if (z === 'pot') return '🏺 항아리에 쏙! 길!';
  if (z === 'out') {
    const ang = sim.ang ?? Math.PI / 2;
    const along = -(sim.rest.x * Math.cos(ang) + sim.rest.z * Math.sin(ang)); // 연못 가운데 너머로 얼마나 갔나
    return along > 4 ? '🌿 너무 세게! 연못 밖으로 넘어갔어요' : '🪨 테두리에 튕겨서 밖으로…';
  }
  const bounced = sim.events.some((e) => e.type === 'stone' || e.type === 'ceramic');
  return bounced ? '깡! 튕겨서 퐁당' : '💧 퐁당! ' + aimHint(sim.rest, sim.ang);
}
// 가까운 목표 기준으로 다음 던지기 힌트
function aimHint(r, ang = Math.PI / 2) {
  const targets = [{ x: -1.15, z: -0.85 }, { x: 1.45, z: -1.55 }];
  const t = targets.reduce((a, b) => (Math.hypot(r.x - a.x, r.z - a.z) < Math.hypot(r.x - b.x, r.z - b.z) ? a : b));
  // 던지는 사람 기준 앞(f)·오른쪽(rt) 방향으로 바꿔서 판단
  const f = { x: -Math.cos(ang), z: -Math.sin(ang) }, rt = { x: -f.z, z: f.x };
  const dx = r.x - t.x, dz = r.z - t.z;
  const along = dx * f.x + dz * f.z, side = dx * rt.x + dz * rt.z;
  if (Math.abs(along) > Math.abs(side) * 0.8) return along > 0 ? '조금만 살살!' : '조금 더 세게!';
  return side > 0 ? '조금 더 왼쪽으로!' : '조금 더 오른쪽으로!';
}

export function finalResult(best) {
  if (best.zone === 'turtle') return { art: '🐢', title: '대길! 거북이가 소원을 업었어요', detail: '거북 석상 등에 동전이 올라갔어요. 이 소원은 이뤄질 수밖에 없어요.' };
  if (best.zone === 'pot') return { art: '🏺', title: '길! 항아리에 소원이 담겼어요', detail: '항아리 속에 동전이 쏙. 차곡차곡 쌓이는 중이에요.' };
  if (best.score >= 60) return { art: '💧', title: '소길! 연못이 소원을 들었어요', detail: '거북이 가까이에 가라앉았어요. 조금만 더!' };
  if (best.zone === 'water') return { art: '🌊', title: '퐁당! 소원이 가라앉는 중', detail: '연못 바닥에서 소원이 천천히 익어가요.' };
  return { art: '🌿', title: '앗, 연못이 못 들었어요', detail: '동전이 연못 밖으로 나갔어요. 한 번 더 빌어볼까요?' };
}

export function timeAgo(at) {
  const s = Math.max(0, (Date.now() - (at || Date.now())) / 1000);
  if (s < 60) return '방금';
  if (s < 3600) return `${Math.floor(s / 60)}분 전`;
  if (s < 86400) return `${Math.floor(s / 3600)}시간 전`;
  return `${Math.floor(s / 86400)}일 전`;
}
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
