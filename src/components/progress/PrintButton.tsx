"use client";
import styles from "./progress.module.css";

export function PrintButton() {
  return <button type="button" className={styles.print} onClick={() => window.print()}>Print this report</button>;
}
