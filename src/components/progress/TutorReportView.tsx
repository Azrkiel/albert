import type { TutorReport } from "@/lib/contracts";
import styles from "./progress.module.css";
import { PrintButton } from "./PrintButton";

const LEVEL_WORDS = ["not covered yet", "taught, no evidence", "can follow along", "can do with help", "can do independently", "can teach it"];
const fmt = (iso: string) => new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
const humanize = (s: string) => { const t = s.replaceAll("_", " "); return t.charAt(0).toUpperCase() + t.slice(1); };

/**
 * PERI SLOT (P8.2): the one change that comes out of the Peri conversation goes in this component, at the top
 * of the report. It is empty until then.
 */
function PeriSlot() {
  return <div className={styles.peri} data-slot="peri" />;
}

export function TutorReportView({ report }: { report: TutorReport }) {
  const { totals } = report;
  return (
    <article className={styles.page} data-testid="tutor-report">
      <PeriSlot />
      <header>
        <h1>Tutor report — {report.student.name} · {report.course.title} · this week</h1>
        <p className={styles.muted}>{fmt(report.period.from)} to {fmt(report.period.to)} · built from the student&apos;s work by plain code, no model involved.</p>
        <p className={`${styles.muted} ${styles.noprint}`}><PrintButton /></p>
      </header>
      <section className={styles.card}>
        <h2 className={styles.h2}>Summary</h2>
        <p>{report.summary}</p>
        <div className={styles.figures}>
          <span className={styles.figure}><strong>{totals.minutes}</strong>minutes</span>
          <span className={styles.figure}><strong>{totals.problemsAttempted}</strong>problems attempted</span>
          <span className={styles.figure}><strong>{totals.solvedUnaided}</strong>solved unaided</span>
          <span className={styles.figure}><strong>{totals.hintsByRung[1]} / {totals.hintsByRung[2]} / {totals.hintsByRung[3]}</strong>hints by step</span>
        </div>
      </section>
      <section>
        <h2 className={styles.h2}>Where they got stuck</h2>
        {report.stuckPoints.length === 0 && <p className={styles.muted}>No stuck points this week.</p>}
        {report.stuckPoints.map((p) => (
          <div key={`${p.subskillId}/${p.errorType}`} className={styles.stuck} data-testid="stuck-point">
            <div>
              {p.example.snapshotFileId
                // eslint-disable-next-line @next/next/no-img-element
                ? <img className={styles.snapshot} src={`/api/files/${encodeURIComponent(p.example.snapshotFileId)}`} alt={`The student's work on ${p.example.worksheetTitle} problem ${p.example.problemLabel}`} />
                : <p className={styles.muted}>No snapshot saved.</p>}
            </div>
            <div>
              <p className={styles.label}>{p.unitTitle} · {p.subskillName}</p>
              <p><strong>{humanize(p.errorType)}</strong> · {p.count} {p.count === 1 ? "time" : "times"} · last {fmt(p.lastAt)} · {p.example.worksheetTitle}, problem {p.example.problemLabel}</p>
              <p>Albert read: <code>{p.example.albertRead || "none"}</code></p>
              <p>What was wrong: {p.example.tutorNote || "No note recorded."}</p>
              <p>Albert asked: {p.example.albertAsked}</p>
            </div>
          </div>
        ))}
      </section>
      <section>
        <h2 className={styles.h2}>Skills</h2>
        <div className={styles.skills}>
          {report.skills.map((s) => <span key={s.subskillId} className={styles.skill}><span>{s.name}</span><span className={styles.muted}>{s.level} · {LEVEL_WORDS[s.level]}</span></span>)}
        </div>
      </section>
      <section className={styles.card}>
        <h2 className={styles.h2}>Suggested focus for your next session</h2>
        {report.suggestedFocus.length ? <ol>{report.suggestedFocus.map((f) => <li key={f}>{f}</li>)}</ol> : <p className={styles.muted}>Nothing to suggest yet.</p>}
      </section>
    </article>
  );
}
