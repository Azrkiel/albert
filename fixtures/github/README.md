# GitHub course-source recordings

## Controlled synthetic source (P5.1 owner)

`manifest.json`, `commit.json` and `files/synthetic/` now record the P5.1 owner's published artifacts from `Azrkiel/albert` commit `7ce9cd74d940e24b49b1814e0cbedc2cd6470098`, branch `codex/p5.1-calc2-seed`. The manifest is at `seed/calc2/manifest.json`; all file paths resolve beneath that directory. These replace this lane's initial clearly labelled transport placeholders. No seed source, seed build command, teaching-card fixture or database seeding was changed.

Counts: five units, six lectures (labels Lecture 5–10), four worksheet assignments and one course-wide syllabus. Unit 4 has a worksheet but no lecture notes; Unit 5 has no files. Worksheet 3/4 offsets are +4/+11 days. Every copied PDF's SHA-256 and byte count matches the owner's `pdf-build.json`, recorded as `files/synthetic-build.json`. Tests check those hashes and import the actual artifacts offline. Answers, evaluation checks and synthetic marker facts are not invented by this lane; no answer file is copied or listed. The owner reports automated build/CAS checks passed and human P5.1-AC4 readability sign-off still pending. That human check remains with P5.1.

## Separate real source

`live-manifest.json` records the root manifest on `Azrkiel/albert-files:codex/p5-course-manifest`, commit `ce2196c8417b4fe751923b7969744b3d4ec41968` (`files/live-commit.json`). The user confirmed subset, teaching order, Section 7.1–7.4 labels and worksheet links in this session on November 14, 2026. Four units map existing notes to worksheets 7.1a, 7.2, 7.3a, 7.4a. No due dates, syllabus or synthetic marker facts are fabricated. `files/live/` is byte-for-byte original PDF content from `6b0f4dd35dfa6d2dc7a29da1753ace79d1b638dd`, unchanged in the manifest commit. First-page note headings were checked against the units. All eight PDFs were downloaded through SHA-pinned GitHub contents endpoints with encoded paths, including spaces.

Real review-branch source smoke passed with the actual title, four units, manifest SHA and demo day. Publication on configured `main` and that configuration's smoke remain pending. Neither repository main was merged. Both recordings import without networking or credentials; the live source and synthetic course remain separate.
