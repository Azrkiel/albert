"use client";

import Link from "next/link";
import { useSourceCourses } from "./source-client";
import styles from "./source.module.css";

export function CoursePicker() {
  const { courses, error } = useSourceCourses();

  return (
    <section className={styles.panel} aria-label="Saved courses">
      {error ? <>
        <p role="alert">{error}</p>
        <p><Link href="/">Back to import</Link></p>
      </> : courses === null ? <p aria-live="polite">Loading courses…</p>
        : courses.length === 0 ? <>
          <p>No courses yet.</p>
          <p><Link href="/">Import a course</Link></p>
        </> : <ul className={styles.courses}>
          {courses.map(course => (
            <li className={styles.course} key={course.id}>
              <h2>{course.title}</h2>
              {course.ingested
                ? <Link className={styles.action} href={`/course/${encodeURIComponent(course.id)}`}>Open</Link>
                : <>
                  <button className={styles.action} type="button" disabled aria-describedby={`learn-note-${encodeURIComponent(course.id)}`}>Learn this course</button>
                  <p id={`learn-note-${encodeURIComponent(course.id)}`}>Course learning is not available yet.</p>
                </>}
            </li>
          ))}
        </ul>}
    </section>
  );
}
