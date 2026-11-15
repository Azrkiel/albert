import { createHash } from "node:crypto";
import type { Repo, StoredHint } from "../contracts";

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47];
const MAX_BYTES = 4_000_000;

/**
 * Stores a hint request's marked snapshot as a cached file and points the stored hint at it. Called AFTER the hint
 * has been sent, never before: it must not slow the hint. Returns the file id, or undefined when there was nothing
 * valid to save or the hint was not stored (an unpersisted demo session, an untaught unit).
 */
export async function saveHintSnapshot(repo: Repo, args: { sessionId: string; hintId: string; imageBase64: string }): Promise<string | undefined> {
  const bytes = Uint8Array.from(Buffer.from(args.imageBase64.replace(/^data:image\/png;base64,/, ""), "base64"));
  if (bytes.length < 8 || bytes.length > MAX_BYTES || PNG_SIGNATURE.some((b, i) => bytes[i] !== b)) return undefined;
  const hint: StoredHint | undefined = (await repo.listHints({ sessionId: args.sessionId })).find((h) => h.id === args.hintId);
  if (!hint) return undefined;
  const id = `snapshot-${createHash("sha256").update(hint.id).digest("hex").slice(0, 24)}`;
  await repo.putFile({ id, courseId: hint.courseId, title: "Hint snapshot", mime: "image/png", bytes: bytes.length, kind: "other" }, bytes);
  await repo.saveHint({ ...hint, snapshotFileId: id });
  return id;
}
