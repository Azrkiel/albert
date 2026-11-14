# GitHub course source

The server imports a configured public repository. It resolves the ref once, reads the manifest and every listed PDF at that SHA, validates the complete download, and then saves original bytes, manifest, normalized outline, course and connection through Repo. Import does not run a model or set `ingestedAt`; P6 owns that flag.

Configure server environment:

```dotenv
COURSE_GITHUB_REPO=Azrkiel/albert-files
COURSE_GITHUB_REF=main
COURSE_MANIFEST_PATH=manifest.json
COURSE_DEMO_DAY=2026-11-14
# Optional API quota credential; never NEXT_PUBLIC or a browser input:
COURSE_GITHUB_TOKEN=
```

`POST /api/source/connect` imports the configured source; it accepts no repository or token from the browser. `GET /api/source/courses` reads the saved demo connection and course only. `getAdapter(courseId)` reads stored source and returns a cache-only adapter. Originals use the outline's `/api/files/<encoded file id>` URL. A missing cached file fails instead of fetching GitHub.

Course identity includes owner/repository, manifest path and course id, commit SHA and demo day. Unit ids are `${courseId}/u${order}`; assignment/file ids also include the course identity. Reimport upserts those identities, preserves existing ingestion state and file transcription metadata, and does not duplicate courses or original files. Without `COURSE_DEMO_DAY`, the first import uses the UTC date; importing the same snapshot again reuses its saved day even after midnight. Set the day explicitly to reproduce an import on another store. Offsets become 23:59:59 UTC; absent offsets stay absent. A new SHA or day creates a separate course.

Manifest paths are relative to the manifest directory. URLs, traversal, absolute paths, percent escapes, backslashes and control characters are rejected. Every assignment links a listed worksheet in its own unit. Only listed PDF paths are downloaded; answer/solution files are rejected. GitHub's contents API reports `application/vnd.github.raw+json` for raw PDF bytes, so that negotiated MIME and `application/octet-stream` are accepted alongside `application/pdf`, always with a `%PDF-` signature check. HTML/JSON MIME types and missing PDF signatures fail. Transport errors and upstream bodies are never logged or returned; source errors expose only the documented codes and fixed messages.

## Review state

The user confirmed the live four-unit mapping on November 14, 2026: Integration by Parts → Trigonometric Integrals → Trigonometric Substitution → Partial Fractions; labels Section 7.1–7.4; worksheets 7.1a, 7.2, 7.3a, 7.4a. Unknown dates and syllabus are omitted. The root manifest is proposed in [albert-files draft PR #1](https://github.com/Azrkiel/albert-files/pull/1) on branch `codex/p5-course-manifest`; existing PDFs are unchanged. Review branch publication is separate from publication on the configured `main` ref. Neither main is merged by this lane.

Run a review-branch check without a model or database credential:

```bash
STORE=memory COURSE_GITHUB_REPO=Azrkiel/albert-files \
COURSE_GITHUB_REF=codex/p5-course-manifest COURSE_MANIFEST_PATH=manifest.json \
COURSE_DEMO_DAY=2026-11-14 pnpm smoke --no-llm
```

In this managed Cloud environment, use `NODE_USE_ENV_PROXY=1` with Node 24 to honor the inherited proxy. No application transport changes are needed for this environment setting.

Smoke imports all PDFs and prints the actual title, unit count, SHA and day. In-memory smoke data lasts only for that process; use the app import route or a persistent Repo for later viewing. `--no-source` preserves database/model/vision checks without a source request. `--snapshot <png>` retains its existing independent behavior.

## P5.1 dependency and shared files

P5.1 owns `seed/calc2/**`, `seed:pdf` and seed tests. Its published artifacts became available at commit `7ce9cd74d940e24b49b1814e0cbedc2cd6470098` on `codex/p5.1-calc2-seed` and were consumed into `fixtures/github/manifest.json` and `files/synthetic/`. All 11 PDF hashes/byte counts match the owner's build evidence. Recorded offline import verifies five units, Lecture 5–10 labels, four worksheet links, a syllabus, empty future notes and the +4/+11 day offsets. These replace this lane's initial transport-only placeholders. No seed course is duplicated or authored here, and no answer file is imported.

The remaining P5.1 dependency is the owner's human P5.1-AC4 PDF readability sign-off. Their automated build/CAS and artifact evidence is published; this lane does not claim the human check or modify the owner's status. Update the source recordings if that owner changes the manifest/PDFs after review. P5.1's own branch/PR remains separate and unmerged here.

This lane changes the course-source plan documents, source fixture mappings in the contract test, source smoke additions and P5.2/P5.3 evidence. It changes no contract schema or Repo interface/implementation, no P3.2 teaching cards, database seeding, session-sync implementation or WorksheetCanvas. P5.4 upload UI, P5.5 import UI and P6 ingestion remain separate work. Main's newer status/evidence is retained; inaccessible Windows plan revisions were not copied or claimed as read.

## Verified review-branch smoke

The real review branch passed with the optional GitHub token unset:

```text
db ok 0ms
source ok Calculus II — Integration Techniques 4 units ce2196c8417b4fe751923b7969744b3d4ec41968 2026-11-14
```

- [x] Owner mapping confirmed in this session.
- [x] Manifest-only review branch published; all eight live PDFs downloaded at its pinned SHA.
- [ ] Manifest published on the default configured `main` ref and that configuration smoked.
- [x] P5.1 published manifest/PDF artifacts consumed; hashes verified and imported offline.
- [ ] P5.1 owner records human PDF-readability sign-off (P5.1-AC4).

The Windows dirty checkout is unavailable here. The user directed plan reconciliation to the GitHub repository; reconciliation uses current main contracts and the task requirements, rather than claiming access to unpublished local revisions.

Production HTTP verification also passed: POST connect returned the pinned review SHA; GET courses returned the imported course with `ingested: false`; GET original for `lecture notes/7.4 annotated.pdf` returned 2,197,431 bytes with PDF MIME and SHA-256 `8af06d4403be9ecf46522df4bfc8b9f154be7a37663d903041d3974aabbfa4ce`, matching the unchanged source. The browser endpoint uses the Repo cache and an encoded snapshot-qualified id.

Final validation: `pnpm verify` — 490 passed, 16 live MongoDB tests skipped without credentials; offline `pnpm e2e` — 49 passed, four existing deferred/production opt-in skips; production `pnpm build` passed. No dependencies were added by this lane.
