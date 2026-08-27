CARD FORTRESS - AI CHAT FILTER

구조
1. 명백한 욕설: 서버 사전에서 즉시 부분 마스킹
2. 그 외 문장: OpenAI omni-moderation-latest 검사
3. 정상 문장: 그대로 전송
4. AI 서버 장애: 최소 로컬 fallback으로 채팅 자체는 계속 동작

배포 방법 (Render)
1. 이 폴더의 moderation-server.py, requirements.txt, render.yaml을 별도 GitHub 저장소에 올립니다.
2. Render에서 새 Web Service를 만들거나 render.yaml Blueprint를 사용합니다.
3. Environment에 OPENAI_API_KEY를 Secret으로 추가합니다. 절대로 online.js에 API 키를 넣지 마세요.
4. 배포 후 https://...onrender.com/health 를 열어 {"ok":true,"ai":true}인지 확인합니다.
5. online.js 상단의 CHAT_MODERATION_ENDPOINT를 다음처럼 수정합니다.
   const CHAT_MODERATION_ENDPOINT = "https://자신의-Render-주소.onrender.com/moderate";
6. Card Fortress 저장소에는 index.html, online.js를 교체합니다.
7. 기존 채팅 Firebase Rules는 그대로 사용 가능합니다.

주의
- OpenAI Moderation은 '욕설 사전' 그 자체가 아니라 유해 콘텐츠 분류기입니다.
- 그래서 명백한 욕설은 자체 사전으로 부분 검열하고, AI는 나머지 문맥 검사의 2차 방어로 사용합니다.
- '안녕', '시발점' 같은 정상 표현이 무작정 검열되지 않도록 짧은 한 글자 금칙어는 사용하지 않습니다.
