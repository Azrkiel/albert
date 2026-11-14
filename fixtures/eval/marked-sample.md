# marked-sample.png (P2.7-AC4)

question: Which cluster number is above the term dx in row R2?
answer: 9, 10

- **Source:** `fixtures/sessions/ac4-handwriting.json` (real handwriting, free layout, written by the user
  for P2.5a-AC4). Problem `demo-worksheet/p1`, `upToRowId` = `demo-worksheet/p1/r2`, marked.
- **What it shows:** R1 `∫ x/(sin x dx) + C`-style first integral; R2 `∫ 2/(3x⁴ + n³c) dx`.
- **Known answer:** in R2, `d` is cluster 9 and `x` is cluster 10, so `dx` spans clusters **9 and 10**.
  `pnpm smoke --snapshot fixtures/eval/marked-sample.png` passes when the reply names exactly 9 and 10.
- **Size:** 1109 × 892 px (2× device scale, under the 1400 px cap).
- **How it was made:** `STORE=memory MOCK_LLM=1 pnpm dev`, open
  `/work/demo?dev=1&replay=ac4-handwriting&speed=instant`, then in the page
  `await window.__albert.renderSnapshot({ upToRowId: "demo-worksheet/p1/r2" })` and decode `png` (base64)
  to this file. Re-render it if the snapshot rules or the clustering change, and recheck the answer.
