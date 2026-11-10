// 판정 문구, 결과 문구 등 게임 공통 데이터
export const ZONES = {
  turtle: { emoji: '🐢', label: '거북 등', grade: '소원 성취', color: '#9dffcf' },
  pot:    { emoji: '🏺', label: '항아리', grade: '소원 성취', color: '#ffd36b' },
  water:  { emoji: '💧', label: '연못', grade: '퐁당', color: '#8fd3ff' },
  out:    { emoji: '🌿', label: '연못 밖', grade: '아깝다', color: '#c7b99a' },
};
export const SHOTS = 3;

export function shotMessage(sim) {
  const z = sim.zone;
  if (z === 'turtle') return '🐢 거북 등에 올라갔어요! 소원이 이루어집니다!!';
  if (z === 'pot') return '🏺 항아리에 쏙! 소원이 이루어집니다!!';
  if (z === 'out') {
    const ang = sim.ang ?? Math.PI / 2;
    const along = -(sim.rest.x * Math.cos(ang) + sim.rest.z * Math.sin(ang)); // 연못 가운데 너머로 얼마나 갔나
    return along > 4 ? '🌿 마음이 너무 컸나 봐요! 살짝만 덜 세게 다시 해보세요' : '🪨 아깝다! 테두리에 튕겼어요. 다시 해보세요!';
  }
  const bounced = sim.events.some((e) => e.type === 'stone' || e.type === 'ceramic');
  return bounced ? '깡! 아깝다~ 다음엔 거북 등으로!' : '💧 아깝다! ' + aimHint(sim.rest, sim.ang);
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

/** 결과: 성공이면 "소원이 이루어집니다!!", 아니면 확률 대신 희망을 */
export function finalResult(zone) {
  if (zone === 'turtle') return { art: '🐢', title: '거북이가 소원을 업었어요 ✨', stat: '소원이 이루어집니다!!', detail: '거북 등에 동전이 딱 올라갔어요. 이 소원은 꼭 이루어져요!' };
  if (zone === 'pot') return { art: '🏺', title: '항아리에 소원이 담겼어요 ✨', stat: '소원이 이루어집니다!!', detail: '항아리 속에 동전이 쏙. 소원이 차곡차곡 이뤄지는 중이에요!' };
  if (zone === 'water') return { art: '🌊', title: '아깝다! 거의 다 왔어요', stat: '다시 해보세요!', detail: '연못이 소원을 들었어요. 거북 등이나 항아리에 올리면 소원이 이루어져요!' };
  return { art: '🍀', title: '소원은 아직 날아가는 중!', stat: '다시 해보세요!', detail: '연못이 한 번 더 기회를 준대요. 거북 등이나 항아리에 올리면 소원이 이루어져요!' };
}

export function timeAgo(at) {
  const s = Math.max(0, (Date.now() - (at || Date.now())) / 1000);
  if (s < 60) return '방금';
  if (s < 3600) return `${Math.floor(s / 60)}분 전`;
  if (s < 86400) return `${Math.floor(s / 3600)}시간 전`;
  return `${Math.floor(s / 86400)}일 전`;
}
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
