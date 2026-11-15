# Handwriting and worksheet hint sources

Goal: general calculus hints follow the visible ink; worksheet hints follow the visible assigned exercise and its course notes.

Architecture: add optional HintRequest.problemSource, defaulting to worksheet for existing API callers. The work page loads real worksheet metadata; general practice uses blank prompts and explicitly sends handwriting. General runHint bypasses the course repository and scope loader, validates the normal reading/pointing/ladder rules, rejects course references and saves no course hints or skill evidence. The existing 12-second deadline, safe log and worksheet no-notes behavior remain.

Tech stack: existing Next.js, React, Zod, Vitest and Playwright; no dependencies.

```
visible page -> real ink snapshot -> problemSource
  handwriting -> image + rows + history -> validated hint -> margin
  worksheet   -> assigned problem + scope + image -> validated hint -> margin + course evidence
  bad output -> one repair -> bad_model_output
  provider/deadline failure -> safe retry note; drawing remains available
```

- [x] Add failing schema, runHint, request-builder and browser source tests. Run targeted Vitest and Playwright; confirm missing mode support fails.
- [x] Add optional source enum to hints.ts and contracts.md; label both request fixtures and contract examples worksheet in the same commit. Existing omitted-source requests remain valid.
- [x] Extract shared prompt rules and branch the course block; handwriting uses its first written problem, no fixed exercise or course material. Reuse pure validators and reject course metadata in handwriting replies.
- [x] Branch runHint before any repository/scope lookup. General hints still log and end in done, but make no course persistence/evidence writes. Keep mock worksheet streams; give general mock requests a course-free fixture and prevent mock course evidence.
- [x] Work page: display all loaded worksheet statements; provide General calculus and worksheet navigation. Blank/unknown workspaces explicitly use handwriting. Pass source through the live and dev snapshot builders. Navigation remounts the canvas so requests/history cannot cross sources.
- [x] Fix the existing fixture-injection test observer race by checking forwarded input inside its route handler, while retaining all real response and drawing assertions. Update worksheet hydration counts for actual five-problem metadata.
- [x] Run verify, offline e2e twice, build and production checks on a free port. Check the user's recorded two-row ink with live Haiku after offline checks. Review diff/privacy, preserve all status Log lines and leave human-only criteria unticked. Update PR #38 with exact evidence; do not merge.


Validation: verify 757 passed / 16 skipped; full offline browser suite twice consecutively 91 passed / 6 skipped; build passed; production replay 1, production gates 5 and source-mode checks 4 passed. Initial full runs hit the fixed static-mode status-role conflict and separate before-hydration timeouts; no test or application timeout was raised. Fresh final reruns passed. The live general-practice check read the user's first integral correctly with a clean image and finished in 3403 ms (log 3406 ms), retry 0. P3.5's model benchmark and human P3.8-AC3 remain open.
