import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { parseRecording } from "@/lib/canvas/recording";

export async function GET(request: Request) {
  if (process.env.NODE_ENV === "production") return new Response(null, { status: 404 });
  const name = new URL(request.url).searchParams.get("name");
  // A single filename stem: no slashes, dots, encoding tricks, drive letters or URLs.
  if (!name || !/^[a-zA-Z0-9_-]+$/.test(name)) return new Response("Invalid recording name", { status: 400 });
  try {
    const rec = parseRecording(JSON.parse(await readFile(join(process.cwd(), "fixtures", "sessions", `${name}.json`), "utf8")));
    return Response.json(rec, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const missing = error instanceof Error && "code" in error && error.code === "ENOENT";
    return new Response(missing ? "Recording not found" : "Invalid recording", { status: missing ? 404 : 400 });
  }
}
