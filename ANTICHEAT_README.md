# CARD FORTRESS Anti-Cheat v1

## 적용한 방어

- 방 참가자만 해당 방 읽기
- 최대 6명
- 플레이어는 자기 `players/{uid}` 정보만 수정
- 방장만 게임 모드 변경
- 방장만 게임 생성/삭제
- 진행 중 게임은 `turnUid`인 사용자만 상태 변경
- 모든 게임 액션에 `rev`(revision) + `lastActor` 기록
- 이전 revision + 1이 아니면 Firebase Rules에서 거부
- 비정상 토큰 / 손패 / 방 데이터 클라이언트 검증

## Firebase에서 꼭 해야 하는 것

`firebase-rtdb-rules.json` 내용을 Firebase Console → Realtime Database → 규칙에 붙여넣고 **게시**해야 합니다.
HTML/JS만 GitHub에 올리고 Rules를 게시하지 않으면 서버 측 안티치트가 적용되지 않습니다.

## 한계

현재 게임 상태와 손패가 한 방 데이터 안에 존재하므로,
방 참가자가 개발자 도구로 다른 플레이어의 손패를 읽는 것까지 완전히 막지는 못합니다.

그 수준까지 막으려면:
- 플레이어별 private hand 경로 분리
- 서버/Cloud Function에서 덱과 판정 관리
- 클라이언트는 액션 요청만 전송

방식의 서버 권위 구조로 바꾸는 것이 필요합니다.


## 6인 확장

- 온라인 방 최대 인원: 2~6명
- 방장이 대기실에서 최대 인원을 2~6명으로 설정
- 현재 참가 인원보다 낮게 줄이는 것은 차단
- Firebase Rules에서도 seat 0~5 / 최대 6명까지만 허용
- 로컬 플레이는 기존 2~4인 유지
