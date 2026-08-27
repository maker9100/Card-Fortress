# CARD FORTRESS ONLINE MVP

이 폴더는 **온라인 멀티 기본형**입니다.  
현재 온라인으로 구현된 게임은 **원카드 2~4인**이며, 기존 로컬 전체 게임은 `local.html`에 남겨두었습니다.

## 현재 구현

- 익명 Firebase 로그인
- 방 만들기
- 6자리 방 코드 참가
- 2~4인 대기실
- 준비 / 준비 취소
- 호스트 게임 시작
- 각자 자기 기기에서 플레이
- 실시간 턴 / 카드 수 / 현재 카드 동기화
- CARD FORTRESS 원카드 특수 규칙
  - 2 = +2
  - 일반 A = +3
  - ♠A = +5
  - 흑조커 = +5
  - 컬러조커 = +7
  - 2 → 같은 무늬 3 방어
  - ♠A → 조커만 반격
  - 흑조커 → ♠A 또는 컬러조커
  - 7 → 다음 무늬 지정
  - K → 추가 행동
  - 2인 J → K와 같은 추가 행동
  - 3~4인 J → 스킵
  - Q → 방향 전환
  - 21장 이상 → 파산
- 흑조커 판 등장률 35%, 컬러조커 20%

## 1. Firebase 프로젝트 만들기

1. Firebase Console에서 새 프로젝트를 만듭니다.
2. Web App(`</>`)을 추가합니다.
3. 프로젝트 설정에 나온 `firebaseConfig` 값을 `firebase-config.js`에 붙여넣습니다.
4. **Authentication → Sign-in method → Anonymous**를 활성화합니다.
5. **Realtime Database**를 생성합니다.
6. Realtime Database 주소를 `firebase-config.js`의 `databaseURL`에 넣습니다.

## 2. Realtime Database Rules

`firebase-rtdb-rules.json` 내용을 Firebase Console → Realtime Database → Rules에 붙여넣고 게시합니다.

현재 규칙은 **친구끼리 테스트하는 MVP용**입니다. 익명 인증 사용자라면 방 데이터를 읽고 쓸 수 있습니다.
공개 서비스로 확장하기 전에는 서버 권한 검증/보안 규칙을 더 강화해야 합니다.

## 3. 실행

ES Module을 사용하므로 파일을 더블클릭(`file://`)하는 것보다 웹 서버에서 실행해야 합니다.

GitHub Pages에 올리면 바로 사용할 수 있습니다.

- 저장소에 이 폴더 파일들을 업로드
- `index.html`이 저장소 루트에 있도록 배치
- Settings → Pages → main branch 활성화
- 생성된 `https://...github.io/.../` 주소를 친구들과 공유

## 중요한 현재 한계

이 MVP는 Firebase Realtime Database를 통해 상태를 동기화하지만 **완전한 서버 권위(authoritative server) 구조는 아닙니다.**
따라서 개발자 도구로 DB를 직접 건드리는 악의적인 치팅까지 막지는 않습니다.

친구들과 실제 플레이 테스트 → 온라인 흐름 검증을 먼저 하고,
그 다음 포커 / 조커뽑기 / 경쟁모드를 온라인으로 옮기는 순서를 권장합니다.
