import { Suspense } from "react";
import { WorksheetCanvas } from "@/components/work/WorksheetCanvas";

type WorkPageProps = { params: Promise<{ worksheetId: string }> };

async function DemoProblems({ params }: WorkPageProps) {
  const { worksheetId } = await params;
  // Local canvas demonstration until Phase 5 supplies loaded worksheet.problems.
  const problems = [
    { id: `${worksheetId}/p1`, label: "1", statementLatex: worksheetId === "demo"
      ? String.raw`\int \frac{dx}{x^2\sqrt{16-x^2}}` : "Write one step per row." },
    { id: `${worksheetId}/p2`, label: "2", statementLatex: "Continue with the next problem here." },
  ];
  return <WorksheetCanvas key={worksheetId} worksheetId={worksheetId} problems={problems} />;
}

export default function WorkPage({ params }: WorkPageProps) {
  return (
    <>
      <h1>The page you write on</h1>
      <p>Work through your worksheet by hand, with room for Albert beside you.</p>
      <Suspense fallback={<p>Opening worksheet...</p>}>
        <DemoProblems params={params} />
      </Suspense>
    </>
  );
}
