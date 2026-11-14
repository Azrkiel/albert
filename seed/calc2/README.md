# Controlled synthetic CALC2 course

This is original synthetic teaching material for P5.1. It is separate from the real PDFs in `Azrkiel/albert-files`; no files from that repository were read, copied, changed or published. Only the eleven student PDFs listed in `manifest.json` are importable. `answers.md`, the verification scripts, and evidence JSON are evaluation/maintenance material.

## Integration handoff

Use `seed/calc2/manifest.json` in **Azrkiel/albert**. Every `files[].path` and `assignments[].filePaths` entry is relative to the manifest directory, as required by the shared `CourseManifestSchema`. For example, `pdf/unit-3/lecture-09.pdf` resolves to `seed/calc2/pdf/unit-3/lecture-09.pdf` in this repository.

The course id is `calc2`, title `Calculus II`, short name `CALC2`. Keep all five units in manifest order. Unit 4 has a worksheet but no lecture notes; Unit 5 has no files. Neither future unit is taught. The syllabus has no unit order.

| Unit | Title | Lecture labels and manifest paths | Worksheet title and manifest path |
| --- | --- | --- | --- |
| 1 | Integration by Parts | Lecture 5: `pdf/unit-1/lecture-05.pdf`; Lecture 6: `pdf/unit-1/lecture-06.pdf` | Worksheet 1: `pdf/unit-1/worksheet-1.pdf` |
| 2 | Trigonometric Integrals | Lecture 7: `pdf/unit-2/lecture-07.pdf`; Lecture 8: `pdf/unit-2/lecture-08.pdf` | Worksheet 2: `pdf/unit-2/worksheet-2.pdf` |
| 3 | Trigonometric Substitution | Lecture 9: `pdf/unit-3/lecture-09.pdf`; Lecture 10: `pdf/unit-3/lecture-10.pdf` | Worksheet 3: `pdf/unit-3/worksheet-3.pdf` |
| 4 | Partial Fractions | No notes posted | Worksheet 4: `pdf/unit-4/worksheet-4.pdf` |
| 5 | Improper Integrals | No notes posted | None |

The course-wide Syllabus is `pdf/syllabus.pdf`. Assignment ids are `ws1` through `ws4`. Only Worksheet 3 and Worksheet 4 have due offsets: +4 and +11 days from the import's demo day, respectively. The importer resolves dates at 23:59:59 UTC according to the shared contract; P5.1 does not implement import or database seeding.

Compared read-only with `origin/p3.2-scope` at `30f65fe`: unit titles, lecture labels, Worksheet 1's three problems, and Worksheet 3's five problems match. Worksheet 3 labels 1-3 are on PDF page 1; labels 4-5 are on page 2. Lectures 5, 9 and 10 put Example 1 on page 2 and Example 2 on page 3, matching the hand-authored citations. Its opaque fixture file ids (for example `calc2-lecture-09`) are fixture identifiers, not manifest paths; a GitHub importer will supply snapshot-qualified ids. No P3.2 fixture or seed command was edited. Stable paths and labels were handed off early through the task conversation, then posted to the P3.2 owner on PR #22 (https://github.com/Azrkiel/albert/pull/22#issuecomment-6882711202), with a request to relay them to the P5.2/P5.3 owner; that owner has no visible open PR/channel. This file preserves the handoff for integration.

## Build and checks

Use the package manager pinned in `package.json` (pnpm 10.34.9):

```sh
corepack pnpm install --frozen-lockfile
corepack pnpm exec playwright install chromium
corepack pnpm seed:pdf
corepack pnpm verify
```

`pnpm seed:pdf` uses Marked, MathJax 4 SVG output and Playwright Chromium. TeX is protected before Markdown parsing, including backslash spacing commands. MathJax loads installed font data in Node; printing requires no remote assets or running app. A request blocker prevents external page assets. Invalid TeX, unknown glyphs, page overflow, wrong page count, a ten-page document, or a file reaching 4,000,000 bytes fails the command. Intentional page breaks preserve citations. `pdf-build.json` records source/PDF hashes, page counts, byte counts, generator hash and browser version; tests reject stale outputs. PDF timestamps may change when rebuilt.

For independent CAS verification, install SymPy 1.14.0 and antlr4-python3-runtime 4.11.1 in a Python environment, then run:

```sh
python seed/calc2/verify-answers.py --output seed/calc2/answer-verification.json
```

The checker strictly parses the actual displayed worksheet integrals and answer formulas in Markdown, differentiates each answer, and simplifies the difference to exactly zero. It checks every connected domain interval, including both intervals for Worksheet 3 problem 1 and all pole-separated intervals on Worksheet 4. It strips only presentation sizing commands and interprets the symbol `e` as Euler's constant. Fourteen answers pass, over 21 interval checks. Source hashes bind the evidence to those formulas. Re-run the checker after any answer or worksheet edit. Python is needed for this independent check, not for `seed:pdf` or `pnpm verify`.

## Visual acceptance

Agent review rasterized all 21 pages with Poppler, inspected contact sheets and enlarged Lecture 9/10 examples, and checked print-layout bounds during generation. On Nov 14, the user opened Lecture 9 and confirmed readable math and five clear steps in Example 2, satisfying P5.1-AC4. A separate fresh SymPy 1.14.0 check verified all 14 worksheet answers across 21 domain intervals and both Lecture 9 example antiderivatives on 0 < x < 3. P5.1 is now checked in status.md.

The initial implementation used GitHub while the Windows checkout was unavailable. Merge preparation subsequently reconciled the branch with main 5a61abd, including its GitHub-source plan, P2.8 sessions and P3.2 cards. The seed:pdf and seed:demo commands are both preserved. Scoped Git attributes keep source hashes and PDF bytes stable across Windows and Linux checkouts.
