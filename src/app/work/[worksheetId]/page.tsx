import { Suspense } from "react";
import { ProblemBlock } from "@/components/work/ProblemBlock";

type WorkPageProps = { params: Promise<{ worksheetId: string }> };

async function DemoProblems({ params }: WorkPageProps) {
  const { worksheetId } = await params;
  // Local canvas demonstration until Phase 5 supplies loaded worksheet.problems.
  const problems = [
    { id: `${worksheetId}/p1`, label: "1", statementLatex: "Write one step per row." },
    { id: `${worksheetId}/p2`, label: "2", statementLatex: "Continue with the next problem here." },
  ];
  return problems.map((problem) => <ProblemBlock key={problem.id} problem={problem} />);
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
