---
name: teaching-card
description: How to build one unit's teaching card from the teacher's own files. Use before reading or saving any unit's card, for taught units and for upcoming (syllabus-only) units.
---

# Building a teaching card

A card records how THIS teacher teaches one unit, so a tutor can speak in the teacher's own words. Read the unit's files with `read_course_file` first. Everything on the card must come from those files.

## Parts

- **Method.** A named procedure with ordered steps, in the order the teacher gives them. Use the teacher's step wording. A method has at least two steps in a taught unit.
- **Notation.** What the teacher writes (`teacherWrites`, copied character for character from the files) and the standard forms the teacher does not use (`avoid`, for example prime notation `f'(x)` where the teacher writes Leibniz `\frac{dy}{dx}`). Whenever the teacher writes derivatives or differentials in Leibniz form (`\frac{dy}{dx}`, `dy`, `dx`), include a notation row for it: `teacherWrites` is the teacher's own form (for example `\frac{dy}{dx}`) and `avoid` always includes the prime form `f'(x)`, plus any other prime form the students might write. Keep such rows when you revise a card. If a lecture fixes the letter for a variable (for example the angle), add a row for it. Never take notation from the syllabus.
- **Tables.** When a lecture gives a table (for example a substitution table pairing each radical form with its substitution), record EVERY row, copied exactly, as notation rows or inside the method step. A step that says "choose from the table" is not enough on its own.
- **Conventions.** Habits the teacher states, written as plain sentences ("Draw the reference triangle before back-substituting").
- **Worked examples.** Copy the lecture label and the example label exactly (for example "Lecture 9, Example 2"). Never invent a label. Give the page where it appears and the methods it uses.
- **Subskills.** Three to eight statements that begin "can ...". Each is small enough for one problem to exercise.
- **Pitfalls.** A mistake the teacher warns about, the subskill it belongs to, and a snake_case `errorType` that names the symbol literally as the teacher writes it (`missing_dx`, `dropped_theta`), never a paraphrase of it (not `missing_differential`).

## Taught units

Include at least one method with two or more steps, notation, a worked example, three to eight subskills, and pitfalls tied to subskills.

## Upcoming units (no lecture files)

Read only the syllabus section. Record a title, method NAMES with empty steps, and subskills. No notation, no examples, no pitfalls, no steps.

## Saving

Call `save_teaching_card`. It checks your card against the source and returns `{ ok: false, problems }` when something is unsupported. Fix every problem (usually by correcting a label or a notation string to match the file text) and call it again. After three failed saves, stop and report the problems.
