"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { readSourceResponse, sourceMessage, useSourceCourses } from "./source-client";
import styles from "./source.module.css";

const COMING_SOON = ["Canvas", "Moodle", "Blackboard"];

export function ImportCourse() {
  const router = useRouter();
  const { courses, error: connectionError } = useSourceCourses();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const loadingConnection = courses === null && connectionError === null;

  async function importCourse() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await readSourceResponse(await fetch("/api/source/connect", { method: "POST", cache: "no-store" }));
      router.push("/courses");
    } catch (error) {
      setError(sourceMessage(error));
      setBusy(false);
    }
  }

  return (
    <section className={styles.panel} aria-label="Course import" aria-busy={busy}>
      {courses?.map(course => (
        <p key={course.id}>Connected: {course.title}. <Link href="/courses">Pick a course</Link></p>
      ))}
      {connectionError && <p role="alert">{connectionError}</p>}
      <button className={styles.action} type="button" disabled={busy || loadingConnection} onClick={() => void importCourse()}>
        {busy ? "Importing…" : "Import course"}
      </button>
      <p aria-live="polite">{busy ? "Downloading the course PDFs. This may take a while." : "Import the course notes and worksheets."}</p>
      {error && <p className={styles.error} role="alert">{error}</p>}
      <div aria-label="Other course sources">
        <p className={styles.soonLabel}>Other sources</p>
        <ul className={styles.soon} role="list" data-testid="coming-soon-sources">
          {COMING_SOON.map(name => <li key={name}>{name} <span>coming soon</span></li>)}
        </ul>
      </div>
    </section>
  );
}
