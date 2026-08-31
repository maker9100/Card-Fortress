from pathlib import Path
import csv, pickle
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.linear_model import LogisticRegression
from sklearn.pipeline import Pipeline

BASE=Path(__file__).resolve().parent
rows=list(csv.DictReader((BASE/"dataset.csv").open(encoding="utf-8-sig")))
X=[r["text"] for r in rows]; y=[r["label"] for r in rows]
model=Pipeline([
 ("tfidf",TfidfVectorizer(analyzer="char",ngram_range=(1,5),sublinear_tf=True)),
 ("clf",LogisticRegression(max_iter=2000,class_weight="balanced",random_state=42))
])
model.fit(X,y)
with (BASE/"moderation_model.pkl").open("wb") as f: pickle.dump(model,f)
print("moderation_model.pkl 생성 완료")
