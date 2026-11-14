import { MemoryRepo } from "./memory";
import { getMongoClient, MongoRepo } from "./mongo";
import type { Repo } from "./repo";

export type { Repo } from "./repo";
export { MemoryRepo } from "./memory";
export { getMongoClient, MongoRepo } from "./mongo";

const shared = globalThis as typeof globalThis & {
  albertMemoryRepo?: MemoryRepo;
  albertMongoRepos?: Map<string, MongoRepo>;
};

export function getRepo(): Repo {
  const store = process.env.STORE || "mongo";
  if (store === "memory") return shared.albertMemoryRepo ??= new MemoryRepo();
  if (store !== "mongo") throw new Error(`Unknown STORE: ${store}`);
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error("MONGODB_URI is required for STORE=mongo");
  const name = process.env.MONGODB_DB || "albert";
  const repos = shared.albertMongoRepos ??= new Map();
  const key = JSON.stringify([uri, name]);
  let repo = repos.get(key);
  if (!repo) {
    repo = new MongoRepo(getMongoClient(uri).db(name));
    repos.set(key, repo);
  }
  return repo;
}
export { seedDemo } from "./seed-demo";
