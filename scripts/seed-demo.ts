import { getRepo, seedDemo } from "../src/lib/db";

async function main() {
  const counts = await seedDemo(getRepo());
  console.log(`seed:demo loaded ${counts.cards} cards and ${counts.worksheets} worksheets (STORE=${process.env.STORE || "mongo"})`);
}

main().then(() => process.exit(0), (error) => { console.error(error); process.exit(1); });
