// With STORE=memory the server loads the demo cards and worksheets at start (P3.2).
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs" || process.env.STORE !== "memory") return;
  const { getRepo, seedDemo } = await import("./lib/db");
  await seedDemo(getRepo());
}
