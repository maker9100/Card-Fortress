import os
import re
from typing import Any

import httpx
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

app = FastAPI(title="Card Fortress Chat Moderation")

# GitHub Pages에서 호출할 수 있게 CORS 허용.
# 공개 배포 전에는 자신의 도메인만 남기는 것을 권장.
ALLOWED_ORIGINS = [
    "https://maker9100.github.io",
    "http://localhost:8000",
    "http://127.0.0.1:8000",
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=False,
    allow_methods=["POST", "GET", "OPTIONS"],
    allow_headers=["Content-Type"],
)

OPENAI_API_KEY = os.getenv("OPENAI_API_KEY", "").strip()
OPENAI_MODERATION_URL = "https://api.openai.com/v1/moderations"

# 오탐이 거의 없는 강한 욕설만 서버에서 먼저 부분 마스킹.
# '시발'은 '시발점' 같은 정상 단어가 있어 별도 예외 처리.
STRONG_PATTERNS = [
    re.compile(r"씨\s*발", re.I),
    re.compile(r"ㅆ\s*ㅂ", re.I),
    re.compile(r"ㅅ\s*ㅂ", re.I),
    re.compile(r"좆", re.I),
    re.compile(r"존\s*나", re.I),
    re.compile(r"개\s*새\s*끼", re.I),
    re.compile(r"병\s*신", re.I),
    re.compile(r"ㅂ\s*ㅅ", re.I),
    re.compile(r"지\s*랄", re.I),
    re.compile(r"ㅈ\s*ㄹ", re.I),
    re.compile(r"\bfuck(?:ing)?\b", re.I),
    re.compile(r"\bshit\b", re.I),
    re.compile(r"\bbitch\b", re.I),
    re.compile(r"\basshole\b", re.I),
    re.compile(r"\bmotherfucker\b", re.I),
]

class ChatRequest(BaseModel):
    text: str = Field(min_length=1, max_length=120)


def mask_match(match: re.Match[str]) -> str:
    visible = len(match.group(0).replace(" ", ""))
    return "*" * max(2, visible)


def local_mask(text: str) -> tuple[str, bool]:
    out = text
    changed = False
    for pattern in STRONG_PATTERNS:
        new = pattern.sub(mask_match, out)
        if new != out:
            changed = True
            out = new

    # '시발'은 정상 용례 예외를 둔다.
    # 시발점/시발역/시발차 같은 단어는 통과.
    if not re.search(r"시발(?:점|역|차|지|선)", out):
        new = re.sub(r"시\s*발", lambda m: mask_match(m), out, flags=re.I)
        if new != out:
            changed = True
            out = new

    return out, changed


async def ai_flagged(text: str) -> bool:
    if not OPENAI_API_KEY:
        return False

    payload = {
        "model": "omni-moderation-latest",
        "input": text,
    }
    headers = {
        "Authorization": f"Bearer {OPENAI_API_KEY}",
        "Content-Type": "application/json",
    }

    async with httpx.AsyncClient(timeout=5.0) as client:
        response = await client.post(OPENAI_MODERATION_URL, json=payload, headers=headers)
        response.raise_for_status()
        data: dict[str, Any] = response.json()

    results = data.get("results") or []
    return bool(results and results[0].get("flagged"))


@app.get("/health")
async def health():
    return {"ok": True, "ai": bool(OPENAI_API_KEY)}


@app.post("/moderate")
async def moderate(req: ChatRequest):
    raw = req.text.strip()
    if not raw:
        raise HTTPException(status_code=400, detail="empty text")

    masked, local_changed = local_mask(raw)

    # 강한 욕설을 찾았으면 굳이 AI 왕복을 하지 않고 부분 검열된 문장을 반환.
    if local_changed:
        return {
            "text": masked,
            "censored": True,
            "source": "dictionary",
        }

    # 정상 문장(예: '안녕')은 AI가 유해 콘텐츠로 판단하지 않으면 그대로 통과.
    try:
        flagged = await ai_flagged(raw)
    except httpx.HTTPError as exc:
        # AI 서비스 장애가 채팅 장애로 번지지 않도록 fail-open.
        print("moderation API error:", repr(exc))
        flagged = False

    if flagged:
        # Moderation API는 정확한 욕설 위치를 반환하지 않으므로 전체 문장을 가린다.
        return {
            "text": "[AI에 의해 검열된 메시지]",
            "censored": True,
            "source": "openai-moderation",
        }

    return {
        "text": raw,
        "censored": False,
        "source": "openai-moderation" if OPENAI_API_KEY else "dictionary-only",
    }
