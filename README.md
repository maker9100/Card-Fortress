# CARD FORTRESS Moderation v1

SAFE / PROFANITY 한국어 채팅 분류기.

## 실행
1. `pip install -r requirements.txt`
2. `python train.py`
3. `python server.py`

POST `/moderate`에 `{"text":"시발 뭐야"}` 형식으로 전송합니다.

이 데이터셋은 시제품용 소규모 데이터입니다. 실제 오탐/미탐 사례를
dataset.csv에 추가하고 train.py를 다시 실행하면 개선할 수 있습니다.

'시발'처럼 반드시 잡아야 하는 표현은 모델만 믿지 않고 최소 규칙 안전망도 함께 사용합니다.
