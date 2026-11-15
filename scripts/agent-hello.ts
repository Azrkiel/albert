import { courseBackend, createCourseAgent, createEventMapper, getAgentRuntime } from "../src/lib/agent";
import type { AgentEvent } from "../src/lib/contracts";

// Usage: agent-hello.ts [--course id] [--student id] [--thread id] [--ask text] [--seed-memory text] [--then-thread id --then-ask text]
// Default: write a todo list and a note to /course/hello.md. --then-* runs a second, separate thread in the same process
// (needed for STORE=memory, whose store lives only for the process; with STORE=mongo run the script twice instead).
const DEFAULT_ASK = "Write a todo list with two items and save a note to /course/hello.md.";

function arg(args: string[], name: string): string | undefined {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
}

async function runOnce(courseId: string, studentId: string, thread: string, ask: string): Promise<AgentEvent[]> {
  const events: AgentEvent[] = [];
  const emit = (e: AgentEvent) => { events.push(e); console.log(`[${e.type}] ${e.label}${e.detail === undefined ? "" : " " + JSON.stringify(e.detail).slice(0, 300)}`); };
  const agent = await createCourseAgent({ studentId, courseId, emit });
  const map = createEventMapper(() => new Date());
  console.log(`--- thread ${thread}: ${ask}`);
  const stream = await agent.stream({ messages: [{ role: "user", content: ask }] }, { configurable: { thread_id: thread }, streamMode: "updates" });
  for await (const chunk of stream) for (const e of map(chunk)) emit(e);
  const counts = (type: AgentEvent["type"]) => events.filter((e) => e.type === type).length;
  console.log(`events: todo=${counts("todo")} file=${counts("file")} note=${counts("note")}`);
  return events;
}

export async function main(args = process.argv.slice(2)): Promise<void> {
  const courseId = arg(args, "course") ?? "hello-course";
  const studentId = arg(args, "student") ?? "hello-student";
  const stamp = Date.now().toString(36);
  const seed = arg(args, "seed-memory");
  if (seed) {
    const { store } = await getAgentRuntime();
    const written = await courseBackend({ studentId, courseId }, store).write("/memories/AGENTS.md", seed);
    console.log(`seeded /memories/AGENTS.md${written.error ? ` (${written.error})` : ""}`);
  }
  await runOnce(courseId, studentId, arg(args, "thread") ?? `hello:${stamp}`, arg(args, "ask") ?? DEFAULT_ASK);
  const thenAsk = arg(args, "then-ask");
  if (thenAsk) await runOnce(courseId, studentId, arg(args, "then-thread") ?? `hello:${stamp}:2`, thenAsk);
}

main().then(() => process.exit(0), (error) => {
  console.error(error instanceof Error ? `${error.name}: ${error.message.slice(0, 300)}` : "Agent run failed.");
  process.exit(1);
});
