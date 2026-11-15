import { getRepo } from "../../../../../../lib/db";
import { sourceErrorResponse } from "../../../../../../lib/lms/adapter";
import { filePagePng } from "../../../../../../lib/lms/pdf-files";

export async function GET(_request: Request, context: { params: Promise<{ fileId: string; n: string }> }) {
  try {
    const { fileId, n } = await context.params;
    const png = await filePagePng(getRepo(), fileId, n);
    return new Response(new Uint8Array(png), { headers: {
      "Content-Type": "image/png", "Content-Length": String(png.length), "Content-Disposition": "inline",
      "X-Content-Type-Options": "nosniff", "Cache-Control": "private, no-store",
    } });
  } catch (error) { return sourceErrorResponse(error); }
}
