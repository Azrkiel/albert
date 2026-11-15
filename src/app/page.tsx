import Image from "next/image";
import Link from "next/link";
import { ImportCourse } from "@/components/source/ImportCourse";
import styles from "./home.module.css";

const STEPS = [
  { title: "Write on the PDF", body: "Open the worksheet and work each problem by hand, one step at a time." },
  { title: "Tap I’m stuck, or ask", body: "Ask a question or tap the button when a step stops making sense." },
  { title: "Albert marks the page", body: "Circles, arrows and handwritten notes appear right where you were working. Save the annotated PDF when you finish." },
];

export default function Home() {
  return (
    <>
      <section className={styles.hero} aria-label="Albert">
        <div className={styles.copy}>
          <h1 className={styles.title}>Write your math. Albert marks the page.</h1>
          <p className={styles.lead}>
            Work a real worksheet PDF with a pen. When you get stuck, Albert answers on the page itself with hints in his own handwriting.
          </p>
          <div className={styles.actions}>
            <Link className={styles.cta} href="/work/calc2-ws3">Open the demo worksheet</Link>
            <a className={styles.secondary} href="#connect">Connect your course</a>
          </div>
        </div>
        <Image className={styles.mascot} src="/brand/albert-guiding.png" alt="" width={512} height={512} priority unoptimized />
      </section>

      <section className={styles.how} aria-labelledby="how-title">
        <h2 id="how-title" className={styles.sectionTitle}>How it works</h2>
        <ol className={styles.steps}>
          {STEPS.map((step, index) => (
            <li key={step.title} className={styles.step}>
              <span className={styles.number} aria-hidden="true">{index + 1}</span>
              <h3>{step.title}</h3>
              <p>{step.body}</p>
            </li>
          ))}
        </ol>
      </section>

      <section id="connect" className={styles.connect} aria-labelledby="connect-title">
        <h2 id="connect-title" className={styles.sectionTitle}>Connect your course</h2>
        <p className={styles.muted}>Bring your course notes and worksheets together.</p>
        <ImportCourse />
      </section>
    </>
  );
}
