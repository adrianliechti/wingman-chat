---
name: quiz
description: Create an interactive multiple-choice quiz from the conversation and workspace material, delivered as a self-contained clickable HTML file (with a Markdown fallback). Trigger with "make a quiz", "test my knowledge", "create practice questions", or whenever the user wants to check understanding of the material.
---

# Quiz

Produce an interactive quiz the user can actually take. You write a single self-contained
`quiz.html` to the workspace; it previews and plays directly in the artifacts panel.

## 1. Gather the material

Source = **the conversation so far plus workspace files**. Base every question on real content —
never test on facts that aren't in the material.

## 2. Design the questions

- **8–12 questions** covering the key concepts unless the user asked for a count.
- **Exactly 4 options** each, one correct.
- Mix difficulty: some straight recall, some that require understanding.
- Write a one-sentence **explanation** for each answer that points back to the material.

## 3. Build a self-contained interactive HTML

Write `quiz.html` with everything inline (CSS + JS, no external dependencies needed). Embed the
questions as a JS array, let the user click an option per question, then reveal correct/incorrect
with the explanation and a final score. Keep it clean and legible.

```python
import json, html

questions = [
    {"q": "What drove enterprise ACV growth in FY24?",
     "options": ["Net-new logos", "Upsell into existing accounts", "Price increases", "FX tailwind"],
     "answer": 1,
     "why": "Growth came from upsell/expansion, not new-logo acquisition."},
    # … 8–12 total …
]

doc = """<!doctype html><html><head><meta charset="utf-8">
<title>Quiz</title><style>
  body{font-family:system-ui,sans-serif;max-width:760px;margin:2rem auto;padding:0 1rem;color:#1a1a1a}
  .q{margin:1.5rem 0;padding:1rem 1.25rem;border:1px solid #e5e5e5;border-radius:12px}
  button.opt{display:block;width:100%;text-align:left;margin:.4rem 0;padding:.6rem .8rem;border:1px solid #ddd;border-radius:8px;background:#fff;cursor:pointer}
  .correct{background:#e8f5e9;border-color:#43a047}.wrong{background:#ffebee;border-color:#e53935}
  .why{margin-top:.5rem;font-size:.9rem;color:#555;display:none}
  #score{font-size:1.2rem;font-weight:600;margin-top:1.5rem}
</style></head><body><h1>Quiz</h1><div id="quiz"></div><div id="score"></div>
<script>const QUESTIONS=__DATA__;
let answered=0,correct=0;const root=document.getElementById('quiz');
QUESTIONS.forEach((item,i)=>{const d=document.createElement('div');d.className='q';
  d.innerHTML='<p><b>'+(i+1)+'.</b> '+item.q+'</p>';
  item.options.forEach((opt,j)=>{const b=document.createElement('button');b.className='opt';b.textContent=opt;
    b.onclick=()=>{if(b.disabled)return;[...d.querySelectorAll('button')].forEach(x=>x.disabled=true);
      const ok=j===item.answer;b.classList.add(ok?'correct':'wrong');
      if(!ok)d.querySelectorAll('button')[item.answer].classList.add('correct');
      d.querySelector('.why').style.display='block';answered++;if(ok)correct++;
      document.getElementById('score').textContent='Score: '+correct+' / '+QUESTIONS.length;};
    d.appendChild(b);});
  const w=document.createElement('div');w.className='why';w.textContent='Why: '+item.why;d.appendChild(w);
  root.appendChild(d);});
</script></body></html>"""

with open("quiz.html", "w") as f:
    f.write(doc.replace("__DATA__", json.dumps(questions)))
print("wrote quiz.html")
```

## 4. Deliver

Tell the user the quiz is ready in the workspace (number of questions, what it covers). If they
prefer plain text, write a `quiz.md` with questions, an answer key, and explanations instead.
