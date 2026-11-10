# 🪙 소원의 연못

QR을 찍고, 내가 꾸민 동전을 연못에 던져 소원을 비는 3D 게임. 여러 사람이 던진 동전이 연못 바닥에 계속 쌓여요.

- **연못 화면** (`index.html`): TV·모니터에 띄워 두는 화면. QR이 떠 있고, 누가 던지든 동전이 실시간으로 날아와 퐁당 빠지고 바닥에 쌓여요. 오른쪽 아래 QR, 왼쪽에는 🎉 소원 성취 게시판이 있어요.
- **던지는 폰** (`coin.html`): QR로 들어와서 닉네임 → 동전 꾸미기 → 소원 쓰기 → **3번 던지기** → 결과. 폰에서도 동전이 날아가 연못에 빠지는 장면이 3D로 보여요.

GitHub Pages(정적 호스팅) + Firebase Realtime Database(실시간 연동·동전 보관)로 동작합니다.

## 플레이 방법

1. 연못 화면을 열어 두고, 폰 카메라로 QR을 찍어요.
2. **동전 꾸미기**: 재질(금·은·동·로즈·옥), 가운데 그림(이모지), 앞·뒷면 글자(4자), 테두리 무늬.
3. **소원 쓰기** (40자). "성공하면 익명으로 게시판에 올리기"가 기본으로 켜져 있어요.
4. 동전을 **위로 휙 밀어서** 던져요. 세게 밀수록 멀리, 비스듬히 밀면 그쪽으로 날아가요. 바람(→ ←)도 불어요.
   - 🐢 **거북 등**에 올라가면 대길 / 🏺 **항아리**에 쏙 들어가면 길 / 💧 연못에 빠지면 목표에 가까울수록 점수 / 🪨 돌에 튕기면 "깡!"
5. 3개 중 가장 좋은 결과로 **소원 성취 확률**이 나와요. 거북 등이나 항아리에 성공하면 소원이 **익명으로** 성취 게시판에 올라가고, 다른 사람들이 👏 응원할 수 있어요. 응원이 오면 내 폰에 알림이 떠요.

> 데스크톱 테스트: 던지기 화면에서 **스페이스바**를 누르면 무작위로 던져요. 연못 화면 콘솔에서 `testThrow()`로 테스트 동전을 날릴 수 있어요.

## 1. Firebase 설정

1. [Firebase 콘솔](https://console.firebase.google.com) → **프로젝트 추가** (이 게임 전용 프로젝트 권장).
2. 빌드 → **Realtime Database** → 데이터베이스 만들기 (위치는 싱가포르 `asia-southeast1` 추천, "잠금 모드"로 시작해도 OK).
3. Realtime Database → **규칙** 탭에 [`database.rules.json`](database.rules.json) 내용을 붙여넣고 **게시**.
4. 빌드 → **Authentication** → 시작하기 → 로그인 방법에서 **익명** 사용 설정.
5. 프로젝트 설정(⚙️) → 내 앱 → **웹 앱(</>) 추가** → `firebaseConfig` 값을 [`js/firebase-config.js`](js/firebase-config.js)에 붙여넣기 (`databaseURL` 필수).

> Firebase 웹 설정값(apiKey 등)은 공개돼도 되는 값이에요. 보안은 DB 규칙으로 지킵니다.

DB 규칙이 지키는 것:
- 동전·소원은 **새로 쓰기만** 가능 (수정·삭제 불가). 동전은 계속 쌓여요.
- 한 사람(익명 로그인 uid)당 1.2초에 동전 1개 (도배 방지).
- 닉네임 10자, 각인 4자, 소원 40자 제한. 게시판에는 거북·항아리 성공만 올라감.
- 응원·신고는 한 사람이 소원 하나에 한 번. 신고 3개면 게시판에서 숨김.

## 2. GitHub Pages 배포

```bash
git push -u origin main
```

저장소 → Settings → Pages → Source: `Deploy from a branch`, Branch: `main` / `(root)` → Save.
잠시 후 `https://dopasharp.github.io/wish-pond/` 에서 열려요. 연못 화면의 QR은 `coin.html` 주소를 자동으로 가리켜요.

## 로컬 테스트 (Firebase 없이)

`firebase-config.js`가 비어 있으면(또는 주소에 `?local`) **로컬 테스트 모드**예요. 같은 브라우저의 탭끼리 localStorage + BroadcastChannel로 연동돼요.

```bash
python3 -m http.server 4190
```

`http://localhost:4190/` (연못) 탭과 `http://localhost:4190/coin.html` (폰) 탭을 같이 열고 던져 보세요.

## 파일 구조

```
index.html            연못 화면 (QR, 실시간 동전, 성취 게시판, 동전 탭하면 확대)
coin.html             던지는 폰 (꾸미기 → 소원 → 3번 던지기 → 결과 → 게시판)
css/style.css         게임 화면 스타일
js/world.js           3D 연못 (three.js): 반사되는 물·물결·코스틱, 돌거북, 항아리, 석등, 연잎,
                      반딧불, 물보라·기포·반짝이 파티클, 동전 비행/가라앉기, 바닥 동전 수백 개(인스턴싱)
js/physics.js         동전 물리 (폰과 연못이 같은 코드로 같은 궤적 계산): 포물선·바람·튕김·가라앉기, 구역 판정
js/coin-art.js        동전 앞·뒷면 그림 (꾸미기 미리보기와 연못이 같이 사용)
js/sound.js           WebAudio 합성 효과음: 동전 튕기기, 회전음, 퐁당(기포 공명), 깡, 도자기 통, 따르르, 종·풍경, 주변음
js/net.js             연동 (Firebase RTDB + 익명 로그인 / 로컬 BroadcastChannel)
js/pond.js            연못 화면 로직
js/coin.js            던지는 폰 로직 (스와이프 감지, 3번 던지기, 결과, 게시판, 응원)
js/game.js            판정·결과 문구
js/filter.js          게시판 글 다듬기 (링크·연락처·욕설 가리기)
js/firebase-config.js Firebase 설정
database.rules.json   Realtime Database 보안 규칙
vendor/               three.js r160, QR 생성기 (CDN 없이 동작)
og/wish.html, .png    링크 미리보기 이미지 (명령은 파일 맨 위 주석)
```

## 도파# 브랜드 프레임

`dopasharp/` 폴더는 모든 dopa.shap 게임 저장소에 **똑같이** 복사해 쓰는 공통 디자인 시스템입니다. 원본은 `soju-game/dopasharp/`이고, 이 저장소의 `dopasharp.js`에는 게임 목록에 `wish-pond`(GAME 009 / WISH)를 추가해 두었어요. 원본과 다른 저장소들, 허브의 `games.js`에도 같은 줄을 넣어 주세요.
