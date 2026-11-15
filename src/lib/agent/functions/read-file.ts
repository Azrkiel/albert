import { createHash } from "node:crypto";
import { HumanMessage } from "@langchain/core/messages";
import { PDFDocument } from "pdf-lib";
import { z } from "zod";
import type { Repo } from "../../contracts";
import { getRepo } from "../../db";
import { getChatModel, providerFor } from "../../llm";
import { rasterizePdf } from "../../lms/pdf";
export { rasterizePdf } from "../../lms/pdf";

export const TRANSCRIPTION_INSTRUCTION = "Transcribe this document faithfully to Markdown, with LaTeX for all math; keep headings, example labels and step labels exactly as written; mark page breaks as `--- page N ---`; do not summarise.";
export type FileText = { fileId: string; text: string; pages: number; lectureLabel?: string };
export type ReaderModel = { invoke(messages: HumanMessage[]): Promise<{ text: string; response_metadata?: Record<string, unknown> }> };
export type ReadOptions = {
  repo?: Repo;
  model?: ReaderModel;
  provider?: "bedrock" | "anthropic";
  rasterize?: (bytes: Uint8Array) => Promise<Uint8Array[]>;
};

function rejectsPdf(error: unknown): boolean {
  // Authentication, throttling and timeouts must never trigger extra model calls.
  if (!(error instanceof Error)) return false;
  return /(?:pdf|document).*(?:unsupported|not support(?:ed)?|invalid|reject)|(?:unsupported|not support(?:ed)?|invalid).*(?:pdf|document)/i.test(error.message);
}

function transcription(reply: { text: string; response_metadata?: Record<string, unknown> }): string {
  const stop = reply.response_metadata?.stopReason ?? reply.response_metadata?.stop_reason;
  if (stop === "max_tokens" || stop === "model_context_window_exceeded") throw new Error("Transcription was truncated; split the PDF before retrying.");
  return z.string().trim().min(1, "The reader returned an empty transcription").parse(reply.text);
}

export async function readCourseFile(fileId: string, options: ReadOptions = {}): Promise<{ text: string; pages: number }> {
  const repo = options.repo ?? getRepo();
  const file = await repo.getFile(fileId);
  if (!file) throw new Error(`Course file ${fileId} is missing from the Repo; reimport the course source.`);
  if (file.meta.mime !== "application/pdf") throw new Error(`Course file ${fileId} is not a PDF; reimport a PDF source.`);
  const pages = (await PDFDocument.load(file.bytes)).getPageCount();
  if (file.meta.textCacheId) {
    const cached = await repo.getText(file.meta.textCacheId);
    if (cached?.trim()) return { text: cached, pages };
  }
  // Converse: <=5 documents, each <=4.5 MB. Use a conservative 100-page
  // ceiling for Claude PDF processing. This function sends one document.
  // https://docs.aws.amazon.com/bedrock/latest/APIReference/API_runtime_Message.html
  if (file.bytes.length > 4_500_000 || pages > 100) throw new Error("PDF exceeds the 4.5 MB / 100-page ingestion limit; split it and reimport the source.");
  const provider = options.provider ?? providerFor("reader");
  const model = options.model ?? getChatModel("reader");
  const data = Buffer.from(file.bytes).toString("base64");
  let text: string;
  try {
    const block = provider === "bedrock"
      ? { type: "document", document: { name: "Course document", format: "pdf", source: { bytes: file.bytes }, citations: { enabled: true } } }
      : { type: "document", source: { type: "base64", media_type: "application/pdf", data } };
    text = transcription(await model.invoke([new HumanMessage({ content: [{ type: "text", text: TRANSCRIPTION_INSTRUCTION }, block] })]));
  } catch (error) {
    if (!rejectsPdf(error)) throw error;
    const images = await (options.rasterize ?? rasterizePdf)(file.bytes);
    if (images.length !== pages) throw new Error("PDF renderer returned the wrong page count.");
    const parts: string[] = [];
    // One page per call stays below Converse's 20-image limit.
    for (const [index, png] of images.entries()) {
      if (png.length > 3_750_000) throw new Error("Rendered PDF exceeds the 3.75 MB image limit.");
      const result = await model.invoke([new HumanMessage({ content: [
        { type: "text", text: `${TRANSCRIPTION_INSTRUCTION}\nThis is page ${index + 1} of ${pages}.` },
        { type: "image_url", image_url: { url: `data:image/png;base64,${Buffer.from(png).toString("base64")}` } },
      ] })]);
      parts.push(`--- page ${index + 1} ---\n${transcription(result).replace(/^--- page \d+ ---\s*/, "")}`);
    }
    text = parts.join("\n\n");
  }
  const textCacheId = `${fileId}/text-v1-${createHash("sha256").update(file.bytes).digest("hex")}`;
  await repo.putText(textCacheId, text);
  await repo.putFile({ ...file.meta, textCacheId }, file.bytes);
  return { text, pages };
}
