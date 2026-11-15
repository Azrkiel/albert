import { Suspense } from "react";
import Link from "next/link";
import { connection } from "next/server";
import { WorksheetCanvas } from "@/components/work/WorksheetCanvas";
import { WorksheetShell } from "@/components/work/WorksheetShell";
import { getRepo } from "@/lib/db";

type WorkPageProps = {
  params: Promise<{ worksheetId: string }>;
  searchParams: Promise<{ source?: string }>;
};

async function WorkProblems({ params, searchParams }: WorkPageProps) {
  const { worksheetId } = await params;
  const { source } = await searchParams;
  await connection();
  const general = source === "handwriting" || worksheetId === "general-calculus";
  let worksheet;
  try {
    worksheet = general ? null : await getRepo().getWorksheet(worksheetId);
  } catch {
    return <p role="alert">Could not load this worksheet. Try again, or <Link prefetch={false} href="/work/general-calculus">open general calculus</Link>.</p>;
  }
  if (source === "worksheet" && !worksheet) {
    return <p role="alert">This worksheet is not available. <Link prefetch={false} href="/work/general-calculus">Open general calculus</Link>.</p>;
  }
  const problemSource = worksheet ? "worksheet" : "handwriting";
  const problems = worksheet?.problems ?? [1, 2].map(index => ({
    id: `${worksheetId}/p${index}`, label: String(index),
    statementLatex: "Write your problem, then work one step per row.",
  }));
  const page = `/work/${encodeURIComponent(worksheetId)}`;
  const worksheetHref = worksheet || (source === "handwriting" && worksheetId !== "general-calculus")
    ? `${page}?source=worksheet` : "/courses";
  const canvas = <WorksheetCanvas key={`${worksheetId}/${problemSource}`} worksheetId={worksheetId} problems={problems} problemSource={problemSource} />;
  return <>
    <nav aria-label="Problem source" style={{ display: "flex", gap: 16 }}>
      <Link prefetch={false} href={`${page}?source=handwriting`} aria-current={problemSource === "handwriting" ? "page" : undefined}>General calculus</Link>
      <Link prefetch={false} href={worksheetHref}
        aria-current={problemSource === "worksheet" ? "page" : undefined}>{worksheet ? "Worksheet" : "Choose worksheet"}</Link>
    </nav>
    <p data-problem-source={problemSource}>{worksheet ? `${worksheet.title}: hints use these assigned questions and your course notes.`
      : "General calculus: hints follow the problem and steps you write."}</p>
    <p>Choose a source before writing. Switching opens a fresh page.</p>
    {worksheet ? <WorksheetShell worksheet={worksheet}>{canvas}</WorksheetShell> : canvas}
  </>;
}

export default function WorkPage(props: WorkPageProps) {
  return <>
    <h1>The page you write on</h1>
    <p>Write by hand, with room for Albert beside you.</p>
    <Suspense fallback={<p>Opening your page...</p>}>
      <WorkProblems {...props} />
    </Suspense>
  </>;
}
