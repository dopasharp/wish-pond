// 소원 게시판에 올라가는 글 다듬기: 길이 제한, 연락처·링크 가리기, 기본 욕설 가리기.
const BAD = ['시발', '씨발', 'ㅅㅂ', '병신', 'ㅂㅅ', '개새', '좆', '존나', '닥쳐', '미친놈', '미친년', '꺼져', '죽어', 'fuck', 'shit', 'bitch'];
export function cleanWish(text) {
  let s = Array.from(String(text || '').replace(/\s+/g, ' ').trim()).slice(0, 40).join('');
  s = s.replace(/https?:\/\/\S+|www\.\S+/gi, '🔗');
  s = s.replace(/\d{2,4}[-\s.]?\d{3,4}[-\s.]?\d{4}/g, '☎️');
  s = s.replace(/[\w.+-]+@[\w-]+\.[\w.]+/g, '✉️');
  for (const w of BAD) s = s.split(w).join('♡'.repeat(Array.from(w).length));
  return s;
}
export const cleanNick = (s) => cleanWish(s).slice(0, 10);
