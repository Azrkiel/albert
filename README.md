# Albert

**Turns you into Einstein.** · Part of *Albert and Einstein Academy* · HackPrinceton Fall 2026

Albert is a math tutor that works where students do math: on the page, by hand.

You connect your course from your LMS. Albert reads the lecture notes and worksheets and learns how your teacher teaches. You solve a worksheet by hand on a canvas. When you get stuck, Albert writes next to your work in red ink: it circles the symbol that went wrong, draws an arrow and asks you a question. It uses only the methods your class has covered, in your teacher's notation, and points you back to the lecture. Afterwards it tells you how you are doing on each skill and plans what to practice next.

## The four ideas

- **Stroke-aware.** Albert reads pen strokes with their timing. Pauses, erasing and crossed-out steps tell it you are stuck, and it can point at the exact symbol.
- **Scope-aware.** Hints stay inside what your course has covered so far.
- **Socratic.** A question first, then the next step, then one worked step. Never the answer on the first tap.
- **Adaptive.** A course agent tracks each skill and rebuilds your study plan from the evidence in your work.

## Status

This repository currently holds the build plan. Code follows it.

| Start here | |
|---|---|
| [`docs/plan/00-main-plan.md`](docs/plan/00-main-plan.md) | The idea, the architecture, the order of work |
| [`docs/plan/status.md`](docs/plan/status.md) | What is done and what is next |
| [`docs/plan/contracts.md`](docs/plan/contracts.md) | Data shapes, routes, env vars, commands |
| [`docs/plan/tracks.md`](docs/plan/tracks.md) | Prize tracks and how each is met |
| [`docs/plan/decisions.md`](docs/plan/decisions.md) | Design decisions and their reasons |
| [`AGENTS.md`](AGENTS.md) | How people and coding agents work in this repo |

Phases: [1 Foundation](docs/plan/phase-1-foundation.md) · [2 Canvas](docs/plan/phase-2-canvas.md) · [3 Tutor brain](docs/plan/phase-3-tutor-brain.md) · [4 Ink](docs/plan/phase-4-ink.md) · [5 LMS](docs/plan/phase-5-lms.md) · [6 Course agent](docs/plan/phase-6-course-agent.md) · [7 Progress](docs/plan/phase-7-progress.md) · [8 Ship](docs/plan/phase-8-ship.md)

## Built with

Next.js and TypeScript · a custom stroke canvas · Claude on Amazon Bedrock · LangChain Deep Agents · MongoDB Atlas · Moodle web services · MathJax · roughjs

## Licence

MIT. See [`LICENSE`](LICENSE). The Socratic tutoring rules are adapted from Jane Street's [`agent_skills`](https://github.com/janestreet/agent_skills) (MIT).
