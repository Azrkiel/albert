import type { Metadata } from "next";
import Link from "next/link";
import type { CSSProperties } from "react";
import { ACADEMY, NAME, TAGLINE } from "@/lib/brand";
import { INK } from "@/lib/contracts";
import { HealthStatus } from "./health-status";
import "./globals.css";

export const metadata: Metadata = {
  title: NAME,
  description: TAGLINE,
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en">
      <body style={{ "--ink-student": INK.student, "--ink-albert": INK.albert } as CSSProperties}>
        <a className="skip-link" href="#main">Skip to content</a>
        <div className="shell">
          <header className="shell-header">
            <div>
              <p className="academy">{ACADEMY}</p>
              <Link className="brand" href="/">{NAME}</Link>
              <p className="tagline">{TAGLINE}</p>
            </div>
            <HealthStatus />
          </header>
          <main id="main">{children}</main>
        </div>
      </body>
    </html>
  );
}
