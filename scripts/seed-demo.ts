import { getRepo, seedDemo } from "../src/lib/db";
import { seedDemoHistory } from "../src/lib/progress/demo-history";

// Cards and worksheets, then hand-written demo history: two earlier sessions, their hints and evidence, and a study
// plan. All of the history is seed data (plan ids start with "seed-demo-plan"), never agent output. Pass --no-history
// to load only the cards and worksheets.
async function main() {
  const repo = getRepo();
  const counts = await seedDemo(repo);
  console.log(`seed:demo loaded ${counts.cards} cards and ${counts.worksheets} worksheets (STORE=${process.env.STORE || "mongo"})`);
  if (process.argv.includes("--no-history")) return;
  const h = await seedDemoHistory(repo);
  console.log(`seed:demo history for ${h.studentId} in ${h.courseId}: ${h.sessions} sessions, ${h.hints} hints, ${h.evidence} evidence events, 1 demo plan`);
}

main().then(() => process.exit(0), (error) => { console.error(error); process.exit(1); });
