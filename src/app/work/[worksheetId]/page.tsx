import { Suspense } from "react";
import Link from "next/link";
import { connection } from "next/server";
import { WorksheetCanvas } from "@/components/work/WorksheetCanvas";
import { WorksheetShell } from "@/components/work/WorksheetShell";
import { worksheetWithRegions } from "@/lib/lms/pdf-files";
import { getRepo } from "@/lib/db";
import { decodeRouteId } from "@/lib/route-id";

type WorkPageProps = {
  params: Promise<{ worksheetId: string }>;
  searchParams: Promise<{ source?: string }>;
};

async function WorkProblems({ params, searchParams }: WorkPageProps) {
  const { worksheetId: rawWorksheetId } = await params;
  const worksheetId = decodeRouteId(rawWorksheetId);
  const { source } = await searchParams;
  await connection();
  const general = source === "handwriting" || worksheetId === "general-calculus";
  let worksheet;
  try {
    worksheet = general ? null : await getRepo().getWorksheet(worksheetId);
    if (worksheet) worksheet = await worksheetWithRegions(getRepo(), worksheet);
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
  const canvas = <WorksheetCanvas key={`${worksheetId}/${problemSource}/${worksheet?.fileId ?? ""}`} worksheetId={worksheetId} problems={problems} worksheetTitle={worksheet?.title} fileId={worksheet?.fileId} pdfProblems={worksheet?.problems} problemSource={problemSource} />;
  return <>
    <nav aria-label="Problem source" className="source-nav">
      <Link prefetch={false} href={`${page}?source=handwriting`} aria-current={problemSource === "handwriting" ? "page" : undefined}>General calculus</Link>
      <Link prefetch={false} href={worksheetHref}
        aria-current={problemSource === "worksheet" ? "page" : undefined}>{worksheet ? "Worksheet" : "Choose worksheet"}</Link>
    </nav>
    <p data-problem-source={problemSource} className="work-note">{worksheet ? `${worksheet.title}: hints use these assigned questions and your course notes.`
      : "General calculus: hints follow the problem and steps you write."}</p>
    <p className="work-note work-note--quiet">Choose a source before writing.</p>
    {process.env.MOCK_LLM === "1" && <p data-recorded-preview="" className="work-note work-note--badge">Recorded preview: replies use saved examples and do not read your handwriting.</p>}
    {worksheet ? <WorksheetShell worksheet={worksheet}>{canvas}</WorksheetShell> : canvas}
  </>;
}

export default function WorkPage(props: WorkPageProps) {
  return <>
    <h1 className="work-title">The page you write on</h1>
    <p>Write by hand, with room for Albert beside you.</p>
    <Suspense fallback={<p>Opening your page...</p>}>
      <WorkProblems {...props} />
    </Suspense>
  </>;
}
