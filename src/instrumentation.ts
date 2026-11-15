// With STORE=memory the server loads the demo cards and worksheets at start (P3.2).
// SEED_DEMO_HISTORY=1 also loads the hand-written demo history and plan (P7.3), so the course page is never empty.
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs" || process.env.STORE !== "memory") return;
  const { getRepo, seedDemo } = await import("./lib/db");
  await seedDemo(getRepo());
  if (process.env.SEED_DEMO_HISTORY === "1") {
    const { seedDemoHistory } = await import("./lib/progress/demo-history");
    await seedDemoHistory(getRepo());
  }
}
