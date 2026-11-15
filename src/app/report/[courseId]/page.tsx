import { Suspense } from "react";
import { connection } from "next/server";
import { notFound } from "next/navigation";
import { getRepo } from "../../../lib/db";
import { buildTutorReport, reportPeriod } from "../../../lib/progress/report";
import { TutorReportView } from "../../../components/progress/TutorReportView";

async function Report({ params }: { params: Promise<{ courseId: string }> }) {
  await connection();
  const { courseId } = await params;
  const repo = getRepo();
  if (!(await repo.getCourse(courseId)) && !(await repo.listCards(courseId)).length) notFound();
  const studentId = process.env.DEMO_STUDENT_ID?.trim() || "demo";
  const report = await buildTutorReport(studentId, courseId, reportPeriod(new Date()), repo, { studentName: process.env.DEMO_STUDENT_NAME?.trim() || "Ada" });
  return <TutorReportView report={report} />;
}

export default function ReportPage({ params }: { params: Promise<{ courseId: string }> }) {
  return <Suspense fallback={<p>Opening report...</p>}><Report params={params} /></Suspense>;
}
