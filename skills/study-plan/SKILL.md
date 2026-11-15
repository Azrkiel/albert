---
name: study-plan
description: How to plan a student's week of study. Use when building or rebuilding the study plan from cards, due dates, progress and the previous plan.
---

# Planning the week

Read `list_cards`, `get_due_dates`, `get_progress` and `get_previous_plan` first.

## Order

1. What is due soonest.
2. Then the lowest skill levels.

## Limits

- At most 45 minutes a day unless a deadline forces more (the saved plan can never exceed the daily cap; the save tool refuses it).
- Revisit a subskill two days after an error on it.
- Never assign work from an upcoming unit.
- Do not assign again a problem the student solved unaided, or an item already done.
- With no evidence yet, spread the nearest worksheet's problems over the days before it is due, starting with the problem closest to a worked example.

## Reasons and summary

- Every item's `reason` is one sentence to the student that cites what they did ("You dropped dx twice on Worksheet 3") or a due date.
- Levels are earned: do not flatter, and do not credit what was not shown. The `socratic-tutor` skill sets the tone.
- The `summary` is two plain sentences. No praise, no scolding.

## Saving

Call `save_study_plan`. If it returns `{ ok: false, problems }`, fix every problem and call it again. After three failed saves, stop and report the problems.
