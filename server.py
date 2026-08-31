from pathlib import Path
import os,pickle,re,unicodedata
from flask import Flask,jsonify,request
from flask_cors import CORS

BASE=Path(__file__).resolve().parent
with (BASE/"moderation_model.pkl").open("rb") as f: model=pickle.load(f)

app=Flask(__name__)
CORS(app)

PATTERNS=[
 r"시[\s._@\-!1]*발",r"씨[\s._@\-!1]*발",
 r"ㅅ[\s._@\-!1]*ㅂ",r"ㅆ[\s._@\-!1]*ㅂ",
 r"병[\s._@\-!1]*신",r"ㅂ[\s._@\-!1]*ㅅ",
 r"존[\s._@\-!1]*나",r"ㅈ[\s._@\-!1]*ㄴ",
 r"지[\s._@\-!1]*랄",r"ㅈ[\s._@\-!1]*ㄹ",
 r"좆",r"개[\s._@\-!1]*새끼"
]
def norm(s): return unicodedata.normalize("NFKC",s).lower().strip()
def classify(text):
    t=norm(text)
    if any(re.search(p,t) for p in PATTERNS): return "PROFANITY",1.0,"rule"
    probs=dict(zip(model.classes_,model.predict_proba([t])[0]))
    score=float(probs.get("PROFANITY",0))
    return ("PROFANITY" if score>=0.70 else "SAFE"),score,"model"

@app.get("/health")
def health(): return jsonify(ok=True)

@app.post("/moderate")
def moderate():
    text=str((request.get_json(silent=True) or {}).get("text","")).strip()
    if not text: return jsonify(error="text is required"),400
    if len(text)>120: return jsonify(error="text is too long"),400
    label,score,source=classify(text); blocked=label=="PROFANITY"
    return jsonify(ok=True,label=label,blocked=blocked,score=round(score,4),
                   source=source,filtered="***" if blocked else text)

if __name__=="__main__":
    app.run(host="0.0.0.0",port=int(os.environ.get("PORT","5000")))
