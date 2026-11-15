import { InMemoryStore, MemorySaver } from "@langchain/langgraph";
import type { BaseCheckpointSaver, BaseStore } from "@langchain/langgraph";
import { MongoDBSaver, MongoDBStore } from "@langchain/langgraph-checkpoint-mongodb";
import { getMongoClient } from "../db";

export type AgentRuntime = { store: BaseStore; checkpointer: BaseCheckpointSaver };

const shared = globalThis as typeof globalThis & { albertAgentRuntimes?: Map<string, Promise<AgentRuntime>> };

/**
 * The agent's long-term store and checkpointer, chosen by STORE like the Repo.
 * Memory: process-wide InMemoryStore + MemorySaver. Mongo: MongoDBStore + MongoDBSaver
 * on the shared client; collection names stay at the package defaults.
 */
export function getAgentRuntime(): Promise<AgentRuntime> {
  const mode = process.env.STORE || "mongo";
  const uri = process.env.MONGODB_URI;
  const name = process.env.MONGODB_DB || "albert";
  const key = mode === "memory" ? "memory" : JSON.stringify([uri, name]);
  const runtimes = shared.albertAgentRuntimes ??= new Map();
  let runtime = runtimes.get(key);
  if (!runtime) {
    runtime = mode === "memory" ? Promise.resolve(memoryRuntime()) : mongoRuntime(mode, uri, name);
    runtimes.set(key, runtime);
    runtime.catch(() => runtimes.delete(key));
  }
  return runtime;
}

function memoryRuntime(): AgentRuntime {
  return { store: new InMemoryStore(), checkpointer: new MemorySaver() };
}

async function mongoRuntime(mode: string, uri: string | undefined, dbName: string): Promise<AgentRuntime> {
  if (mode !== "mongo") throw new Error(`Unknown STORE: ${mode}`);
  if (!uri) throw new Error("MONGODB_URI is required for STORE=mongo");
  // The checkpoint package bundles mongodb 6; the app uses 7. Both expose the db()/collection() surface used here.
  const client = getMongoClient(uri) as unknown as ConstructorParameters<typeof MongoDBSaver>[0]["client"];
  const store = new MongoDBStore({ client, dbName });
  await store.start();
  const checkpointer = new MongoDBSaver({ client, dbName });
  const errors = await checkpointer.setup();
  if (errors.length) throw new Error("Could not create checkpoint indexes");
  return { store, checkpointer };
}

export function agentThreadId(kind: "ingest" | "plan", courseId: string, studentId?: string): string {
  return kind === "ingest" ? `ingest:${courseId}` : `plan:${studentId ?? "demo"}:${courseId}`;
}
