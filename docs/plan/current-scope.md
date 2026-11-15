# Current release: PDF tutor with course context

User scope change, Nov 14, 2026. This file overrides earlier product scope, phase dependencies and release gates. `contracts.md` still governs existing data shapes until a matching code-and-contract change is implemented. Historical acceptance evidence remains historical; this revision does not mark work complete.

## Goal

Open a course worksheet PDF, write on it, and get a helper that understands the course and the student's pen strokes, points at the relevant work, and writes a short explanation beside it. Save the annotated PDF.

## Included

- PDF annotation: pen, eraser, undo/redo, page navigation, save/reload annotations, and download the original PDF with student and Albert ink. The user confirmed annotation, rather than editing original PDF text or layout.
- **Learn this course**: read the imported notes and worksheets, build validated teaching cards, preserve source references, and expose loading, ready, and failure states. A compact course/worksheet picker replaces the proposed study dashboard.
- Course context: selected course and unit, teacher notation and methods, covered versus upcoming material, source citations, and recent interaction context for the current problem. Keep course knowledge separate from the current page's working memory.
- Stroke-aware tutoring: line/cluster assignment, timing, pauses, erases and cross-outs; a hint request includes the active problem, page crop, stroke structure and recent hint history. A pause offers help; explanatory ink starts after a request.
- A page-local helper: ask for help through the existing stuck control or a short typed question. It points, circles, underlines, draws arrows and writes short notes beside the relevant work. Students continue the conversation by writing their next step or asking a follow-up.
- Safe rendering and recovery: cancel obsolete replies, keep drawing responsive, preserve work on a model failure, and avoid drawing over printed content or student ink. Fall back to a note band below the page when nearby space is full.

## Pixie concepts to adapt

Source: [Pixie README](https://github.com/Azrkiel/pixie/blob/master/README.md), [action types](https://github.com/Azrkiel/pixie/blob/master/src/shared/actions.ts), [stage reducer](https://github.com/Azrkiel/pixie/blob/master/src/renderer/stage.ts).

Use a visible assistant that points at what it explains, an ordered stream of explanation/drawing actions, deterministic rendering, explicit coordinate conversion, and an unobtrusive interaction. Reuse Albert's validated hint events, cluster IDs, ink conductor and logical page coordinates; do not import Pixie's screenshot-pixel targeting into the math path. A pointer can move to the targeted cluster before its annotation appears.

Pixie's README reports that its overlay/motion/drawing engine exists but its AI connection is still planned. These are interaction concepts, not a finished tutoring backend to integrate. A small page-local pointer is enough; voice, Electron desktop overlay, OS control, background research agents and personality animation are outside this release.

## Removed from this release

Study plans, daily practice schedules, re-planning, mastery/skill dashboards, tutor reports and the old adaptive-loop gate G4. Preserve existing code and unfinished work; do not delete it as part of this scope change. Automatic grading/Check is optional and cannot block the PDF-helper demo. Standalone whiteboard, upload UI, advanced agent-run replay and broader course coverage follow the core PDF flow.

## Data flow and failure paths

```text
GitHub course -> cached PDFs -> course learner -> validated cards + citations
                                      | failure -> retry; retain prior ready context
                                      v
PDF page + problem region + course/unit + pen strokes + question/history
                                      |
                                      v
                        one validated tutoring call
                         |                      |
                         v                      v
                 ordered hint actions    failure/cancel -> preserve student ink
                         |
                         v
             page-local pointer + marks + explanation
                         | no free space -> note band below page
                         v
            saved annotation state -> annotated PDF download
```

## Build order

1. **Course context integration.** Reconcile P6.5 work with current main. Keep card/worksheet validation, citations and repeat-ingestion checks. Remove the planner from the required ingest flow, its tools/sub-agent dispatch and completion conditions. Replace the old mandatory plan golden check with explicit context-only coverage in the implementation change; do not present the old P6.5 checklist as passed. Enable Learn this course with a compact status panel and worksheet access.
2. **PDF annotation surface (P5.8, promoted to core).** Render cached PDF pages beneath existing ink, keep stable page coordinates under scale/zoom, assign strokes to problem regions with a picker fallback, and save/reload page-owned annotation state. Retain original PDF content and page sizes in annotated export.
3. **Contextual page helper.** Extend the existing validated tutoring request for a short question and scoped follow-up context; update schemas, contracts and fixtures together. Include the active PDF problem crop and recent stroke events. Adapt the ink conductor for pointer-to-cluster sequencing and free-space note placement. Printed course/page content is input data, not instructions.
4. **Integrated proof and hardening.** Run the automated acceptance below, then the live pen/PDF-save checks. Tune latency after correctness; streaming remains a follow-up if needed, rather than claiming the old three-second target is already met.

The old requirement to wait for G3 before building PDF mode is superseded. PDF work can start while course-context integration is being completed. This is an implementation order, not authorization to spawn parallel agents.

## Release acceptance

- [ ] Import a course, press Learn this course, and open a worksheet with ready, validated course context. Repeating learning updates existing cards/worksheets without duplicates and completes without creating a study plan.
- [ ] Write, erase and undo on multiple PDF pages; navigate, zoom and reload without losing or shifting strokes. Automated replay verifies page/problem ownership and stored geometry.
- [ ] Request a hint on the missing-dx example: it uses the selected unit's methods, cites the source, targets the right stroke cluster, and reveals no final answer on the first request. Automated recorded replies plus a live human check are required.
- [ ] Ask a follow-up while writing. The helper uses recent work and the question, stays within course scope, and cancels obsolete responses. Model failure leaves drawing and saved work usable.
- [ ] Notes avoid print and ink, with the below-page fallback tested. By hand, inspect crowded and sparse pages on the demo device.
- [ ] Download an annotated PDF retaining original page sizes/content and both inks. Reopen it in an independent PDF viewer and inspect multiple pages by hand; save/reload annotation state separately remains editable.
- [ ] `pnpm verify` and offline `pnpm e2e` pass for the integrated code. Run the complete live course-to-PDF-to-hint-to-save demo three times and record results. Existing human gates for actual handwriting still apply; study-plan/report gates do not.

## Remaining effort estimate

Estimate from main `567169d` plus inspected local P6.5 work, for one focused engineer or coding-agent session with human checks available. These are planning ranges, not measured completion times.

| Work | Focused hours |
|---|---:|
| Context-only course learning, integration, button and compact status | 2-3 |
| PDF annotation surface, page mapping, persistence and export | 5-8 |
| Page helper, short questions, context and pointing/annotation sequence | 3-5 |
| Integrated tests, live handwriting, PDF inspection and fixes | 2-4 |
| **Demo-ready total** | **12-20** |

A first thin PDF demo can target 6-8 hours by using one known worksheet, a problem picker when extraction fails, cached course cards and the existing annotation renderer. That is a milestone, not completion of all acceptance above. A more robust multi-page experience needs approximately 2-3 focused working days including integration and polish. Main risks are PDF coordinate/export correctness, crowded-page placement, and live handwriting quality/latency. Removing study planning saves work, but the PDF surface and helper interaction add new integration work.
