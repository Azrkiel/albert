import type { Metadata, Viewport } from "next";
import Link from "next/link";
import type { CSSProperties } from "react";
import { NAME, TAGLINE } from "@/lib/brand";
import { INK } from "@/lib/contracts";
import { HealthStatus } from "./health-status";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: `${NAME}: a tutor that marks your worksheet`, template: `%s | ${NAME}` },
  description: "Write on your worksheet PDF by hand. Albert watches your steps and answers on the page with circles, arrows and handwritten notes.",
  applicationName: NAME,
  manifest: "/site.webmanifest",
  icons: {
    icon: [
      { url: "/favicon.svg", type: "image/svg+xml" },
      { url: "/favicon-32.png", sizes: "32x32", type: "image/png" },
      { url: "/favicon-16.png", sizes: "16x16", type: "image/png" },
      { url: "/favicon.ico", sizes: "48x48" },
    ],
    apple: "/apple-touch-icon.png",
  },
};

export const viewport: Viewport = { themeColor: "#182B49" };

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en">
      <body style={{ "--ink-student": INK.student, "--ink-albert": INK.albert } as CSSProperties}>
        <a className="skip-link" href="#main">Skip to content</a>
        <div className="shell">
          <header className="shell-header">
            <div className="brand-block">
              <Link className="brand" href="/">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src="/brand/albert-wordmark-primary.svg" alt={NAME} width={132} height={38} />
              </Link>
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
