import { Suspense } from "react";
import Link from "next/link";
import { connection } from "next/server";
import { WorksheetCanvas } from "@/components/work/WorksheetCanvas";
import { WorksheetShell } from "@/components/work/WorksheetShell";
import { PdfWorksheetCanvas } from "@/components/work/PdfWorksheetCanvas";
import { worksheetWithRegions, filePages } from "@/lib/lms/pdf-files";
import { getRepo } from "@/lib/db";

type WorkPageProps = {
  params: Promise<{ worksheetId: string }>;
  searchParams: Promise<{ source?: string; surface?: string; layout?: string; replay?: string }>;
};

async function WorkProblems({ params, searchParams }: WorkPageProps) {
  const { worksheetId } = await params;
  const { source, surface, layout, replay } = await searchParams;
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
  let pdfPages;
  let pdfError = false;
  if (worksheet?.fileId && surface !== "ruled" && surface !== "free" && !layout && !replay) {
    try {
      const repo = getRepo();
      const metadata = await filePages(repo, worksheet.fileId);
      if (metadata) { worksheet = await worksheetWithRegions(repo, worksheet); pdfPages = metadata; }
    } catch { pdfError = true; }
  }
  const recorded = process.env.MOCK_LLM === "1";
  const canvas = pdfPages && worksheet ? <PdfWorksheetCanvas key={`${worksheet.id}/${worksheet.fileId}`} worksheet={worksheet} pages={pdfPages} recorded={recorded} /> : <WorksheetCanvas key={`${worksheetId}/${problemSource}`} worksheetId={worksheetId} problems={problems} problemSource={problemSource} />;
  return <>
    <nav aria-label="Problem source" style={{ display: "flex", gap: 16 }}>
      <Link prefetch={false} href={`${page}?source=handwriting`} aria-current={problemSource === "handwriting" ? "page" : undefined}>General calculus</Link>
      <Link prefetch={false} href={worksheetHref}
        aria-current={problemSource === "worksheet" ? "page" : undefined}>{worksheet ? "Worksheet" : "Choose worksheet"}</Link>
    </nav>
    <p data-problem-source={problemSource}>{worksheet ? `${worksheet.title}: hints use these assigned questions and your course notes.`
      : "General calculus: hints follow the problem and steps you write."}</p>
    <p>Choose a source before writing. Switching opens a fresh page.</p>
    {recorded && !pdfPages && <p data-recorded-preview="">Recorded preview: replies use saved examples and do not read your handwriting.</p>}
    {pdfError && <p role="alert">Could not open the PDF pages. You can still use the writing area below and open Original.</p>}
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
