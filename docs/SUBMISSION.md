# Albert: submission description

HackPrinceton Fall 2026 · Education track.
Live: [learn-albert.fly.dev](https://learn-albert.fly.dev) · Code: [Azrkiel/albert](https://github.com/Azrkiel/albert) · Run it locally: [README](../README.md)

Numbers below come from [`docs/plan/status.md`](plan/status.md).

## Inspiration

AI tutors live in chat boxes. You type your problem in, and they often teach a method your class has not reached yet. But math homework happens by hand, on a worksheet, usually late at night with nobody around to ask. We wanted help that shows up on the page, in the margin, the way a tutor leaning over your shoulder would give it.

## What it does

You open your course worksheet as a PDF and write on it with a pen, finger or mouse. When you get stuck, tap **I'm stuck** or type a short question into **Ask Albert**.

Albert reads your handwriting and answers on the page. A small red pen tip moves to the symbol it means, circles it, draws an arrow, and writes a short note in handwriting with a citation to the lecture where your class learned that step.

- **It doesn't give the answer.** Hints climb a ladder: first a question, then naming the step, then one worked step.
- **It knows your course.** Tap **Learn this course** and an agent reads the course notes and worksheets first. Hints for Worksheet 3 use only the methods from Units 1 to 3.
- **You can follow up.** Ask Albert remembers your earlier question and its reply.
- **Your work is kept.** Strokes save and reload, and **Save PDF** downloads the worksheet with your ink and Albert's, ready to hand to a teacher or tutor.

## How we built it

**Front end.** Next.js and TypeScript with our own stroke canvas on Pointer Events (`perfect-freehand`). The server renders PDF pages with `pdf.js`, and `pdf-lib` writes the annotated download. Albert's marks are drawn with `roughjs` so they look hand-drawn, and its writing uses MathJax and the Kalam handwriting font.

**Pointing at the right symbol.** The browser groups your strokes into numbered symbols. The model says *which* symbol it means by number, and the browser already knows *where* it is. The model never has to guess pixel coordinates on handwriting.

**Hints.** One call to Claude Sonnet 4.6 on Amazon Bedrock reads a snapshot of your work and writes the hint. Every reply is validated with zod, and the hint ladder is checked again on the server before anything is drawn. If a hint breaks the rules, Albert trims it or falls back to a neutral question rather than showing an answer.

**Learning the course.** A deep agent built with LangChain Deep Agents keeps a todo list and delegates to three sub-agents: `unit-reader` writes a teaching card per unit, `worksheet-mapper` maps each problem to its unit, and `card-checker` re-reads each unit against its card. It uses a file system, skills (`socratic-tutor`, `teaching-card`) and memory. Its tools refuse any card whose worked examples aren't in the source, so the agent fixes its own output.

**Data.** MongoDB Atlas holds sessions, cards, worksheets and cached course files, plus the agent's checkpoints. Course files come from a GitHub repository through a pinned manifest.

We built from a written plan, one subphase at a time, each with acceptance criteria and recorded results in the repo.

## Challenges we ran into

**Pointing at handwriting.** Asking a model for coordinates on messy handwriting was unreliable. Numbered stroke clusters fixed it: on our recorded eval Albert picked the right line every time.

**Keeping hints from giving answers.** A model told to be Socratic still slips. We enforce the ladder in the prompt and again on the server, and when a hint breaks the rules it is cut down or replaced with a neutral question instead of an answer.

**PDF coordinates.** Real PDFs are cropped and rotated, and the downloaded file has to put ink back in exactly the right place. We tested the transform on plain, cropped, and 90, 180 and 270 degree pages before building the UI.

**Speed.** Reading handwriting and checking the reply takes about 6 to 11 seconds today. The pen tip moving to the symbol shows the student Albert is working on it.

## Accomplishments we're proud of

- **Hint quality on recorded student work:** right status, right line and in-scope methods on 100% of cases, and no answers given on the first two rungs in three runs in a row.
- **Course ingestion:** the agent read the full demo course in about 5 minutes, producing 5 teaching cards and 4 mapped worksheets (14 problems), and passed 13 of 13 golden checks, twice in a row.
- **Save PDF:** your strokes become native PDF ink annotations. 19 unit tests read the coordinates back from the file on plain, cropped and rotated pages.
- **Tested end to end:** 983 automated tests, plus browser tests that replay real pen recordings and real model replies.
- **Deployed:** live at learn-albert.fly.dev.

## What we learned

A model is better at saying *which* numbered symbol is wrong than *where* it is, so the browser should own the geometry. Recording real pen input and real model replies as test fixtures let us test the whole flow without spending model calls. And a rule written in a prompt is a suggestion, so anything that must hold needs to be checked again in code.

## What's next

- Streaming, so the first ink appears faster.
- Placing notes in the free space on the page instead of a band below it.
- Real courses through an institution-approved LMS integration.
- More subjects beyond calculus.

## Built with

Next.js, TypeScript, Amazon Bedrock (Claude Sonnet 4.6), LangChain Deep Agents, MongoDB Atlas, pdf.js, pdf-lib, MathJax, roughjs, perfect-freehand, Zod, Playwright, Vitest, Fly.io.

## Tracks

- **Education** (main track)
- **Amazon: Best Practical AI Innovation.** Claude on Amazon Bedrock for every model call.
- **LangChain: Best use of deepagents.** Course ingestion agent in [`src/lib/agent/`](../src/lib/agent/agent.ts), sub-agents in [`subagents.ts`](../src/lib/agent/subagents.ts), skills in [`skills/`](../skills).
- **MLH: Best Use of MongoDB Atlas** (if offered). Atlas is the default store and holds the agent's checkpoints.
